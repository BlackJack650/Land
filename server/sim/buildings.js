import { BALANCE as B } from '../../config/balance.js';
import { buildingCost, upgradeBuilding, distance } from '../../shared/formulas.js';
import { refreshStats } from './economy.js';
import { GameError, regionBusy } from './combat.js';
export function build(room, player, { regionId, type }) {
  const r = room.regions[regionId];
  if (!r || r.ownerId !== player.id) throw new GameError('NOT_OWNER');
  if (regionBusy(room, regionId)) throw new GameError('TARGET_BUSY');
  if (type === 'port' && !r.isCoastal) throw new GameError('INVALID');
  const old = r.buildings[type], level = old ? old.level + 1 : 1;
  if (level > B.buildings.maxLevel) throw new GameError('MAX_LEVEL');
  const cost = buildingCost(type, player.buildingCount, level);
  if (player.economy < cost) throw new GameError('INSUFFICIENT_FUNDS');
  player.economy -= cost;
  r.buildings[type] = old ? { ...upgradeBuilding(old, type), lastAct: room.time } : { type, level: 1, hp: B.buildings[type].hp, maxHp: B.buildings[type].hp, lastAct: room.time };
  refreshStats(room);
  room.emit(old ? 'upgrade' : 'build', { owner: player.id, to: regionId, type, level, cost }, regionId);
}
function damageBuilding(room, r, type, damage, owner) {
  const b = r.buildings[type]; if (!b) return;
  b.hp = Math.max(0, b.hp - damage);
  if (b.hp <= 0) { delete r.buildings[type]; room.emit('destroyed', { owner, to: r.id, type, level: b.level }, r.id); }
  else room.emit('damaged', { owner, to: r.id, type, damage, hp: b.hp }, r.id);
}
function targetsInRange(room, owner, origin, radius) {
  const result = [];
  for (const r of room.regions) if (r.ownerId !== null && r.ownerId !== owner && Object.keys(r.buildings).length && distance(origin, r) <= radius) result.push(r);
  return result;
}
export function advanceWeapons(room) {
  const scale = room.map.width / B.map.width;
  // Air defence intercepts projectiles, never buildings.
  for (const r of room.regions) {
    const aa = r.buildings.aa;
    if (!aa || r.ownerId === null || room.time - aa.lastAct < B.buildings.aa.cooldown) continue;
    const radius = B.buildings.aa.radius * scale;
    let intercepted = 0;
    for (let i = room.projectiles.length - 1; i >= 0 && intercepted < aa.level; i--) {
      const shot = room.projectiles[i];
      if (shot.owner === r.ownerId || distance(r, room.regions[shot.to]) > radius) continue;
      if (shot.type === 'missile' && room.random() >= Math.min(B.buildings.aa.missileChanceCap, B.buildings.aa.missileChance * aa.level)) continue;
      room.projectiles.splice(i, 1); intercepted++; aa.lastAct = room.time;
      room.emit('intercept', { owner: r.ownerId, to: shot.to, type: shot.type }, shot.to);
    }
  }
  for (let i = room.projectiles.length - 1; i >= 0; i--) {
    const shot = room.projectiles[i]; if (room.time < shot.arrival) continue;
    room.projectiles.splice(i, 1); const target = room.regions[shot.to];
    if (target.ownerId === null || target.ownerId === shot.owner) continue;
    const splash = shot.type === 'missile' ? B.buildings.missile.splash * scale : 0;
    for (const r of room.regions) {
      if (r.ownerId === null || r.ownerId === shot.owner || distance(target, r) > splash) continue;
      for (const type of Object.keys(r.buildings)) damageBuilding(room, r, type, shot.damage, shot.owner);
    }
    room.emit('explosion', { owner: shot.owner, to: shot.to, type: shot.type }, shot.to);
    refreshStats(room);
  }
  for (const r of room.regions) {
    if (r.ownerId === null || room.players[r.ownerId]?.connected === false) continue;
    for (const type of ['drone', 'missile']) {
      const b = r.buildings[type]; if (!b) continue;
      const def = B.buildings[type];
      if (room.time < room.settings.peaceSeconds || room.time - b.lastAct < def.cooldown) continue;
      const targets = targetsInRange(room, r.ownerId, r, def.radius * scale);
      if (!targets.length) continue;
      const target = targets[Math.floor(room.random() * targets.length)];
      b.lastAct = room.time;
      room.projectiles.push({ id: room.nextEntityId++, owner: r.ownerId, type, from: r.id, to: target.id, damage: def.damage * b.level, start: room.time, arrival: room.time + def.flightSeconds });
      room.emit(type, { owner: r.ownerId, from: r.id, to: target.id, level: b.level }, target.id);
    }
  }
}
