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
    START_WOOD: 120,

    // ---- Workers: they build, repair, chop wood and farm. Separate from the army (no squad, no army
    // slots). You have BASE_WORKERS plus WORKSHOP_WORKERS per Workshop; fallen ones respawn with the
    // troops. Each job has a priority (0 off, 1 low, 2 high): workers take the highest-priority job
    // that has work, sharing out jobs of equal priority.
    BASE_WORKERS: 3,
    WORKSHOP_WORKERS: 2,
    MAX_WORKSHOPS: 3,
    WORKER_JOBS: ['build', 'repair', 'gather', 'farm', 'scout'],
    START_JOBS: { build: 2, repair: 2, gather: 2, farm: 1, scout: 1 }, // (with nothing to build, they chop wood)
    SCOUT_WORKERS: 2, // at most this many workers out scouting
    SCOUT_SPEED: 4.2, // scouting workers run fast...
    SCOUT_SIGHT: 11, // ...and see far (they never fight: they explore, staying clear of enemy guns)
    BUILD_TIME: { tower: 20, barracks: 30, trade: 25, workshop: 15 }, // worker-seconds to put one up
    WALL_BUILD_TIME: 3,
    SITE_WORKERS: 3, // at most this many workers on one building site
    SITE_START_HP: 0.1, // a site starts at this share of its HP and grows as it rises
    REPAIR_RATE: 30, // HP a second one worker repairs...
    REPAIR_GOLD_PER_HP: 0.05, // ...for this much gold per HP
    REPAIR_WORKERS: 2, // at most this many on one damaged building
    FOREST_WOOD: 200, // wood in a forest hex (it regrows slowly once chopped)
    FOREST_REGROW: 0.4, // wood a second
    CHOP_RATE: 0.8, // wood a second one worker chops...
    WORKER_CARRY: 10, // ...until it carries this much back to the core or a workshop
    TREE_WORKERS: 2, // at most this many chopping one forest hex
    FARM_GOLD: 0.3, // gold a second each farming worker earns
    WORKER_BOUNTY: 20, // gold for killing an enemy worker (plus any wood it carried)
    BASE_INCOME: 1.5, // gold per second
    INCOME_PER_TILE: 0.015, // extra gold per second for each owned tile...
    INCOME_FULL_TILES: 400, // ...for the first this many tiles; beyond that each tile pays
    INCOME_LATE_SHARE: 0.4, // this share of it (so a huge empire doesn't snowball out of reach)

    // The core: your base. It shoots like a tower; if it falls, you're out.
    CORE_HP: 5000,
    CORE_RANGE: 5,
    CORE_DAMAGE: 60,
    CORE_RATE: 1,
    CORE_CLAIM: 6, // how far apart bases must be (a new core starts with its hex and the six around it)
    HEX_R: 2.5, // hex radius in tiles: land, buildings and borders work in hexes this big (about 16 tiles each)
    // Rival buildings must keep ENEMY_BUILD_GAP tiles apart.
    ENEMY_BUILD_GAP: 4.6, // no building in a hex next to an enemy building
    CORE_KILL_BOUNTY: 250, // plus all of the victim's gold
    SPAWN_MARGIN: 10, // cores spawn at least this far from the map edge
    SPAWN_CANDIDATES: 300, // random spots tried per spawn; the one furthest from other bases wins
    SPAWN_SHIELD: 120, // seconds after spawning during which your core and towers can't be damaged

    MAX_LEVEL: 5, // troops and towers
    // Levels past this one get steeply more expensive (x LATE_LEVEL_PRICE per extra level) - a late-game gold sink.
    CHEAP_LEVELS: 2,
    LATE_LEVEL_PRICE: 2.5,
    SELL_REFUND: 0.6,
    SELL_LOCK: 5, // seconds after a building is hit before it can be sold
    RUIN_CAPTURE_COST: 25,
    RUIN_LIFETIME: 120, // seconds before an unclaimed ruin crumbles

    // ---- Squads and reinforcements
    // You have up to MAX_SQUADS lasting squads, each with its own troop mix and stance. Each squad is
    // raised by a barracks: your 1st barracks raises squad 1, the 2nd squad 2 and so on. A barracks
    // gives its squad BARRACKS_TROOPS troop slots per level (up to SQUAD_MAX_TROOPS); you start with
    // no troops at all. Every WAVE_INTERVAL seconds every fallen troop respawns (at the core and
    // barracks) and marches out to rejoin its squad.
    WAVE_INTERVAL: 20,
    FIRST_WAVE_DELAY: 6,
    MAX_SQUADS: 4,
    STANCES: ['aggressive', 'defensive', 'hold', 'pillage'], // pillage: hunt barbarian camps on its own, nearest first
    BARRACKS_TROOPS: 5, // troop slots a barracks gives its squad per level...
    SQUAD_MAX_TROOPS: 20, // ...up to this many (level 4)
    MAX_BARRACKS: 4, // one per squad
    BARRACKS_COST_STEP: 150, // each extra barracks costs this much more than the last
    BARRACKS_UPGRADE_STEP: 150, // a barracks upgrade costs this much per level it has
    // Squads stay together: on the march a squad moves at its slowest troop's pace, and troops
    // more than SQUAD_SPREAD (+ a little per troop) from the squad's centre wait for it or catch up.
    SQUAD_SPREAD: 1.4,
    SQUAD_WAIT_MAX: 5, // seconds a troop waits for a straggling squad before carrying on
    // Personal space: troops keep at least UNIT_SPACING apart (friend or foe) and stay this far from
    // the middle of buildings and barbarians, so they never sit on top of each other.
    UNIT_SPACING: 0.95, // a little more than the widest troop icon, so icons never overlap
    ENEMY_SPACING: 0.55, // troops of different sides may stand this close (front lines meet)...
    MELEE_CLOSE: 0.7, // ...and melee troops close in to this distance from the troop they're fighting
    SLOT_RING1: 1.2, // formation rings inside a hex (tiles from its centre): 6 troops...
    SLOT_RING2: 2.05, // ...and 12 more
    STRUCT_BODY: 0.6,
    CORE_BODY: 0.85,
    CREEP_BODY: 0.55,
    MAX_UNITS: 80, // (a cap on troops picked in one order)
    HOLD_LEASH: 6, // troops holding a spot fight enemies within this distance of it
    HUNT_ROLL_RANGE: 6, // when a hunted troop dies, hunters go after its squadmates within this range
    TROOP_AGGRO: 2,
    // Troops sent somewhere don't stop to fight on the way (they shoot what they pass); they fight
    // normally once within this many tiles of their target.
    MARCH_ENGAGE: 7,
    // Home defence: troops at home go after enemy troops (and angry barbarians) within HOME_ALERT tiles
    // of them that are on their land or within HOME_EDGE tiles of its border, fighting from their own
    // side of the border.
    HOME_ALERT: 16,
    HOME_EDGE: 1,
    RAID_RANGE: 6, // aggressive squads guarding home go out after enemy troops this close to their border
    // Alliances: allies don't fight and can see each other's bases. Offers run out after ALLY_OFFER_TIME seconds.
    MAX_ALLIES: 2,
    ALLY_OFFER_TIME: 30,
    BOT_OFFER_FIRST: 90, // bots start offering alliances to players after this (+ up to a minute)
    BOT_OFFER_EVERY: 120,
    PROVOKE_TIME: 3, // troops shot by someone out of reach go after the shooter for this long...
    PROVOKE_RANGE: 7, // ...if it's within their range + this
    // Fog of war: you see your own land plus what your core, buildings and troops can see.
    CORE_SIGHT: 9,
    // Chain lightning: a tower's (or core's) bolt jumps from its target to up to CHAIN_JUMPS more
    // enemies, each within CHAIN_RANGE of the last one hit, dealing CHAIN_FALLOFF of the previous hit.
    CHAIN_JUMPS: 2,
    CHAIN_RANGE: 2.5,
    CHAIN_FALLOFF: 0.75,
    TOWER_SIGHT_BONUS: 2, // towers see this much past their range
    BARRACKS_SIGHT: 5,
    SCOUT_RANGE: 45, // scouting workers explore up to this far from their core
    SCOUT_LEG_TIME: 25, // seconds before a scout picks a new place to explore // troops on the march engage enemies within (attack range + this)
    TROOP_BOUNTY: 14, // gold for killing an enemy troop
    TROOP_BOUNTY_PER_LEVEL: 6, // extra gold per level of the troop killed
    TOWER_BOUNTY: 150, // gold for destroying an enemy tower (which you then also own)
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
    CORE_FORTIFY: 0.8, // fraction of core damage blocked...
    CORE_FORTIFY_TIME: 480, // ...until this many seconds into the round
    SIEGE_RAMP_START: 480,
    SIEGE_RAMP_PER_MIN: 0.1, // +10% building damage per minute after that (x2 at 18 min)
    SUDDEN_DEATH_DECAY: 0.002, // fraction of core max HP lost per second in sudden death (never below 1 HP)
    ROUND_RESET_DELAY: 15, // seconds the scoreboard shows before the next round starts

    BOT_TARGET: 6, // bots fill the server up to this many players
    BOT_STRIKE_SHARE: 0.6, // share of its home troops a bot sends on each attack
    BOT_MAX_WALLS: 14, // bots wall at most this many segments (facing their nearest enemy)
    BOT_GATES: 2,
    BOT_JUNGLE_SHARE: 0.35, // share of its home troops a bot sends to farm jungle camps
    MAX_PLAYERS: 24,
    // Player colours: 12 well-separated hues, picked so players in a game are as far apart as
    // possible; past 12 players the hues come round again in a paler tone, then a deeper one.
    PLAYER_HUES: [0, 25, 48, 90, 130, 168, 195, 220, 255, 285, 315, 340],
    HUE_ORDER: [0, 6, 3, 9, 1, 7, 4, 10, 2, 8, 5, 11], // most spread-out first
    MAX_ROOMS: 200, // private rooms open at once
    PRIVATE_DEFAULT_BOTS: 2, // bots in a new private room (the host can change it)
    PRIVATE_MAX_BOTS: 10,

    // ---- Trade: a trade post sends a caravan to an ally's trade post every CARAVAN_EVERY seconds.
    // When it arrives both players get its cargo: CARAVAN_BASE + CARAVAN_PER_TILE for every tile
    // between the posts, +CARAVAN_LEVEL_CARGO for each post level past 1. Enemies who destroy one
    // take RAID_SHARE of its cargo. Caravans steer around hostile towers and cores.
    MAX_TRADE_POSTS: 2,
    CARAVAN_EVERY: 30,
    CARAVAN_BASE: 15,
    CARAVAN_PER_TILE: 0.3,
    CARAVAN_LEVEL_CARGO: 0.3,
    RAID_SHARE: 0.5,
    CARAVAN_STUCK: 4, // a caravan that gets no closer for this many seconds plans its road again
    CARAVAN_DANGER: 6, // extra path cost (in steps) for each tile in reach of a hostile tower or core

    // ---- Walls: built on the edges between your hexes and land that isn't yours. They block everyone's
    // troops and caravans; gates let yours and your allies' through.
    WALL_COST: 15,
    WALL_HP: 600, // every wall is the same (no upgrades)
    WALL_GATE_COST: 40,
    WALL_REFUND: 0.6, // gold back when a wall is knocked down or ends up inside your land
    WALL_SOLDIER_BONUS: 2, // soldiers hit walls this many times harder
    WALL_BUILD_MAX: 120, // segments one build message may ask for
    WALL_REBUILD_DELAY: 45, // seconds before a broken wall's edge can be walled again
    WALL_ENEMY_GAP: 3, // no building a wall with enemy troops this close to it
    DETOUR_RANGE: 18, // a troop walking straight at something behind a wall looks this far for a way round

    // Troop types. `cost` sets the price of levelling the type up (see armyLevelCost).
    UNITS: {
      soldier: {
        name: 'Soldier', key: '1', cost: 60, slots: 1, hp: 340, range: 1.3, damage: 22, rate: 1, speed: 2.3, sight: 5,
        melee: true,
        color: '#a5d6a7', desc: 'Sword and shield: the backbone of every wave. Empty wave slots are filled with soldiers',
      },
      medic: {
        name: 'Medic', key: '3', cost: 90, slots: 1, hp: 200, range: 3, heal: 15, patients: 2, rate: 1, speed: 2.4, sight: 5,
        color: '#f48fb1', desc: 'Heals the two most wounded troops near it, cannot attack',
      },
      archer: {
        name: 'Archer', key: '4', cost: 80, slots: 1, hp: 170, range: 5, damage: 26, rate: 1.1, speed: 2.4, sight: 6,
        ranged: true,
        color: '#4fc3f7', desc: 'Shoots arrows from range. Fragile: keep soldiers in front of them',
      },
      // The siege ram: slow and weak against troops, but it smashes walls (wallBreaker x their
      // damage) and buildings (siege x), and goes for them first when they're in reach.
      siege: {
        name: 'Siege Ram', key: '5', cost: 110, slots: 2, hp: 700, range: 1.4, damage: 16, rate: 0.6, speed: 1.7, sight: 4,
        melee: true, siege: 8, wallBreaker: 25, breaker: true, size: 1.2,
        color: '#c9a27a', desc: 'A heavy battering ram: weak against troops, but it smashes walls and buildings. Takes 2 army slots',
      },
      // Not a troop you pick: a trade post sends one along its trade route. Its stats grow with the
      // post's level; its two guards (drawn riding along) fight back with this damage and range.
      // Not a troop either: workers (see BASE_WORKERS). They never fight.
      worker: {
        name: 'Worker', worker: true, hp: 160, speed: 2.6, sight: 4,
        color: '#ffcc80', desc: 'Builds, repairs, chops wood, farms and scouts',
      },
      caravan: {
        name: 'Caravan', caravan: true, hp: 500, range: 2.5, damage: 14, rate: 1, speed: 1.6, sight: 4,
        color: '#d9c7a0', desc: 'An ox wagon of barrels carrying trade goods to an ally. Two guards walk with it',
      },
    },

    // Fixed structures.
    TOWERS: {
      tower: {
        name: 'Tower', key: 'B', cost: 120, wood: 40, hp: 2400, range: 5, damage: 58, dmgPerLevel: 0.2, rate: 1,
        color: '#80deea', desc: 'Zaps enemy troops that come near. Build on your own land',
      },
      barracks: {
        name: 'Barracks', key: 'R', cost: 200, wood: 80, hp: 1600, maxLevel: 4,
        color: '#9fb4c7', desc: 'Raises a squad: your 1st barracks raises squad 1, the 2nd squad 2 and so on. +5 troops for its squad per level (up to 20). Troops respawn here too',
      },
      trade: {
        name: 'Trade Post', key: 'T', cost: 220, wood: 60, hp: 900, maxLevel: 3,
        color: '#ffd54f', desc: 'Sends a caravan to an ally\'s trade post every 30s: you both get paid when it arrives',
      },
      workshop: {
        name: 'Workshop', key: 'K', cost: 150, wood: 30, hp: 1100, maxLevel: 1,
        color: '#ffb74d', desc: '+2 workers (they respawn here too), and a place to drop off wood',
      },
    },

    // ---- Land: bought hex by hex with gold. A hex must be empty and touch your land; it costs, for
    // each tile in it, LAND_BASE_COST + LAND_COST_PER_TILE for every tile you already own (bigger
    // realms pay more). Enemy land can't be bought: taking an enemy tower opens up their hexes next to
    // it (for anyone to buy), and destroying a core wins all of that player's land.
    LAND_BASE_COST: 5,
    LAND_COST_PER_TILE: 0.07,
    LAND_BUY_MAX: 120, // hexes one buy message may ask for (a drag, or a whole ring of border)

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
    CAMP_AGGRO: 1.6, // anyone's units (not caravans) this close to a barbarian wake the whole camp: it attacks them
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

  // Stats of a troop or structure at a given level (levels scale damage, heal, range and hp).
  CONFIG.towerStats = function (kind, level) {
    const d = CONFIG.defOf(kind);
    const l = level - 1;
    return {
      hp: Math.round(d.hp * (1 + 0.5 * l)),
      damage: d.damage ? d.damage * (1 + (d.dmgPerLevel ?? 0.6) * l) : 0,
      heal: d.heal ? d.heal * (1 + 0.6 * l) : 0,
      range: d.range ? d.range + 0.5 * l : 0,
      rate: d.rate || 0,
    };
  };

  // Price multiplier for going from `level` to `level + 1`: steep past CHEAP_LEVELS.
  CONFIG.latePrice = function (level) {
    return level > CONFIG.CHEAP_LEVELS ? Math.pow(CONFIG.LATE_LEVEL_PRICE, level - CONFIG.CHEAP_LEVELS) : 1;
  };

  // Sight radius of a structure.
  CONFIG.structSight = function (kind, level) {
    if (kind === 'barracks' || kind === 'trade') return CONFIG.BARRACKS_SIGHT;
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

  // Tower upgrades: cost to go from `level` to `level + 1`.
  CONFIG.upgradeCost = function (kind, level) {
    if (kind === 'barracks') return CONFIG.BARRACKS_UPGRADE_STEP * level;
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

  // Troop slots a barracks of this level gives its squad.
  CONFIG.squadCap = function (level) {
    return Math.min(CONFIG.SQUAD_MAX_TROOPS, CONFIG.BARRACKS_TROOPS * level);
  };

  // Gold for the next tile of land, for a player who owns `territory` tiles.
  CONFIG.landCost = function (territory) {
    return Math.ceil(CONFIG.LAND_BASE_COST + territory * CONFIG.LAND_COST_PER_TILE);
  };

  CONFIG.income = function (territory) {
    const full = Math.min(territory, CONFIG.INCOME_FULL_TILES);
    const late = Math.max(0, territory - CONFIG.INCOME_FULL_TILES);
    return CONFIG.BASE_INCOME + (full + late * CONFIG.INCOME_LATE_SHARE) * CONFIG.INCOME_PER_TILE;
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
  } else {
    root.TD_CONFIG = CONFIG;
  }
})(typeof window !== 'undefined' ? window : globalThis);
