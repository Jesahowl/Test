// Shared game configuration and helpers.
// Loaded by the Node server (require) and by the browser (window.TD_CONFIG).
(function (root) {
  'use strict';

  const CONFIG = {
    TICK_RATE: 20,
    MAP_W: 110,
    MAP_H: 110,

    START_GOLD: 160,
    BASE_INCOME: 3, // gold per second
    INCOME_PER_TILE: 0.03, // extra gold per second for each owned tile

    CORE_HP: 1000,
    CORE_CLAIM: 6, // territory radius around a core
    CORE_KILL_BOUNTY: 200, // plus half the victim's gold
    SPAWN_MIN_DIST: 24,

    MAX_LEVEL: 3,
    SELL_REFUND: 0.6,
    RUIN_CAPTURE_COST: 25,
    RUIN_LIFETIME: 120, // seconds before an unclaimed ruin crumbles

    FIRST_WAVE_DELAY: 25,
    NEUTRAL_WAVE_INTERVAL: 22,
    NEUTRAL_SPAWN_DIST: 20,

    MAX_CREEPS_PER_PLAYER: 60,
    BOT_TARGET: 6, // bots fill the server up to this many players
    MAX_PLAYERS: 24,

    TOWERS: {
      bolt: {
        name: 'Bolt', key: '1', cost: 50, hp: 200, range: 5, damage: 14, rate: 2.5,
        color: '#4fc3f7', desc: 'Fast single-target shots',
      },
      frost: {
        name: 'Frost', key: '2', cost: 70, hp: 180, range: 3.5, damage: 5, rate: 1,
        aoe: true, slow: 0.45, slowTime: 1.5,
        color: '#b3e5fc', desc: 'Pulses damage and slows all nearby creeps',
      },
      mortar: {
        name: 'Mortar', key: '3', cost: 110, hp: 220, range: 7, minRange: 1.5, damage: 45, rate: 0.5,
        splash: 1.6,
        color: '#ff8a65', desc: 'Long-range splash, cannot hit close targets',
      },
      beacon: {
        name: 'Beacon', key: '4', cost: 90, hp: 260, claim: 5,
        color: '#ffd54f', desc: 'Claims land around it: more income and build space',
      },
      wall: {
        name: 'Wall', key: '5', cost: 15, hp: 500,
        color: '#90a4ae', desc: 'Cheap blocker that creeps must chew through',
      },
    },

    CREEPS: {
      grunt: {
        name: 'Grunt', key: 'Z', cost: 10, hp: 45, speed: 2.2, damage: 8, bounty: 4, size: 0.28,
        desc: 'Cheap and steady',
      },
      runner: {
        name: 'Runner', key: 'X', cost: 15, hp: 28, speed: 4, damage: 5, bounty: 4, size: 0.22,
        desc: 'Fast, fragile',
      },
      brute: {
        name: 'Brute', key: 'C', cost: 45, hp: 260, speed: 1.2, damage: 35, bounty: 15, size: 0.42,
        desc: 'Slow tank that smashes walls',
      },
    },
  };

  // Stats of a tower at a given level (levels scale damage, range, hp, claim).
  CONFIG.towerStats = function (kind, level) {
    const d = CONFIG.TOWERS[kind];
    const l = level - 1;
    return {
      hp: Math.round(d.hp * (1 + 0.5 * l)),
      damage: d.damage ? d.damage * (1 + 0.6 * l) : 0,
      range: d.range ? d.range + 0.5 * l : 0,
      claim: d.claim ? d.claim + l : 0,
      rate: d.rate || 0,
    };
  };

  // Cost to go from `level` to `level + 1`.
  CONFIG.upgradeCost = function (kind, level) {
    return CONFIG.TOWERS[kind].cost * level;
  };

  // Total gold invested in a tower of this level.
  CONFIG.totalSpent = function (kind, level) {
    return CONFIG.TOWERS[kind].cost * (1 + (level * (level - 1)) / 2);
  };

  CONFIG.sellValue = function (kind, level) {
    return Math.floor(CONFIG.totalSpent(kind, level) * CONFIG.SELL_REFUND);
  };

  CONFIG.income = function (territory) {
    return CONFIG.BASE_INCOME + territory * CONFIG.INCOME_PER_TILE;
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
  } else {
    root.TD_CONFIG = CONFIG;
  }
})(typeof window !== 'undefined' ? window : globalThis);
