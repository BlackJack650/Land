import { BALANCE as B, COLORS, COUNTRIES } from '../../config/balance.js';
import { seededRandom, pickWeighted, hashSeed } from '../../shared/rng.js';
import { cleanName, normalizeSettings, validateCommand, validateViewport, ERRORS } from '../../shared/protocol.js';
import { troopCap } from '../../shared/formulas.js';
import { refreshStats, growEconomies } from '../sim/economy.js';
import { launchAttack, advanceWaves, GameError } from '../sim/combat.js';
import { build, advanceWeapons } from '../sim/buildings.js';
import { AIController } from '../ai/aiController.js';

export class GameRoom {
  constructor(id, { mode = 'solo', settings = {}, map, maps = {}, headless = false, onFinish } = {}) {
    this.id = id; this.mode = mode; this.headless = headless; this.onFinish = onFinish;
    this.maps = maps; this.map = map; this.settings = normalizeSettings({ ...settings, bots: Math.max(mode === 'solo' ? 1 : 0, settings.bots ?? (mode === 'solo' ? 8 : 0)) });
    this.players = []; this.hostId = null; this.phase = 'lobby'; this.tickNumber = 0; this.time = 0; this.realTime = 0; this.emptySince = 0;
    this.manualPause = false; this.autoPause = false; this.countdown = 0; this.result = null;
    this.queue = []; this.queueHead = 0; this.events = []; this.eventSeq = 0; this.nextEntityId = 1; this.waves = []; this.projectiles = []; this.flashes = []; this.ai = new Map();
    this.resetState();
  }
  get paused() { return this.mode === 'solo' && (this.manualPause || this.autoPause); }
  resetState() {
    this.random = seededRandom(this.settings.seed);
    const offset = hashSeed(this.settings.seed) % this.map.spawns.length;
    this.spawnOrder = this.map.spawns.map((_, i) => this.map.spawns[(i + offset) % this.map.spawns.length]);
    this.averageArea = this.map.landCells / this.map.regions.length;
    this.regions = this.map.regions.map(r => ({ ...r, ownerId: null, troops: Math.max(1, Math.round(r.area * B.map.neutralTroopsPerCell)), buildings: {} }));
    this.time = 0; this.tickNumber = 0; this.countdown = 0; this.result = null; this.manualPause = false; this.autoPause = false;
    this.waves.length = 0; this.projectiles.length = 0; this.flashes.length = 0; this.ai.clear();
    this.lockedSources = new Set(); this.lockedTargets = new Set();
    for (const p of this.players) {
      p.capitalId = this.spawnOrder[p.id]; p.regionsCount = 0; p.troops = 0; p.houseLevels = 0; p.portLevels = 0; p.buildingCount = 0;
      p.cap = troopCap(0); p.growth = 0; p.income = 0; p.economy = B.economy.start * this.settings.startMultiplier;
      p.growthPool = 0; p.growthCursor = 0; p.peakRegions = 1; p.eliminated = false; p.lastAttackAt = -Infinity; p.lastChatAt = -Infinity;
      p.owned = []; p.frontier = []; p.autoExpand = false; p.attackPercent = 50; p.commandHistory = new Map(); p.bucket = B.network.commandsPerSecond;
      const capital = this.regions[p.capitalId]; capital.ownerId = p.id; capital.troops = Math.floor(troopCap(0) * B.startTroopFraction * this.settings.startMultiplier);
    }
    refreshStats(this);
  }
  addPlayer({ name, color, token, connected = true, bot = false, difficulty } = {}) {
    if (this.players.length >= B.match.maxSlots) throw new GameError('ROOM_FULL');
    if (this.phase !== 'lobby') throw new GameError('ALREADY_STARTED');
    const id = this.players.length;
    const chosenColor = COLORS.includes(color) && !this.players.some(p => p.color === color) ? color : COLORS.find(c => !this.players.some(p => p.color === c));
    const level = difficulty === 'mixed' || !difficulty ? pickWeighted(B.ai.mixedWeights, seededRandom(`${this.settings.seed}:level:${id}`)()) : Math.max(1, Math.min(5, Number(difficulty) || 3));
    const p = { id, name: cleanName(name, bot ? `AI ${id + 1}` : COUNTRIES[id]), color: chosenColor, isBot: bot, difficulty: level, requestedDifficulty: difficulty || 'mixed', connected, token, disconnectedAt: connected ? null : this.realTime, viewport: null, fullResync: true };
    this.players.push(p); if (this.hostId === null && !bot) this.hostId = id;
    this.resetState(); return p;
  }
  addBot(difficulty = this.settings.difficulty) { return this.addPlayer({ bot: true, difficulty, name: `AI ${this.players.length + 1}` }); }
  fillBots() { const target = Math.min(B.match.maxSlots, this.players.filter(p => !p.isBot).length + this.settings.bots); while (this.players.length < target) this.addBot(); }
  startCountdown() {
    if (this.phase !== 'lobby') return;
    this.fillBots();
    if (this.players.length < 2) throw new GameError('INVALID');
    this.resetState(); this.phase = 'countdown'; this.countdown = B.match.countdownSeconds;
    this.emit('info', { text: 'Государства основаны. Приготовьтесь к расширению.' });
  }
  begin() {
    this.phase = 'running'; this.countdown = 0;
    for (const p of this.players) { if (p.isBot) this.ai.set(p.id, new AIController(this, p)); p.fullResync = true; }
    this.emit('info', { text: this.settings.peaceSeconds ? `Мирная застройка: ${this.settings.peaceSeconds} секунд.` : 'Мир открыт. Захватывайте соседние регионы.' });
  }
  emit(type, payload = {}, regionId = null) {
    this.events.push({ id: ++this.eventSeq, type, p: payload, regionId, time: Math.round(this.time * 100) / 100 });
    if (this.events.length > B.network.eventHistory) this.events.shift();
  }
  deliver(playerId, message) { const p = this.players[playerId]; if (p?.connected && !p.isBot && this.send) this.send(playerId, message); }
  enqueue(item) { this.queue.push(item); }
  reject(item, code, message) { if (!item.internal) this.deliver(item.playerId, { t: 'ERR', cmdId: item.message?.cmdId, code, message: message || ERRORS[code] || code }); }
  processCommands() {
    for (; this.queueHead < this.queue.length; this.queueHead++) {
      const item = this.queue[this.queueHead], p = this.players[item.playerId];
      if (!p) continue;
      if (item.view) { this.setViewport(p, item.view); continue; }
      if (item.lobby) { this.processLobby(item); continue; }
      const m = item.message;
      const invalid = validateCommand(m); if (invalid) { this.reject(item, 'INVALID', invalid); continue; }
      const previous = p.commandHistory.get(m.cmdId);
      if (previous) { if (!item.internal) this.deliver(p.id, previous); continue; }
      p.bucket = Math.min(B.network.commandsPerSecond, p.bucket + (item.dt || 0));
      if (!item.internal && p.bucket < 1) { this.reject(item, 'RATE_LIMIT'); continue; }
      if (!item.internal) p.bucket--;
      try {
        const payload = m.payload || {};
        switch (m.type) {
          case 'PING': break;
          case 'CHAT':
            if (this.realTime - p.lastChatAt < B.network.chatCooldown) throw new GameError('CHAT_RATE');
            p.lastChatAt = this.realTime; this.emit('chat', { owner: p.id, name: p.name, text: payload.text.replace(/[\u0000-\u001f]/g, '').trim().slice(0, B.network.chatLength) }); break;
          case 'SET_ATTACK_PERCENT': p.attackPercent = payload.percent; break;
          case 'SET_AUTO': p.autoExpand = payload.value; break;
          case 'PAUSE': if (this.mode === 'solo' && p.id === this.hostId) this.manualPause = payload.value; break;
          case 'AUTO_PAUSE': if (this.mode === 'solo' && p.id === this.hostId) this.autoPause = payload.value; break;
          default:
            if (this.phase !== 'running' || p.eliminated) throw new GameError('NOT_RUNNING');
            if (this.paused && !item.internal) throw new GameError('NOT_RUNNING');
            if (m.type === 'ATTACK' || m.type === 'TRANSFER') launchAttack(this, p, payload, m.type === 'TRANSFER');
            else if (m.type === 'BUILD' || m.type === 'UPGRADE') build(this, p, payload);
        }
        const response = { t: m.type === 'PING' ? 'PONG' : 'ACK', cmdId: m.cmdId, ok: true, sentAt: payload.sentAt, tick: this.tickNumber };
        p.commandHistory.set(m.cmdId, response); if (!item.internal) this.deliver(p.id, response);
      } catch (error) {
        const code = error instanceof GameError ? error.code : 'INVALID';
        if (!(error instanceof GameError)) console.error(`Command error in room ${this.id}:`, error);
        p.commandHistory.set(m.cmdId, { t: 'ERR', cmdId: m.cmdId, code, message: ERRORS[code] || code });
        this.reject(item, code);
      }
      if (p.commandHistory.size > B.network.commandHistory) p.commandHistory.delete(p.commandHistory.keys().next().value);
    }
    this.queue.length = 0; this.queueHead = 0;
  }
  processLobby(item) {
    const p = this.players[item.playerId]; if (!p) return;
    try {
      if (item.action !== 'LEAVE' && p.id !== this.hostId) throw new GameError('FORBIDDEN');
      if (item.action === 'START') this.startCountdown();
      else if (item.action === 'REMATCH' && this.phase === 'finished') { this.phase = 'lobby'; this.resetState(); this.startCountdown(); }
      else if (this.phase === 'lobby') {
        if (item.action === 'LOBBY_BOT') {
          if (Number.isInteger(item.payload.slot)) {
            const slot = this.players[item.payload.slot]; if (!slot || slot.id === this.hostId) throw new GameError('FORBIDDEN');
            if (!slot.isBot) this.deliver(slot.id, { t: 'KICKED', message: 'Хост заменил ваш слот ботом' });
            slot.isBot = true; slot.connected = true; slot.token = null; slot.name = `AI ${slot.id + 1}`;
            slot.requestedDifficulty = item.payload.difficulty || 'mixed';
            slot.difficulty = slot.requestedDifficulty === 'mixed' ? pickWeighted(B.ai.mixedWeights, this.random()) : Math.max(1, Math.min(5, Number(slot.requestedDifficulty) || 3));
          } else this.addBot(item.payload.difficulty);
        } else if (item.action === 'LOBBY_KICK') {
          const slot = this.players[item.payload.slot]; if (!slot || slot.id === this.hostId) throw new GameError('FORBIDDEN');
          const host = this.players[this.hostId];
          if (!slot.isBot) this.deliver(slot.id, { t: 'KICKED', message: 'Хост освободил ваш слот' });
          if (this.players.filter(s => !s.isBot).length === 1) this.players.splice(slot.id,1);
          else { slot.isBot = true; slot.connected = true; slot.token = null; slot.difficulty = 3; slot.name = `AI ${slot.id + 1}`; }
          // Reindex the remaining lobby slots and their capitals atomically.
          this.players.forEach((s,id) => { s.id = id; });
          this.hostId = this.players.includes(host) ? host.id : this.players.find(s => !s.isBot)?.id ?? null;
          this.resetState();
        } else if (item.action === 'LOBBY_SETTINGS') {
          this.settings = normalizeSettings({ ...this.settings, ...item.payload, bots: Math.min(item.payload.bots ?? this.settings.bots, B.match.maxSlots - this.players.filter(p => !p.isBot).length) });
          if (this.settings.mapSize === 'large' && this.maps.large) this.map = this.maps.large;
          if (this.settings.mapSize === 'standard' && this.maps.standard) this.map = this.maps.standard;
          this.resetState();
        }
      }
      if (item.action === 'LEAVE') this.disconnect(p.id, true);
      if (!item.internal) this.deliver(p.id, { t: 'ACK', cmdId: item.message?.cmdId, ok: true });
    } catch (error) { this.reject(item, error instanceof GameError ? error.code : 'INVALID'); }
  }
  disconnect(id, explicit = false) {
    const p = this.players[id]; if (!p || p.isBot) return;
    p.connected = false; p.disconnectedAt = this.realTime; p.viewport = null;
    if (this.phase === 'lobby') {
      const host = this.players[this.hostId];
      this.players.splice(id,1); this.players.forEach((s,i) => s.id = i);
      this.hostId = this.players.includes(host) ? host.id : this.players.find(s => !s.isBot)?.id ?? null;
      this.resetState();
    } else if (explicit || this.phase === 'finished') this.replaceWithBot(p);
    this.emit('info', { text: `${p.name}: ${explicit ? 'страну возглавил ИИ' : 'связь потеряна, слот сохранён на 90 секунд'}` });
  }
  replaceWithBot(p) { p.isBot = true; p.connected = true; p.token = null; p.difficulty = 3; p.name = `AI ${p.id + 1}`; p.autoExpand = true; if (this.phase === 'running') this.ai.set(p.id, new AIController(this,p)); if (this.hostId === p.id) this.hostId = this.players.find(s => !s.isBot && s.connected)?.id ?? null; }
  tick(realDt = 1 / B.tickRate) {
    this.realTime += realDt;
    for (const p of this.players) {
      p.bucket = Math.min(B.network.commandsPerSecond, p.bucket + realDt * B.network.commandsPerSecond);
      if (!p.isBot && !p.connected && this.phase === 'running' && this.realTime - p.disconnectedAt >= B.network.reconnectSeconds) this.replaceWithBot(p);
    }
    this.processCommands();
    if (this.phase === 'countdown') { this.countdown -= realDt; if (this.countdown <= 0) this.begin(); return; }
    if (this.phase !== 'running' || this.paused) return;
    const dt = realDt * this.settings.speed;
    this.time += dt; this.tickNumber++;
    refreshStats(this); growEconomies(this, dt); advanceWaves(this); advanceWeapons(this);
    for (const controller of this.ai.values()) controller.think(this);
    for (const p of this.players) if (!p.eliminated && p.regionsCount === 0) { p.eliminated = true; this.emit('defeat', { owner: p.id }); }
    if (this.flashes.length) this.flashes = this.flashes.filter(f => this.time - f.at < B.render.captureFlashSeconds);
    const threshold = Math.ceil(this.regions.length * this.settings.victoryPercent / 100);
    const leader = [...this.players].sort((a,b) => b.regionsCount-a.regionsCount)[0];
    const alive = this.players.filter(p => p.regionsCount > 0);
    if (leader?.regionsCount >= threshold) this.finish('conquest');
    else if (alive.length <= 1) this.finish('domination');
    else if (this.time >= this.settings.minutes * 60) this.finish('time');
    this.assertInvariants();
  }
  assertInvariants() {
    for (const r of this.regions) {
      if (!Number.isFinite(r.troops) || r.troops < 0 || !Number.isInteger(r.troops)) throw new Error(`Invalid garrison in region ${r.id}`);
      if (r.ownerId !== null && !this.players[r.ownerId]) throw new Error(`Invalid owner in region ${r.id}`);
      for (const b of Object.values(r.buildings)) if (b.level < 1 || b.level > 5 || b.hp <= 0 || b.hp > b.maxHp) throw new Error(`Invalid building in region ${r.id}`);
    }
    for (const p of this.players) if (!Number.isFinite(p.economy) || p.economy < 0 || p.troops < 0) throw new Error(`Invalid economy for player ${p.id}`);
  }
  finish(reason = 'time') {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    const ranking = [...this.players].sort((a,b) => b.regionsCount-a.regionsCount || b.peakRegions-a.peakRegions || b.troops-a.troops || a.id-b.id);
    this.result = { reason, winnerId: ranking[0]?.id ?? null, time: this.time, threshold: this.settings.victoryPercent, ranking: ranking.map((p,i) => ({ id: p.id, name: p.name, color: p.color, place: i+1, regions: p.regionsCount, peakRegions: p.peakRegions, troops: p.troops, buildings: p.buildingCount, isBot: p.isBot })) };
    this.emit('result', this.result); this.onFinish?.(this);
  }
  publicPlayer(p) { return { id: p.id, name: p.name, color: p.color, isBot: p.isBot, difficulty: p.difficulty, requestedDifficulty: p.requestedDifficulty, connected: p.connected, regionsCount: p.regionsCount, troops: p.troops, cap: p.cap, growth: p.growth, income: p.income, buildingCount: p.buildingCount, eliminated: p.eliminated, capitalId: p.capitalId }; }
  lobbyState() { return { t: 'LOBBY', code: this.id, mode: this.mode, hostId: this.hostId, phase: this.phase, settings: this.settings, mapSize: this.settings.mapSize, players: this.players.map(p => this.publicPlayer(p)) }; }
  snapshot(player, client) {
    const full = !!client.full; client.full = false;
    const view = player.viewport || { x: 0, y: 0, w: this.map.width, h: this.map.height };
    const delta = [];
    for (const r of this.regions) {
      const visible = r.ownerId === player.id || r.neighbors.some(id => this.regions[id].ownerId === player.id) || (r.x >= view.x - 3 && r.x <= view.x + view.w + 3 && r.y >= view.y - 3 && r.y <= view.y + view.h + 3);
      const row = visible ? [r.id, r.ownerId, r.troops, Object.values(r.buildings).map(b => [b.type,b.level,Math.ceil(b.hp)])] : [r.id,r.ownerId];
      const key = JSON.stringify(row), old = client.baseline.get(r.id);
      if (full || old !== key) { delta.push(row); client.baseline.set(r.id,key); }
    }
    const events = this.events.filter(e => e.id > (client.lastEvent || 0)); client.lastEvent = this.eventSeq;
    return { t: 'SNAP', full, tick: this.tickNumber, time: this.time, phase: this.phase, countdown: Math.ceil(this.countdown), paused: this.paused, peaceLeft: Math.max(0,this.settings.peaceSeconds-this.time), settings: this.settings, hostId: this.hostId,
      players: this.players.map(p => this.publicPlayer(p)), you: { id: player.id, economy: player.economy, attackPercent: player.attackPercent, autoExpand: player.autoExpand, houseLevels: player.houseLevels, portLevels: player.portLevels },
      delta, events, waves: this.waves.map(w => [w.id,w.owner,w.fromX,w.fromY,w.to,w.force,w.start,w.arrival,w.transfer,w.from]),
      projectiles: this.projectiles.map(p => [p.id,p.type,p.owner,p.from,p.to,p.start,p.arrival]),
      result: this.result };
  }
  setViewport(player, payload) { const view = validateViewport(payload,this.map); if (view) { const old = player.viewport; player.viewport = view; if (!old || ['x','y','w','h'].some(k => Math.abs(old[k] - view[k]) > 0.75)) player.fullResync = true; } }
}
