import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BALANCE as B } from '../config/balance.js';
import { seededRandom } from '../shared/rng.js';

// Hand-drawn longitude/latitude silhouettes. No third-party map service/data.
// Each polygon is rasterized, then connected watershed cells form countries.
const CONTINENTS = [
  ['north-america', [[-168,72],[-156,71],[-148,70],[-141,69],[-136,69],[-128,70],[-120,73],[-110,73],[-102,75],[-94,74],[-88,71],[-82,69],[-78,66],[-72,62],[-64,60],[-58,54],[-55,52],[-60,47],[-66,45],[-70,43],[-74,40],[-76,36],[-80,32],[-81,25],[-83,25],[-84,30],[-89,29],[-94,29],[-97,25],[-97,22],[-96,19],[-92,18],[-90,21],[-87,21],[-86,17],[-84,15],[-83,11],[-79,9],[-77,8],[-78,7],[-82,8],[-85,10],[-88,13],[-92,15],[-96,16],[-101,18],[-105,21],[-107,24],[-111,28],[-114,32],[-117,33],[-120,37],[-124,42],[-126,49],[-131,53],[-136,57],[-141,59],[-148,60],[-153,58],[-160,55],[-165,54],[-162,58],[-168,60],[-166,64],[-170,66]]],
  ['greenland', [[-73,59],[-61,60],[-48,64],[-40,68],[-24,73],[-18,78],[-25,82],[-42,83],[-55,80],[-62,76],[-68,70]]],
  ['south-america', [[-81,12],[-75,11],[-72,12],[-67,10],[-61,10],[-58,7],[-52,4],[-49,1],[-44,-2],[-35,-5],[-35,-10],[-38,-15],[-40,-20],[-44,-23],[-48,-28],[-51,-33],[-54,-38],[-60,-42],[-64,-50],[-68,-55],[-73,-54],[-75,-47],[-74,-40],[-73,-33],[-71,-28],[-70,-20],[-75,-15],[-78,-8],[-81,-4],[-80,2],[-77,7]]],
  ['africa', [[-17,21],[-17,15],[-16,12],[-13,8],[-8,5],[-3,5],[2,6],[7,4],[9,1],[10,-4],[13,-8],[12,-15],[15,-22],[18,-29],[20,-35],[26,-34],[31,-29],[33,-25],[35,-20],[40,-15],[41,-10],[40,-4],[43,1],[48,5],[51,11],[44,11],[42,12],[39,18],[36,22],[34,28],[32,31],[25,32],[20,33],[12,33],[10,37],[3,37],[-2,35],[-6,36],[-10,31],[-13,27]]],
  ['eurasia', [[-10,36],[-9,43],[-2,44],[-5,48],[0,50],[5,52],[8,55],[8,58],[5,58],[5,62],[10,66],[18,70],[25,71],[30,70],[29,65],[34,65],[40,68],[46,68],[53,70],[60,69],[66,72],[75,73],[85,75],[96,77],[108,77],[118,73],[128,72],[139,72],[148,70],[159,70],[170,66],[179,66],[179,60],[170,60],[164,57],[160,54],[157,50],[155,51],[155,56],[151,59],[146,59],[141,54],[139,49],[135,45],[131,43],[129,40],[127,38],[129,35],[126,34],[124,38],[121,40],[119,37],[121,31],[120,26],[116,23],[111,21],[108,18],[109,13],[106,9],[103,10],[101,14],[100,8],[103,2],[101,1],[98,7],[97,16],[94,18],[92,22],[89,22],[87,20],[83,17],[80,12],[78,8],[76,9],[73,16],[71,21],[68,23],[65,25],[60,25],[57,24],[56,26],[54,24],[51,23],[49,25],[48,29],[44,29],[42,31],[39,35],[35,36],[32,36],[29,37],[26,40],[24,40],[24,37],[22,37],[20,40],[18,42],[16,40],[15,38],[13,41],[10,44],[7,44],[4,43],[3,41],[0,40],[-1,37],[-6,36]]],
  ['arabia', [[34,30],[43,30],[48,29],[51,24],[56,25],[57,22],[54,17],[49,14],[44,13],[42,16],[39,21],[36,26]]],
  ['britain', [[-6,50],[-3,51],[0,52],[-2,55],[-3,59],[-6,58],[-5,55],[-7,54],[-5,52]]],
  ['ireland', [[-10,51],[-7,51],[-6,54],[-8,55],[-10,54]]],
  ['iceland', [[-24,64],[-20,63],[-14,65],[-16,67],[-22,67]]],
  ['japan', [[130,31],[133,33],[136,34],[140,36],[142,40],[141,43],[145,44],[145,41],[143,39],[142,36],[138,33],[134,31]]],
  ['madagascar', [[48,-13],[50,-16],[48,-23],[45,-26],[44,-22],[46,-16]]],
  ['sumatra', [[95,5],[99,3],[103,-2],[106,-6],[103,-6],[99,-2]]],
  ['java', [[105,-6],[112,-7],[115,-8],[114,-9],[108,-8]]],
  ['borneo', [[109,2],[114,5],[118,6],[119,1],[116,-4],[111,-3],[109,0]]],
  ['sulawesi', [[119,1],[122,2],[125,1],[123,0],[121,-2],[123,-4],[121,-5],[119,-3]]],
  ['new-guinea', [[131,-1],[137,-2],[141,-3],[147,-5],[151,-10],[146,-10],[141,-8],[136,-5],[132,-4]]],
  ['philippines', [[120,19],[123,18],[122,14],[125,12],[126,8],[123,6],[121,10],[119,12]]],
  ['australia', [[113,-22],[115,-19],[120,-18],[123,-15],[129,-14],[132,-11],[136,-12],[137,-16],[141,-17],[143,-12],[146,-16],[146,-20],[150,-24],[153,-28],[151,-34],[146,-39],[140,-38],[136,-35],[131,-32],[125,-33],[119,-35],[115,-33],[113,-28]]],
  ['tasmania', [[145,-40],[149,-41],[147,-44],[145,-43]]],
  ['new-zealand', [[173,-34],[176,-37],[178,-38],[176,-41],[173,-42],[170,-46],[166,-47],[168,-43],[172,-40],[174,-38]]],
  ['cuba', [[-85,22],[-80,23],[-75,21],[-74,20],[-79,21],[-84,21]]],
  ['hispaniola', [[-74,20],[-70,20],[-68,18],[-72,18]]],
  ['sri-lanka', [[80,10],[82,8],[81,6],[79,7]]]
];
function inside(x, y, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}
export function generateMap({ width = 192, height = 96, count = 320, seed = 650 } = {}) {
  const random = seededRandom(seed), size = width * height;
  const mask = new Uint8Array(size), land = [];
  const polygons = CONTINENTS.map(([name, p]) => [name, p.map(([lon, lat]) => [(lon + 180) / 360 * width, (90 - lat) / 180 * height])]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (polygons.some(([, p]) => inside(x + 0.5, y + 0.5, p))) { const i = y * width + x; mask[i] = 1; land.push(i); }
  }
  // Remove one-pixel raster specks, retaining named small islands.
  const adjacent = i => { const a = [], x = i % width, y = Math.floor(i / width); if (x) a.push(i - 1); if (x < width - 1) a.push(i + 1); if (y) a.push(i - width); if (y < height - 1) a.push(i + width); return a; };
  for (const i of land) if (adjacent(i).filter(j => mask[j]).length < 2) mask[i] = 0;
  const candidates = land.filter(i => mask[i]);
  // Give every island component a seed before farthest-point sampling, so no
  // raster island is silently dropped and every land pixel belongs to a region.
  const componentSeen = new Uint8Array(size), seeds = [];
  for (const start of candidates) {
    if (componentSeen[start]) continue;
    const component = [start]; componentSeen[start] = 1;
    for (let q = 0; q < component.length; q++) for (const j of adjacent(component[q])) if (mask[j] && !componentSeen[j]) { componentSeen[j] = 1; component.push(j); }
    seeds.push(component[Math.floor(random() * component.length)]);
  }
  if (seeds.length > count) throw new Error('Too many island components for region budget');
  const nearest = new Float64Array(size).fill(Infinity);
  for (const s of seeds) { const sx = s % width, sy = Math.floor(s / width); for (const i of candidates) { const dx = i % width - sx, dy = Math.floor(i / width) - sy; const d = dx*dx+dy*dy; if (d < nearest[i]) nearest[i] = d; } }
  for (let n = seeds.length; n < count; n++) {
    let best = -1, bestScore = -1;
    for (const i of candidates) {
      const score = nearest[i] * (0.94 + random() * 0.12);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    seeds.push(best);
    const sx = best % width, sy = Math.floor(best / width);
    for (const i of candidates) { const dx = i % width - sx, dy = Math.floor(i / width) - sy; const d = dx*dx+dy*dy; if (d < nearest[i]) nearest[i] = d; }
  }
  const cellRegion = new Int16Array(size).fill(-1), queue = new Int32Array(size);
  let head = 0, tail = 0;
  seeds.forEach((i, id) => { cellRegion[i] = id; queue[tail++] = i; });
  // Multi-source BFS: every watershed is connected by construction.
  while (head < tail) {
    const i = queue[head++], id = cellRegion[i];
    for (const j of adjacent(i)) if (mask[j] && cellRegion[j] === -1) { cellRegion[j] = id; queue[tail++] = j; }
  }
  const regions = seeds.map((s, id) => ({ id, cells: [], x: 0, y: 0, area: 0, ownerId: null, troops: 0, neighbors: [], landNeighbors: [], seaNeighbors: [], isCoastal: false, continent: '' }));
  for (const i of candidates) {
    const id = cellRegion[i]; if (id < 0) continue;
    const r = regions[id], x = i % width, y = Math.floor(i / width);
    r.cells.push(i); r.x += x + 0.5; r.y += y + 0.5; r.area++;
    const lon = (x + 0.5) / width * 360 - 180, lat = 90 - (y + 0.5) / height * 180;
    r.continent = polygons.find(([, p]) => inside((lon + 180) / 360 * width, (90 - lat) / 180 * height, p))?.[0] || 'islands';
    for (const j of adjacent(i)) {
      if (!mask[j]) r.isCoastal = true;
      else if (cellRegion[j] >= 0 && cellRegion[j] !== id && !r.landNeighbors.includes(cellRegion[j])) r.landNeighbors.push(cellRegion[j]);
    }
  }
  for (const r of regions) { r.x = +(r.x / r.area).toFixed(2); r.y = +(r.y / r.area).toFixed(2); r.troops = Math.max(1, Math.round(r.area * B.map.neutralTroopsPerCell)); r.neighbors = [...r.landNeighbors]; }
  // Bounded flood through water only. Ports use these precomputed straits.
  const max = B.map.seaLinkCells * width / 192;
  const visited = new Int32Array(size).fill(-1), depths = new Uint16Array(size), waterQueue = new Int32Array(size);
  for (const r of regions.filter(r => r.isCoastal)) {
    let wh = 0, wt = 0;
    for (const i of r.cells) for (const j of adjacent(i)) if (!mask[j] && visited[j] !== r.id) { visited[j] = r.id; depths[j] = 1; waterQueue[wt++] = j; }
    while (wh < wt) {
      const i = waterQueue[wh++], d = depths[i];
      for (const j of adjacent(i)) {
        if (mask[j]) {
          const other = cellRegion[j];
          if (other >= 0 && other !== r.id && !r.landNeighbors.includes(other) && !r.seaNeighbors.includes(other)) { r.seaNeighbors.push(other); regions[other].seaNeighbors.push(r.id); }
        } else if (d < max && visited[j] !== r.id) { visited[j] = r.id; depths[j] = d + 1; waterQueue[wt++] = j; }
      }
    }
  }
  for (const r of regions) r.neighbors = [...new Set([...r.landNeighbors, ...r.seaNeighbors])].sort((a,b) => a-b);
  // Area-weighted, farthest-first capitals; rematch uses the same seed/order.
  const eligible = regions.filter(r => r.area >= 7).sort((a,b) => b.area-a.area || a.id-b.id);
  const spawns = [eligible[0].id], distances = new Float64Array(size).fill(Infinity);
  while (spawns.length < B.match.maxSlots) {
    const last = regions[spawns.at(-1)]; let best = null, score = -1;
    for (const r of eligible) {
      const d = (r.x-last.x)**2 + (r.y-last.y)**2;
      distances[r.id] = Math.min(distances[r.id], d);
      const s = distances[r.id] * Math.sqrt(r.area);
      if (s > score && !spawns.includes(r.id)) { score = s; best = r; }
    }
    spawns.push(best.id);
  }
  return { version: 1, width, height, seed, landCells: candidates.length, spawns, regions };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const directory = new URL('../shared/map/', import.meta.url);
  fs.mkdirSync(directory, { recursive: true });
  for (const large of [false, true]) {
    const map = generateMap({ width: large ? B.map.largeWidth : B.map.width, height: large ? B.map.largeHeight : B.map.height, count: large ? B.map.largeRegions : B.map.regions });
    fs.writeFileSync(new URL(large ? 'map-large.json' : 'map.json', directory), JSON.stringify(map));
    console.log(`${large ? 'Large' : 'Standard'}: ${map.regions.length} connected regions, ${map.landCells} land pixels, ${map.regions.reduce((n,r) => n+r.seaNeighbors.length,0)/2} straits`);
  }
}
