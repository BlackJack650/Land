// All balance knobs are centralized here. Distances use the 192-cell map;
// the large map scales weapon/port radii proportionally, never the economy.
export const BALANCE = Object.freeze({
  version: '0.1.0',
  map: { width: 192, height: 96, largeWidth: 256, largeHeight: 128, regions: 320, largeRegions: 340, minIslandCells: 3, seaLinkCells: 6, neutralTroopsPerCell: 0.12 },
  tickRate: 20,
  snapshotRate: 10,
  growth: { coefficient: 0.30, exponent: 0.92, houseMultiplier: 0.03, baseCap: 300, capPerHouse: 350 },
  economy: { regionIncome: 0.06, houseIncome: 0.35, portIncome: 0.5, portRegionBonus: 0.05, start: 200 },
  startTroopFraction: 0.40,
  attack: { neutralBase: 1, neutralTroopCost: 0.5, areaExponent: 0.5, baseSeconds: 0.25, secondsPerCell: 0.05, cooldownSeconds: 0.1, maxSources: 64, cascadeReserve: 0, fortSlow: 1.5, fortForceLoss: 0.08, fortDefense: 0.10, portForceBonus: 0.15 },
  buildings: {
    maxLevel: 5, priceGrowth: 1.08, upgradeGrowth: 1.6, upgradeHealFraction: 0.5,
    house: { name: 'Дом', cost: 100, hp: 100, radius: 0, cooldown: 0 },
    port: { name: 'Порт', cost: 250, hp: 120, radius: 6, cooldown: 0 },
    fort: { name: 'Защита', cost: 300, hp: 150, radius: 4, cooldown: 0 },
    drone: { name: 'FPV-дрон', cost: 400, hp: 80, radius: 5, cooldown: 20, damage: 25, flightSeconds: 0.8 },
    missile: { name: 'Ракета', cost: 900, hp: 60, radius: 12, cooldown: 60, damage: 120, flightSeconds: 2.5, splash: 1.5 },
    aa: { name: 'ПВО', cost: 500, hp: 100, radius: 6, cooldown: 8, missileChance: 0.25, missileChanceCap: 0.9 }
  },
  capture: { intact: 0.40, damaged: 0.35, destroyed: 0.25, hpDestructionWeight: 0.15, overkillWeight: 0, minDestroy: 0.05, maxDestroy: 0.6, damageHpFraction: 0.5 },
  ai: {
    mixedWeights: [15, 20, 30, 20, 15], reserveFraction: 0.18, mistakeChance: 0.16,
    profiles: {
      1: { reactionMs: 1200, aggression: 0.2, buildBudget: 0.2 },
      2: { reactionMs: 900, aggression: 0.35, buildBudget: 0.3 },
      3: { reactionMs: 600, aggression: 0.5, buildBudget: 0.4 },
      4: { reactionMs: 350, aggression: 0.7, buildBudget: 0.55 },
      5: { reactionMs: 150, aggression: 0.9, buildBudget: 0.7 }
    }
  },
  match: { defaultMinutes: 10, defaultVictoryPercent: 65, minBots: 1, maxBots: 15, maxSlots: 20, countdownSeconds: 3 },
  network: { maxRooms: 100, emptyLobbyTTL: 60, reconnectSeconds: 90, commandsPerSecond: 30, chatCooldown: 0.7, chatLength: 200, maxMessageBytes: 16384, commandHistory: 256, eventHistory: 160, highPingMs: 250 },
  render: { minZoom: 0.5, maxZoom: 8, maxDPR: 2, maxBattleSounds: 6, particlePool: 160, wavePool: 96, lowFps: 45, degradeAfterSeconds: 3, captureFlashSeconds: 0.2 }
});
export const DEFAULT_SETTINGS = Object.freeze({
  bots: 8, difficulty: 'mixed', speed: 1, startMultiplier: 1, peaceSeconds: 10,
  mapSize: 'standard', seed: 42, minutes: 10, victoryPercent: 65
});
export const COLORS = ['#c4ee80', '#e9a36f', '#81b8dc', '#c49cda', '#e27878', '#72c6b3', '#e3cc79', '#9da9e7', '#d58eb3', '#9fc18b', '#dfb493', '#7fc5ce', '#b5a17c', '#c1bed8', '#d99565', '#7ea48b', '#cd7c95', '#acb865', '#859fc4', '#b78c72', '#84b2a3'];
export const COUNTRIES = ['Северный союз', 'Янтарная республика', 'Лазурный берег', 'Лунная федерация', 'Алая империя', 'Лесная держава', 'Золотой рассвет', 'Звёздный союз', 'Розовый альянс', 'Новая земля', 'Медный край', 'Бирюзовая лига', 'Песчаный султанат', 'Серебряный пакт', 'Оранжевая республика', 'Зелёный остров', 'Коралловый союз', 'Степная федерация', 'Синий горизонт', 'Кедровый край', 'Мятная республика'];
