import { BALANCE as B } from '../../config/balance.js';
import { clamp, distance } from '../../shared/formulas.js';

const ICON_PIXELS = {
  house: ['00100','01110','11111','01110','01010'],
  port: ['00100','01110','00100','10101','01110'],
  fort: ['10101','11111','01110','01110','00100'],
  drone: ['10001','01110','01110','10001','00000'],
  missile: ['00100','00110','01100','11000','10000'],
  aa: ['10001','01010','00100','01110','11011']
};
const OCEANS = [['ТИХИЙ ОКЕАН',24,51],['АТЛАНТИЧЕСКИЙ ОКЕАН',67,48],['ИНДИЙСКИЙ ОКЕАН',137,64],['СЕВЕРНЫЙ ЛЕДОВИТЫЙ',107,7]];
const rgb = hex => [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
export class MapRenderer {
  constructor(canvas, minimap, getState, callbacks = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d',{ alpha: false }); this.minimap = minimap; this.miniCtx = minimap.getContext('2d',{ alpha: false }); this.getState = getState; this.callbacks = callbacks;
    this.base = document.createElement('canvas'); this.baseCtx = this.base.getContext('2d',{ alpha: false }); this.palette = new Map(); this.paths = []; this.dirty = new Set(); this.pointers = new Map(); this.keys = new Set();
    this.zoom = 1; this.camX = 96; this.camY = 48; this.vx = 0; this.vy = 0; this.width = 1; this.height = 1; this.fitScale = 1; this.dpr = 1; this.hover = -1; this.rect = null; this.preview = true; this.colorblind = false; this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.running = false; this.lastFrame = 0; this.fps = 60; this.renderMs = 0; this.frameCount = 0; this.fpsSince = 0; this.lowSince = 0; this.quality = 1; this.lastMini = 0; this.lastRendered = 0;
    this.particles = { x: new Float32Array(B.render.particlePool), y: new Float32Array(B.render.particlePool), vx: new Float32Array(B.render.particlePool), vy: new Float32Array(B.render.particlePool), life: new Float32Array(B.render.particlePool), color: new Array(B.render.particlePool).fill('#c4ee80'), cursor: 0 };
    this.dash = [3,5]; this.emptyDash = []; this.bindInput();
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas.parentElement);
  }
  setMap(map, preview = false) {
    this.map = map; this.preview = preview; this.cellRegion = new Int16Array(map.width * map.height).fill(-1);
    this.base.width = map.width; this.base.height = map.height; this.image = this.baseCtx.createImageData(map.width,map.height); this.flashes = new Float64Array(map.regions.length);
    for (const r of map.regions) for (const i of r.cells) this.cellRegion[i] = r.id;
    this.paths = map.regions.map(r => { const path = new Path2D(); for (const i of r.cells) { const x = i % map.width, y = Math.floor(i/map.width); if (x === 0 || this.cellRegion[i-1] !== r.id) { path.moveTo(x,y); path.lineTo(x,y+1); } if (x === map.width-1 || this.cellRegion[i+1] !== r.id) { path.moveTo(x+1,y); path.lineTo(x+1,y+1); } if (y === 0 || this.cellRegion[i-map.width] !== r.id) { path.moveTo(x,y); path.lineTo(x+1,y); } if (y === map.height-1 || this.cellRegion[i+map.width] !== r.id) { path.moveTo(x,y+1); path.lineTo(x+1,y+1); } } return path; });
    this.owners = new Int16Array(map.regions.length).fill(-2); this.minimap.width = map.width; this.minimap.height = map.height;
    this.camX = map.width/2; this.camY = map.height/2; this.zoom = 1; this.vx = this.vy = 0; this.hover = -1;
    for (let i = 0; i < map.width*map.height; i++) this.paintWater(i);
    for (const r of map.regions) this.dirty.add(r.id);
    this.flushDirty(); this.resize();
  }
  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect(); if (!box.width || !box.height) return;
    this.width = box.width; this.height = box.height; this.dpr = Math.min(devicePixelRatio || 1,B.render.maxDPR);
    this.canvas.width = Math.round(this.width*this.dpr); this.canvas.height = Math.round(this.height*this.dpr);
    if (this.map) this.fitScale = Math.min(this.width/this.map.width,this.height/this.map.height)*0.97;
    this.ctx.imageSmoothingEnabled = false; this.clampCamera(); this.lastMini = 0;
  }
  get scale() { return this.fitScale*this.zoom; }
  get ox() { return Math.round((this.width-this.map.width*this.scale)/2-(this.camX-this.map.width/2)*this.scale); }
  get oy() { return Math.round((this.height-this.map.height*this.scale)/2-(this.camY-this.map.height/2)*this.scale); }
  screenToGrid(x,y) { return { x: (x-this.ox)/this.scale, y: (y-this.oy)/this.scale }; }
  regionAt(x,y) { const p = this.screenToGrid(x,y), gx = Math.floor(p.x), gy = Math.floor(p.y); if (!this.map || gx<0 || gy<0 || gx>=this.map.width || gy>=this.map.height) return -1; return this.cellRegion[gy*this.map.width+gx]; }
  localPoint(e) { const box = this.canvas.getBoundingClientRect(); return { x: e.clientX-box.left, y: e.clientY-box.top }; }
  fit() { this.zoom = 1; if (this.map) { this.camX = this.map.width/2; this.camY = this.map.height/2; } this.vx = this.vy = 0; this.callbacks.onCamera?.(); }
  centerOn(x,y,zoom = this.zoom) { this.camX = x; this.camY = y; this.zoom = clamp(zoom,B.render.minZoom,B.render.maxZoom); this.vx = this.vy = 0; this.clampCamera(); this.callbacks.onCamera?.(); }
  zoomAt(factor,x = this.width/2,y = this.height/2) { const before = this.screenToGrid(x,y); this.zoom = clamp(this.zoom*factor,B.render.minZoom,B.render.maxZoom); const after = this.screenToGrid(x,y); this.camX += before.x-after.x; this.camY += before.y-after.y; this.clampCamera(); this.callbacks.onCamera?.(); }
  pan(dx,dy) { this.camX -= dx/this.scale; this.camY -= dy/this.scale; this.clampCamera(); }
  clampCamera() { if (!this.map) return; const halfW = this.width/(2*this.scale), halfH = this.height/(2*this.scale); this.camX = halfW >= this.map.width/2 ? this.map.width/2 : clamp(this.camX,halfW,this.map.width-halfW); this.camY = halfH >= this.map.height/2 ? this.map.height/2 : clamp(this.camY,halfH,this.map.height-halfH); }
  viewport() { const p = this.screenToGrid(0,0); return { x: p.x, y: p.y, w: this.width/this.scale, h: this.height/this.scale }; }
  bindInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu',e => { e.preventDefault(); this.callbacks.onClear?.(); });
    c.addEventListener('wheel',e => { e.preventDefault(); const p = this.localPoint(e); this.zoomAt(Math.exp(-e.deltaY*0.0015),p.x,p.y); },{ passive:false });
    c.addEventListener('pointerdown',e => {
      if (e.button === 2) return;
      const p = this.localPoint(e); c.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId,{ ...p, startX:p.x,startY:p.y,lastX:p.x,lastY:p.y,moved:false,type:e.pointerType });
      this.vx = this.vy = 0; this.longPressed = false;
      if (this.pointers.size === 1) {
        this.mode = e.shiftKey ? 'rect' : e.altKey ? 'paint' : 'pan';
        if (this.mode === 'rect') this.rect = { x:p.x,y:p.y,w:0,h:0 };
        if (this.mode === 'paint') this.callbacks.onPaint?.(this.regionAt(p.x,p.y));
        if (e.pointerType === 'touch') { clearTimeout(this.longTimer); this.longTimer = setTimeout(() => { const a = [...this.pointers.values()][0]; if (a && !a.moved && this.pointers.size === 1) { this.longPressed = true; this.callbacks.onLongPress?.(); } },550); }
      } else if (this.pointers.size === 2) { clearTimeout(this.longTimer); this.rect = null; const [a,b] = [...this.pointers.values()]; this.pinchDistance = Math.hypot(a.x-b.x,a.y-b.y); this.pinchCenter = { x:(a.x+b.x)/2,y:(a.y+b.y)/2 }; }
    });
    c.addEventListener('pointermove',e => {
      const p = this.localPoint(e); this.hover = this.regionAt(p.x,p.y);
      const a = this.pointers.get(e.pointerId); if (!a) return;
      a.x = p.x; a.y = p.y; if (Math.hypot(a.x-a.startX,a.y-a.startY)>6) { a.moved = true; clearTimeout(this.longTimer); }
      if (this.pointers.size >= 2) {
        const [first,second] = [...this.pointers.values()], d = Math.hypot(first.x-second.x,first.y-second.y), center = { x:(first.x+second.x)/2,y:(first.y+second.y)/2 };
        if (this.pinchDistance > 0) this.zoomAt(d/this.pinchDistance,center.x,center.y);
        if (this.pinchCenter) this.pan(center.x-this.pinchCenter.x,center.y-this.pinchCenter.y);
        this.pinchDistance = d; this.pinchCenter = center;
      } else if (this.mode === 'rect') this.rect = { x:Math.min(a.startX,p.x),y:Math.min(a.startY,p.y),w:Math.abs(p.x-a.startX),h:Math.abs(p.y-a.startY) };
      else if (this.mode === 'paint') this.callbacks.onPaint?.(this.regionAt(p.x,p.y));
      else if (a.moved) { const dx = p.x-a.lastX, dy = p.y-a.lastY; this.pan(dx,dy); this.vx = dx*0.45; this.vy = dy*0.45; }
      a.lastX = p.x; a.lastY = p.y;
    });
    const end = (e,cancelled = false) => {
      clearTimeout(this.longTimer); const a = this.pointers.get(e.pointerId); if (!a) return;
      this.pointers.delete(e.pointerId);
      if (cancelled) { this.rect = null; this.pointers.clear(); return; }
      if (this.pointers.size) { for (const remaining of this.pointers.values()) { remaining.lastX = remaining.x; remaining.lastY = remaining.y; remaining.moved = true; } this.pinchDistance = 0; return; }
      if (this.mode === 'rect' && this.rect) { const r = this.rect, ids = this.map.regions.filter(region => { const x = this.ox+region.x*this.scale,y = this.oy+region.y*this.scale; return x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h; }).map(region=>region.id); this.callbacks.onSelect?.(ids,e.ctrlKey||e.metaKey); this.rect = null; }
      else if (!a.moved && !this.longPressed && this.mode !== 'paint') {
        const id = this.regionAt(a.x,a.y), now = performance.now();
        if (id >= 0) { if (this.lastTap?.id === id && now-this.lastTap.at<310) { this.callbacks.onDoubleClick?.(id); this.lastTap = null; } else { this.callbacks.onRegionClick?.(id,e); this.lastTap = { id,at:now }; } }
      }
      this.mode = null;
    };
    c.addEventListener('pointerup',e=>end(e)); c.addEventListener('pointercancel',e=>end(e,true)); c.addEventListener('pointerleave',()=>{ if (!this.pointers.size) this.hover = -1; });
    this.minimap.addEventListener('pointerdown',e => { if (!this.map) return; e.preventDefault(); const box = this.minimap.getBoundingClientRect(); this.centerOn((e.clientX-box.left)/box.width*this.map.width,(e.clientY-box.top)/box.height*this.map.height,Math.max(1.8,this.zoom)); });
  }
  colorShades(color) { if (!this.palette.has(color)) { const base = rgb(color); this.palette.set(color,[0.84,0.93,1.02].map(k=>base.map(v=>Math.min(255,Math.round(v*k))))); } return this.palette.get(color); }
  paintWater(i) {
    const x = i%this.map.width,y = Math.floor(i/this.map.width), data = this.image.data, at = i*4, grid = x%8===0||y%8===0, noise = ((i*13^(i>>>5)*7)%3)-1;
    data[at] = 18+noise+(grid?3:0); data[at+1] = 37+noise+(grid?4:0); data[at+2] = 45+noise+(grid?4:0); data[at+3] = 255;
  }
  paintRegion(r) {
    const state = this.getState(), current = state.regions[r.id] || r, color = current.ownerId === null || !state.players[current.ownerId] ? '#71836a' : state.players[current.ownerId].color;
    const shades = this.colorShades(color), data = this.image.data, w = this.map.width;
    for (const i of r.cells) {
      const x = i%w,y = Math.floor(i/w); let edge = false, coast = false, foreign = false;
      for (const j of [x>0?i-1:-1,x<w-1?i+1:-1,y>0?i-w:-1,y<this.map.height-1?i+w:-1]) {
        if (j<0) { coast = true; continue; }
        const other = this.cellRegion[j];
        if (other<0) coast = true;
        else if (other!==r.id) { edge = true; const owner = state.regions[other]?.ownerId; if (owner !== current.ownerId) foreign = true; }
      }
      let shade = shades[this.quality < 1 ? 1 : (i*17^(i>>>3)*11)%3];
      if (foreign) shade = [30,45,39]; else if (coast) shade = shade.map(v=>Math.round(v*0.72)); else if (edge) shade = shade.map(v=>Math.round(v*0.83));
      const at = i*4; data[at]=shade[0]; data[at+1]=shade[1]; data[at+2]=shade[2]; data[at+3]=255;
    }
  }
  flushDirty() {
    const state = this.getState();
    for (const r of this.map.regions) if ((state.regions[r.id]?.ownerId ?? null) !== this.owners[r.id]) { this.dirty.add(r.id); for (const n of r.neighbors) this.dirty.add(n); }
    if (!this.dirty.size) return;
    for (const id of this.dirty) { const r = this.map.regions[id]; this.paintRegion(r); this.owners[id] = state.regions[id]?.ownerId ?? null; }
    this.dirty.clear(); this.baseCtx.putImageData(this.image,0,0); this.lastMini = 0;
  }
  flash(id,color = '#e5f6c9') {
    if (!this.flashes) return; this.flashes[id] = performance.now()+B.render.captureFlashSeconds*1000;
    if (this.reducedMotion || this.quality<1) return;
    const r = this.map.regions[id]; if (!r) return;
    for (let n=0;n<7;n++) { const p = this.particles, i = p.cursor++%p.x.length, angle = n/7*Math.PI*2; p.x[i]=r.x; p.y[i]=r.y; p.vx[i]=Math.cos(angle)*(2+Math.random()*3); p.vy[i]=Math.sin(angle)*(2+Math.random()*3); p.life[i]=0.45; p.color[i]=color; }
  }
  start() { if (this.running) return; this.running = true; this.lastFrame = performance.now(); this.fpsSince = this.lastFrame; this.frameCount = 0; this.raf = requestAnimationFrame(t=>this.frame(t)); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); this.keys.clear(); }
  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05,(now-this.lastFrame)/1000); this.lastFrame = now;
    const begin = performance.now(); this.update(dt,now); this.draw(now); this.renderMs = this.renderMs*0.9+(performance.now()-begin)*0.1;
    this.frameCount++;
    if (now-this.fpsSince >= 700) { this.fps = this.frameCount*1000/(now-this.fpsSince); this.frameCount=0; this.fpsSince=now; if (this.fps<B.render.lowFps) { if (!this.lowSince) this.lowSince=now; else if (now-this.lowSince>B.render.degradeAfterSeconds*1000 && this.quality===1) { this.quality=0.5; for (const r of this.map.regions) this.dirty.add(r.id); } } else this.lowSince=0; this.callbacks.onPerformance?.(this.fps,this.renderMs,this.quality); }
    this.raf = requestAnimationFrame(t=>this.frame(t));
  }
  update(dt,now) {
    if (!this.map) return;
    const speed = 290*dt;
    if (this.keys.has('w')||this.keys.has('arrowup')) this.pan(0,speed);
    if (this.keys.has('s')||this.keys.has('arrowdown')) this.pan(0,-speed);
    if (this.keys.has('a')||this.keys.has('arrowleft')) this.pan(speed,0);
    if (this.keys.has('d')||this.keys.has('arrowright')) this.pan(-speed,0);
    if (this.keys.has('q')) this.zoomAt(1-dt*1.4);
    if (this.keys.has('e')) this.zoomAt(1+dt*1.4);
    if (!this.pointers.size && (Math.abs(this.vx)>0.05||Math.abs(this.vy)>0.05) && !this.reducedMotion) { this.pan(this.vx*dt*60,this.vy*dt*60); this.vx*=Math.pow(0.86,dt*60); this.vy*=Math.pow(0.86,dt*60); }
    const p = this.particles;
    for (let i=0;i<p.x.length;i++) if (p.life[i]>0) { p.life[i]-=dt; p.x[i]+=p.vx[i]*dt; p.y[i]+=p.vy[i]*dt; }
    this.flushDirty();
  }
  draw(now) {
    if (!this.map) return;
    const ctx = this.ctx, state = this.getState(), s = this.scale, ox = this.ox, oy = this.oy;
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0); ctx.imageSmoothingEnabled=false; ctx.fillStyle='#12252d'; ctx.fillRect(0,0,this.width,this.height);
    ctx.drawImage(this.base,0,0,this.map.width,this.map.height,ox,oy,Math.round(this.map.width*s),Math.round(this.map.height*s));
    ctx.font='7px "Plex Mono", monospace'; ctx.textAlign='center'; ctx.fillStyle='#66868b66';
    for (const [name,x,y] of OCEANS) ctx.fillText(name,Math.round(ox+x/192*this.map.width*s),Math.round(oy+y/96*this.map.height*s));
    ctx.save(); ctx.translate(ox,oy); ctx.scale(s,s);
    if (state.buildMode && !this.preview) {
      const def = B.buildings[state.buildMode];
      for (const player of state.players) if (player.id === state.you?.id) for (const r of this.map.regions) { const current = state.regions[r.id]; if (current?.ownerId === player.id && (state.buildMode !== 'port' || r.isCoastal)) { ctx.fillStyle='#c4ee8014'; ctx.fill(this.paths[r.id]); } }
      const focus = state.selected?.size ? state.regions[[...state.selected][0]] : this.hover>=0 ? state.regions[this.hover] : null;
      if (focus && def.radius) { ctx.beginPath(); ctx.arc(focus.x,focus.y,def.radius*this.map.width/192,0,Math.PI*2); ctx.fillStyle='#c4ee8012'; ctx.fill(); ctx.strokeStyle='#c4ee8088'; ctx.lineWidth=1/s; ctx.setLineDash(this.dash); ctx.stroke(); ctx.setLineDash(this.emptyDash); }
    }
    if (this.colorblind) { ctx.lineWidth=1.2/s; for (const r of this.map.regions) { const owner = state.regions[r.id]?.ownerId; if (owner !== null && owner !== undefined) { ctx.setLineDash(owner%2 ? [1,2] : [3,1]); ctx.strokeStyle='#f2f5df77'; ctx.stroke(this.paths[r.id]); } } ctx.setLineDash(this.emptyDash); }
    if (!this.preview && state.selected) for (const id of state.selected) { if (!this.paths[id]) continue; ctx.fillStyle='#d9ff9b25'; ctx.fill(this.paths[id]); ctx.strokeStyle='#dbffac'; ctx.lineWidth=2/s; ctx.stroke(this.paths[id]); }
    if (this.hover>=0 && this.paths[this.hover]) { const hovered=state.regions[this.hover]; const invalidBuild=state.buildMode && !this.preview && (hovered?.ownerId!==state.you?.id || (state.buildMode==='port' && !hovered?.isCoastal)); ctx.strokeStyle=invalidBuild?'#ec9290bb':this.preview?'#d4e6b488':'#edf5d9bb'; ctx.lineWidth=1/s; ctx.stroke(this.paths[this.hover]); }
    for (const r of this.map.regions) if (this.flashes[r.id]>now && !this.reducedMotion) { ctx.fillStyle=`rgba(235,255,203,${(this.flashes[r.id]-now)/200*0.55})`; ctx.fill(this.paths[r.id]); }
    ctx.restore();
    this.drawWaves(now,state); this.drawBuildings(state); this.drawCapitals(state);
    const p = this.particles;
    for (let i=0;i<p.x.length;i++) if (p.life[i]>0) { ctx.globalAlpha=Math.min(1,p.life[i]*3); ctx.fillStyle=p.color[i]; ctx.fillRect(Math.round(ox+p.x[i]*s),Math.round(oy+p.y[i]*s),2,2); }
    ctx.globalAlpha=1;
    if (this.rect) { ctx.fillStyle='#c4ee8020'; ctx.fillRect(this.rect.x,this.rect.y,this.rect.w,this.rect.h); ctx.strokeStyle='#c4ee80'; ctx.lineWidth=1; ctx.setLineDash(this.dash); ctx.strokeRect(Math.round(this.rect.x)+0.5,Math.round(this.rect.y)+0.5,this.rect.w,this.rect.h); ctx.setLineDash(this.emptyDash); }
    if (now-this.lastMini>180) { this.drawMinimap(state); this.lastMini=now; }
  }
  drawCapitals(state) {
    const ctx=this.ctx,s=this.scale,ox=this.ox,oy=this.oy;
    ctx.textAlign='left'; ctx.font='7px "Plex Mono", monospace';
    for (const p of state.players) {
      if (!p.regionsCount) continue;
      let r=state.regions[p.capitalId]; if (!r || r.ownerId!==p.id) { r=this.map.regions.find(r=>state.regions[r.id]?.ownerId===p.id); } if (!r) continue;
      const x=Math.round(ox+r.x*s),y=Math.round(oy+r.y*s); if (x< -20||y< -20||x>this.width+20||y>this.height+20) continue;
      ctx.fillStyle='#102019'; ctx.fillRect(x-1,y-12,2,14); ctx.fillRect(x+1,y-12,10,7); ctx.fillStyle=p.color; ctx.fillRect(x+2,y-11,8,5);
      if (p.id===state.you?.id) { ctx.strokeStyle='#e1f8bd'; ctx.lineWidth=1; ctx.strokeRect(x-4.5,y-15.5,18,20); }
      if ((this.preview && this.width>560) || this.zoom>1.65 && p.id===state.you?.id) { const name=p.name.toUpperCase(),w=ctx.measureText(name).width; let lx=x+15,ly=y-10; if (lx+w>this.width-12) lx=x-w-9; ctx.fillStyle='#102027dd'; ctx.fillRect(lx-4,ly-8,w+8,13); ctx.fillStyle=p.color; ctx.fillText(name,lx,ly+1); }
    }
  }
  drawBuildings(state) {
    if (this.preview && this.zoom<1.2) return;
    const ctx=this.ctx,s=this.scale,ox=this.ox,oy=this.oy,size=this.zoom>2?2:1;
    for (const r of this.map.regions) {
      const current=state.regions[r.id]; if (!current?.buildings?.length) continue;
      const x=Math.round(ox+r.x*s),y=Math.round(oy+r.y*s); if (x<0||y<0||x>this.width||y>this.height) continue;
      let n=0;
      for (const b of current.buildings) { const mask=ICON_PIXELS[b[0]]; if (!mask) continue; const bx=x-7+n%3*7,by=y+5+Math.floor(n/3)*8; ctx.fillStyle='#13231d'; ctx.fillRect(bx-1,by-1,5*size+2,5*size+2); ctx.fillStyle=state.players[current.ownerId]?.color||'#c4ee80'; for (let yy=0;yy<5;yy++) for (let xx=0;xx<5;xx++) if (mask[yy][xx]==='1') ctx.fillRect(bx+xx*size,by+yy*size,size,size); if (this.zoom>2.4) { ctx.font='7px "Plex Mono"'; ctx.fillStyle='#eff5df'; ctx.fillText(String(b[1]),bx+6,by+7); } n++; }
    }
  }
  drawWaves(now,state) {
    const ctx=this.ctx,s=this.scale,ox=this.ox,oy=this.oy,time=this.preview?now/1000:state.time;
    ctx.lineWidth=1;
    for (const w of state.waves||[]) {
      const sea=Array.isArray(w),owner=sea?w[1]:w.owner,fromX=sea?w[2]:w.fromX,fromY=sea?w[3]:w.fromY,toId=sea?w[4]:w.to,start=sea?w[6]:w.start,arrival=sea?w[7]:w.arrival,transfer=sea?w[8]:w.transfer;
      const target=this.map.regions[toId]; if (!target) continue;
      const progress=this.preview?(time%3)/3:clamp((time-start)/Math.max(0.01,arrival-start),0,1),color=state.players[owner]?.color||'#c4ee80';
      const x1=Math.round(ox+fromX*s),y1=Math.round(oy+fromY*s),x2=Math.round(ox+target.x*s),y2=Math.round(oy+target.y*s);
      ctx.strokeStyle=color+'66'; ctx.setLineDash(this.dash); ctx.lineDashOffset=this.reducedMotion?0:-now/90; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); ctx.setLineDash(this.emptyDash);
      if (!transfer) { const x=Math.round(x1+(x2-x1)*progress),y=Math.round(y1+(y2-y1)*progress); ctx.fillStyle=color; ctx.fillRect(x-2,y-2,5,5); ctx.fillStyle='#f0f8d9'; ctx.fillRect(x-1,y-1,2,2); if (!this.reducedMotion) { ctx.fillStyle=color+'88'; ctx.fillRect(Math.round(x-(x2-x1)*0.08)-1,Math.round(y-(y2-y1)*0.08)-1,3,3); } }
    }
    for (const p of state.projectiles||[]) {
      const [id,type,owner,from,to,start,arrival]=p,a=this.map.regions[from],b=this.map.regions[to]; if (!a||!b) continue;
      const t=clamp((state.time-start)/(arrival-start),0,1),x1=ox+a.x*s,y1=oy+a.y*s,x2=ox+b.x*s,y2=oy+b.y*s,arc=type==='missile'?Math.sin(t*Math.PI)*Math.min(60,s*10):0;
      const x=Math.round(x1+(x2-x1)*t),y=Math.round(y1+(y2-y1)*t-arc); ctx.strokeStyle=(state.players[owner]?.color||'#eee')+'55'; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x,y); ctx.stroke(); ctx.fillStyle=type==='missile'?'#f2bf85':'#e5ecad'; ctx.fillRect(x-2,y-2,type==='missile'?5:3,type==='missile'?5:3);
    }
    ctx.lineDashOffset=0;
  }
  drawMinimap(state) {
    const ctx=this.miniCtx; ctx.imageSmoothingEnabled=false; ctx.drawImage(this.base,0,0);
    const v=this.viewport(),x=v.x/this.map.width*this.minimap.width,y=v.y/this.map.height*this.minimap.height,w=v.w/this.map.width*this.minimap.width,h=v.h/this.map.height*this.minimap.height;
    ctx.strokeStyle='#d8f4b0'; ctx.lineWidth=1.5; ctx.strokeRect(Math.max(1,x+1),Math.max(1,y+1),Math.min(this.minimap.width-2,w-2),Math.min(this.minimap.height-2,h-2));
    const me=state.players[state.you?.id]; if (me) { const r=state.regions[me.capitalId]; if (r?.ownerId===me.id) { ctx.fillStyle='#f2ffe0'; ctx.fillRect(Math.round(r.x/this.map.width*this.minimap.width)-2,Math.round(r.y/this.map.height*this.minimap.height)-2,4,4); } }
  }
}
