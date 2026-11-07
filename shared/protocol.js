import { BALANCE as B, DEFAULT_SETTINGS } from '../config/balance.js';
export const COMMAND_TYPES = new Set(['ATTACK', 'TRANSFER', 'BUILD', 'UPGRADE', 'SET_ATTACK_PERCENT', 'SET_AUTO', 'CHAT', 'PING', 'PAUSE', 'AUTO_PAUSE']);
export const MESSAGE_TYPES = new Set(['JOIN', 'CMD', 'START', 'LOBBY_BOT', 'LOBBY_KICK', 'LOBBY_SETTINGS', 'LEAVE', 'REMATCH', 'VIEW']);
export const BUILDING_TYPES = new Set(['house', 'port', 'fort', 'drone', 'missile', 'aa']);
export function cleanName(value, fallback = 'Новый союз') { return typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || fallback : fallback; }
export function normalizeSettings(input = {}) {
  const num = (key, min, max, integer = true) => {
    const n = Number(input[key] ?? DEFAULT_SETTINGS[key]);
    const safe = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : DEFAULT_SETTINGS[key];
    return integer ? Math.round(safe) : safe;
  };
  return {
    bots: num('bots', 0, B.match.maxBots),
    difficulty: [1,2,3,4,5,'mixed'].includes(input.difficulty) ? input.difficulty : DEFAULT_SETTINGS.difficulty,
    speed: [0.5,1,2,4].includes(Number(input.speed)) ? Number(input.speed) : 1,
    startMultiplier: num('startMultiplier', 0.5, 3, false),
    peaceSeconds: [0,10,30].includes(Number(input.peaceSeconds)) ? Number(input.peaceSeconds) : 10,
    mapSize: input.mapSize === 'large' ? 'large' : 'standard',
    seed: typeof input.seed === 'string' || typeof input.seed === 'number' ? String(input.seed).slice(0, 32) || '42' : '42',
    minutes: num('minutes', 1, 60), victoryPercent: num('victoryPercent', 50, 100)
  };
}
export function validateCommand(message) {
  if (!message || message.t !== 'CMD' || typeof message.cmdId !== 'string' || !/^[\w-]{1,64}$/.test(message.cmdId) || !COMMAND_TYPES.has(message.type)) return 'Некорректная команда';
  const p = message.payload || {};
  if (typeof p !== 'object' || Array.isArray(p)) return 'Некорректные данные';
  switch (message.type) {
    case 'ATTACK': case 'TRANSFER':
      if (!Array.isArray(p.fromRegions) || !p.fromRegions.length || p.fromRegions.length > B.attack.maxSources || !p.fromRegions.every(Number.isInteger) || new Set(p.fromRegions).size !== p.fromRegions.length || !Number.isInteger(p.toRegionId)) return 'Неверные регионы';
      if (!Number.isFinite(p.percent) || p.percent < 0 || p.percent > 100) return 'Сила атаки должна быть от 0 до 100%';
      break;
    case 'BUILD': case 'UPGRADE':
      if (!Number.isInteger(p.regionId) || !BUILDING_TYPES.has(p.type)) return 'Неверная постройка'; break;
    case 'SET_ATTACK_PERCENT':
      if (!Number.isFinite(p.percent) || p.percent < 0 || p.percent > 100) return 'Неверная сила атаки'; break;
    case 'SET_AUTO': case 'PAUSE': case 'AUTO_PAUSE':
      if (typeof p.value !== 'boolean') return 'Ожидается true или false'; break;
    case 'CHAT':
      if (typeof p.text !== 'string' || p.text.trim().length === 0 || p.text.length > B.network.chatLength) return 'Сообщение: от 1 до 200 символов'; break;
    case 'PING': if (!Number.isFinite(p.sentAt)) return 'Неверный ping'; break;
  }
  return null;
}
export function validateViewport(p, map) {
  if (!p || !['x','y','w','h'].every(k => Number.isFinite(p[k]))) return null;
  const w = Math.max(1, Math.min(map.width, p.w)), h = Math.max(1, Math.min(map.height, p.h));
  return { x: Math.max(0, Math.min(map.width - w, p.x)), y: Math.max(0, Math.min(map.height - h, p.y)), w, h };
}
export const ERRORS = {
  INVALID: 'Некорректная команда', RATE_LIMIT: 'Слишком много команд — подождите',
  NOT_RUNNING: 'Матч ещё не идёт', ZERO_FORCE: 'Выберите силу атаки больше 0%',
  NO_TROOPS: 'В выбранных регионах нет войск', NOT_OWNER: 'Этот регион вам не принадлежит',
  NOT_ADJACENT: 'Выберите соседний регион. Для десанта нужен порт',
  SOURCE_BUSY: 'Из этого региона уже идёт атака', TARGET_BUSY: 'В регионе уже идёт военная операция',
  PEACE: 'Идёт мирная застройка — атаки пока запрещены', PORT_REQUIRED: 'Для морского перехода постройте порт',
  MAX_LEVEL: 'Достигнут максимальный уровень: 5', INSUFFICIENT_FUNDS: 'Недостаточно золота',
  FORBIDDEN: 'Это действие доступно только хосту', CHAT_RATE: 'Сообщения можно отправлять раз в 0,7 секунды',
  NOT_FOUND: 'Комната не найдена', ROOM_FULL: 'В комнате нет свободных мест', ALREADY_STARTED: 'Матч уже начался'
};
