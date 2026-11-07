import { BALANCE as B } from '../config/balance.js';
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const troopCap = houses => B.growth.baseCap + B.growth.capPerHouse * houses;
export const troopGrowth = (regions, houses) => regions <= 0 ? 0 : B.growth.coefficient * regions ** B.growth.exponent * (1 + B.growth.houseMultiplier * houses);
export const economyIncome = (regions, houses) => B.economy.regionIncome * regions + B.economy.houseIncome * houses;
export const tradeIncome = (regions, ports) => B.economy.portIncome * ports * (1 + B.economy.portRegionBonus * regions / 100);
export const totalIncome = (regions, houses, ports) => economyIncome(regions, houses) + tradeIncome(regions, ports);
export function buildingCost(type, owned, targetLevel = 1) {
  const def = B.buildings[type];
  if (!def || !Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > B.buildings.maxLevel) throw new Error('Invalid building level');
  return Math.round(def.cost * B.buildings.priceGrowth ** owned * B.buildings.upgradeGrowth ** (targetLevel - 1));
}
export function upgradeBuilding(building, type) {
  if (building.type !== type) throw new Error('Building type mismatch');
  if (building.level >= B.buildings.maxLevel) throw new Error('Maximum level is 5');
  const level = building.level + 1;
  const maxHp = B.buildings[type].hp * level;
  return { ...building, level, maxHp, hp: Math.min(maxHp, building.hp + maxHp * B.buildings.upgradeHealFraction) };
}
export function takeProportional(regions, percent) {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Invalid attack percent');
  const total = regions.reduce((sum, r) => sum + r.troops, 0);
  const force = Math.floor(total * percent / 100);
  const shares = regions.map(r => ({ id: r.id, exact: total ? force * r.troops / total : 0 }));
  const taken = shares.map(s => ({ id: s.id, count: Math.floor(s.exact), remainder: s.exact % 1 }));
  let left = force - taken.reduce((sum, s) => sum + s.count, 0);
  const order = [...taken].sort((a, b) => b.remainder - a.remainder || a.id - b.id);
  for (let i = 0; i < left; i++) order[i % order.length].count++;
  return { force, taken: taken.map(({ id, count }) => ({ id, count })) };
}
export function resolveCombat(force, defenders, fortLevel = 0, navalLevel = 0) {
  const attack = Math.max(0, Math.floor(force * (navalLevel ? 1 + B.attack.portForceBonus * navalLevel : 1) * (fortLevel ? 1 - B.attack.fortForceLoss * fortLevel : 1)));
  const defenseMultiplier = 1 + B.attack.fortDefense * fortLevel;
  const defense = defenders * defenseMultiplier;
  const captured = attack > defense;
  // Surviving defenders retain the unconsumed garrison. This resolves the
  // contradictory "lose all / retain remainder" wording in the supplied brief.
  const remaining = captured ? Math.ceil(attack - defense) : Math.max(0, Math.ceil(defenders - attack / defenseMultiplier));
  return { captured, remaining, attack, defense };
}
export function neutralCost(region, averageArea = 17) {
  return (B.attack.neutralBase + B.attack.neutralTroopCost * region.troops) * (region.area / averageArea) ** B.attack.areaExponent;
}
export function captureProbabilities(building, force = 0) {
  const c = B.capture;
  // The brief's remaining-HP formula is the default. overkillWeight is an
  // explicit, optional balance knob for a more destructive ruleset.
  const destroyed = clamp(c.destroyed - c.hpDestructionWeight * (building.hp / building.maxHp) + c.overkillWeight * Math.max(0, force / building.maxHp - 1), c.minDestroy, c.maxDestroy);
  const damaged = Math.min(c.damaged, 1 - destroyed);
  return { intact: 1 - destroyed - damaged, damaged, destroyed };
}
export function captureBuilding(building, roll, force = 0) {
  const p = captureProbabilities(building, force);
  if (roll < p.destroyed) return { outcome: 'destroyed', building: null };
  if (roll < p.destroyed + p.damaged) {
    const level = Math.max(1, building.level - 1);
    const maxHp = B.buildings[building.type].hp * level;
    return { outcome: 'damaged', building: { ...building, level, maxHp, hp: Math.max(1, Math.min(maxHp, Math.floor(building.hp * B.capture.damageHpFraction))) } };
  }
  return { outcome: 'intact', building: { ...building } };
}
