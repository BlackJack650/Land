import { BALANCE as B } from '../../config/balance.js';
import { distance, takeProportional, resolveCombat, neutralCost, captureBuilding } from '../../shared/formulas.js';
import { refreshStats } from './economy.js';
export class GameError extends Error { constructor(code) { super(code); this.code = code; } }
export function regionBusy(room, id) { return room.lockedSources.has(id) || room.lockedTargets.has(id); }
export function launchAttack(room, player, payload, transfer = false) {
  if (room.time - player.lastAttackAt < B.attack.cooldownSeconds) throw new GameError('RATE_LIMIT');
  if (!transfer && room.time < room.settings.peaceSeconds) throw new GameError('PEACE');
  if (payload.percent === 0) throw new GameError('ZERO_FORCE');
  const sources = payload.fromRegions.map(id => room.regions[id]);
  const target = room.regions[payload.toRegionId];
  if (!target || sources.some(r => !r)) throw new GameError('INVALID');
  if (sources.some(r => r.ownerId !== player.id) || (transfer && target.ownerId !== player.id)) throw new GameError('NOT_OWNER');
  if (!transfer && target.ownerId === player.id) throw new GameError('NOT_OWNER');
  if (sources.some(r => room.lockedSources.has(r.id))) throw new GameError('SOURCE_BUSY');
  if (regionBusy(room, target.id)) throw new GameError('TARGET_BUSY');
  const byLand = sources.some(r => r.landNeighbors.includes(target.id));
  const bySea = sources.some(r => r.seaNeighbors.includes(target.id));
  if (!byLand && !bySea) throw new GameError('NOT_ADJACENT');
  const portLevel = byLand ? 0 : Math.max(0, ...sources.map(r => r.buildings.port?.level || 0));
  if (!byLand && !portLevel && !transfer) throw new GameError('PORT_REQUIRED');
  const { force, taken } = takeProportional(sources, payload.percent);
  if (force < 1) throw new GameError('NO_TROOPS');
  for (const s of taken) room.regions[s.id].troops -= s.count;
  player.troops -= force; player.lastAttackAt = room.time;
  deployWave(room, player.id, taken, target.id, { force, navalLevel: transfer ? 0 : portLevel, auto: player.autoExpand && !transfer, transfer });
}
export function deployWave(room, owner, taken, targetId, { force, navalLevel = 0, auto = false, transfer = false }) {
  const target = room.regions[targetId];
  const nearest = taken.reduce((best, s) => distance(room.regions[s.id], target) < distance(room.regions[best.id], target) ? s : best, taken[0]);
  const fort = transfer ? 0 : target.buildings.fort?.level || 0;
  const duration = (B.attack.baseSeconds + B.attack.secondsPerCell * distance(room.regions[nearest.id], target)) * (fort && !navalLevel ? B.attack.fortSlow : 1);
  const wave = { id: room.nextEntityId++, owner, from: taken.map(s => s.id), fromX: room.regions[nearest.id].x, fromY: room.regions[nearest.id].y, to: targetId, force, navalLevel, auto, transfer, start: room.time, arrival: room.time + duration };
  room.waves.push(wave);
  for (const id of wave.from) room.lockedSources.add(id);
  room.lockedTargets.add(targetId);
  if (!transfer) room.emit('attack', { owner, to: targetId, from: wave.from, force, sea: navalLevel > 0 }, targetId);
  return wave;
}
function captureRegion(room, wave, remaining) {
  const r = room.regions[wave.to], previous = r.ownerId, attacker = room.players[wave.owner];
  if (previous !== null) { const defender = room.players[previous]; defender.regionsCount = Math.max(0, defender.regionsCount - 1); defender.troops -= r.troops; room.emit('lost', { owner: previous, by: wave.owner, to: r.id }, r.id); }
  r.ownerId = wave.owner; r.troops = Math.max(1, remaining); attacker.regionsCount++; attacker.troops += r.troops;
  for (const [type, b] of Object.entries(r.buildings)) {
    const result = captureBuilding(b, room.random(), wave.force);
    if (result.building) { r.buildings[type] = { ...result.building, lastAct: room.time }; attacker.buildingCount++; }
    else delete r.buildings[type];
    if (previous !== null) room.emit('buildingCapture', { owner: wave.owner, previous, to: r.id, type, outcome: result.outcome, level: b.level }, r.id);
  }
  room.flashes.push({ id: r.id, at: room.time, owner: wave.owner });
  room.emit('capture', { owner: wave.owner, previous, to: r.id, count: 1, troops: r.troops }, r.id);
  if (wave.auto && r.troops > 2) {
    const choices = r.neighbors.map(id => room.regions[id]).filter(t => t.ownerId !== wave.owner && !regionBusy(room, t.id) && (t.ownerId !== null || r.troops > neutralCost(t, room.averageArea) + 1) && (r.landNeighbors.includes(t.id) || r.buildings.port));
    choices.sort((a,b) => (a.ownerId === null ? 0 : 1000) + a.troops - ((b.ownerId === null ? 0 : 1000) + b.troops));
    if (choices[0]) deployWave(room, wave.owner, [{ id: r.id, count: r.troops }], choices[0].id, { force: r.troops, navalLevel: r.landNeighbors.includes(choices[0].id) ? 0 : r.buildings.port.level, auto: true });
  }
}
export function advanceWaves(room) {
  for (let i = room.waves.length - 1; i >= 0; i--) {
    const wave = room.waves[i]; if (room.time < wave.arrival) continue;
    room.waves.splice(i, 1);
    for (const id of wave.from) room.lockedSources.delete(id);
    room.lockedTargets.delete(wave.to);
    const r = room.regions[wave.to], p = room.players[wave.owner];
    // A wave already dispatched remains valid if its source was captured.
    if (wave.transfer) { const destination = r.ownerId === wave.owner ? r : room.regions[p.owned[0]]; if (destination) { destination.troops += wave.force; p.troops += wave.force; } continue; }
    if (r.ownerId === wave.owner) { r.troops += wave.force; p.troops += wave.force; continue; }
    let captured, remaining;
    if (r.ownerId === null) { const cost = neutralCost(r, room.averageArea); captured = wave.force > cost; remaining = Math.max(1, Math.ceil(wave.force - cost)); }
    else ({ captured, remaining } = resolveCombat(wave.force, r.troops, r.buildings.fort?.level || 0, wave.navalLevel));
    if (captured) captureRegion(room, wave, remaining);
    else { r.troops = remaining; if (r.ownerId !== null) room.players[r.ownerId].troops = room.regions.filter(x => x.ownerId === r.ownerId).reduce((n,x) => n+x.troops,0); room.emit('repelled', { owner: wave.owner, to: r.id, defender: r.ownerId }, r.id); }
  }
}
