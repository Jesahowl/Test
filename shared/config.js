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

    // Pathfinding: entering a structure tile (core or beacon) costs (BASE + maxHp * PER_HP) extra
    // tiles of walking, so creeps go around structures unless the detour is very long.
    PATH_STRUCT_BASE: 4,
    PATH_STRUCT_PER_HP: 0.08,
    PATH_RECOMPUTE_INTERVAL: 0.25, // seconds between flow-field rebuilds for the same target

    BOT_TARGET: 6, // bots fill the server up to this many players
    MAX_PLAYERS: 24,

    // Mobile defenders. Each one guards an anchor (your core or one of your beacons): it patrols
    // within the anchor's leash radius, chases enemy creeps that come near, and never leaves your land.
    UNITS: {
      bolt: {
        name: 'Bolt', key: '1', cost: 55, hp: 160, range: 4, damage: 14, rate: 2.5, speed: 2.8,
        color: '#4fc3f7', desc: 'Fast single-target shots',
      },
      frost: {
        name: 'Frost', key: '2', cost: 75, hp: 150, range: 3, damage: 5, rate: 1, speed: 2.4,
        aoe: true, slow: 0.45, slowTime: 1.5,
        color: '#b3e5fc', desc: 'Pulses damage and slows all nearby creeps',
      },
      mortar: {
        name: 'Mortar', key: '3', cost: 115, hp: 180, range: 6, minRange: 1.5, damage: 45, rate: 0.5, speed: 1.6,
        splash: 1.6,
        color: '#ff8a65', desc: 'Long-range splash, cannot hit close targets',
      },
    },
    MAX_UNITS: 14, // per player
    UNIT_LEASH_CORE: 4.5, // patrol radius around the core
    UNIT_LEASH_BEACON: 3.5, // patrol radius around a beacon
    UNIT_REPATH: 0.4, // seconds between re-planning a chase path

    // Fixed structures.
    TOWERS: {
      beacon: {
        name: 'Beacon', key: '4', cost: 90, hp: 400, claim: 5,
        color: '#ffd54f', desc: 'Claims land around it. Creeps attack beacons they pass - guard them!',
      },
    },

    // Creeps divert to attack enemy beacons within this range, and fight enemy units they bump into.
    CREEP_AGGRO_RANGE: 2.5,
    CREEP_UNIT_REACH: 0.7,

    // Leapfrogging: beacons may be placed on unclaimed land up to this many tiles outside your border.
    BEACON_LEAP: 3,
    // Capture by occupation: your units within CAPTURE_RANGE of an enemy beacon take it over after
    // CAPTURE_TIME seconds (faster with more units) - unless any of the owner's units are there too.
    CAPTURE_RANGE: 4.5,
    CAPTURE_TIME: 10,
    CAPTURE_EXTRA_UNIT_SPEED: 0.5, // each extra unit adds 50% capture speed

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
        desc: 'Slow tank that hits hard',
      },
    },
  };

  // Definition of a unit or structure kind.
  CONFIG.defOf = function (kind) {
    return CONFIG.UNITS[kind] || CONFIG.TOWERS[kind];
  };

  // Stats of a unit or structure at a given level (levels scale damage, range, hp, claim).
  CONFIG.towerStats = function (kind, level) {
    const d = CONFIG.defOf(kind);
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
    return CONFIG.defOf(kind).cost * level;
  };

  // Total gold invested in a unit or structure of this level.
  CONFIG.totalSpent = function (kind, level) {
    return CONFIG.defOf(kind).cost * (1 + (level * (level - 1)) / 2);
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
