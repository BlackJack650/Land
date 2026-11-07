import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameRoom } from '../server/rooms/gameRoom.js';
import { refreshStats } from '../server/sim/economy.js';
const map=JSON.parse(fs.readFileSync('shared/map/map.json'));
let serial=0;
function room(settings={}){const r=new GameRoom('TEST'+(++serial),{map,headless:true,settings:{bots:1,peaceSeconds:0,minutes:5,...settings}});r.errors=[];r.deliver=(id,m)=>{if(m.t==='ERR')r.errors.push(m);};r.addPlayer({name:'Human',token:'secret'});r.addBot(1);r.startCountdown();for(let i=0;i<65;i++)r.tick(.05);return r;}
function cmd(r,type,payload,id=0){r.enqueue({playerId:id,message:{t:'CMD',cmdId:`test-${++serial}`,type,payload}});r.tick(.05);}
test('0% never attacks; 100% withdraws the whole garrison and captures on arrival',()=>{
  const r=room(),p=r.players[0],from=p.capitalId,to=r.regions[from].landNeighbors[0];
  cmd(r,'ATTACK',{fromRegions:[from],toRegionId:to,percent:0});assert.equal(r.errors.at(-1).code,'ZERO_FORCE');assert.equal(r.waves.length,0);assert.equal(r.regions[from].troops,120);
  cmd(r,'ATTACK',{fromRegions:[from],toRegionId:to,percent:100});assert.equal(r.regions[from].troops,0);assert.equal(r.waves[0].force,120);
  for(let i=0;i<40&&r.regions[to].ownerId!==0;i++)r.tick(.05);
  assert.equal(r.regions[to].ownerId,0);assert.ok(r.regions[to].troops>0);
});
test('homes raise the cap, stack to five, reject six, and do not regenerate HP',()=>{
  const r=room(),p=r.players[0],id=p.capitalId;p.economy=100000;
  cmd(r,'BUILD',{regionId:id,type:'house'});assert.equal(p.cap,650);assert.equal(r.regions[id].buildings.house.level,1);
  for(let level=2;level<=5;level++){p.economy=100000;cmd(r,'UPGRADE',{regionId:id,type:'house'});assert.equal(r.regions[id].buildings.house.level,level);}
  p.economy=100000;cmd(r,'BUILD',{regionId:id,type:'house'});assert.equal(r.errors.at(-1).code,'MAX_LEVEL');
  r.regions[id].buildings.house.hp=10;for(let i=0;i<100;i++)r.tick(.05);assert.equal(r.regions[id].buildings.house.hp,10);
});
test('ownership, adjacency, source locks and solo pause are authoritative',()=>{
  const r=room(),p=r.players[0],from=p.capitalId,to=r.regions[from].landNeighbors[0];
  cmd(r,'BUILD',{regionId:r.players[1].capitalId,type:'house'});assert.equal(r.errors.at(-1).code,'NOT_OWNER');
  const far=r.regions.find(x=>!p.owned.includes(x.id)&&!r.regions[from].neighbors.includes(x.id)).id;cmd(r,'ATTACK',{fromRegions:[from],toRegionId:far,percent:20});assert.equal(r.errors.at(-1).code,'NOT_ADJACENT');
  cmd(r,'ATTACK',{fromRegions:[from],toRegionId:to,percent:20});for(let i=0;i<4;i++)r.tick(.05);cmd(r,'ATTACK',{fromRegions:[from],toRegionId:to,percent:20});assert.equal(r.errors.at(-1).code,'SOURCE_BUSY');
  cmd(r,'PAUSE',{value:true});const time=r.time;for(let i=0;i<20;i++)r.tick(.05);assert.equal(r.time,time);cmd(r,'BUILD',{regionId:from,type:'house'});assert.equal(r.errors.at(-1).code,'NOT_RUNNING');
});
test('command IDs are idempotent and malformed commands are rejected',()=>{
  const r=room(),p=r.players[0];const message={t:'CMD',cmdId:'duplicate',type:'SET_ATTACK_PERCENT',payload:{percent:25}};r.enqueue({playerId:0,message});r.tick(.05);r.enqueue({playerId:0,message});r.tick(.05);assert.equal(p.attackPercent,25);assert.equal(p.commandHistory.size,1);
  r.enqueue({playerId:0,message:{t:'CMD',cmdId:'bad',type:'SET_ATTACK_PERCENT',payload:{percent:900}}});r.tick(.05);assert.equal(r.errors.at(-1).code,'INVALID');assert.equal(p.attackPercent,25);
});
test('delta snapshots send full visible rows and ownership-only summaries outside interest',()=>{
  const r=room(),p=r.players[0],client={full:true,baseline:new Map(),lastEvent:0};const first=r.snapshot(p,client);assert.equal(first.full,true);assert.equal(first.delta.length,r.regions.length);
  const second=r.snapshot(p,client);assert.equal(second.full,false);assert.equal(second.delta.length,0);
  const far=r.regions.find(x=>x.ownerId===null&&!p.owned.some(id=>r.regions[id].neighbors.includes(x.id)));r.setViewport(p,{x:far.x,y:far.y,w:2,h:2});assert.equal(p.fullResync,true);client.full=true;const view=r.snapshot(p,client);assert.ok(view.delta.find(row=>row[0]===far.id).length>2);
  const outside=r.regions.find(x=>x.ownerId===null&&Math.abs(x.x-far.x)>10);const row=view.delta.find(row=>row[0]===outside.id);assert.equal(row.length,2);
});
test('disconnected slots are replaced by a level-3 bot after 90 seconds',()=>{
  const r=room();r.disconnect(0);assert.equal(r.players[0].isBot,false);for(let i=0;i<1802;i++)r.tick(.05);assert.equal(r.players[0].isBot,true);assert.equal(r.players[0].difficulty,3);
});
test('seeded AI matches are deterministic and expand without breaking invariants',()=>{
  function run(){const r=new GameRoom('DETERMINISTIC',{map,headless:true,settings:{bots:7,seed:42,speed:4,peaceSeconds:0,minutes:5}});r.addPlayer({name:'Observer'});r.replaceWithBot(r.players[0]);r.startCountdown();for(let i=0;i<65;i++)r.tick(.05);for(let i=0;i<200&&r.phase==='running';i++)r.tick(.05);refreshStats(r);return JSON.stringify({regions:r.regions.map(x=>[x.ownerId,x.troops,Object.values(x.buildings).map(b=>[b.type,b.level,b.hp])]),players:r.players.map(p=>[p.regionsCount,p.troops,Math.round(p.economy*1000)])});}
  const a=run(),b=run();assert.equal(a,b);const parsed=JSON.parse(a);assert.ok(parsed.players.some(p=>p[0]>1));assert.ok(parsed.players.reduce((n,p)=>n+p[0],0)>8);
});
