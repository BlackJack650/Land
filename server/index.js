import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { BALANCE as B } from '../config/balance.js';
import { MESSAGE_TYPES, ERRORS } from '../shared/protocol.js';
import { RoomManager } from './rooms/roomManager.js';
import { ProfileStore } from './profileStore.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maps = { standard: JSON.parse(fs.readFileSync(path.join(root,'shared/map/map.json'),'utf8')), large: JSON.parse(fs.readFileSync(path.join(root,'shared/map/map-large.json'),'utf8')) };
const store = new ProfileStore(path.join(root,'data'));
const manager = new RoomManager(maps,store);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use((req,res,next) => {
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self'; object-src 'none'; base-uri 'self'");
  next();
});
const apiLimits = new Map();
app.use('/api',(req,res,next) => {
  const now = Date.now(), key = req.ip, entry = apiLimits.get(key) || { start: now, count: 0 };
  if (now-entry.start > 60000) { entry.start = now; entry.count = 0; }
  entry.count++; apiLimits.set(key,entry);
  if (entry.count > 120) return res.status(429).json({ error: 'Слишком много запросов' });
  next();
});
app.get('/api/health',(_req,res) => res.json({ ok: true, version: B.version, rooms: manager.rooms.size, tickRate: B.tickRate }));
app.get('/api/rooms',(_req,res) => res.json(manager.listRooms()));
app.post('/api/rooms',(req,res) => {
  try { const room = manager.createRoom(req.body || {}); res.status(201).json({ code: room.id, mode: room.mode, settings: room.settings }); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/rooms/:code',(req,res) => { const room = manager.getRoom(req.params.code); if (!room || room.mode !== 'multi') return res.status(404).json({ error: 'Комната не найдена' }); res.json(room.lobbyState()); });
app.use('/shared',express.static(path.join(root,'shared'),{ maxAge: '1h', etag: true }));
app.use('/config',express.static(path.join(root,'config'),{ maxAge: '1h', etag: true }));
app.use(express.static(path.join(root,'client'),{ etag: true, maxAge: 0 }));
app.use('/api',(_req,res) => res.status(404).json({ error: 'Не найдено' }));
app.use((error,_req,res,_next) => { console.warn('HTTP:',error.message); res.status(400).json({ error: 'Некорректный запрос' }); });
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: B.network.maxMessageBytes, perMessageDeflate: false });
server.on('upgrade',(req,socket,head) => {
  if (req.url?.split('?')[0] !== '/ws') return;
  // Same-origin browser connections; non-browser CLI clients may omit Origin.
  if (req.headers.origin) {
    try {
      const allowed = new Set([req.headers.host, req.headers['x-forwarded-host']?.split(',')[0].trim()]);
      if (process.env.E2B_SANDBOX_ID) allowed.add(`${req.socket.localPort}-${process.env.E2B_SANDBOX_ID}.e2b.app`);
      if (!allowed.has(new URL(req.headers.origin).host)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    } catch { socket.destroy(); return; }
  }
  wss.handleUpgrade(req,socket,head,ws => wss.emit('connection',ws,req));
});
wss.on('connection',ws => {
  ws.isAlive = true; ws.rateStart = Date.now(); ws.rateCount = 0;
  ws.on('pong',() => { ws.isAlive = true; });
  ws.on('error',() => {});
  ws.on('message',data => {
    try {
      const now = Date.now(); if (now-ws.rateStart >= 1000) { ws.rateStart = now; ws.rateCount = 0; }
      if (++ws.rateCount > B.network.commandsPerSecond + 5) { ws.send(JSON.stringify({ t: 'ERR', code: 'RATE_LIMIT', message: ERRORS.RATE_LIMIT })); return; }
      const message = JSON.parse(data.toString());
      if (!message || !MESSAGE_TYPES.has(message.t)) throw new Error('Unknown message');
      if (message.t === 'JOIN') { manager.join(ws,message); return; }
      const room = manager.getRoom(ws.roomCode); if (!room) return;
      if (message.t === 'VIEW') { room.enqueue({ playerId: ws.playerId, view: message.payload }); return; }
      if (message.t === 'LEAVE') { ws.leaving = true; room.enqueue({ playerId: ws.playerId, lobby: true, action: 'LEAVE' }); ws.send(JSON.stringify({ t: 'LEFT' })); ws.close(1000,'Left room'); return; }
      if (message.t === 'CMD') room.enqueue({ playerId: ws.playerId, message });
      else room.enqueue({ playerId: ws.playerId, lobby: true, action: message.t, payload: message.payload || {}, message: { cmdId: message.cmdId } });
    } catch (error) {
      const code = error.code && ERRORS[error.code] ? error.code : 'INVALID';
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ERR', code, message: ERRORS[code] }));
    }
  });
  ws.on('close',() => manager.detach(ws));
});
const tickMs = 1000 / B.tickRate;
let last = performance.now(), accumulator = 0;
const timer = setInterval(() => {
  const now = performance.now(); accumulator += Math.min(250,now-last); last = now;
  let steps = 0;
  while (accumulator >= tickMs && steps++ < 5) { manager.tick(1/B.tickRate); accumulator -= tickMs; }
  if (steps >= 5) accumulator = 0; // bounded catch-up, never an unbounded spiral
},10);
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  for (const [key,value] of apiLimits) if (Date.now()-value.start > 120000) apiLimits.delete(key);
},30000);
let closing = false;
function shutdown() {
  if (closing) return; closing = true; clearInterval(timer); clearInterval(heartbeat); manager.shutdown();
  wss.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0),2000).unref();
}
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
const port = Number(process.env.PORT || 3000);
server.listen(port,'0.0.0.0',() => console.log(`LAND v${B.version} — http://localhost:${port} · WebSocket /ws · ${B.tickRate} Hz`));
export { app, server, manager };
