import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const maps=['shared/map/map.json','shared/map/map-large.json'].map(p=>JSON.parse(fs.readFileSync(p)));
for(const map of maps) test(`map ${map.width}x${map.height}: connected regions, symmetric adjacency and valid capitals`,()=>{
  assert.ok(map.regions.length>=250&&map.regions.length<=350); assert.equal(map.spawns.length,20); assert.equal(new Set(map.spawns).size,20);
  const seen=new Set();
  for(const r of map.regions){
    assert.ok(r.area>0); assert.equal(r.cells.length,r.area); assert.ok(Number.isFinite(r.x)&&Number.isFinite(r.y));
    for(const i of r.cells){assert.ok(!seen.has(i));seen.add(i);assert.equal(map.regions[r.id].cells.includes(i),true);}
    for(const n of r.neighbors) assert.ok(map.regions[n].neighbors.includes(r.id));
    for(const n of r.seaNeighbors) assert.ok(!r.landNeighbors.includes(n));
    const reached=new Set([r.cells[0]]),queue=[r.cells[0]];
    for(let q=0;q<queue.length;q++)for(const i of r.cells){const a=queue[q],x=i%map.width,y=Math.floor(i/map.width),ax=a%map.width,ay=Math.floor(a/map.width);if(Math.abs(x-ax)+Math.abs(y-ay)===1&&!reached.has(i)){reached.add(i);queue.push(i);}}
    assert.equal(reached.size,r.area,`region ${r.id} must be connected`);
  }
  assert.equal(seen.size,map.landCells);
});
