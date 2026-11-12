'use strict';

// Authoritative game simulation for Territory Siege.
//
// Positions are in tiles. A structure on tile (x, y) has its centre at (x + 0.5, y + 0.5).
// - Cores and towers sit on the grid. Both claim land and shoot enemy troops.
// - Every WAVE_INTERVAL seconds each core sends out a free wave of troops built from the player's
//   army plan. Troops follow orders: attack an enemy tower/core/jungle camp (marching across the
//   map via flow fields, fighting what they meet), or defend one of their own structures
//   (patrolling around it on their own land).
// - Jungle camps are neutral monsters that sit still, fight back when attacked, and pay out.

const C = require('../shared/config');
const Vision = require('../shared/vision');
const Path = require('../shared/pathfinding');

const BOT_NAMES = [
  'Ironclad', 'Warden', 'Bulwark', 'Rampart', 'Sentinel', 'Citadel', 'Palisade', 'Keepr',
  'Moatzilla', 'TurretTom', 'Bastille', 'Gatekeep', 'Stonewall', 'Outpost', 'Redoubt', 'Barbican',
];

const KIND_KEYS = Object.keys(C.TOWERS);
const UNIT_KEYS = Object.keys(C.UNITS);
const CREEP_KEYS = Object.keys(C.CREEPS);
const CAMP_KEYS = Object.keys(C.CAMP_TYPES);

// 8-way neighbour offsets for unit path planning.
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const BOT_JUNGLE_RANGE = 34; // how far from their core bots go to farm camps
const UGRID = 4; // spatial grid cell size (tiles)
const UGRID_SLACK = 1; // how far a troop can have moved since the grid was built

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function sanitizeName(name) {
  const clean = String(name || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16);
  return clean || 'Player';
}

// World position of anything that can be fought: troop, monster, tower, or player (= their core).
function posOf(o) {
  if (o.isTower) return [o.x + 0.5, o.y + 0.5];
  if (o.isPlayer) return [o.core.x + 0.5, o.core.y + 0.5];
  return [o.x, o.y];
}

class Game {
  constructor(opts = {}) {
    this.w = C.MAP_W;
    this.h = C.MAP_H;
    this.rand = opts.rand || Math.random;
    this.botTarget = opts.botTarget ?? C.BOT_TARGET;
    // Rounds (used by the server): joining closes after ROUND_JOIN_WINDOW, the last core standing
    // wins and the game freezes with phase 'over'. Without rounds, players come and go freely.
    this.rounds = !!opts.rounds;
    this.round = opts.round || 1;
    this.phase = 'playing';
    this.winner = null;
    this.roster = new Map(); // everyone who played this round: id -> standings entry

    this.players = new Map();
    this.towers = new Map();
    this.units = new Map(); // troops
    this.creeps = new Map(); // jungle monsters
    this.camps = [];

    // grid: 0 = empty, >0 = tower id, <0 = core of player -id
    this.grid = new Int32Array(this.w * this.h);
    // terr: owner player id per tile, 0 = unclaimed
    this.terr = new Int32Array(this.w * this.h);
    this.terrDist = new Float32Array(this.w * this.h);
    this.terrDirty = true;
    this.terrVersion = 0;

    // Pathfinding: structVersion bumps whenever a structure appears, disappears or changes max HP.
    this.structVersion = 0;
    this.extra = new Int32Array(this.w * this.h); // per-tile path entry cost
    this.extraVersion = -1;
    this.fields = new Map(); // goal tile -> { dist, version, at, used }

    // Scratch buffers for unit BFS (stamp-based so they never need clearing).
    this.bfsStamp = new Int32Array(this.w * this.h);
    this.bfsParent = new Int32Array(this.w * this.h);
    this.bfsQueue = new Int32Array(this.w * this.h);
    this.bfsGen = 0;

    this.nextId = 1;
    this.time = 0;
    this.botSpawnAt = 1;
    this.pruneAt = 5;

    this.fx = []; // visual effects produced this tick
    this.feed = []; // kill-feed messages produced this tick

    // Hook: called as onDeath(player, info) when a player's core is destroyed.
    this.onDeath = null;

    this.setupCamps();
    this.recomputeTerritory();
  }

  idx(x, y) {
    return y * this.w + x;
  }

  // ---- spatial grid for troops: rebuilt once per tick so "who is near here?" checks only look at
  // nearby cells instead of every troop on the map. Troops move < UGRID_SLACK tiles per tick, and
  // every candidate is still distance-checked exactly, so lookups pad the radius by that much.
  buildUnitGrid() {
    const gw = Math.ceil(this.w / UGRID);
    const gh = Math.ceil(this.h / UGRID);
    if (!this.ucells) this.ucells = Array.from({ length: gw * gh }, () => []);
    for (const c of this.ucells) c.length = 0;
    for (const u of this.units.values()) this.ucells[this.ucellOf(u.x, u.y)].push(u);
  }

  ucellOf(x, y) {
    const gw = Math.ceil(this.w / UGRID);
    const cx = Math.min(gw - 1, Math.max(0, Math.floor(x / UGRID)));
    const cy = Math.min(Math.ceil(this.h / UGRID) - 1, Math.max(0, Math.floor(y / UGRID)));
    return cy * gw + cx;
  }

