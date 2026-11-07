import { BALANCE as B } from '../../config/balance.js';
import { troopCap, troopGrowth, totalIncome } from '../../shared/formulas.js';
export function refreshStats(room, economy = true) {
  for (const p of room.players) { p.regionsCount = 0; p.troops = 0; p.buildingCount = 0; if (economy) { p.houseLevels = 0; p.portLevels = 0; } p.owned.length = 0; p.frontier.length = 0; }
  for (const r of room.regions) {
    if (r.ownerId === null) continue;
    const p = room.players[r.ownerId]; if (!p) continue;
    p.regionsCount++; p.troops += r.troops; p.owned.push(r.id);
    if (r.neighbors.some(id => room.regions[id].ownerId !== r.ownerId)) p.frontier.push(r.id);
    for (const b of Object.values(r.buildings)) { p.buildingCount++; if (economy) { if (b.type === 'house') p.houseLevels += b.level; if (b.type === 'port') p.portLevels += b.level; } }
  }
  for (const p of room.players) {
    if (economy) { p.cap = troopCap(p.houseLevels); p.growth = troopGrowth(p.regionsCount, p.houseLevels); p.income = totalIncome(p.regionsCount, p.houseLevels, p.portLevels); }
    p.peakRegions = Math.max(p.peakRegions || 0, p.regionsCount);
  }
}
export function growEconomies(room, dt) {
  for (const p of room.players) {
    if (!p.regionsCount || p.eliminated) continue;
    p.economy += p.income * dt;
    if (p.troops < p.cap) {
      p.growthPool += p.growth * dt;
      let amount = Math.floor(Math.min(p.growthPool, p.cap - p.troops));
      p.growthPool -= amount; p.troops += amount;
      const targets = p.frontier.length ? p.frontier : p.owned;
      while (amount-- > 0) { const r = room.regions[targets[p.growthCursor++ % targets.length]]; r.troops++; }
    }
  }
}
