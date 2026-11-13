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
    SPAWN_MARGIN: 10, // cores spawn at least this far from the map edge
    SPAWN_CANDIDATES: 300, // random spots tried per spawn; the one furthest from other bases wins
    SPAWN_SHIELD: 120, // seconds after spawning during which your core and towers can't be damaged

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
    // Wave size: BASE_WAVE slots from the core, plus BARRACKS_TROOPS from each barracks you own.
    // The army panel only sets the mix (one slot per troop); unassigned slots become soldiers.
    BASE_WAVE: 5,
    BARRACKS_TROOPS: 5,
    MAX_BARRACKS: 5,
    BARRACKS_COST_STEP: 150, // each extra barracks costs this much more than the last
    START_ARMY: {}, // wave slots assigned at the start (the rest are soldiers)
    // How many troop slots can be alive at once grows with land: one per LAND_PER_UNIT tiles.
    LAND_PER_UNIT: 10,
    MIN_UNITS: 10,
    MAX_UNITS: 45,
    HOLD_LEASH: 6, // troops holding a spot fight enemies within this distance of it
    HUNT_ROLL_RANGE: 6, // when a hunted troop dies, hunters go after its squadmates within this range
    TROOP_AGGRO: 2,
    PROVOKE_TIME: 3, // troops shot by someone out of reach go after the shooter for this long...
    PROVOKE_RANGE: 7, // ...if it's within their range + this
    // Fog of war: you see your own land plus what your core, buildings and troops can see.
    CORE_SIGHT: 9,
    TOWER_SIGHT_BONUS: 2, // towers see this much past their range
    BARRACKS_SIGHT: 5,
    SCOUT_RANGE: 45, // scouts explore up to this far from their core
    SCOUT_LEG_TIME: 25, // seconds before a scout picks a new place to explore // troops on the march engage enemies within (attack range + this)
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
    PATH_FIELDS_PER_TICK: 3, // new flow fields built per tick at most (keeps ticks smooth)
    PATH_DIRECT_RANGE: 3, // troops this close to their goal walk straight there

    // ---- Rounds: last core standing wins, then a scoreboard and a fresh map.
    ROUND_JOIN_WINDOW: 60, // seconds after a round starts during which players (and bots) can join
    // Sudden death after this many seconds: no home-turf bonuses, troops hit structures harder,
    // and cores slowly crumble - so every round ends.
    ROUND_SUDDEN_DEATH: 1140, // 19 minutes: rounds run about 15-22 minutes
    SUDDEN_DEATH_SIEGE: 2, // troop damage multiplier against towers and cores
    // Pacing: cores take less damage for the first minutes, and troop damage to buildings
    // ramps up from SIEGE_RAMP_START so pushes get easier as the round goes on.
    CORE_FORTIFY: 0.7, // fraction of core damage blocked...
    CORE_FORTIFY_TIME: 420, // ...until this many seconds into the round
    SIEGE_RAMP_START: 480,
    SIEGE_RAMP_PER_MIN: 0.1, // +10% building damage per minute after that (x2 at 18 min)
    SUDDEN_DEATH_DECAY: 0.002, // fraction of core max HP lost per second in sudden death (never below 1 HP)
    ROUND_RESET_DELAY: 15, // seconds the scoreboard shows before the next round starts

    BOT_TARGET: 6, // bots fill the server up to this many players
    BOT_STRIKE_SHARE: 0.6, // share of its home troops a bot sends on each attack
    BOT_JUNGLE_SHARE: 0.35, // share of its home troops a bot sends to farm jungle camps
    MAX_PLAYERS: 24,
    MAX_ROOMS: 200, // private rooms open at once
    PRIVATE_DEFAULT_BOTS: 2, // bots in a new private room (the host can change it)
    PRIVATE_MAX_BOTS: 10,

    // Troop types. `cost` sets the price of levelling the type up (see armyLevelCost).
    UNITS: {
      soldier: {
        name: 'Soldier', key: '1', cost: 60, slots: 1, hp: 300, range: 1.3, damage: 20, rate: 1, speed: 2.3, sight: 5,
        melee: true,
        color: '#a5d6a7', desc: 'Sword and shield: the backbone of every wave. Empty wave slots are filled with soldiers',
      },
      scout: {
        name: 'Scout', key: '2', cost: 50, slots: 1, hp: 110, speed: 4.2, sight: 11, scout: true,
        color: '#fff59d', desc: 'Very fast, sees far, never fights. While your troops defend, scouts explore on their own, uncovering camps and enemy land',
      },
      medic: {
        name: 'Medic', key: '3', cost: 90, slots: 1, hp: 150, range: 3, heal: 12, rate: 1, speed: 2.4, sight: 5,
        color: '#f48fb1', desc: 'Heals nearby troops, cannot attack',
      },
      archer: {
        name: 'Archer', key: '4', cost: 80, slots: 1, hp: 170, range: 5, damage: 26, rate: 1.1, speed: 2.4, sight: 6,
        ranged: true,
        color: '#4fc3f7', desc: 'Shoots arrows from range. Fragile: keep soldiers in front of them',
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

    // ---- Jungle: neutral camps that sit still, fight back when attacked, and pay out when cleared.
    CAMP_COUNT: 12,
    CAMP_RESPAWN: 45,
    BUFF_CAMP_RESPAWN: 90, // the warlord's fort (which gives the jungle buff) takes longer to come back
    // A cleared camp comes back somewhere new (preferring unclaimed land).
    CAMP_SPACING: 18, // minimum distance between camps (they're placed as far apart as they can be)
    CAMP_CANDIDATES: 150, // random spots tried when placing a camp
    CAMP_CORE_DIST: 9, // minimum distance from any core
    CAMP_MOVE_MIN: 15, // a camp moves at least this far when it can
    CAMP_LEASH: 4.5, // monsters chase attackers this far from their camp, then reset
    CAMP_MIX: { small: 5, medium: 4, large: 3 }, // how many of each camp size
    CAMP_INFO: {
      small: { name: 'Raider Camp' },
      medium: { name: 'Barbarian Outpost' },
      large: { name: "Warlord's Fort" },
    },
    CAMP_TYPES: {
      // the first monster listed is the leader, standing in the middle
      small: { raider: 3 },
      medium: { brute: 1, raider: 2 },
      large: { warlord: 1, spearman: 2 },
    },
    CREEPS: {
      // Barbarians: neutral, passive until attacked. Each carries the weapon that tells it apart.
      raider: { name: 'Raider', hp: 150, speed: 2.9, damage: 9, bounty: 40, size: 0.32, weapon: 'axe' },
      brute: { name: 'Brute', hp: 650, speed: 2.0, damage: 22, bounty: 110, size: 0.46, weapon: 'club' },
      warlord: { name: 'Warlord', hp: 1100, speed: 1.5, damage: 32, bounty: 250, size: 0.54, weapon: 'greataxe', crown: true },
      spearman: { name: 'Spearman', hp: 240, speed: 2.3, damage: 13, bounty: 60, size: 0.32, weapon: 'spear' },
    },
    CREEP_REACH: 0.9,
    // Jungle buff: whoever clears one of these camp types empowers all their troops for a while.
    BUFF_CAMPS: ['large'],
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

  // Sight radius of a structure.
  CONFIG.structSight = function (kind, level) {
    if (kind === 'barracks') return CONFIG.BARRACKS_SIGHT;
    return CONFIG.towerStats(kind, level).range + CONFIG.TOWER_SIGHT_BONUS;
  };

  // Wave slots a troop type takes.
  CONFIG.slotsOf = function (kind) {
    return CONFIG.UNITS[kind].slots || 1;
  };

  // Total gold for clearing a camp of this type.
  CONFIG.campBounty = function (type) {
    return Object.entries(CONFIG.CAMP_TYPES[type]).reduce((n, [k, c]) => n + CONFIG.CREEPS[k].bounty * c, 0);
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

  CONFIG.income = function (territory) {
    return CONFIG.BASE_INCOME + territory * CONFIG.INCOME_PER_TILE;
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
  } else {
    root.TD_CONFIG = CONFIG;
  }
})(typeof window !== 'undefined' ? window : globalThis);