  // Living troops that may be within r of (x, y) (callers check the exact distance).
  nearUnits(x, y, r) {
    if (!this.ucells) this.buildUnitGrid();
    const gw = Math.ceil(this.w / UGRID);
    const gh = Math.ceil(this.h / UGRID);
    const pad = r + UGRID_SLACK;
    const x0 = Math.max(0, Math.floor((x - pad) / UGRID));
    const x1 = Math.min(gw - 1, Math.floor((x + pad) / UGRID));
    const y0 = Math.max(0, Math.floor((y - pad) / UGRID));
    const y1 = Math.min(gh - 1, Math.floor((y + pad) / UGRID));
    const out = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (const u of this.ucells[cy * gw + cx]) if (this.units.has(u.id)) out.push(u);
      }
    }
    return out;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  // ---------------------------------------------------------------- players

  addPlayer(name, isBot = false) {
    if (this.players.size >= C.MAX_PLAYERS) return null;
    const pos = this.findSpawn();
    if (!pos) return null;
    const id = this.nextId++;
    const army = {};
    const levels = {};
    for (const k of UNIT_KEYS) {
      army[k] = C.START_ARMY[k] || 0;
      levels[k] = 1;
    }
    const p = {
      isPlayer: true,
      id,
      name: sanitizeName(name),
      isBot,
      alive: true,
      hue: Math.round((id * 137.508) % 360),
      gold: C.START_GOLD,
      core: { x: pos.x, y: pos.y, hp: C.CORE_HP, maxHp: C.CORE_HP, cd: 0 },
      territory: 0,
      peakTerritory: 0,
      kills: 0,
      coresDestroyed: 0,
      towersDestroyed: 0,
      earned: { income: 0, troops: 0, camps: 0, towers: 0, cores: 0 }, // gold by source
      spawnTime: this.time,
      buffUntil: 0, // jungle buff active until this time
      vis: new Uint8Array(this.w * this.h), // fog of war: what this player sees now
      explored: new Uint8Array(this.w * this.h), // ...and everywhere they have seen
      army,
      levels,
      order: { type: 'defend', anchor: 0 },
      nextWaveAt: this.time + C.FIRST_WAVE_DELAY,
      bot: isBot ? { next: this.time + 1, nextOrder: this.time + 10 } : null,
    };
    this.players.set(id, p);
    this.roster.set(id, { id, name: p.name, hue: p.hue, isBot, place: 0, left: false, survived: 0, peakTerritory: 0,
      kills: 0, towersDestroyed: 0, coresDestroyed: 0, gold: 0 });
    this.grid[this.idx(pos.x, pos.y)] = -id;
    this.terrDirty = true;
    this.structVersion++;
    this.pushFeed(`${p.name} joined the siege`);
    return p;
  }

  findSpawn() {
    const margin = 8;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 400; i++) {
      const x = margin + Math.floor(this.rand() * (this.w - margin * 2));
      const y = margin + Math.floor(this.rand() * (this.h - margin * 2));
      const k = this.idx(x, y);
      if (this.grid[k] !== 0 || this.terr[k] !== 0) continue;
      if (this.camps.some((c) => dist(x, y, c.x, c.y) < 7)) continue;
      let minD = Infinity;
      for (const p of this.players.values()) {
        if (p.alive) minD = Math.min(minD, dist(x, y, p.core.x, p.core.y));
      }
      if (minD >= C.SPAWN_MIN_DIST) return { x, y };
      if (minD > bestScore) {
        bestScore = minD;
        best = { x, y };
      }
    }
    return bestScore >= C.CORE_CLAIM * 2 ? best : null;
  }

  // Whether new players may join right now.
  canJoin() {
    return !this.rounds || (this.phase === 'playing' && this.time < C.ROUND_JOIN_WINDOW);
  }

  humansAlive() {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot && p.alive) n++;
    return n;
  }

  suddenDeath() {
    return this.rounds && this.time >= C.ROUND_SUDDEN_DEATH;
  }

  buffed(pid) {
    const p = this.players.get(pid);
    return !!p && p.buffUntil > this.time;
  }

  // Copy a player's numbers into the round standings.
  recordStanding(p, place, left = false) {
    const r = this.roster.get(p.id);
    if (!r) return;
    Object.assign(r, {
      place, left, survived: Math.round(this.time - p.spawnTime), peakTerritory: p.peakTerritory, kills: p.kills,
      towersDestroyed: p.towersDestroyed, coresDestroyed: p.coresDestroyed,
      gold: Math.round(Object.values(p.earned).reduce((a, b) => a + b, 0)),
    });
  }

  // Final standings: winner first, then by how long each player lasted; players who left go last.
  standings() {
    return [...this.roster.values()].sort((a, b) => (a.left - b.left) || ((a.place || 99) - (b.place || 99)));
  }

  // Last core standing: once joining has closed and at most one core is left, the round is over.
  checkRoundOver() {
    if (!this.rounds || this.phase !== 'playing' || this.time < C.ROUND_JOIN_WINDOW) return;
    const alive = [...this.players.values()].filter((p) => p.alive);
    if (alive.length > 1) return;
    this.phase = 'over';
    const w = alive[0];
    if (w) {
      this.recordStanding(w, 1);
      this.winner = { id: w.id, name: w.name, hue: w.hue };
      this.pushFeed(`${w.name} is the last core standing and wins round ${this.round}!`);
    }
  }

  // Removes a player (disconnect) - their base turns into ruins like a death.
  removePlayer(id) {
    const p = this.players.get(id);
    if (p) this.killPlayer(p, null, true);
  }

  // Newly spawned players' cores and towers can't be damaged for SPAWN_SHIELD seconds.
  isShielded(p) {
    return !!p && this.time - p.spawnTime < C.SPAWN_SHIELD;
  }

  // A core has fallen (or its player left). The player is out of the game. If another player
  // destroyed it, they take the spoils: all the victim's gold (plus a bounty), every troop the
  // victim still had standing, and a new tower where the core stood, garrisoned by those troops.
  // The victim's other towers become ruins.
  killPlayer(p, killerId, leftGame = false) {
    if (!p.alive) return;
    this.recordStanding(p, this.players.size, leftGame);
    p.alive = false;
    const coreIdx = this.idx(p.core.x, p.core.y);
    this.grid[coreIdx] = 0;
    this.fx.push({ k: 'coreDown', x: p.core.x + 0.5, y: p.core.y + 0.5 });

    const killer = killerId ? this.players.get(killerId) : null;
    const conquered = !!(killer && killer.alive && killer.id !== p.id);

    for (const t of this.towers.values()) {
      if (t.owner === p.id) this.ruinTower(t, p.name);
    }

    // The core site becomes a tower for the conqueror.
    let site = null;
    if (conquered) {
      const id = this.nextId++;
      const stats = C.towerStats('tower', 1);
      site = {
        isTower: true, id, kind: 'tower', x: p.core.x, y: p.core.y, owner: killer.id, level: 1,
        hp: stats.hp, maxHp: stats.hp, cd: 0, ruin: false, cap: 0, capBy: 0,
      };
      this.towers.set(id, site);
      this.grid[coreIdx] = id;
      this.fx.push({ k: 'capture', x: p.core.x + 0.5, y: p.core.y + 0.5, o: killer.id });
    }

    // Surviving troops defect to the conqueror and garrison the new tower; otherwise they vanish.
    let troopsTaken = 0;
    for (const u of this.units.values()) {
      if (u.owner !== p.id) continue;
      if (!conquered) {
        this.units.delete(u.id);
        continue;
      }
      u.owner = killer.id;
      u.attack = null;
      u.anchor = site.id;
      u.path = [];
      u.dest = null;
      u.repathAt = 0;
      u.idleUntil = 0;
      troopsTaken++;
    }
    for (const c of this.creeps.values()) {
      if (c.angry === p.id) c.angry = 0;
    }

    let goldTaken = 0;
    if (conquered) {
      goldTaken = Math.floor(p.gold);
      const bounty = C.CORE_KILL_BOUNTY + goldTaken;
      this.award(killer, bounty, 'cores', p.core.x + 0.5, p.core.y + 0.5);
      killer.coresDestroyed++;
      p.gold = 0;
      // Waves that were pushing on this player head home instead of wandering off.
      if (killer.order.type === 'attack' && !this.orderValid(killer.id, killer.order)) killer.order = { type: 'defend', anchor: 0 };
      this.pushFeed(`${killer.name} destroyed ${p.name}'s core: +${bounty}g, ${troopsTaken} troop${troopsTaken === 1 ? '' : 's'} and a new tower`);
    } else if (leftGame) {
      this.pushFeed(`${p.name} left - their base lies in ruins`);
    } else {
      this.pushFeed(`${p.name}'s core fell`);
    }

    this.players.delete(p.id);
    this.terrDirty = true;
    this.structVersion++;

    if (this.onDeath && !leftGame) {
      this.onDeath(p, {
        killer: conquered ? killer.name : null,
        killerId: conquered ? killer.id : 0,
        troopsTaken,
        goldTaken,
        survived: Math.round(this.time - p.spawnTime),
        peakTerritory: p.peakTerritory,
        kills: p.kills,
        coresDestroyed: p.coresDestroyed,
        towersDestroyed: p.towersDestroyed,
        earned: Object.fromEntries(Object.entries(p.earned).map(([k, v]) => [k, Math.round(v)])),
      });
    }
  }

  // Give a player gold, remembering where it came from. Kill rewards pop up where they were earned.
  award(p, amount, source, x, y) {
    p.gold += amount;
    p.earned[source] += amount;
    if (x !== undefined) this.fx.push({ k: 'gold', x: round2(x), y: round2(y), n: Math.round(amount), o: p.id });
  }

  pushFeed(text) {
    this.feed.push(text);
  }

  // ---------------------------------------------------------------- territory

  recomputeTerritory() {
    this.terr.fill(0);
    this.terrDist.fill(Infinity);
    const sources = [];
    for (const p of this.players.values()) {
      if (p.alive) sources.push({ x: p.core.x, y: p.core.y, r: C.CORE_CLAIM, owner: p.id, weight: 0.5 });
    }
    for (const t of this.towers.values()) {
      if (t.owner) sources.push({ x: t.x, y: t.y, r: C.towerStats(t.kind, t.level).claim, owner: t.owner, weight: 1 });
    }
    for (const s of sources) {
      const r = Math.ceil(s.r);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = s.x + dx;
          const y = s.y + dy;
          if (!this.inBounds(x, y)) continue;
          const d = Math.hypot(dx, dy);
          // +0.25 rounds the claim off (no lone one-tile spikes at the four compass points).
          if (d > s.r + 0.25) continue;
          // Cores hold their nearby land more strongly than towers.
          const eff = d * s.weight;
          const k = this.idx(x, y);
          if (eff < this.terrDist[k]) {
            this.terrDist[k] = eff;
            this.terr[k] = s.owner;
          }
        }
      }
    }
    const counts = new Map();
    for (let i = 0; i < this.terr.length; i++) {
      const o = this.terr[i];
      if (o) counts.set(o, (counts.get(o) || 0) + 1);
    }
    for (const p of this.players.values()) {
      p.territory = counts.get(p.id) || 0;
      p.peakTerritory = Math.max(p.peakTerritory, p.territory);
    }
    this.terrDirty = false;
    this.terrVersion++;
  }

  // Run-length encoded territory: [owner, count, owner, count, ...]
  encodeTerritory() {
    const out = [];
    let cur = this.terr[0];
    let n = 0;
    for (let i = 0; i < this.terr.length; i++) {
      if (this.terr[i] === cur) {
        n++;
      } else {
        out.push(cur, n);
        cur = this.terr[i];
        n = 1;
      }
    }
    out.push(cur, n);
    return out;
  }

  // ---------------------------------------------------------------- structure actions

  // Place a tower on your land, or leapfrog it onto unclaimed land just past your border.
  build(pid, x, y, kind) {
    const p = this.players.get(pid);
    const def = C.TOWERS[kind];
    if (!p || !p.alive || !def) return 'Invalid build';
    if (!Number.isInteger(x) || !Number.isInteger(y) || !this.inBounds(x, y)) return 'Out of bounds';
    const k = this.idx(x, y);
    if (this.terr[k] !== pid) {
      if (def.ownLandOnly) return `${def.name} must be built on your own land`;
      if (this.terr[k] !== 0) return 'You cannot build on enemy land';
      if (!this.withinLeap(pid, x, y)) return `Towers can leap at most ${C.TOWER_LEAP} tiles beyond your border`;
    }
    if (this.grid[k] !== 0) return 'Tile is occupied';
    const owned = this.countOwned(pid, kind);
    if (kind === 'barracks' && owned >= C.MAX_BARRACKS) return `You can have at most ${C.MAX_BARRACKS} barracks`;
    const cost = C.buildCost(kind, owned);
    if (p.gold < cost) return 'Not enough gold';
    p.gold -= cost;
    const id = this.nextId++;
    const stats = C.towerStats(kind, 1);
    this.towers.set(id, {
      isTower: true, id, kind, x, y, owner: pid, level: 1, hp: stats.hp, maxHp: stats.hp, cd: 0, ruin: false, cap: 0, capBy: 0,
    });
    this.grid[k] = id;
    this.structVersion++;
    this.terrDirty = true;
    return null;
  }

  // Is unclaimed tile (x, y) within TOWER_LEAP tiles of pid's land?
  countOwned(pid, kind) {
    let n = 0;
    for (const t of this.towers.values()) if (t.owner === pid && t.kind === kind) n++;
    return n;
  }

  withinLeap(pid, x, y) {
    const r = C.TOWER_LEAP;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.hypot(dx, dy) > r + 0.01 || !this.inBounds(x + dx, y + dy)) continue;
        if (this.terr[this.idx(x + dx, y + dy)] === pid) return true;
      }
    }
    return false;
  }

  upgrade(pid, id) {
    const p = this.players.get(pid);
    const t = this.towers.get(id);
    if (!p || !p.alive || !t || t.owner !== pid) return 'Invalid upgrade';
    if (t.level >= C.maxLevel(t.kind)) return t.kind === 'tower' ? 'Already max level' : `A ${C.TOWERS[t.kind].name} can't be upgraded`;
    const cost = C.upgradeCost(t.kind, t.level);
    if (p.gold < cost) return 'Not enough gold';
    p.gold -= cost;
    t.level++;
    const stats = C.towerStats(t.kind, t.level);
    t.hp += stats.hp - t.maxHp;
    t.maxHp = stats.hp;
    this.structVersion++;
    this.terrDirty = true;
    return null;
  }

  sell(pid, id) {
    const p = this.players.get(pid);
    const t = this.towers.get(id);
    if (!p || !p.alive || !t || t.owner !== pid) return 'Invalid sell';
    p.gold += C.sellValue(t.kind, t.level);
    this.removeTower(t);
    return null;
  }

  // Buy back a ruined tower that sits inside your land.
  capture(pid, towerId) {
    const p = this.players.get(pid);
    const t = this.towers.get(towerId);
    if (!p || !p.alive || !t || !t.ruin) return 'Nothing to capture';
    if (this.terr[this.idx(t.x, t.y)] !== pid) return 'Ruin must be inside your land';
    if (p.gold < C.RUIN_CAPTURE_COST) return 'Not enough gold';
    p.gold -= C.RUIN_CAPTURE_COST;
    t.owner = pid;
    t.ruin = false;
    t.hp = t.maxHp;
    delete t.ruinOf;
    delete t.ruinTime;
    this.structVersion++;
    this.terrDirty = true;
    return null;
  }

  // ---------------------------------------------------------------- army plan

  // Wave slots: BASE_WAVE from the core plus BARRACKS_TROOPS per barracks.
  waveSize(p) {
    return C.waveSize(this.countOwned(p.id, 'barracks'));
  }

  // The troops of the next wave, in order: assigned slots first (a giant takes 3), the rest soldiers.
  waveList(p) {
    const size = this.waveSize(p);
    const list = [];
    let used = 0;
    for (const kind of UNIT_KEYS) {
      for (let i = 0; i < p.army[kind] && used + C.slotsOf(kind) <= size; i++) {
        list.push(kind);
        used += C.slotsOf(kind);
      }
    }
    for (; used < size; used++) list.push('soldier');
    return list;
  }

  slotsUsed(p) {
    return UNIT_KEYS.reduce((n, k) => n + p.army[k] * C.slotsOf(k), 0);
  }

  // Assigning wave slots is free; barracks are what add slots.
  armyAdd(pid, kind) {
    const p = this.players.get(pid);
    if (!p || !p.alive || !C.UNITS[kind]) return 'Invalid troop type';
    if (this.slotsUsed(p) + C.slotsOf(kind) > this.waveSize(p)) {
      return C.slotsOf(kind) > 1
        ? `Not enough free wave slots (a ${C.UNITS[kind].name} takes ${C.slotsOf(kind)}): build a barracks, or remove a troop`
        : 'Every wave slot is assigned: build a barracks for more, or remove a troop';
    }
    p.army[kind]++;
    return null;
  }

  armyRemove(pid, kind) {
    const p = this.players.get(pid);
    if (!p || !p.alive || !C.UNITS[kind]) return 'Invalid troop type';
    if (p.army[kind] <= 0) return 'None to remove';
    p.army[kind]--;
    return null;
  }

  armyLevel(pid, kind) {
    const p = this.players.get(pid);
    if (!p || !p.alive || !C.UNITS[kind]) return 'Invalid troop type';
    const level = p.levels[kind];
    if (level >= C.MAX_LEVEL) return 'Already max level';
    const cost = C.armyLevelCost(kind, level);
    if (p.gold < cost) return 'Not enough gold';
    p.gold -= cost;
    p.levels[kind]++;
    return null;
  }

  // ---------------------------------------------------------------- orders

  // Turn a clicked target into an order for pid's troops.
  // target: { k: 't', id } tower | { k: 'c', id } core (player id) | { k: 'j', id } jungle camp
  makeOrder(pid, target) {
    if (!target || typeof target !== 'object') return 'Invalid target';
    const { k, id } = target;
    if (k === 't') {
      const t = this.towers.get(id);
      if (!t) return 'No such tower';
      if (t.owner === pid) return { type: 'defend', anchor: t.id };
      if (!t.owner) return 'That tower is a ruin';
      return { type: 'attack', target: { k: 't', id: t.id, owner: t.owner } };
    }
    if (k === 'c') {
      if (id === pid) return { type: 'defend', anchor: 0 };
      const enemy = this.players.get(id);
      if (!enemy || !enemy.alive) return 'No such core';
      return { type: 'attack', target: { k: 'c', id } };
    }
    if (k === 'j') {
      const camp = this.camps[id];
      if (!camp || !camp.alive) return 'That camp is empty';
      return { type: 'attack', target: { k: 'j', id } };
    }
    if (k === 'u') {
      // Hunt an enemy troop: chase it down, then go after its nearby squadmates.
      const v = this.units.get(id);
      if (!v) return 'That troop is gone';
      if (v.owner === pid) return 'That is your own troop';
      return { type: 'attack', target: { k: 'u', id, owner: v.owner, lx: v.x, ly: v.y } };
    }
    return 'Invalid target';
  }

  // Order troops.
  // - ids: exactly those troops.
  // - otherwise, share (0..1] of your troops: 1 (default) means every troop plus all future waves;
  //   less than 1 sends that fraction of your current troops (keeping the army's mix of types, nearest
  //   to the target first) and leaves the standing order for new waves alone.
  // Returns null on success or an error string; this.lastOrderCount says how many troops moved.
  order(pid, ids, target, share = 1) {
    this.lastOrderCount = 0;
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    const ord = this.makeOrder(pid, target);
    if (typeof ord === 'string') return ord;
    let chosen;
    if (Array.isArray(ids) && ids.length) {
      chosen = ids.slice(0, C.MAX_UNITS).map((id) => this.units.get(id)).filter((u) => u && u.owner === pid);
      if (!chosen.length) return 'No troops selected';
    } else if (!(share < 1)) {
      if (ord.target?.k !== 'u') p.order = ord; // new waves don't chase a single troop
      chosen = [...this.units.values()].filter((u) => u.owner === pid);
    } else {
      chosen = this.pickShare(pid, ord, Math.max(0.01, share));
      if (!chosen.length) return 'No troops available to send';
    }
    for (const u of chosen) this.applyOrder(u, ord);
    this.lastOrderCount = chosen.length;
    return null;
  }

  // Pick `share` of pid's troops for an order: troops not already following it, each type taken in
  // proportion so the group keeps the army's mix, nearest to the order's destination first.
  pickShare(pid, ord, share) {
    const mine = [...this.units.values()].filter((u) => u.owner === pid);
    const want = Math.max(1, Math.round(mine.length * share));
    const dest = this.orderPos(pid, ord);
    const already = (u) => (ord.type === 'defend'
      ? !u.attack && u.anchor === ord.anchor
      : u.attack && u.attack.k === ord.target.k && u.attack.id === ord.target.id);
    const free = mine.filter((u) => !already(u));
    const byDist = (u1, u2) => dist(u1.x, u1.y, dest.x, dest.y) - dist(u2.x, u2.y, dest.x, dest.y);
    const picked = [];
    const leftovers = [];
    for (const kind of UNIT_KEYS) {
      const ofKind = free.filter((u) => u.kind === kind).sort(byDist);
      const take = Math.round(ofKind.length * share);
      picked.push(...ofKind.slice(0, take));
      leftovers.push(...ofKind.slice(take));
    }
    // Rounding per type can miss the total: top up (or trim) with the nearest remaining troops.
    leftovers.sort(byDist);
    while (picked.length < want && leftovers.length) picked.push(leftovers.shift());
    picked.sort(byDist);
    return picked.slice(0, want);
  }

  // Where an order sends troops.
  orderPos(pid, ord) {
    if (ord.type === 'defend') {
      const t = ord.anchor && this.towers.get(ord.anchor);
      const p = this.players.get(pid);
      return t ? { x: t.x + 0.5, y: t.y + 0.5 } : { x: p.core.x + 0.5, y: p.core.y + 0.5 };
    }
    const { k, id } = ord.target;
    if (k === 't') {
      const t = this.towers.get(id);
      return { x: t.x + 0.5, y: t.y + 0.5 };
    }
    if (k === 'c') {
      const p = this.players.get(id);
      return { x: p.core.x + 0.5, y: p.core.y + 0.5 };
    }
    if (k === 'u') return { x: ord.target.lx, y: ord.target.ly };
    const camp = this.camps[id];
    return { x: camp.x + 0.5, y: camp.y + 0.5 };
  }

  applyOrder(u, ord) {
    if (ord.type === 'defend') {
      u.attack = null;
      u.anchor = ord.anchor;
    } else {
      u.attack = { ...ord.target };
    }
    u.path = [];
    u.dest = null;
    u.repathAt = 0;
    u.idleUntil = 0;
  }

  // Is an order still meaningful? Used to sanity-check the standing order for new waves.
  orderValid(pid, ord) {
    if (ord.type === 'defend') return !ord.anchor || this.towers.get(ord.anchor)?.owner === pid;
    const t = ord.target;
    if (t.k === 'c') return !!this.players.get(t.id)?.alive;
    if (t.k === 'j') return !!this.camps[t.id]?.alive;
    if (t.k === 'u') return this.units.has(t.id);
    return !!this.players.get(t.owner)?.alive; // tower orders roll on to that player's next structure
  }

  // ---------------------------------------------------------------- waves

  updateWaves() {
    for (const p of this.players.values()) {
      if (!p.alive || this.time < p.nextWaveAt) continue;
      p.nextWaveAt += C.WAVE_INTERVAL;
      this.spawnWave(p);
    }
  }

  // The core sends BASE_WAVE troops; each barracks sends its BARRACKS_TROOPS from where it stands.
  spawnWave(p) {
    if (!this.orderValid(p.id, p.order)) p.order = { type: 'defend', anchor: 0 };
    let alive = 0; // in wave slots: a giant counts as 3
    for (const u of this.units.values()) if (u.owner === p.id) alive += C.slotsOf(u.kind);
    const cap = C.unitCap(p.territory, this.waveSize(p));
    const barracks = [...this.towers.values()].filter((t) => t.owner === p.id && t.kind === 'barracks')
      .sort((a, b) => a.id - b.id).slice(0, C.MAX_BARRACKS);
    const list = this.waveList(p);
    let spawned = 0;
    let slotAt = 0;
    for (const kind of list) {
      const n = C.slotsOf(kind);
      if (alive + n > cap) break;
      const slot = slotAt - C.BASE_WAVE;
      const from = slot < 0 ? null : barracks[Math.floor(slot / C.BARRACKS_TROOPS)];
      this.spawnTroop(p, kind, from);
      slotAt += n;
      alive += n;
      spawned++;
    }
    if (spawned) {
      this.fx.push({ k: 'wave', x: p.core.x + 0.5, y: p.core.y + 0.5, o: p.id });
      for (const b of barracks) this.fx.push({ k: 'wave', x: b.x + 0.5, y: b.y + 0.5, o: p.id });
    }
  }

  // Spawn one troop at the core, or at barracks `from`.
  spawnTroop(p, kind, from = null) {
    const id = this.nextId++;
    const level = p.levels[kind];
    const stats = C.towerStats(kind, level);
    const a = this.rand() * Math.PI * 2;
    const ox = from ? from.x : p.core.x;
    const oy = from ? from.y : p.core.y;
    const x = Math.max(0.5, Math.min(this.w - 0.5, ox + 0.5 + Math.cos(a) * (from ? 1 : 1.3)));
    const y = Math.max(0.5, Math.min(this.h - 0.5, oy + 0.5 + Math.sin(a) * (from ? 1 : 1.3)));
    const u = {
      isUnit: true, id, kind, owner: p.id, x, y, level, hp: stats.hp, maxHp: stats.hp, cd: 0,
      anchor: 0, attack: null, path: [], dest: null, repathAt: 0, idleUntil: this.time + 0.5, slowT: 0, slowF: 1,
    };
    this.applyOrder(u, p.order);
    // Troops from a barracks guard it when the standing order is "defend the core".
    if (from && p.order.type === 'defend' && !p.order.anchor) u.anchor = from.id;
    this.units.set(id, u);
    if (this.ucells) this.ucells[this.ucellOf(u.x, u.y)].push(u); // findable before the next grid rebuild
    return u;
  }

  // ---------------------------------------------------------------- jungle

  setupCamps() {
    const cols = 4;
    const rows = 3;
    const margin = 10;
    const cw = (this.w - margin * 2) / cols;
    const ch = (this.h - margin * 2) / rows;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (i >= C.CAMP_COUNT) break;
        const x = Math.round(margin + (c + 0.5) * cw + (this.rand() - 0.5) * cw * 0.5);
        const y = Math.round(margin + (r + 0.5) * ch + (this.rand() - 0.5) * ch * 0.5);
        this.camps.push({ id: i, x, y, type: (r + c) % 3 === 0 ? 'big' : 'small', alive: false, respawnAt: 0, lastActive: 0 });
        i++;
      }
    }
  }

  // Is (x, y) a good place for a camp? `strict` also requires unclaimed land and a real move.
  campSpotOk(camp, x, y, strict) {
    const k = this.idx(x, y);
    if (this.grid[k] !== 0) return false;
    if (strict && this.terr[k] !== 0) return false;
    if (strict && dist(x, y, camp.x, camp.y) < C.CAMP_MOVE_MIN) return false;
    for (const o of this.camps) if (o !== camp && dist(x, y, o.x, o.y) < C.CAMP_SPACING) return false;
    for (const p of this.players.values()) if (p.alive && dist(x, y, p.core.x, p.core.y) < C.CAMP_CORE_DIST) return false;
    for (const t of this.towers.values()) if (dist(x, y, t.x, t.y) < 3) return false;
    return true;
  }

  // A new random spot for a camp: unclaimed land if possible, else anywhere clear.
  pickCampSpot(camp) {
    const margin = 6;
    for (let i = 0; i < 400; i++) {
      const x = margin + Math.floor(this.rand() * (this.w - margin * 2));
      const y = margin + Math.floor(this.rand() * (this.h - margin * 2));
      if (this.campSpotOk(camp, x, y, i < 250)) return { x, y };
    }
    return { x: camp.x, y: camp.y };
  }

  // Move a camp to a new spot (its monsters must already be gone).
  moveCamp(camp) {
    const spot = this.pickCampSpot(camp);
    camp.x = spot.x;
    camp.y = spot.y;
  }

  spawnCamp(camp) {
    if (!this.campSpotOk(camp, camp.x, camp.y, false)) this.moveCamp(camp); // someone built here meanwhile
    camp.lastActive = this.time;
    this.fx.push({ k: 'campSpawn', x: camp.x + 0.5, y: camp.y + 0.5 });
    for (const [kind, n] of Object.entries(C.CAMP_TYPES[camp.type])) {
      const def = C.CREEPS[kind];
      for (let i = 0; i < n; i++) {
        const id = this.nextId++;
        const hx = camp.x + 0.5 + (kind === 'golem' ? 0 : Math.cos(i * 2.1) * 0.9);
        const hy = camp.y + 0.5 + (kind === 'golem' ? 0 : Math.sin(i * 2.1) * 0.9);
        this.creeps.set(id, {
          isCreep: true, id, kind, owner: 0, camp: camp.id, hx, hy, x: hx, y: hy,
          hp: def.hp, maxHp: def.hp, angry: 0, atkCd: 0, slowT: 0, slowF: 1, dead: false,
        });
      }
    }
    camp.alive = true;
  }

  updateCreeps(dt) {
    for (const c of this.creeps.values()) {
      if (c.dead) continue;
      const def = C.CREEPS[c.kind];
      c.atkCd -= dt;
      if (c.slowT > 0) c.slowT -= dt;
      const speed = def.speed * (c.slowT > 0 ? c.slowF : 1);
      const homeD = dist(c.x, c.y, c.hx, c.hy);
      if (c.angry && homeD > C.CAMP_LEASH + 1.5) c.angry = 0; // dragged too far: reset

      if (c.angry) {
        // Fight back against the player who attacked the camp, without leaving the camp area.
        let foe = null;
        let foeD = Infinity;
        for (const u of this.nearUnits(c.hx, c.hy, C.CAMP_LEASH + 2)) {
          if (u.owner !== c.angry || dist(u.x, u.y, c.hx, c.hy) > C.CAMP_LEASH + 2) continue;
          const d = dist(u.x, u.y, c.x, c.y);
          if (d < foeD) {
            foeD = d;
            foe = u;
          }
        }
        if (!foe) {
          c.angry = 0;
        } else if (foeD <= C.CREEP_REACH) {
          if (c.atkCd <= 0) {
            c.atkCd = 1;
            this.fx.push({ k: 'slash', x: round2(foe.x), y: round2(foe.y) });
            this.damageUnit(foe, def.damage, 0);
          }
          continue;
        } else {
          const step = Math.min(foeD - C.CREEP_REACH * 0.9, speed * dt);
          c.x += ((foe.x - c.x) / foeD) * step;
          c.y += ((foe.y - c.y) / foeD) * step;
          continue;
        }
      }
      // Calm: walk home and regenerate.
      if (homeD > 0.05) {
        const step = Math.min(homeD, speed * dt);
        c.x += ((c.hx - c.x) / homeD) * step;
        c.y += ((c.hy - c.y) / homeD) * step;
      } else {
        c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.25 * dt);
      }
    }
    const living = new Set();
    for (const [id, c] of this.creeps) {
      if (c.dead) this.creeps.delete(id);
      else living.add(c.camp);
    }
    for (const camp of this.camps) {
      if (camp.alive && !living.has(camp.id)) {
        // Cleared: it will come back somewhere new (players can see where and when).
        camp.alive = false;
        camp.respawnAt = this.time + (C.BUFF_CAMPS.includes(camp.type) ? C.BUFF_CAMP_RESPAWN : C.CAMP_RESPAWN);
        this.moveCamp(camp);
      } else if (camp.alive && this.time - camp.lastActive > C.CAMP_RELOCATE) {
        // Left alone too long: if it's calm and unhurt, the camp wanders off to a new spot.
        const members = [...this.creeps.values()].filter((m) => m.camp === camp.id);
        if (members.every((m) => !m.angry && m.hp >= m.maxHp)) {
          for (const m of members) this.creeps.delete(m.id);
          const from = { x: camp.x + 0.5, y: camp.y + 0.5 };
          this.moveCamp(camp);
          this.fx.push({ k: 'campLeave', x: from.x, y: from.y });
          this.spawnCamp(camp);
        } else {
          camp.lastActive = this.time;
        }
      } else if (!camp.alive && this.time >= camp.respawnAt) {
        this.spawnCamp(camp);
      }
    }
  }

  // ---------------------------------------------------------------- damage

  hurt(obj, amount, byPid) {
    if (obj.isUnit) this.damageUnit(obj, amount, byPid);
    else if (obj.isCreep) this.damageCreep(obj, amount, byPid);
    else if (obj.isTower) this.damageTower(obj, amount, byPid);
    else if (obj.isPlayer) this.damageCore(obj, amount, byPid);
  }

  damageUnit(u, amount, byPid) {
    if (!this.units.has(u.id)) return;
    u.hp -= this.buffed(u.owner) ? amount * (1 - C.JUNGLE_BUFF_ARMOR) : amount;
    if (u.hp > 0) return;
    this.units.delete(u.id);
    this.fx.push({ k: 'boom', x: round2(u.x), y: round2(u.y), r: 0.5 });
    const p = this.players.get(byPid);
    if (p && p.alive && byPid !== u.owner) {
      this.award(p, C.TROOP_BOUNTY + C.TROOP_BOUNTY_PER_LEVEL * (u.level - 1), 'troops', u.x, u.y);
      p.kills++;
    }
  }

  damageCreep(c, amount, byPid) {
    if (c.dead) return;
    c.hp -= amount;
    const camp = this.camps[c.camp];
    if (camp) camp.lastActive = this.time;
    if (byPid) {
      // The whole camp joins in.
      for (const m of this.creeps.values()) if (m.camp === c.camp && !m.angry) m.angry = byPid;
      c.angry = byPid;
    }
    if (c.hp <= 0) {
      c.dead = true;
      const p = this.players.get(byPid);
      if (p && p.alive) {
        this.award(p, C.CREEPS[c.kind].bounty, 'camps', c.x, c.y);
        p.kills++;
        const cleared = ![...this.creeps.values()].some((m) => m.camp === c.camp && !m.dead);
        if (cleared && camp && C.BUFF_CAMPS.includes(camp.type)) {
          p.buffUntil = this.time + C.JUNGLE_BUFF_TIME;
          this.fx.push({ k: 'buff', x: camp.x + 0.5, y: camp.y + 0.5, o: p.id });
          this.pushFeed(`${p.name} cleared a golem camp: troops empowered for ${C.JUNGLE_BUFF_TIME}s`);
        }
      }
    }
  }

  damageCore(p, amount, byPid) {
    if (this.isShielded(p)) return;
    p.core.hp -= amount;
    this.fx.push({ k: 'hit', x: p.core.x + 0.5, y: p.core.y + 0.5 });
    if (p.core.hp <= 0) this.killPlayer(p, byPid);
  }

  damageTower(t, amount, byPid) {
    if (!t.owner || this.isShielded(this.players.get(t.owner))) return;
    t.hp -= amount;
    this.fx.push({ k: 'hit', x: t.x + 0.5, y: t.y + 0.5 });
    if (t.hp > 0) return;
    const owner = this.players.get(t.owner);
    const p = this.players.get(byPid);
    this.fx.push({ k: 'boom', x: t.x + 0.5, y: t.y + 0.5, r: 1.2 });
    if (p && p.alive && p.id !== t.owner) {
      // The player who brings a tower down claims it, patched up to a fraction of its health.
      this.award(p, C.TOWER_BOUNTY, 'towers', t.x + 0.5, t.y + 0.5);
      p.towersDestroyed++;
      t.hp = Math.max(1, Math.round(t.maxHp * C.TOWER_CLAIM_HP));
      this.transferTower(t, p.id, 'destroyed');
      return;
    }
    const ownerId = t.owner;
    this.ruinTower(t, owner ? owner.name : '');
    this.rollOnOrders(t, ownerId);
  }

  // A fallen tower becomes a ruin: no owner, no land, can be bought back by whoever's land covers it.
  ruinTower(t, ruinOf) {
    t.owner = 0;
    t.ruin = true;
    t.ruinOf = ruinOf;
    t.ruinTime = this.time;
    t.hp = t.maxHp;
    t.cap = 0;
    t.capBy = 0;
    this.structVersion++;
    this.terrDirty = true;
  }

  removeTower(t) {
    this.towers.delete(t.id);
    this.grid[this.idx(t.x, t.y)] = 0;
    this.structVersion++;
    if (t.owner) this.terrDirty = true;
  }

  // ---------------------------------------------------------------- towers & cores shoot

  updateStructures(dt) {
    const shooters = [];
    for (const t of this.towers.values()) {
      if (!t.owner) continue;
      const s = C.towerStats(t.kind, t.level);
      if (!s.damage) continue; // barracks don't shoot
      shooters.push({ obj: t, x: t.x + 0.5, y: t.y + 0.5, owner: t.owner, range: s.range, damage: s.damage, rate: s.rate });
    }
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      shooters.push({
        obj: p.core, x: p.core.x + 0.5, y: p.core.y + 0.5, owner: p.id, range: C.CORE_RANGE, damage: C.CORE_DAMAGE, rate: C.CORE_RATE,
      });
    }
    for (const sh of shooters) {
      sh.obj.cd = (sh.obj.cd || 0) - dt;
      if (sh.obj.cd > 0) continue;
      let target = null;
      let bestD = Infinity;
      for (const u of this.nearUnits(sh.x, sh.y, sh.range)) {
        if (u.owner === sh.owner) continue;
        const d = dist(sh.x, sh.y, u.x, u.y);
        if (d <= sh.range && d < bestD) {
          bestD = d;
          target = u;
        }
      }
      if (!target) continue;
      sh.obj.cd = 1 / sh.rate;
      this.fx.push({ k: 'tshot', x1: sh.x, y1: sh.y, x2: round2(target.x), y2: round2(target.y), o: sh.owner });
      this.damageUnit(target, sh.damage, sh.owner);
    }
  }

  // ---------------------------------------------------------------- pathfinding

  // Per-tile extra cost of walking into a tile. Towers and cores are costly; ruins are rubble.
  getExtra() {
    if (this.extraVersion === this.structVersion) return this.extra;
    const extra = this.extra;
    extra.fill(0);
    for (const t of this.towers.values()) {
      if (t.owner) extra[this.idx(t.x, t.y)] = Path.structureCost(C, t.maxHp);
    }
    for (const p of this.players.values()) {
      if (p.alive) extra[this.idx(p.core.x, p.core.y)] = Path.structureCost(C, p.core.maxHp);
    }
    this.extraVersion = this.structVersion;
    return extra;
  }

  // Flow field toward a goal tile. Rebuilt lazily, at most every PATH_RECOMPUTE_INTERVAL.
  getFieldTo(goal) {
    let f = this.fields.get(goal);
    const stale = !f || (f.version !== this.structVersion && this.time - f.at >= C.PATH_RECOMPUTE_INTERVAL);
    if (stale) {
      f = { dist: Path.computeField(this.w, this.h, this.getExtra(), goal), goal, version: this.structVersion, at: this.time };
      this.fields.set(goal, f);
    } else {
      this.getExtra();
    }
    f.used = this.time;
    return f;
  }

  // ---------------------------------------------------------------- troops

  // Where a defending troop patrols: its tower if still standing and owned, else its owner's core.
  anchorOf(u) {
    if (u.anchor) {
      const t = this.towers.get(u.anchor);
      if (t && t.owner === u.owner) {
        return { x: t.x + 0.5, y: t.y + 0.5, leash: C.UNIT_LEASH_TOWER, goal: this.idx(t.x, t.y) };
      }
      u.anchor = 0; // tower lost: fall back to guarding the core
    }
    const p = this.players.get(u.owner);
    return { x: p.core.x + 0.5, y: p.core.y + 0.5, leash: C.UNIT_LEASH_CORE, goal: this.idx(p.core.x, p.core.y) };
  }

  // Resolve a troop's attack order into a destination, rolling on to the same enemy's next
  // structure when a tower falls or changes hands. Returns null when the order is finished.
  resolveAttack(u) {
    const a = u.attack;
    if (a.k === 'u') {
      let v = this.units.get(a.id);
      if (!v || v.owner === u.owner) {
        // The hunted troop is down (or changed sides): go after the nearest of its squadmates
        // around where it fell; if there are none, the hunt is over.
        v = null;
        let best = C.HUNT_ROLL_RANGE;
        for (const o of this.nearUnits(a.lx, a.ly, C.HUNT_ROLL_RANGE)) {
          if (o.owner !== a.owner || o.owner === u.owner) continue;
          const d = dist(a.lx, a.ly, o.x, o.y);
          if (d <= best) {
            best = d;
            v = o;
          }
        }
        if (!v) return null;
        a.id = v.id;
      }
      a.lx = v.x;
      a.ly = v.y;
      return { x: v.x, y: v.y, goal: this.idx(Math.floor(v.x), Math.floor(v.y)), struct: false, unit: v };
    }
    if (a.k === 'j') {
      const camp = this.camps[a.id];
      if (!camp || !camp.alive) return null;
      return { x: camp.x + 0.5, y: camp.y + 0.5, goal: this.idx(camp.x, camp.y), struct: false };
    }
    if (a.k === 'c') {
      const p = this.players.get(a.id);
      if (!p || !p.alive) return null;
      return { x: p.core.x + 0.5, y: p.core.y + 0.5, goal: this.idx(p.core.x, p.core.y), struct: true };
    }
    const t = this.towers.get(a.id);
    if (t && t.owner === a.owner && t.owner !== u.owner) {
      return { x: t.x + 0.5, y: t.y + 0.5, goal: this.idx(t.x, t.y), struct: true };
    }
    const enemy = this.players.get(a.owner);
    if (!enemy || !enemy.alive) return null;
    let next = null;
    let nextD = Infinity;
    for (const o of this.towers.values()) {
      if (o.owner !== enemy.id) continue;
      const d = dist(u.x, u.y, o.x + 0.5, o.y + 0.5);
      if (d < nextD) {
        nextD = d;
        next = o;
      }
    }
    u.attack = next ? { k: 't', id: next.id, owner: enemy.id } : { k: 'c', id: enemy.id };
    return this.resolveAttack(u);
  }

  // Best thing for troop u to hit within `reach`. Enemy troops first (Guards that taunt come
  // before anything else), then monsters fighting us (or the camp we were sent to), then -
  // if `structures` - enemy towers and cores.
  pickTarget(u, def, reach, structures) {
    const minR = def.minRange || 0;
    let best = null;
    let bestScore = Infinity;
    for (const v of this.nearUnits(u.x, u.y, reach)) {
      if (v.owner === u.owner) continue;
      const d = dist(u.x, u.y, v.x, v.y);
      if (d > reach || d < minR) continue;
      const vd = C.UNITS[v.kind];
      const score = vd.taunt && d <= vd.taunt ? d - 100 : d;
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    if (best) return best;
    for (const c of this.creeps.values()) {
      if (c.dead) continue;
      if (c.angry !== u.owner && !(u.attack && u.attack.k === 'j' && u.attack.id === c.camp)) continue;
      const d = dist(u.x, u.y, c.x, c.y);
      if (d > reach || d < minR) continue;
      if (d < bestScore) {
        bestScore = d;
        best = c;
      }
    }
    if (best || !structures) return best;
    for (const t of this.towers.values()) {
      if (!t.owner || t.owner === u.owner || this.isShielded(this.players.get(t.owner))) continue;
      const d = dist(u.x, u.y, t.x + 0.5, t.y + 0.5);
      if (d > reach || d < minR) continue;
      if (d < bestScore) {
        bestScore = d;
        best = t;
      }
    }
    for (const p of this.players.values()) {
      if (!p.alive || p.id === u.owner || this.isShielded(p)) continue;
      const d = dist(u.x, u.y, p.core.x + 0.5, p.core.y + 0.5);
      if (d > reach || d < minR) continue;
      if (d < bestScore) {
        bestScore = d;
        best = p;
      }
    }
    return best;
  }

  onHomeLand(u) {
    const x = Math.floor(u.x);
    const y = Math.floor(u.y);
    return !this.suddenDeath() && this.inBounds(x, y) && this.terr[this.idx(x, y)] === u.owner;
  }

  unitFire(u, target, s, def) {
    u.cd = 1 / s.rate;
    const [tx, ty] = posOf(target);
    const isStruct = target.isTower || target.isPlayer;
    const home = this.onHomeLand(u) ? 1 + C.HOME_DAMAGE_BONUS : 1;
    const buff = this.buffed(u.owner) ? 1 + C.JUNGLE_BUFF_DAMAGE : 1;
    const base = s.damage * buff; // splash and frost pulses
    const siege = isStruct ? (def.siege || 1) * (this.suddenDeath() ? C.SUDDEN_DEATH_SIEGE : 1) : 1;
    const dmg = base * home * siege;
    if (def.aoe) {
      // Frost pulse: every enemy troop and monster around us.
      for (const v of this.nearUnits(u.x, u.y, s.range)) {
        if (v.owner === u.owner || dist(u.x, u.y, v.x, v.y) > s.range) continue;
        v.slowT = def.slowTime;
        v.slowF = def.slow;
        this.damageUnit(v, base, u.owner);
      }
      for (const c of this.creeps.values()) {
        if (c.dead || dist(u.x, u.y, c.x, c.y) > s.range) continue;
        c.slowT = def.slowTime;
        c.slowF = def.slow;
        this.damageCreep(c, base, u.owner);
      }
      if (isStruct) this.hurt(target, dmg, u.owner);
      this.fx.push({ k: 'frost', x: round2(u.x), y: round2(u.y), r: s.range });
    } else if (def.splash) {
      this.hurt(target, dmg, u.owner);
      for (const v of this.nearUnits(tx, ty, def.splash)) {
        if (v !== target && v.owner !== u.owner && dist(tx, ty, v.x, v.y) <= def.splash) this.damageUnit(v, base, u.owner);
      }
      for (const c of this.creeps.values()) {
        if (c !== target && !c.dead && dist(tx, ty, c.x, c.y) <= def.splash) this.damageCreep(c, base, u.owner);
      }
      this.fx.push({ k: 'shell', x1: round2(u.x), y1: round2(u.y), x2: round2(tx), y2: round2(ty), r: def.splash });
    } else if (def.cleave) {
      // Giant: smash the target and everything around it, knocking troops back.
      const hit = [target];
      for (const v of this.nearUnits(tx, ty, def.cleave)) {
        if (v !== target && v.owner !== u.owner && dist(tx, ty, v.x, v.y) <= def.cleave) hit.push(v);
      }
      for (const c of this.creeps.values()) {
        if (c !== target && !c.dead && dist(tx, ty, c.x, c.y) <= def.cleave) hit.push(c);
      }
      for (const v of hit) {
        this.hurt(v, v === target ? dmg : base * home, u.owner);
        if (v.isUnit && this.units.has(v.id)) {
          const d = dist(u.x, u.y, v.x, v.y) || 1;
          v.x = Math.max(0.5, Math.min(this.w - 0.5, v.x + ((v.x - u.x) / d) * def.knockback));
          v.y = Math.max(0.5, Math.min(this.h - 0.5, v.y + ((v.y - u.y) / d) * def.knockback));
          v.path = [];
          v.dest = null;
        }
      }
      this.fx.push({ k: 'smash', x: round2(tx), y: round2(ty), r: def.cleave });
    } else if (def.melee) {
      this.hurt(target, dmg, u.owner);
      this.fx.push({ k: 'slash', x: round2(tx), y: round2(ty) });
    } else {
      this.hurt(target, dmg, u.owner);
      this.fx.push({ k: 'bolt', x1: round2(u.x), y1: round2(u.y), x2: round2(tx), y2: round2(ty), o: u.owner });
    }
  }

  walkable(k, owner) {
    return this.terr[k] === owner && this.grid[k] === 0;
  }

  // Plan a path for u toward (gx, gy) over its owner's open land (BFS, no corner cutting past
  // structures). If the point itself can't be reached, head for the reachable tile nearest to it.
  planUnit(u, gx, gy) {
    const w = this.w;
    const ok = (n) => this.walkable(n, u.owner);
    const gen = ++this.bfsGen;
    const stamp = this.bfsStamp;
    const parent = this.bfsParent;
    const queue = this.bfsQueue;
    const sx = Math.max(0, Math.min(w - 1, Math.floor(u.x)));
    const sy = Math.max(0, Math.min(this.h - 1, Math.floor(u.y)));
    const start = this.idx(sx, sy);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    stamp[start] = gen;
    parent[start] = -1;
    let best = start;
    let bestD = dist(sx + 0.5, sy + 0.5, gx, gy);
    while (head < tail) {
      const k = queue[head++];
      const x = k % w;
      const y = (k - x) / w;
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const n = this.idx(nx, ny);
        if (stamp[n] === gen || !ok(n)) continue;
        if (dx && dy && (!ok(this.idx(x + dx, y)) || !ok(this.idx(x, y + dy)))) continue;
        stamp[n] = gen;
        parent[n] = k;
        queue[tail++] = n;
        const d = dist(nx + 0.5, ny + 0.5, gx, gy);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
    }
    const path = [];
    for (let k = best; k !== start && k !== -1; k = parent[k]) path.push(k);
    path.reverse();
    const bx = best % w;
    const by = (best - bx) / w;
    const exact = Math.floor(gx) === bx && Math.floor(gy) === by;
    u.path = path;
    u.dest = exact ? { x: gx, y: gy } : { x: bx + 0.5, y: by + 0.5 };
  }

  // Advance u along its planned path. Returns true when it arrives at its destination.
  moveUnit(u, dt, speed) {
    let budget = speed * dt;
    while (budget > 0) {
      let tx;
      let ty;
      if (u.path.length) {
        tx = (u.path[0] % this.w) + 0.5;
        ty = Math.floor(u.path[0] / this.w) + 0.5;
      } else if (u.dest) {
        tx = u.dest.x;
        ty = u.dest.y;
      } else {
        return false;
      }
      const dx = tx - u.x;
      const dy = ty - u.y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        u.x = tx;
        u.y = ty;
        budget -= d;
        if (u.path.length) u.path.shift();
        else {
          u.dest = null;
          return true;
        }
      } else {
        u.x += (dx / d) * budget;
        u.y += (dy / d) * budget;
        budget = 0;
      }
    }
    return false;
  }

  // Step straight toward (x, y), stopping `stop` short of it.
  stepToward(u, x, y, stop, speed, dt) {
    const d = dist(u.x, u.y, x, y);
    if (d <= stop) return;
    const step = Math.min(d - stop, speed * dt);
    u.x += ((x - u.x) / d) * step;
    u.y += ((y - u.y) / d) * step;
  }

  // March across the map along the flow field toward goal tile (centre gx, gy).
  marchTo(u, goal, gx, gy, stop, speed, dt) {
    if (dist(u.x, u.y, gx, gy) <= stop) return true;
    const f = this.getFieldTo(goal);
    const tx = Math.max(0, Math.min(this.w - 1, Math.floor(u.x)));
    const ty = Math.max(0, Math.min(this.h - 1, Math.floor(u.y)));
    const next = Path.nextStep(f.dist, this.w, this.h, this.extra, this.idx(tx, ty), goal);
    let nx = gx;
    let ny = gy;
    if (next >= 0 && next !== goal) {
      nx = (next % this.w) + 0.5;
      ny = Math.floor(next / this.w) + 0.5;
    }
    this.stepToward(u, nx, ny, 0, speed, dt);
    return false;
  }

  updateUnits(dt) {
    for (const u of this.units.values()) {
      if (u.hp <= 0 || !this.units.has(u.id)) continue;
      const def = C.UNITS[u.kind];
      const s = C.towerStats(u.kind, u.level);
      u.cd -= dt;
      if (u.slowT > 0) u.slowT -= dt;
      const speed = def.speed * (u.slowT > 0 ? u.slowF : 1);
      // Home turf: troops on their own land slowly heal.
      if (this.onHomeLand(u) && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * C.HOME_REGEN * dt);

      let tgt = null;
      if (u.attack) {
        tgt = this.resolveAttack(u);
        if (!tgt) {
          u.attack = null;
          u.path = [];
          u.dest = null;
        }
      }

      if (def.scout) {
        // Scouts never fight. With an attack order they run to the target; otherwise they explore.
        if (tgt) this.marchTo(u, tgt.goal, tgt.x, tgt.y, 2, speed, dt);
        else this.scoutTick(u, speed, dt);
        continue;
      }

      if (tgt && tgt.unit && !def.heal) {
        // Hunting: focus on the chosen troop, ignoring everything else until it's down.
        const v = tgt.unit;
        const d = dist(u.x, u.y, v.x, v.y);
        if (d <= s.range && d >= (def.minRange || 0)) {
          u.path = [];
          u.dest = null;
          if (u.cd <= 0) this.unitFire(u, v, s, def);
        } else if (d < (def.minRange || 0)) {
          this.stepToward(u, u.x * 2 - v.x, u.y * 2 - v.y, 0, speed, dt); // too close for a mortar: back off
        } else if (d < 10) {
          this.stepToward(u, v.x, v.y, s.range * 0.8, speed, dt);
        } else {
          this.marchTo(u, tgt.goal, v.x, v.y, s.range * 0.8, speed, dt);
        }
        continue;
      }

      if (def.heal) {
        if (this.medicTick(u, def, s, tgt, speed, dt)) continue;
      } else {
        // In range of something? Stand and fight.
        const shoot = this.pickTarget(u, def, s.range, true);
        if (shoot) {
          u.path = [];
          u.dest = null;
          if (u.cd <= 0) this.unitFire(u, shoot, s, def);
          continue;
        }
      }

      if (tgt) {
        // On the march: engage enemies that come close, otherwise push on to the target.
        if (!def.heal) {
          const foe = this.pickTarget(u, def, s.range + C.TROOP_AGGRO, false);
          if (foe) {
            const [fx, fy] = posOf(foe);
            this.stepToward(u, fx, fy, s.range * 0.9, speed, dt);
            continue;
          }
        }
        const stop = tgt.struct ? Math.max(0.6, s.range * 0.85) : 1;
        this.marchTo(u, tgt.goal, tgt.x, tgt.y, stop, speed, dt);
        continue;
      }

      // Defending.
      const a = this.anchorOf(u);
      const tx = Math.max(0, Math.min(this.w - 1, Math.floor(u.x)));
      const ty = Math.max(0, Math.min(this.h - 1, Math.floor(u.y)));
      if (this.terr[this.idx(tx, ty)] !== u.owner && dist(u.x, u.y, a.x, a.y) > a.leash) {
        // Out in the field (back from an attack, or land lost): march home.
        u.path = [];
        u.dest = null;
        this.marchTo(u, a.goal, a.x, a.y, a.leash * 0.5, speed, dt);
        continue;
      }

      if (!def.heal) {
        // Chase intruders near what we guard, staying on the leash.
        let foe = null;
        let foeD = Infinity;
        for (const v of this.nearUnits(a.x, a.y, a.leash + s.range)) {
          if (v.owner === u.owner || dist(a.x, a.y, v.x, v.y) > a.leash + s.range) continue;
          const d = dist(u.x, u.y, v.x, v.y);
          if (d < foeD) {
            foeD = d;
            foe = v;
          }
        }
        if (foe) {
          let gx = foe.x;
          let gy = foe.y;
          const da = dist(a.x, a.y, gx, gy);
          if (da > a.leash) {
            gx = a.x + ((gx - a.x) / da) * a.leash;
            gy = a.y + ((gy - a.y) / da) * a.leash;
          }
          if (this.time >= u.repathAt || !u.dest) {
            this.planUnit(u, gx, gy);
            u.repathAt = this.time + C.UNIT_REPATH;
          }
          this.moveUnit(u, dt, speed);
          continue;
        }
      }

      // Patrol.
      if (u.dest) {
        if (this.moveUnit(u, dt, speed)) u.idleUntil = this.time + 0.8 + this.rand() * 2;
        continue;
      }
      if (dist(u.x, u.y, a.x, a.y) > a.leash + 0.75 || this.terr[this.idx(tx, ty)] !== u.owner) {
        this.planUnit(u, a.x, a.y);
        continue;
      }
      if (this.time < u.idleUntil) continue;
      const ang = this.rand() * Math.PI * 2;
      const r = a.leash * Math.sqrt(this.rand());
      this.planUnit(u, a.x + Math.cos(ang) * r, a.y + Math.sin(ang) * r);
      u.idleUntil = this.time + 0.5;
    }
  }

  // Medics heal every friendly troop in range and keep close to the fighting. Returns true if
  // the medic's movement for this tick is handled.
  // A scout heads for places its owner hasn't seen yet (staying clear of enemy guns), picking a
  // new spot when it arrives or after SCOUT_LEG_TIME seconds.
  scoutTick(u, speed, dt) {
    const p = this.players.get(u.owner);
    if (!p) return;
    if (!u.scoutTo || this.time > u.scoutUntil || dist(u.x, u.y, u.scoutTo.x, u.scoutTo.y) < 1.5) {
      u.scoutTo = this.pickScoutSpot(u, p);
      u.scoutUntil = this.time + C.SCOUT_LEG_TIME;
    }
    const { x, y } = u.scoutTo;
    this.marchTo(u, this.idx(Math.floor(x), Math.floor(y)), x, y, 1, speed, dt);
  }

  pickScoutSpot(u, p) {
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = 6 + this.rand() * C.SCOUT_RANGE;
      const x = Math.max(2, Math.min(this.w - 3, p.core.x + Math.cos(a) * r));
      const y = Math.max(2, Math.min(this.h - 3, p.core.y + Math.sin(a) * r));
      let danger = false;
      for (const t of this.towers.values()) {
        if (t.owner && t.owner !== p.id && dist(x, y, t.x, t.y) < C.structSight(t.kind, t.level)) danger = true;
      }
      for (const q of this.players.values()) if (q.id !== p.id && dist(x, y, q.core.x, q.core.y) < C.CORE_RANGE + 2) danger = true;
      if (danger) continue;
      let unseen = 0;
      for (let dy = -4; dy <= 4; dy += 2) {
        for (let dx = -4; dx <= 4; dx += 2) {
          const tx = Math.floor(x + dx);
          const ty = Math.floor(y + dy);
          if (this.inBounds(tx, ty) && !(p.explored && p.explored[this.idx(tx, ty)])) unseen++;
        }
      }
      const score = unseen * 10 - dist(u.x, u.y, x, y) * 0.3 + this.rand() * 5;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return best || { x: p.core.x + 0.5, y: p.core.y + 0.5 };
  }

  // ---------------------------------------------------------------- fog of war

  // What each player can see right now (p.vis), and everywhere they have ever seen (p.explored).
  updateVision() {
    const n = this.w * this.h;
    const sources = new Map();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      sources.set(p.id, [{ x: p.core.x + 0.5, y: p.core.y + 0.5, r: C.CORE_SIGHT }]);
    }
    for (const t of this.towers.values()) {
      const list = sources.get(t.owner);
      if (list) list.push({ x: t.x + 0.5, y: t.y + 0.5, r: C.structSight(t.kind, t.level) });
    }
    for (const u of this.units.values()) {
      const list = sources.get(u.owner);
      if (list) list.push({ x: u.x, y: u.y, r: C.UNITS[u.kind].sight || 5 });
    }
    for (const [pid, list] of sources) {
      const p = this.players.get(pid);
      if (!p.vis) {
        p.vis = new Uint8Array(n);
        p.explored = new Uint8Array(n);
      }
      Vision.computeVision(p.vis, this.w, this.h, pid, this.terr, list);
      for (let k = 0; k < n; k++) if (p.vis[k]) p.explored[k] = 1;
    }
  }

  // Can player p see world point (x, y)?
  sees(p, x, y) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return !!p.vis && this.inBounds(tx, ty) && p.vis[this.idx(tx, ty)] === 1;
  }

  medicTick(u, def, s, tgt, speed, dt) {
    let healed = 0;
    let patient = null;
    let worst = 1;
    let buddy = null;
    let buddyD = Infinity;
    for (const f of this.nearUnits(u.x, u.y, 12)) { // patients within 10, buddies within 12
      if (f.owner !== u.owner) continue;
      const fd = dist(u.x, u.y, f.x, f.y);
      if (f.hp < f.maxHp) {
        if (u.cd <= 0 && fd <= s.range) {
          f.hp = Math.min(f.maxHp, f.hp + s.heal);
          healed++;
        }
        if (fd < 10 && f.hp / f.maxHp < worst) {
          worst = f.hp / f.maxHp;
          patient = f;
        }
      }
      if (f !== u && !C.UNITS[f.kind].heal && fd < buddyD && (!tgt || f.attack)) {
        buddyD = fd;
        buddy = f;
      }
    }
    if (healed) {
      u.cd = 1 / s.rate;
      this.fx.push({ k: 'heal', x: round2(u.x), y: round2(u.y), r: s.range });
    }
    if (!tgt) return false; // defending medics use the normal patrol code
    // On the march: tend the wounded, else tag along behind the nearest troop, else push on.
    const follow = patient && patient !== u ? patient : buddy;
    if (follow && dist(u.x, u.y, follow.x, follow.y) < 12) {
      this.stepToward(u, follow.x, follow.y, 1.2, speed, dt);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- capture by occupation

  // Troops near an enemy tower slowly take it over, unless its owner's troops are there too.
  updateCaptures(dt) {
    for (const t of this.towers.values()) {
      if (!t.owner) continue;
      const cx = t.x + 0.5;
      const cy = t.y + 0.5;
      const counts = new Map();
      for (const u of this.nearUnits(cx, cy, C.CAPTURE_RANGE)) {
        if (dist(u.x, u.y, cx, cy) <= C.CAPTURE_RANGE) counts.set(u.owner, (counts.get(u.owner) || 0) + 1);
      }
      const defended = (counts.get(t.owner) || 0) > 0;
      let attacker = 0;
      let most = 0;
      for (const [pid, n] of counts) {
        if (pid === t.owner) continue;
        if (n > most || (n === most && pid === t.capBy)) {
          most = n;
          attacker = pid;
        }
      }
      if (!defended && attacker && !this.isShielded(this.players.get(t.owner))) {
        if (t.capBy !== attacker) {
          t.capBy = attacker; // a new challenger starts from scratch
          t.cap = 0;
        }
        t.cap += (dt * C.captureSpeed(most)) / C.captureTime(t.level);
        if (t.cap >= 1) this.transferTower(t, attacker);
      } else if (t.cap) {
        // Contested or abandoned: progress drains away.
        t.cap = Math.max(0, t.cap - dt / C.captureTime(t.level));
        if (!t.cap) t.capBy = 0;
      }
    }
  }

  // When tower t stops being `enemyId`'s, standing attack orders on it roll on to that
  // enemy's nearest remaining tower (or core), so waves keep pushing like a lane.
  rollOnOrders(t, enemyId) {
    for (const p of this.players.values()) {
      const o = p.order;
      if (o.type !== 'attack' || o.target.k !== 't' || o.target.id !== t.id) continue;
      let next = null;
      let nextD = Infinity;
      for (const other of this.towers.values()) {
        if (other === t || other.owner !== enemyId) continue;
        const d = dist(t.x, t.y, other.x, other.y);
        if (d < nextD) {
          nextD = d;
          next = other;
        }
      }
      const enemy = this.players.get(enemyId);
      if (next) p.order = { type: 'attack', target: { k: 't', id: next.id, owner: enemyId } };
      else if (enemy && enemy.alive) p.order = { type: 'attack', target: { k: 'c', id: enemyId } };
      else p.order = { type: 'defend', anchor: 0 };
    }
  }

  // Hand tower t to newOwner (captured by occupation, or claimed by destroying it).
  transferTower(t, newOwner, how = 'captured') {
    const winner = this.players.get(newOwner);
    const loser = this.players.get(t.owner);
    const loserId = t.owner;
    t.owner = newOwner;
    t.cap = 0;
    t.capBy = 0;
    this.structVersion++;
    this.terrDirty = true;
    this.fx.push({ k: 'capture', x: t.x + 0.5, y: t.y + 0.5, o: newOwner });
    // Troops that were attacking it stay on as its garrison.
    for (const u of this.units.values()) {
      if (u.owner === newOwner && u.attack && u.attack.k === 't' && u.attack.id === t.id) {
        u.attack = null;
        u.anchor = t.id;
      }
    }
    this.rollOnOrders(t, loserId);
    if (winner && loser) {
      this.pushFeed(how === 'destroyed'
        ? `${winner.name} destroyed and claimed ${loser.name}'s tower (+${C.TOWER_BOUNTY}g)`
        : `${winner.name} captured a tower from ${loser.name}`);
    }
  }

  // ---------------------------------------------------------------- bots

  updateBots() {
    let humans = 0;
    let bots = 0;
    for (const p of this.players.values()) {
      if (p.isBot) bots++;
      else humans++;
    }
    const desired = Math.max(0, this.botTarget - humans);
    if (bots < desired && this.time >= this.botSpawnAt && this.canJoin()) {
      const used = new Set([...this.players.values()].map((p) => p.name));
      const free = BOT_NAMES.filter((n) => !used.has(n));
      const name = free.length ? free[Math.floor(this.rand() * free.length)] : 'Bot';
      this.addPlayer(name, true);
      this.botSpawnAt = this.time + 4;
    }

    for (const p of this.players.values()) {
      if (!p.isBot || !p.alive || this.time < p.bot.next) continue;
      p.bot.next = this.time + 0.8 + this.rand() * 0.8;
      this.botThink(p);
    }
  }

  nearestEnemy(x, y, excludeId, skipShielded = false) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive || p.id === excludeId || (skipShielded && this.isShielded(p))) continue;
      const d = dist(x, y, p.core.x, p.core.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  botThink(p) {
    const age = this.time - p.spawnTime;
    const structures = [...this.towers.values()].filter((t) => t.owner === p.id);
    const towers = structures.filter((t) => t.kind === 'tower');
    const barracks = structures.length - towers.length;
    const troops = [...this.units.values()].filter((u) => u.owner === p.id);
    const roll = this.rand();

    // Expand: leapfrog towers outward from the core or an existing tower.
    if (towers.length < Math.min(5, 1 + Math.floor(age / 45)) && p.gold >= C.TOWERS.tower.cost + 40 && roll < 0.4) {
      const bases = [p.core, ...towers];
      const base = bases[Math.floor(this.rand() * bases.length)];
      for (let i = 0; i < 25; i++) {
        const ang = this.rand() * Math.PI * 2;
        const r = 5 + this.rand() * 3;
        const x = Math.round(base.x + Math.cos(ang) * r);
        const y = Math.round(base.y + Math.sin(ang) * r);
        if (this.inBounds(x, y) && this.build(p.id, x, y, 'tower') === null) break;
      }
      return;
    }

    // Bigger waves: build barracks near the core once a couple of towers are up.
    const bCost = C.buildCost('barracks', barracks);
    if (barracks < C.MAX_BARRACKS && towers.length >= Math.min(2, 1 + barracks) && p.gold >= bCost && roll < 0.6) {
      for (let i = 0; i < 25; i++) {
        const ang = this.rand() * Math.PI * 2;
        const r = 2 + this.rand() * 3;
        const x = Math.round(p.core.x + Math.cos(ang) * r);
        const y = Math.round(p.core.y + Math.sin(ang) * r);
        if (this.inBounds(x, y) && this.build(p.id, x, y, 'barracks') === null) break;
      }
      return;
    }

    // Shape the wave: assign free slots to a mix of troop types (free), then buy levels.
    const assigned = this.slotsUsed(p);
    if (assigned < this.waveSize(p)) {
      const r = this.rand();
      const kind = !p.army.scout ? 'scout' : r < 0.55 ? 'soldier' : r < 0.75 ? 'medic' : 'giant';
      if (this.armyAdd(p.id, kind)) this.armyAdd(p.id, 'soldier'); // e.g. no room for a giant
    } else if (p.gold >= 120 && roll < 0.7) {
      const kinds = UNIT_KEYS.filter((k) => p.army[k] > 0 && p.levels[k] < C.MAX_LEVEL);
      if (kinds.length) this.armyLevel(p.id, kinds[Math.floor(this.rand() * kinds.length)]);
    }

    // Upgrade towers when rich.
    if (p.gold > 400 && towers.length && roll < 0.2) {
      this.upgrade(p.id, towers[Math.floor(this.rand() * towers.length)].id);
    }

    // Orders.
    if (this.time < p.bot.nextOrder) return;
    p.bot.nextOrder = this.time + 8 + this.rand() * 6;
    const intruders = [...this.units.values()].filter((u) => u.owner !== p.id
      && this.terr[this.idx(Math.floor(u.x), Math.floor(u.y))] === p.id);
    if (intruders.length >= 3) {
      // Defend whichever of our structures is closest to the intruders.
      const cx = intruders.reduce((sum, u) => sum + u.x, 0) / intruders.length;
      const cy = intruders.reduce((sum, u) => sum + u.y, 0) / intruders.length;
      let anchor = { k: 'c', id: p.id };
      let bestD = dist(cx, cy, p.core.x, p.core.y);
      for (const t of towers) {
        const d = dist(cx, cy, t.x, t.y);
        if (d < bestD) {
          bestD = d;
          anchor = { k: 't', id: t.id };
        }
      }
      this.order(p.id, null, anchor);
      return;
    }
    // Keep a small squad farming the nearest jungle camp (it pays well).
    let home = troops.filter((u) => !u.attack);
    const jungling = troops.some((u) => u.attack && u.attack.k === 'j');
    if (!jungling && home.length >= 4) {
      const campScore = (c) => dist(c.x, c.y, p.core.x, p.core.y) - (C.BUFF_CAMPS.includes(c.type) ? 8 : 0);
      const camp = this.camps
        .filter((c) => c.alive && dist(c.x, c.y, p.core.x, p.core.y) < BOT_JUNGLE_RANGE)
        // Golem camps are worth a detour: they give the jungle buff.
        .sort((c1, c2) => campScore(c1) - campScore(c2))[0];
      if (camp) {
        const squad = home.slice(0, Math.max(3, Math.round(home.length * C.BOT_JUNGLE_SHARE)));
        this.order(p.id, squad.map((u) => u.id), { k: 'j', id: camp.id });
        home = home.filter((u) => !squad.includes(u));
      }
    }

    // Attack with a strike force, keeping new waves at home to defend.
    const enemy = this.nearestEnemy(p.core.x, p.core.y, p.id, true);
    if (enemy && this.suddenDeath()) {
      // Sudden death: everything, including new waves, goes for the nearest rival's core.
      this.order(p.id, null, { k: 'c', id: enemy.id });
      return;
    }
    if (enemy && home.length >= Math.max(8, C.unitCap(p.territory, this.waveSize(p)) * 0.5)) {
      let target = { k: 'c', id: enemy.id };
      let bestD = Infinity;
      for (const t of this.towers.values()) {
        if (t.owner !== enemy.id) continue;
        const d = dist(p.core.x, p.core.y, t.x, t.y);
        if (d < bestD) {
          bestD = d;
          target = { k: 't', id: t.id };
        }
      }
      const strike = home.slice(0, Math.ceil(home.length * C.BOT_STRIKE_SHARE)).map((u) => u.id);
      this.order(p.id, strike, target);
      p.order = { type: 'defend', anchor: 0 };
      return;
    }
  }

  // ---------------------------------------------------------------- tick

  update(dt) {
    if (this.phase === 'over') return; // the round is decided: the map freezes under the scoreboard
    this.time += dt;

    if (this.suddenDeath()) {
      for (const p of this.players.values()) {
        if (p.alive) p.core.hp = Math.max(1, p.core.hp - p.core.maxHp * C.SUDDEN_DEATH_DECAY * dt);
      }
    }

    for (const p of this.players.values()) {
      if (p.alive) this.award(p, C.income(p.territory) * dt, 'income');
    }

    this.updateWaves();
    this.buildUnitGrid();
    this.updateBots();
    this.updateUnits(dt);
    this.updateStructures(dt);
    this.updateCaptures(dt);
    this.updateCreeps(dt);

    for (const t of this.towers.values()) {
      if (t.ruin && this.time - t.ruinTime > C.RUIN_LIFETIME) this.removeTower(t);
    }
    if (this.time >= this.pruneAt) {
      this.pruneAt = this.time + 5;
      for (const [goal, f] of this.fields) if (this.time - f.used > 10) this.fields.delete(goal);
    }

    if (this.terrDirty) this.recomputeTerritory();
    this.visionTick = (this.visionTick || 0) + 1;
    if (this.visionTick % 2 === 0) this.updateVision();
    this.checkRoundOver();
  }

  // Shared (non-personal) part of the state broadcast. Clears per-tick fx/feed.
  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      players.push([p.id, p.name, p.hue, p.core.x, p.core.y, Math.max(0, Math.round(p.core.hp)), p.core.maxHp,
        p.territory, p.kills, p.isBot ? 1 : 0, this.isShielded(p) ? Math.ceil(C.SPAWN_SHIELD - (this.time - p.spawnTime)) : 0,
        Math.max(0, Math.ceil(p.buffUntil - this.time))]);
    }
    const towers = [];
    for (const t of this.towers.values()) {
      towers.push([t.id, KIND_KEYS.indexOf(t.kind), t.x, t.y, t.owner, t.level, Math.ceil(t.hp), t.maxHp, t.ruinOf || 0,
        t.capBy || 0, t.cap ? Math.round(t.cap * 100) : 0]);
    }
    const units = [];
    for (const u of this.units.values()) {
      const a = u.attack;
      // positions in tenths of a tile; max HP follows from kind + level on the client
      units.push([u.id, UNIT_KEYS.indexOf(u.kind), Math.round(u.x * 10), Math.round(u.y * 10), u.owner, u.level, Math.ceil(u.hp), u.anchor,
        a ? `${a.k}:${a.id}` : 0]);
    }
    const creeps = [];
    for (const c of this.creeps.values()) {
      creeps.push([c.id, CREEP_KEYS.indexOf(c.kind), Math.round(c.x * 10), Math.round(c.y * 10), c.angry, Math.ceil((100 * c.hp) / c.maxHp), c.camp]);
    }
    const camps = this.camps.map((c) => [c.id, c.x, c.y, CAMP_KEYS.indexOf(c.type), c.alive ? 1 : 0,
      c.alive ? 0 : Math.max(0, Math.ceil(c.respawnAt - this.time))]);
    const snap = { players, towers, units, creeps, camps, fx: this.fx, feed: this.feed };
    if (this.rounds) {
      snap.round = {
        n: this.round, phase: this.phase, t: Math.floor(this.time),
        join: Math.max(0, Math.ceil(C.ROUND_JOIN_WINDOW - this.time)),
        sd: Math.ceil(C.ROUND_SUDDEN_DEATH - this.time), // <= 0: sudden death is on
      };
    }
    this.fx = [];
    this.feed = [];
    return snap;
  }

  // Personal state for one player (sent only to them).
  personal(p) {
    const order = p.order.type === 'defend'
      ? { type: 'defend', target: p.order.anchor ? `t:${p.order.anchor}` : `c:${p.id}` }
      : { type: 'attack', target: `${p.order.target.k}:${p.order.target.id}` };
    return {
      id: p.id,
      gold: Math.floor(p.gold),
      nextWave: Math.max(0, Math.ceil(p.nextWaveAt - this.time)),
      waveSize: this.waveSize(p),
      army: p.army,
      levels: p.levels,
      order,
    };
  }
}

Game.KIND_KEYS = KIND_KEYS;
Game.UNIT_KEYS = UNIT_KEYS;
Game.CREEP_KEYS = CREEP_KEYS;
Game.CAMP_KEYS = CAMP_KEYS;

module.exports = Game;
