import fs from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { BALANCE as B } from '../config/balance.js';
import { GameRoom } from '../server/rooms/gameRoom.js';
import { refreshStats } from '../server/sim/economy.js';

function args(){const out={ai:8,minutes:5,seed:'42',speed:1,difficulty:'mixed',threshold:65,map:'standard',verify:false};for(let i=2;i<process.argv.length;i++){const key=process.argv[i].replace(/^--/,'');if(key==='verify'){out.verify=true;continue;}const value=process.argv[++i];if(value===undefined)throw new Error(`Missing value for --${key}`);out[key]=['ai','minutes','speed','threshold'].includes(key)?Number(value):value;}return out;}
function run(options,map){
  const room=new GameRoom('SIMULATE',{map,headless:true,settings:{bots:Math.max(1,Math.min(15,options.ai)),minutes:Math.max(1,options.minutes),seed:String(options.seed),speed:[0.5,1,2,4].includes(options.speed)?options.speed:1,difficulty:options.difficulty,peaceSeconds:10,victoryPercent:options.threshold}});
  const errors=new Map();const reject=room.reject.bind(room);room.reject=(item,code)=>{errors.set(code,(errors.get(code)||0)+1);reject(item,code);};
  room.addPlayer({name:'Player (idle)'});room.startCountdown();for(let i=0;i<Math.ceil(B.match.countdownSeconds*B.tickRate)+2;i++)room.tick(1/B.tickRate);
  let ticks=0,maxWaves=0,maxProjectiles=0,maxBuildings=0;const limit=Math.ceil(options.minutes*60*B.tickRate/room.settings.speed)+100;
  while(room.phase==='running'&&ticks++<limit){room.tick(1/B.tickRate);maxWaves=Math.max(maxWaves,room.waves.length);maxProjectiles=Math.max(maxProjectiles,room.projectiles.length);maxBuildings=Math.max(maxBuildings,room.players.reduce((n,p)=>n+p.buildingCount,0));}
  assert.equal(room.phase,'finished','Match must finish at conquest or its time limit');refreshStats(room);room.assertInvariants();
  assert.equal(room.regions.reduce((n,r)=>n+(r.ownerId!==null?1:0),0),room.players.reduce((n,p)=>n+p.regionsCount,0));
  for(const p of room.players)assert.equal(p.troops,room.regions.filter(r=>r.ownerId===p.id).reduce((n,r)=>n+r.troops,0));
  return {room,ticks,maxWaves,maxProjectiles,maxBuildings,errors,fingerprint:JSON.stringify({result:room.result,regions:room.regions.map(r=>[r.ownerId,r.troops,Object.values(r.buildings).map(b=>[b.type,b.level,b.hp])])})};
}
const options=args(),map=JSON.parse(fs.readFileSync(new URL(`../shared/map/${options.map==='large'?'map-large.json':'map.json'}`,import.meta.url)));
console.log(`LAND headless simulation · ${options.ai} AI · ${options.minutes} min · seed ${options.seed} · speed ×${options.speed}`);
const start=performance.now(),summary=run(options,map),elapsed=performance.now()-start;
if(options.verify){const second=run(options,map);assert.equal(summary.fingerprint,second.fingerprint,'Same seed and inputs must produce the same match');console.log('Determinism: identical final state ✓');}
console.log(`\nFinished: ${summary.room.result.reason} · simulated ${summary.room.time.toFixed(1)}s · ${summary.ticks} ticks · wall time ${elapsed.toFixed(0)}ms`);
console.table(summary.room.result.ranking.map(p=>({place:p.place,name:p.name,regions:p.regions,peak:p.peakRegions,troops:p.troops,buildings:p.buildings})));
console.log(`Peak waves: ${summary.maxWaves} · peak projectiles: ${summary.maxProjectiles} · peak buildings: ${summary.maxBuildings}`);
if(summary.errors.size)console.log('Rejected AI intentions (safely handled):',Object.fromEntries(summary.errors));
console.log('Invariants: troops, ownership, economy and building levels valid ✓');
