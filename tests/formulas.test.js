import test from 'node:test';
import assert from 'node:assert/strict';
import { troopCap, troopGrowth, economyIncome, tradeIncome, totalIncome, takeProportional, resolveCombat, neutralCost, buildingCost, upgradeBuilding, captureBuilding, captureProbabilities } from '../shared/formulas.js';

test('growth, cap, economy and trade use the configured formulas', () => {
  assert.equal(troopCap(0),300); assert.equal(troopCap(10),3800);
  assert.ok(Math.abs(troopGrowth(100,10)-0.30*100**0.92*1.3)<1e-10);
  assert.equal(troopGrowth(0,10),0); assert.equal(economyIncome(100,10),9.5);
  assert.ok(Math.abs(tradeIncome(100,4)-2.1)<1e-10); assert.ok(Math.abs(totalIncome(100,10,4)-11.6)<1e-10);
});
test('proportional withdrawal preserves integer troops at 0, 25 and 100 percent', () => {
  const regions=[{id:0,troops:10},{id:1,troops:1}];
  assert.equal(takeProportional(regions,0).force,0);
  const quarter=takeProportional(regions,25); assert.equal(quarter.force,2); assert.equal(quarter.taken.reduce((n,x)=>n+x.count,0),2);
  const all=takeProportional(regions,100); assert.equal(all.force,11); assert.deepEqual(all.taken,[{id:0,count:10},{id:1,count:1}]);
  assert.throws(()=>takeProportional(regions,101));
});
test('combat resolves captures, fort defence and naval bonuses', () => {
  assert.deepEqual(resolveCombat(100,30),{captured:true,remaining:70,attack:100,defense:30});
  const fort=resolveCombat(100,100,5); assert.equal(fort.captured,false); assert.equal(fort.attack,60); assert.equal(fort.defense,150); assert.equal(fort.remaining,60);
  assert.equal(resolveCombat(100,30,0,2).remaining,100);
  assert.equal(neutralCost({area:4,troops:2},16),1);
});
test('building prices grow globally and upgrades restore only half of the new maximum', () => {
  assert.equal(buildingCost('house',0),100); assert.equal(buildingCost('house',1),108); assert.equal(buildingCost('house',0,2),160); assert.equal(buildingCost('house',1,2),173);
  const b={type:'house',level:4,hp:100,maxHp:400}; const upgraded=upgradeBuilding(b,'house'); assert.equal(upgraded.level,5); assert.equal(upgraded.hp,350); assert.equal(b.hp,100);
  assert.throws(()=>upgradeBuilding(upgraded,'house'),/Maximum level/); assert.throws(()=>buildingCost('house',0,6));
});
test('capture rolls produce all three outcomes; damaged buildings lose a level and HP', () => {
  const b={type:'fort',level:3,hp:300,maxHp:450}; const p=captureProbabilities(b); assert.ok(Math.abs(p.intact+p.damaged+p.destroyed-1)<1e-10);
  assert.equal(captureBuilding(b,0).outcome,'destroyed'); assert.equal(captureBuilding(b,p.destroyed+0.01).outcome,'damaged'); assert.equal(captureBuilding(b,0.99).outcome,'intact');
  const damaged=captureBuilding(b,p.destroyed+0.01).building; assert.equal(damaged.level,2); assert.equal(damaged.hp,150); assert.equal(damaged.maxHp,300);
  const intact=captureBuilding(b,0.99).building; assert.equal(intact.hp,300); assert.notEqual(intact,b);
});
