import { randomBytes } from 'node:crypto';
import { BALANCE as B } from '../../config/balance.js';
import { GameRoom } from './gameRoom.js';
import { GameError } from '../sim/combat.js';

/** @typedef {{createRoom:Function,getRoom:Function,listRooms:Function,tick:Function,shutdown:Function}} IGameServer */
/** Single-process IGameServer implementation. Room IDs are the sharding key. */
export class RoomManager {
  constructor(maps, store = null) { this.maps = maps; this.store = store; this.rooms = new Map(); this.sessions = new Map(); this.steps = 0; }
  createRoom({ mode = 'solo', settings = {}, mapSize } = {}) {
    if (this.rooms.size >= B.network.maxRooms) throw new Error('Сервер заполнен. Попробуйте позже.');
    let code; do { code = randomBytes(4).toString('hex').slice(0,6).toUpperCase(); } while (this.rooms.has(code));
    const size = mapSize || settings.mapSize || 'standard';
    const room = new GameRoom(code, { mode: mode === 'solo' ? 'solo' : 'multi', settings: { ...settings, mapSize: size }, map: this.maps[size] || this.maps.standard, maps: this.maps, onFinish: r => this.store?.record(r) });
    room.send = (id,message) => { const ws = this.sessions.get(`${code}:${id}`); if (ws?.readyState === 1) ws.send(JSON.stringify(message)); };
    this.rooms.set(code,room); return room;
  }
  getRoom(code) { return this.rooms.get(String(code).toUpperCase()); }
  listRooms() { return [...this.rooms.values()].filter(r => r.mode === 'multi' && r.phase === 'lobby').map(r => ({ code: r.id, players: r.players.filter(p => !p.isBot).length, bots: r.players.filter(p => p.isBot).length, slots: B.match.maxSlots, seed: r.settings.seed, mapSize: r.settings.mapSize, host: r.players[r.hostId]?.name || 'Комната' })); }
  attach(ws, room, player) {
    const key = `${room.id}:${player.id}`;
    const old = this.sessions.get(key); if (old && old !== ws) old.close(4001, 'Session resumed elsewhere');
    this.sessions.set(key,ws); ws.roomCode = room.id; ws.playerId = player.id;
    ws.clientState = { full: true, baseline: new Map(), lastEvent: 0 };
    player.connected = true; player.disconnectedAt = null; player.fullResync = true;
    ws.send(JSON.stringify({ t: 'WELCOME', code: room.id, playerId: player.id, token: player.token, mode: room.mode, mapSize: room.settings.mapSize, settings: room.settings, serverTickRate: B.tickRate }));
    ws.send(JSON.stringify(room.lobbyState()));
    ws.send(JSON.stringify(room.snapshot(player,ws.clientState)));
  }
  join(ws, message) {
    const room = this.getRoom(message.code); if (!room) throw new GameError('NOT_FOUND');
    if (ws.roomCode) throw new GameError('INVALID');
    let player = typeof message.token === 'string' && message.token.length <= 100 ? room.players.find(p => !p.isBot && p.token === message.token) : null;
    if (player) { room.emit('info', { text: `${player.name}: связь восстановлена` }); }
    else player = room.addPlayer({ name: message.name, color: message.color, token: randomBytes(24).toString('hex') });
    this.attach(ws,room,player);
    if (room.mode === 'solo' && room.phase === 'lobby') room.enqueue({ playerId: player.id, lobby: true, action: 'START', internal: true });
    return room;
  }
  detach(ws) {
    if (!ws.roomCode || ws.leaving) return;
    const key = `${ws.roomCode}:${ws.playerId}`;
    if (this.sessions.get(key) === ws) { this.sessions.delete(key); this.getRoom(ws.roomCode)?.disconnect(ws.playerId); }
  }
  tick(dt = 1 / B.tickRate) {
    this.steps++;
    for (const [code,room] of this.rooms) {
      room.tick(dt);
      const humans = room.players.filter(p => !p.isBot && p.connected);
      if (!humans.length) { if (!room.emptySince) room.emptySince = room.realTime; }
      else room.emptySince = 0;
      const ttl = room.phase === 'lobby' ? B.network.emptyLobbyTTL : B.network.reconnectSeconds + B.network.emptyLobbyTTL;
      if (room.emptySince && room.realTime - room.emptySince > ttl) { this.rooms.delete(code); continue; }
      if (this.steps % (B.tickRate / B.snapshotRate) !== 0) continue;
      for (const p of room.players) {
        if (p.isBot || !p.connected) continue;
        const ws = this.sessions.get(`${code}:${p.id}`); if (!ws || ws.readyState !== 1 || ws.bufferedAmount > 2_000_000) continue;
        if (p.fullResync) { ws.clientState.full = true; p.fullResync = false; }
        if (room.phase === 'lobby' || room.phase === 'countdown') ws.send(JSON.stringify(room.lobbyState()));
        ws.send(JSON.stringify(room.snapshot(p,ws.clientState)));
      }
    }
  }
  shutdown() {
    for (const room of this.rooms.values()) { if (room.phase === 'running') room.finish('shutdown'); for (const p of room.players) room.deliver(p.id,{ t: 'SERVER_SHUTDOWN', message: 'Сервер перезапускается. Создайте новую комнату после подключения.' }); }
    for (const ws of this.sessions.values()) ws.close(1001,'Server shutdown');
    this.rooms.clear(); this.sessions.clear(); this.store?.flush();
  }
}
