import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameRoom } from '../server/rooms/gameRoom.js';
import { advanceWeapons } from '../server/sim/buildings.js';
import { refreshStats } from '../server/sim/economy.js';
import { launchAttack } from '../server/sim/combat.js';
import { distance } from '../shared/formulas.js';
const map=JSON.parse(fs.readFileSync('shared/map/map.json'));
function sandbox(){const r=new GameRoom('INFRA',{map,headless:true,settings:{bots:1,peaceSeconds:0,minutes:5}});r.addPlayer({name:'A'});r.addBot(1);r.startCountdown();for(let i=0;i<65;i++)r.tick(.05);r.ai.clear();r.players[0].economy=10000;r.players[1].economy=10000;return r;}
function frontline(r,maxDistance=Infinity){let a=r.regions[r.players[0].capitalId];let b=r.regions[a.landNeighbors.find(id=>distance(a,r.regions[id])<=maxDistance)??a.landNeighbors[0]];if(!b||distance(a,b)>maxDistance){outer:for(const x of r.regions)for(const id of x.landNeighbors){const y=r.regions[id];if(distance(x,y)<=maxDistance){a=x;b=y;a.ownerId=0;break outer;}}}b.ownerId=1;b.troops=20;b.buildings={};a.troops=200;refreshStats(r);return [a,b];}
const building=(type,level=1)=>({type,level,hp:mapBuildingHp(type)*level,maxHp:mapBuildingHp(type)*level,lastAct:-1000});
function mapBuildingHp(type){return {house:100,port:120,fort:150,drone:80,missile:60,aa:100}[type];}
test('drones damage enemy infrastructure and never regenerate its HP',()=>{
  const r=sandbox(),[a,b]=frontline(r,5);a.buildings.drone=building('drone');b.buildings.house=building('house');advanceWeapons(r);assert.equal(r.projectiles.length,1);assert.equal(r.projectiles[0].type,'drone');r.time+=1;advanceWeapons(r);assert.equal(b.buildings.house.hp,75);for(let i=0;i<20;i++)r.tick(.05);assert.equal(b.buildings.house.hp,75);
});
test('ballistic missiles fly for 2.5 seconds and can destroy a building',()=>{
  const r=sandbox(),[a,b]=frontline(r);a.buildings.missile=building('missile');b.buildings.house=building('house');advanceWeapons(r);const shot=r.projectiles[0];assert.ok(Math.abs(shot.arrival-shot.start-2.5)<1e-9);r.time+=2.6;advanceWeapons(r);assert.equal(b.buildings.house,undefined);assert.ok(r.events.some(e=>e.type==='destroyed'));
});
test('AA intercepts drones and can intercept missiles without damaging buildings',()=>{
  const r=sandbox(),[a,b]=frontline(r);b.buildings.aa=building('aa');r.projectiles.push({id:900,owner:0,type:'drone',from:a.id,to:b.id,damage:25,start:r.time,arrival:r.time+1});advanceWeapons(r);assert.equal(r.projectiles.length,0);assert.ok(r.events.some(e=>e.type==='intercept'));
  b.buildings.aa.lastAct=-1000;r.projectiles.push({id:901,owner:0,type:'missile',from:a.id,to:b.id,damage:120,start:r.time,arrival:r.time+2.5});r.random=()=>0;advanceWeapons(r);assert.equal(r.projectiles.length,0);assert.equal(b.buildings.aa.hp,100);
});
test('ports enable sea attacks, add trade income, and forts slow land waves',()=>{
  const r=sandbox(),p=r.players[0];const coast=r.regions.find(x=>x.isCoastal&&x.seaNeighbors.some(id=>r.regions[id].ownerId===null));coast.ownerId=0;coast.troops=200;refreshStats(r);const before=p.income;const target=coast.seaNeighbors.find(id=>r.regions[id].ownerId===null);
  assert.throws(()=>launchAttack(r,p,{fromRegions:[coast.id],toRegionId:target,percent:50}),/PORT_REQUIRED/);
  p.lastAttackAt=-Infinity;coast.buildings.port=building('port');refreshStats(r);assert.ok(p.income>before);launchAttack(r,p,{fromRegions:[coast.id],toRegionId:target,percent:50});assert.equal(r.waves.at(-1).navalLevel,1);
  const [a,b]=frontline(r);b.ownerId=1;b.buildings.fort=building('fort',2);p.lastAttackAt=-Infinity;launchAttack(r,p,{fromRegions:[a.id],toRegionId:b.id,percent:20});const wave=r.waves.at(-1);assert.ok(wave.arrival-wave.start>0.25*1.5);
});
test('captured infrastructure logs intact, damaged and destroyed outcomes',()=>{
  for(const [roll,expected] of [[0,'destroyed'],[0.2,'damaged'],[0.99,'intact']]){
    const r=sandbox(),[a,b]=frontline(r);b.buildings.house=building('house',3);r.random=()=>roll;
    launchAttack(r,r.players[0],{fromRegions:[a.id],toRegionId:b.id,percent:100});const arrival=r.waves[0].arrival;
    while(r.time<arrival+0.06)r.tick(.05);
    const event=r.events.find(e=>e.type==='buildingCapture');assert.ok(event);assert.equal(event.p.outcome,expected);
  }
});
