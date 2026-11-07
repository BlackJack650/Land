import { BALANCE as B } from '../../config/balance.js';
import { buildingCost, neutralCost, distance, clamp } from '../../shared/formulas.js';
import { seededRandom } from '../../shared/rng.js';
import { regionBusy } from '../sim/combat.js';

// Utility AI issues the exact same validated intentions as a human. It has no
// economy multipliers, free units, extra combat power, or privileged mutations.
export class AIController {
  constructor(room, player) {
    this.player = player; this.profile = B.ai.profiles[player.difficulty];
    this.random = seededRandom(`${room.settings.seed}:ai:${player.id}`);
    this.nextThink = this.profile.reactionMs / 1000 + this.random() * 0.3;
    player.autoExpand = player.difficulty >= 3;
  }
  think(room) {
    if (room.time < this.nextThink || this.player.eliminated || !this.player.connected) return;
    this.nextThink = room.time + this.profile.reactionMs / 1000;
    const p = this.player, rng = this.random, profile = this.profile;
    const own = p.owned.map(id => room.regions[id]);
    if (!own.length) return;
    const scale = room.map.width / B.map.width;
    const enemies = own.flatMap(r => r.neighbors.map(id => room.regions[id])).filter(r => r.ownerId !== p.id);
    const enemyBuildings = room.regions.filter(r => r.ownerId !== null && r.ownerId !== p.id && Object.keys(r.buildings).some(t => t === 'drone' || t === 'missile'));
    const candidates = [];
    const mistake = rng() < B.ai.mistakeChance * (6 - p.difficulty) / 5;
    // Infrastructure utility: homes near cap, capital defence, AA against drones.
    for (const r of own) {
      if (regionBusy(room, r.id)) continue;
      for (const type of ['house','port','fort','aa','drone','missile']) {
        if (type === 'port' && (!r.isCoastal || p.difficulty < 3 || p.portLevels >= Math.ceil(p.regionsCount / 12))) continue;
        if (type === 'fort' && p.difficulty < 2) continue;
        if (type === 'aa' && (p.difficulty < 3 || r.buildings.aa)) continue;
        if (type === 'drone' && p.difficulty < 4) continue;
        if (type === 'missile' && p.difficulty < 5) continue;
        const old = r.buildings[type], level = (old?.level || 0) + 1;
        if (level > B.buildings.maxLevel) continue;
        const cost = buildingCost(type, p.buildingCount, level);
        if (cost > p.economy) continue;
        let score = 0;
        if (type === 'house') score = (p.troops / p.cap > 0.65 ? 24 : 7) + Math.min(12, p.regionsCount / 3) - p.houseLevels * 0.65;
        if (type === 'port') score = enemies.some(e => e.ownerId === null && r.seaNeighbors.includes(e.id)) ? 15 : 5 + p.regionsCount / 20;
        if (type === 'fort') {
          const threat = r.neighbors.reduce((n,id) => n + (room.regions[id].ownerId !== null && room.regions[id].ownerId !== p.id ? room.regions[id].troops : 0), 0);
          score = threat > p.troops * 0.25 ? 20 + (r.id === p.capitalId ? 12 : 0) : (r.id === p.capitalId ? 9 : 1);
        }
        if (type === 'aa') score = enemyBuildings.some(e => distance(r,e) < B.buildings.drone.radius * scale) ? 38 : 0;
        if (type === 'drone' || type === 'missile') {
          const range = B.buildings[type].radius * scale;
          const targets = enemies.filter(e => Object.keys(e.buildings).length && distance(r,e) <= range);
          score = targets.length ? 17 + targets.length * 3 : 0;
        }
        score *= profile.buildBudget * (0.85 + rng() * 0.3);
        if (old) score *= 0.65;
        if (mistake) score *= rng() * 2;
        if (score > 0) candidates.push({ score, type: 'BUILD', payload: { regionId: r.id, type } });
      }
    }
    if (room.time >= room.settings.peaceSeconds) {
      for (const r of own) {
        if (regionBusy(room, r.id) || r.troops < 3) continue;
        for (const id of r.neighbors) {
          const target = room.regions[id];
          if (target.ownerId === p.id || regionBusy(room,id)) continue;
          const sea = !r.landNeighbors.includes(id), port = r.buildings.port?.level || 0;
          if (sea && !port) continue;
          const fort = target.buildings.fort?.level || 0;
          const cost = target.ownerId === null ? neutralCost(target, room.averageArea) : target.troops * (1 + B.attack.fortDefense * fort) / ((1 + B.attack.portForceBonus * port * sea) * (1 - B.attack.fortForceLoss * fort));
          const desired = Math.ceil(cost * 1.18 + 2);
          const available = Math.floor(r.troops * (1 - B.ai.reserveFraction * (target.ownerId !== null)));
          if (desired > available) continue;
          let score = (target.ownerId === null ? 22 : 13 + profile.aggression * 18) + (target.isCoastal ? 2 : 0) + Object.keys(target.buildings).length * 4 - cost / Math.max(1,r.troops) * 10;
          if (target.ownerId !== null) {
            const risk = target.neighbors.filter(n => room.regions[n].ownerId !== null && room.regions[n].ownerId !== p.id).reduce((sum,n) => sum + room.regions[n].troops,0);
            score -= risk / Math.max(1,r.troops) * 4;
            if (p.difficulty >= 4) score += 8 / Math.max(1, room.players[target.ownerId].regionsCount);
          }
          score *= (0.8 + rng() * 0.4) * (0.6 + profile.aggression);
          if (mistake) score *= rng();
          const percent = clamp(Math.ceil(desired / r.troops * 100), 5, 85);
          candidates.push({ score, type: 'ATTACK', payload: { fromRegions: [r.id], toRegionId: id, percent } });
        }
      }
    }
    candidates.sort((a,b) => b.score-a.score);
    const action = candidates[0];
    if (action && (action.type === 'ATTACK' || rng() < profile.buildBudget + 0.25 || p.troops / p.cap > 0.8)) this.command(room, action.type, action.payload);
    // Move interior reserves one hop towards the nearest frontier (no teleport).
    if (!action || action.type === 'BUILD') {
      const reserve = own.filter(r => !p.frontier.includes(r.id) && r.troops > 15 && !regionBusy(room,r.id)).sort((a,b) => b.troops-a.troops)[0];
      if (reserve) {
        const queue = [[reserve.id]], seen = new Set([reserve.id]); let next = null;
        for (let i = 0; i < queue.length && next === null; i++) {
          const path = queue[i];
          for (const id of room.regions[path.at(-1)].landNeighbors) {
            if (seen.has(id) || room.regions[id].ownerId !== p.id) continue;
            seen.add(id);
            if (p.frontier.includes(id)) { next = path.length > 1 ? path[1] : id; break; }
            queue.push([...path,id]);
          }
        }
        if (next !== null && !regionBusy(room,next)) this.command(room, 'TRANSFER', { fromRegions: [reserve.id], toRegionId: next, percent: 65 });
      }
    }
  }
  command(room, type, payload) { room.enqueue({ playerId: this.player.id, message: { t: 'CMD', cmdId: `ai-${this.player.id}-${room.tickNumber}-${type}`, type, payload }, internal: true }); }
}
