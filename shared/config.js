// Shared game configuration and helpers.
// Loaded by the Node server (require) and by the browser (window.TD_CONFIG).
(function (root) {
  'use strict';

  const CONFIG = {
    TICK_RATE: 20, // simulation steps per second
    SNAPSHOT_RATE: 10, // state updates sent to players per second (clients interpolate in between)
    MAP_W: 110,
    MAP_H: 110,

    // Economy: land pays a trickle; most gold comes from fighting (troop kills, jungle camps,
    // taking towers and cores - see the *_BOUNTY settings and each monster's bounty).
    START_GOLD: 200,
    BASE_INCOME: 1.5, // gold per second
    INCOME_PER_TILE: 0.015, // extra gold per second for each owned tile

    // The core: your base. It shoots like a tower; if it falls, you're out.
    CORE_HP: 2500,
    CORE_RANGE: 5,
    CORE_DAMAGE: 60,
    CORE_RATE: 1,
    CORE_CLAIM: 6, // territory radius around a core
    CORE_KILL_BOUNTY: 250, // plus all of the victim's gold
    SPAWN_MIN_DIST: 24,
    SPAWN_SHIELD: 90, // seconds after spawning during which your core and towers can't be damaged

    MAX_LEVEL: 5, // troops and towers
    // Levels past this one get steeply more expensive (x LATE_LEVEL_PRICE per extra level) - a late-game gold sink.
    CHEAP_LEVELS: 2,
    LATE_LEVEL_PRICE: 2.5,
    SELL_REFUND: 0.6,
    RUIN_CAPTURE_COST: 25,
    RUIN_LIFETIME: 120, // seconds before an unclaimed ruin crumbles

    // ---- Troop waves (like League minions)
    // Every WAVE_INTERVAL seconds your core sends out a free wave built from your army plan.
    WAVE_INTERVAL: 20,
    FIRST_WAVE_DELAY: 6,
    // Wave size: BASE_WAVE troops from the core, plus BARRACKS_TROOPS from each barracks you own.
    // The army panel only sets the mix; slots left unassigned are filled with guards and archers.
    BASE_WAVE: 5,
    BARRACKS_TROOPS: 5,
    MAX_BARRACKS: 5,
    BARRACKS_COST_STEP: 150, // each extra barracks costs this much more than the last
    START_ARMY: {}, // wave slots assigned at the start (the rest are guards/archers)
    // How many troops can be alive at once grows with land: one per LAND_PER_UNIT tiles.
    LAND_PER_UNIT: 10,
    MIN_UNITS: 10,
    MAX_UNITS: 45,
    HUNT_ROLL_RANGE: 6, // when a hunted troop dies, hunters go after its squadmates within this range
    TROOP_AGGRO: 2, // troops on the march engage enemies within (attack range + this)
    TROOP_BOUNTY: 14, // gold for killing an enemy troop
    TROOP_BOUNTY_PER_LEVEL: 6, // extra gold per level of the troop killed
    TOWER_BOUNTY: 250, // gold for destroying an enemy tower
    TOWER_CLAIM_HP: 0.7, // a destroyed tower becomes the destroyer's, at this fraction of max HP
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

    // ---- Rounds: last core standing wins, then a scoreboard and a fresh map.
    ROUND_JOIN_WINDOW: 60, // seconds after a round starts during which players (and bots) can join
    // Sudden death after this many seconds: no home-turf bonuses, troops hit structures harder,
    // and cores slowly crumble - so every round ends.
    ROUND_SUDDEN_DEATH: 600,
    SUDDEN_DEATH_SIEGE: 2, // troop damage multiplier against towers and cores
    SUDDEN_DEATH_DECAY: 0.002, // fraction of core max HP lost per second in sudden death (never below 1 HP)
    ROUND_RESET_DELAY: 15, // seconds the scoreboard shows before the next round starts

    BOT_TARGET: 6, // bots fill the server up to this many players
    BOT_STRIKE_SHARE: 0.6, // share of its home troops a bot sends on each attack
    BOT_JUNGLE_SHARE: 0.35, // share of its home troops a bot sends to farm jungle camps
    MAX_PLAYERS: 24,

    // Troop types. `cost` sets the price of levelling the type up (see armyLevelCost).
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
        name: 'Frost', key: '3', cost: 90, hp: 220, range: 3.5, damage: 12, rate: 1, speed: 2.2,
        aoe: true, slow: 0.5, slowTime: 1.5,
        color: '#b3e5fc', desc: 'Pulses damage and slows every enemy nearby',
      },
      mortar: {
        name: 'Mortar', key: '4', cost: 130, hp: 140, range: 6, minRange: 1.5, damage: 24, rate: 0.5, speed: 1.8,
        splash: 1.2, siege: 2,
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
      barracks: {
        name: 'Barracks', key: 'R', cost: 250, hp: 1600, claim: 2, maxLevel: 1, ownLandOnly: true,
        color: '#d7a86e', desc: `+5 troops in every wave, spawning here. Build on your own land`,
      },
    },

    // Leapfrogging: towers may be placed on unclaimed land up to this many tiles outside your border.
    TOWER_LEAP: 3,
    // Capture by occupation: your troops within CAPTURE_RANGE of an enemy tower take it over after
    // CAPTURE_TIME seconds (faster with more troops) - unless any of the owner's troops are there too.
    CAPTURE_RANGE: 4.5,
    CAPTURE_TIME: 10,
    CAPTURE_EXTRA_UNIT_SPEED: 0.5, // each extra troop adds 50% capture speed...
    CAPTURE_MAX_SPEED: 3, // ...up to 3x
    CAPTURE_TIME_PER_LEVEL: 0.5, // each tower level above 1 adds 50% to the capture time

    // ---- Jungle: neutral camps that sit still, fight back when attacked, and pay out when cleared.
    CAMP_COUNT: 12,
    CAMP_RESPAWN: 45,
    BUFF_CAMP_RESPAWN: 90, // golem camps (which give the jungle buff) take longer to come back
    // Camps wander: a cleared camp comes back somewhere new, and a camp nobody has touched for
    // CAMP_RELOCATE seconds packs up and moves. New spots prefer unclaimed land.
    CAMP_RELOCATE: 150,
    CAMP_SPACING: 12, // minimum distance between camps
    CAMP_CORE_DIST: 9, // minimum distance from any core
    CAMP_MOVE_MIN: 15, // a camp moves at least this far when it can
    CAMP_LEASH: 4.5, // monsters chase attackers this far from their camp, then reset
    CAMP_TYPES: {
      small: { raptor: 3 },
      big: { golem: 1, raptor: 2 },
    },
    CREEPS: {
      raptor: { name: 'Raptor', hp: 170, speed: 2.6, damage: 10, bounty: 55, size: 0.3 },
      golem: { name: 'Golem', hp: 900, speed: 1.6, damage: 30, bounty: 250, size: 0.5 },
    },
    CREEP_REACH: 0.9,
    // Jungle buff: whoever clears one of these camp types empowers all their troops for a while.
    BUFF_CAMPS: ['big'],
    JUNGLE_BUFF_TIME: 60,
    JUNGLE_BUFF_DAMAGE: 0.3, // +30% damage
    JUNGLE_BUFF_ARMOR: 0.25, // -25% damage taken
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
      claim: d.claim ? d.claim + Math.min(l, 2) : 0, // land reach stops growing after level 3
      rate: d.rate || 0,
    };
  };

  // Price multiplier for going from `level` to `level + 1`: steep past CHEAP_LEVELS.
  CONFIG.latePrice = function (level) {
    return level > CONFIG.CHEAP_LEVELS ? Math.pow(CONFIG.LATE_LEVEL_PRICE, level - CONFIG.CHEAP_LEVELS) : 1;
  };

  // Highest level a structure kind can reach.
  CONFIG.maxLevel = function (kind) {
    return CONFIG.defOf(kind).maxLevel || CONFIG.MAX_LEVEL;
  };

  // Price of building a structure when you already own `owned` of that kind (barracks get pricier).
  CONFIG.buildCost = function (kind, owned) {
    const d = CONFIG.TOWERS[kind];
    return kind === 'barracks' ? d.cost + CONFIG.BARRACKS_COST_STEP * owned : d.cost;
  };

  // Troops per wave for a player owning this many barracks.
  CONFIG.waveSize = function (barracks) {
    return CONFIG.BASE_WAVE + CONFIG.BARRACKS_TROOPS * Math.min(barracks, CONFIG.MAX_BARRACKS);
  };

  // Tower upgrades: cost to go from `level` to `level + 1`.
  CONFIG.upgradeCost = function (kind, level) {
    return Math.round(CONFIG.defOf(kind).cost * level * CONFIG.latePrice(level));
  };

  // Total gold invested in a tower of this level.
  CONFIG.totalSpent = function (kind, level) {
    let total = CONFIG.defOf(kind).cost;
    for (let l = 1; l < level; l++) total += CONFIG.upgradeCost(kind, l);
    return total;
  };

  CONFIG.sellValue = function (kind, level) {
    return Math.floor(CONFIG.totalSpent(kind, level) * CONFIG.SELL_REFUND);
  };

  // Price of raising a troop type from `level` to `level + 1` (applies to troops spawned after).
  CONFIG.armyLevelCost = function (kind, level) {
    return Math.round(CONFIG.UNITS[kind].cost * 2 * level * CONFIG.latePrice(level));
  };

  // How many troops a player with this much land may have alive at once.
  // (always enough for one full wave, so barracks are never wasted).
  CONFIG.unitCap = function (territory, waveSize = 0) {
    return Math.min(CONFIG.MAX_UNITS, Math.max(CONFIG.MIN_UNITS, waveSize, Math.floor(territory / CONFIG.LAND_PER_UNIT)));
  };

  // Capture speed multiplier for `n` capturing troops, and the base capture time of a tower level.
  CONFIG.captureSpeed = function (n) {
    return Math.min(CONFIG.CAPTURE_MAX_SPEED, 1 + CONFIG.CAPTURE_EXTRA_UNIT_SPEED * (n - 1));
  };
  CONFIG.captureTime = function (level) {
    return CONFIG.CAPTURE_TIME * (1 + CONFIG.CAPTURE_TIME_PER_LEVEL * (level - 1));
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
