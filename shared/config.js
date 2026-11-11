// Shared game configuration and helpers.
// Loaded by the Node server (require) and by the browser (window.TD_CONFIG).
(function (root) {
  'use strict';

  const CONFIG = {
    TICK_RATE: 20,
    MAP_W: 110,
    MAP_H: 110,

    START_GOLD: 200,
    BASE_INCOME: 3, // gold per second
    INCOME_PER_TILE: 0.03, // extra gold per second for each owned tile

    // The core: your base. It shoots like a tower; if it falls, you're out.
    CORE_HP: 2500,
    CORE_RANGE: 5,
    CORE_DAMAGE: 60,
    CORE_RATE: 1,
    CORE_CLAIM: 6, // territory radius around a core
    CORE_KILL_BOUNTY: 250, // plus half the victim's gold
    SPAWN_MIN_DIST: 24,
    SPAWN_SHIELD: 90, // seconds after spawning during which your core and towers can't be damaged

    MAX_LEVEL: 3,
    SELL_REFUND: 0.6,
    RUIN_CAPTURE_COST: 25,
    RUIN_LIFETIME: 120, // seconds before an unclaimed ruin crumbles

    // ---- Troop waves (like League minions)
    // Every WAVE_INTERVAL seconds your core sends out a free wave built from your army plan.
    WAVE_INTERVAL: 20,
    FIRST_WAVE_DELAY: 6,
    START_ARMY: { guard: 2, archer: 2 }, // troops per wave at the start
    ARMY_MAX_PER_WAVE: 12,
    // How many troops can be alive at once grows with land: one per LAND_PER_UNIT tiles.
    LAND_PER_UNIT: 10,
    MIN_UNITS: 10,
    MAX_UNITS: 30,
    TROOP_AGGRO: 2, // troops on the march engage enemies within (attack range + this)
    TROOP_BOUNTY: 6, // gold for killing an enemy troop, +3 per troop level
    TOWER_BOUNTY: 120, // gold for destroying an enemy tower
    // Home turf: troops standing on their own land heal and hit harder, so defending is cheaper
    // than attacking and a big army can't simply steamroll a smaller one at its door.
    HOME_REGEN: 0.02, // fraction of max HP healed per second
    HOME_DAMAGE_BONUS: 0.3,

    // Troops defending a structure patrol within this radius of it.
    UNIT_LEASH_CORE: 4.5,
    UNIT_LEASH_TOWER: 3.5,
    UNIT_REPATH: 0.4, // seconds between re-planning a chase path

    // Pathfinding: entering a structure tile (core or tower) costs (BASE + maxHp * PER_HP) extra
    // tiles of walking, so troops go around structures unless the detour is very long.
    PATH_STRUCT_BASE: 4,
    PATH_STRUCT_PER_HP: 0.02,
    PATH_RECOMPUTE_INTERVAL: 0.5, // seconds between flow-field rebuilds for the same goal

    BOT_TARGET: 6, // bots fill the server up to this many players
    BOT_STRIKE_SHARE: 0.6, // share of its home troops a bot sends on each attack
    MAX_PLAYERS: 24,

    // Troop types. `cost` is the base price of adding one to every wave (see armyAddCost).
    UNITS: {
      guard: {
        name: 'Guard', key: '1', cost: 70, hp: 420, range: 1.5, damage: 14, rate: 1, speed: 2.2,
        melee: true, taunt: 2.5,
        color: '#a5d6a7', desc: 'Melee tank. Enemy troops nearby are taunted into fighting it',
      },
      archer: {
        name: 'Archer', key: '2', cost: 60, hp: 120, range: 4.5, damage: 13, rate: 1.4, speed: 2.4,
        color: '#4fc3f7', desc: 'Ranged damage, fragile',
      },
      frost: {
        name: 'Frost', key: '3', cost: 90, hp: 160, range: 3, damage: 7, rate: 1, speed: 2.2,
        aoe: true, slow: 0.5, slowTime: 1.5,
        color: '#b3e5fc', desc: 'Pulses damage and slows every enemy nearby',
      },
      mortar: {
        name: 'Mortar', key: '4', cost: 130, hp: 170, range: 6, minRange: 1.5, damage: 40, rate: 0.5, speed: 1.8,
        splash: 1.6, siege: 2,
        color: '#ff8a65', desc: 'Long-range splash. Double damage to towers and cores',
      },
      medic: {
        name: 'Medic', key: '5', cost: 90, hp: 130, range: 3, heal: 12, rate: 1, speed: 2.4,
        color: '#f48fb1', desc: 'Heals nearby troops, cannot attack',
      },
    },

    // Fixed structures.
    TOWERS: {
      tower: {
        name: 'Tower', key: 'B', cost: 120, hp: 1400, claim: 5, range: 5, damage: 32, rate: 1,
        color: '#ffd54f', desc: 'Claims land and shoots enemy troops',
      },
    },

    // Leapfrogging: towers may be placed on unclaimed land up to this many tiles outside your border.
    TOWER_LEAP: 3,
    // Capture by occupation: your troops within CAPTURE_RANGE of an enemy tower take it over after
    // CAPTURE_TIME seconds (faster with more troops) - unless any of the owner's troops are there too.
    CAPTURE_RANGE: 4.5,
    CAPTURE_TIME: 10,
    CAPTURE_EXTRA_UNIT_SPEED: 0.5, // each extra troop adds 50% capture speed

    // ---- Jungle: neutral camps that sit still, fight back when attacked, and pay out when cleared.
    CAMP_COUNT: 12,
    CAMP_RESPAWN: 60,
    CAMP_LEASH: 4.5, // monsters chase attackers this far from their camp, then reset
    CAMP_TYPES: {
      small: { raptor: 3 },
      big: { golem: 1, raptor: 2 },
    },
    CREEPS: {
      raptor: { name: 'Raptor', hp: 170, speed: 2.6, damage: 10, bounty: 15, size: 0.3 },
      golem: { name: 'Golem', hp: 900, speed: 1.6, damage: 30, bounty: 80, size: 0.5 },
    },
    CREEP_REACH: 0.9,
  };

  // Definition of a troop or structure kind.
  CONFIG.defOf = function (kind) {
    return CONFIG.UNITS[kind] || CONFIG.TOWERS[kind];
  };

  // Stats of a troop or structure at a given level (levels scale damage, heal, range, hp, claim).
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

  // Tower upgrades: cost to go from `level` to `level + 1`.
  CONFIG.upgradeCost = function (kind, level) {
    return CONFIG.defOf(kind).cost * level;
  };

  // Total gold invested in a tower of this level.
  CONFIG.totalSpent = function (kind, level) {
    return CONFIG.defOf(kind).cost * (1 + (level * (level - 1)) / 2);
  };

  CONFIG.sellValue = function (kind, level) {
    return Math.floor(CONFIG.totalSpent(kind, level) * CONFIG.SELL_REFUND);
  };

  // Army plan: price of adding one more `kind` to every wave when you already have `count`.
  CONFIG.armyAddCost = function (kind, count) {
    return Math.round(CONFIG.UNITS[kind].cost * (0.6 + 0.4 * count));
  };

  // Price of raising a troop type from `level` to `level + 1` (applies to troops spawned after).
  CONFIG.armyLevelCost = function (kind, level) {
    return CONFIG.UNITS[kind].cost * 2 * level;
  };

  // How many troops a player with this much land may have alive at once.
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
