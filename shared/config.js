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
    SPAWN_SHIELD: 60, // seconds after spawning during which other players can't send you creeps

    MAX_LEVEL: 3,
    SELL_REFUND: 0.6,
    RUIN_CAPTURE_COST: 25,
    RUIN_LIFETIME: 120, // seconds before an unclaimed ruin crumbles

    FIRST_WAVE_DELAY: 25,
    NEUTRAL_WAVE_INTERVAL: 22,
    NEUTRAL_SPAWN_DIST: 20,
    // Neutral wave N has WAVE_BASE_COUNT + N * WAVE_COUNT_GROWTH creeps, each with
    // (1 + N * WAVE_HP_GROWTH) x normal HP, plus one Brute per WAVE_BRUTE_EVERY waves survived.
    WAVE_BASE_COUNT: 2,
    WAVE_COUNT_GROWTH: 0.6,
    WAVE_HP_GROWTH: 0.1,
    WAVE_BRUTE_EVERY: 4,

    MAX_CREEPS_PER_PLAYER: 60,

    // Pathfinding: entering a structure tile (core or beacon) costs (BASE + maxHp * PER_HP) extra
    // tiles of walking, so creeps go around structures unless the detour is very long.
    PATH_STRUCT_BASE: 4,
    PATH_STRUCT_PER_HP: 0.08,
    PATH_RECOMPUTE_INTERVAL: 0.25, // seconds between flow-field rebuilds for the same target

    BOT_TARGET: 6, // bots fill the server up to this many players
    BOT_UNIT_RAMP: 10, // bots add roughly one unit per this many seconds (up to their land cap)
    MAX_PLAYERS: 24,

    // Mobile defenders. Each one guards an anchor (your core or one of your beacons): it patrols
    // within the anchor's leash radius, chases enemy creeps that come near, and never leaves your land.
    UNITS: {
      guard: {
        name: 'Guard', key: '1', cost: 80, hp: 520, range: 1.2, damage: 12, rate: 1, speed: 2.2,
        melee: true, taunt: 2.5,
        color: '#a5d6a7', desc: 'Tank. Taunts nearby creeps into fighting it instead',
      },
      archer: {
        name: 'Archer', key: '2', cost: 60, hp: 110, range: 5.5, damage: 16, rate: 1.5, speed: 2.6,
        color: '#4fc3f7', desc: 'Long-range single-target shots, fragile',
      },
      frost: {
        name: 'Frost', key: '3', cost: 75, hp: 150, range: 3, damage: 6, rate: 1, speed: 2.4,
        aoe: true, slow: 0.45, slowTime: 1.5,
        color: '#b3e5fc', desc: 'Pulses damage and slows all nearby creeps',
      },
      mortar: {
        name: 'Mortar', key: '4', cost: 115, hp: 170, range: 6, minRange: 1.5, damage: 45, rate: 0.5, speed: 1.6,
        splash: 1.6,
        color: '#ff8a65', desc: 'Long-range splash, slow, cannot hit close targets',
      },
      medic: {
        name: 'Medic', key: '5', cost: 70, hp: 130, range: 3, heal: 14, rate: 1, speed: 2.6,
        color: '#f48fb1', desc: 'Heals nearby units, cannot attack',
      },
    },
    // Army size grows with your land: one unit per LAND_PER_UNIT tiles (at least MIN_UNITS).
    LAND_PER_UNIT: 25,
    MIN_UNITS: 5,
    MAX_UNITS: 24, // hard cap
    UNIT_LEASH_CORE: 4.5, // patrol radius around the core
    UNIT_LEASH_BEACON: 3.5, // patrol radius around a beacon
    UNIT_REPATH: 0.4, // seconds between re-planning a chase path

    // Fixed structures.
    TOWERS: {
      beacon: {
        name: 'Beacon', key: 'B', cost: 90, hp: 400, claim: 5,
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
        name: 'Grunt', key: 'Z', cost: 14, hp: 90, speed: 2.2, damage: 10, bounty: 4, size: 0.28,
        desc: 'Cheap and steady',
      },
      runner: {
        name: 'Runner', key: 'X', cost: 20, hp: 55, speed: 4, damage: 6, bounty: 4, size: 0.22,
        desc: 'Fast, fragile',
      },
      brute: {
        name: 'Brute', key: 'C', cost: 65, hp: 450, speed: 1.2, damage: 40, bounty: 15, size: 0.42,
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
      heal: d.heal ? d.heal * (1 + 0.6 * l) : 0,
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

  // How many units a player with this much land may field.
  CONFIG.unitCap = function (territory) {
    return Math.min(CONFIG.MAX_UNITS, Math.max(CONFIG.MIN_UNITS, Math.floor(territory / CONFIG.LAND_PER_UNIT)));
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
