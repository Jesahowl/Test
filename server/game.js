'use strict';

// Authoritative game simulation for Territory Siege.
// Positions are in tiles. A structure on tile (x, y) has its centre at (x + 0.5, y + 0.5).
// Structures (cores, beacons) sit on the grid; units (bolt, frost, mortar) move freely within
// their owner's land, guarding an anchor (the core or a beacon).

const C = require('../shared/config');
const Path = require('../shared/pathfinding');

const BOT_NAMES = [
  'Ironclad', 'Warden', 'Bulwark', 'Rampart', 'Sentinel', 'Citadel', 'Palisade', 'Keepr',
  'Moatzilla', 'TurretTom', 'Bastille', 'Gatekeep', 'Stonewall', 'Outpost', 'Redoubt', 'Barbican',
];

const KIND_KEYS = Object.keys(C.TOWERS);
const UNIT_KEYS = Object.keys(C.UNITS);
const CREEP_KEYS = Object.keys(C.CREEPS);

// 8-way neighbour offsets for unit path planning.
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

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

class Game {
  constructor(opts = {}) {
    this.w = C.MAP_W;
    this.h = C.MAP_H;
    this.rand = opts.rand || Math.random;
    this.botTarget = opts.botTarget ?? C.BOT_TARGET;

    this.players = new Map();
    this.towers = new Map(); // fixed structures (beacons)
    this.units = new Map(); // mobile defenders
    this.creeps = new Map();

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
    this.fields = new Map(); // target player id -> { dist, version, at }

    // Scratch buffers for unit BFS (stamp-based so they never need clearing).
    this.bfsStamp = new Int32Array(this.w * this.h);
    this.bfsParent = new Int32Array(this.w * this.h);
    this.bfsQueue = new Int32Array(this.w * this.h);
    this.bfsGen = 0;

    this.nextId = 1;
    this.time = 0;
    this.botSpawnAt = 1;

    this.fx = []; // visual effects produced this tick
    this.feed = []; // kill-feed messages produced this tick

    // Hook: called as onDeath(player, info) when a player's core is destroyed.
    this.onDeath = null;

    this.recomputeTerritory();
  }

  idx(x, y) {
    return y * this.w + x;
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
    const p = {
      id,
      name: sanitizeName(name),
      isBot,
      alive: true,
      hue: Math.round((id * 137.508) % 360),
      gold: C.START_GOLD,
      core: { x: pos.x, y: pos.y, hp: C.CORE_HP, maxHp: C.CORE_HP },
      territory: 0,
      peakTerritory: 0,
      kills: 0,
      coresDestroyed: 0,
      spawnTime: this.time,
      nextWave: this.time + C.FIRST_WAVE_DELAY,
      waveNum: 0,
      bot: isBot ? { next: this.time + 1, nextAttack: this.time + 25 + this.rand() * 25, nextCapture: this.time + 60 } : null,
    };
    this.players.set(id, p);
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

  // Removes a player (disconnect) - their base turns into ruins like a death.
  removePlayer(id) {
    const p = this.players.get(id);
    if (p) this.killPlayer(p, null, true);
  }

  killPlayer(p, killerId, leftGame = false) {
    if (!p.alive) return;
    p.alive = false;
    this.grid[this.idx(p.core.x, p.core.y)] = 0;
    this.fx.push({ k: 'coreDown', x: p.core.x + 0.5, y: p.core.y + 0.5 });

    for (const t of this.towers.values()) {
      if (t.owner === p.id) {
        t.owner = 0;
        t.cap = 0;
        t.capBy = 0;
        t.ruin = true;
        t.ruinOf = p.name;
        t.ruinTime = this.time;
      }
    }
    for (const u of this.units.values()) {
      if (u.owner === p.id) this.units.delete(u.id);
    }
    for (const c of this.creeps.values()) {
      if (c.owner === p.id) c.dead = true;
    }

    const killer = killerId ? this.players.get(killerId) : null;
    let bounty = 0;
    if (killer && killer.alive && killer.id !== p.id) {
      bounty = C.CORE_KILL_BOUNTY + Math.floor(p.gold * 0.5);
      killer.gold += bounty;
      killer.coresDestroyed++;
      this.pushFeed(`${killer.name} destroyed ${p.name}'s core (+${bounty}g)`);
    } else if (leftGame) {
      this.pushFeed(`${p.name} left - their base lies in ruins`);
    } else {
      this.pushFeed(`${p.name}'s core was overrun`);
    }

    this.players.delete(p.id);
    this.fields.delete(p.id);
    this.terrDirty = true;
    this.structVersion++;

    if (this.onDeath && !leftGame) {
      this.onDeath(p, {
        killer: killer && killer.id !== p.id ? killer.name : null,
        survived: Math.round(this.time - p.spawnTime),
        peakTerritory: p.peakTerritory,
        kills: p.kills,
        coresDestroyed: p.coresDestroyed,
      });
    }
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
      if (t.kind === 'beacon' && t.owner) {
        sources.push({ x: t.x, y: t.y, r: C.towerStats('beacon', t.level).claim, owner: t.owner, weight: 1 });
      }
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
          // Cores hold their nearby land more strongly than beacons.
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

  // ---------------------------------------------------------------- actions

  // Place a beacon, or buy a unit. Units guard `anchorId` (a beacon id, or 0 for the core);
  // without one they guard whichever of your anchors is nearest to where they were placed.
  build(pid, x, y, kind, anchorId) {
    const p = this.players.get(pid);
    const def = C.defOf(kind);
    if (!p || !p.alive || !def) return 'Invalid build';
    if (!Number.isInteger(x) || !Number.isInteger(y) || !this.inBounds(x, y)) return 'Out of bounds';
    const k = this.idx(x, y);
    const isUnit = !!C.UNITS[kind];
    if (this.terr[k] !== pid) {
      if (isUnit) return 'You can only place units on your own land';
      if (this.terr[k] !== 0) return 'You cannot build on enemy land';
      if (!this.withinLeap(pid, x, y)) return `Beacons can leap at most ${C.BEACON_LEAP} tiles beyond your border`;
    }
    if (this.grid[k] !== 0) return 'Tile is occupied';
    if (isUnit) {
      let count = 0;
      for (const u of this.units.values()) if (u.owner === pid) count++;
      if (count >= C.MAX_UNITS) return `Unit limit reached (${C.MAX_UNITS})`;
    }
    if (p.gold < def.cost) return 'Not enough gold';
    p.gold -= def.cost;
    const id = this.nextId++;
    const stats = C.towerStats(kind, 1);
    if (isUnit) {
      const anchor = this.isValidAnchor(pid, anchorId) ? anchorId : this.nearestAnchor(p, x + 0.5, y + 0.5);
      this.units.set(id, {
        isUnit: true, id, kind, owner: pid, x: x + 0.5, y: y + 0.5, level: 1, hp: stats.hp, maxHp: stats.hp, cd: 0,
        anchor, capture: 0, path: [], dest: null, repathAt: 0, idleUntil: this.time + 0.5,
      });
      return null;
    }
    this.towers.set(id, {
      id, kind, x, y, owner: pid, level: 1, hp: stats.hp, maxHp: stats.hp, ruin: false,
    });
    this.grid[k] = id;
    this.structVersion++;
    this.terrDirty = true;
    return null;
  }

  // Is unclaimed tile (x, y) within BEACON_LEAP tiles of pid's land?
  withinLeap(pid, x, y) {
    const r = C.BEACON_LEAP;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.hypot(dx, dy) > r + 0.01 || !this.inBounds(x + dx, y + dy)) continue;
        if (this.terr[this.idx(x + dx, y + dy)] === pid) return true;
      }
    }
    return false;
  }

  // Can pid's units stand within capture range of beacon t (on pid's own open land)?
  canReachForCapture(pid, t) {
    const r = Math.floor(C.CAPTURE_RANGE);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = t.x + dx;
        const y = t.y + dy;
        if (!this.inBounds(x, y) || Math.hypot(dx, dy) > C.CAPTURE_RANGE - 0.2) continue;
        if (this.walkable(this.idx(x, y), pid)) return true;
      }
    }
    return false;
  }

  // Order units to occupy (capture) an enemy beacon.
  occupy(pid, ids, beaconId) {
    const p = this.players.get(pid);
    const t = this.towers.get(beaconId);
    if (!p || !p.alive || !Array.isArray(ids)) return 'Invalid order';
    if (!t || !t.owner || t.owner === pid || t.kind !== 'beacon') return 'Units can only capture enemy beacons';
    if (!this.canReachForCapture(pid, t)) {
      return `Too far: your land must reach within ${C.CAPTURE_RANGE} tiles of that beacon`;
    }
    let n = 0;
    for (const id of ids.slice(0, C.MAX_UNITS)) {
      const u = this.units.get(id);
      if (!u || u.owner !== pid) continue;
      u.capture = t.id;
      u.path = [];
      u.dest = null;
      u.repathAt = 0;
      n++;
    }
    return n ? null : 'No units selected';
  }

  // A unit or a structure owned by pid.
  ownedThing(pid, id) {
    const t = this.towers.get(id);
    if (t && t.owner === pid) return t;
    const u = this.units.get(id);
    if (u && u.owner === pid) return u;
    return null;
  }

  upgrade(pid, id) {
    const p = this.players.get(pid);
    const t = this.ownedThing(pid, id);
    if (!p || !p.alive || !t) return 'Invalid upgrade';
    if (t.level >= C.MAX_LEVEL) return 'Already max level';
    const cost = C.upgradeCost(t.kind, t.level);
    if (p.gold < cost) return 'Not enough gold';
    p.gold -= cost;
    t.level++;
    const stats = C.towerStats(t.kind, t.level);
    t.hp += stats.hp - t.maxHp;
    t.maxHp = stats.hp;
    if (this.towers.has(t.id)) {
      this.structVersion++;
      this.terrDirty = true;
    }
    return null;
  }

  sell(pid, id) {
    const p = this.players.get(pid);
    const t = this.ownedThing(pid, id);
    if (!p || !p.alive || !t) return 'Invalid sell';
    p.gold += C.sellValue(t.kind, t.level);
    if (this.units.has(t.id)) this.units.delete(t.id);
    else this.destroyTower(t, false);
    return null;
  }

  // Send units to guard a beacon (anchorId) or the core (anchorId 0).
  assign(pid, ids, anchorId) {
    const p = this.players.get(pid);
    if (!p || !p.alive || !Array.isArray(ids)) return 'Invalid assignment';
    if (!this.isValidAnchor(pid, anchorId)) return 'Units can only guard your core or your beacons';
    let n = 0;
    for (const id of ids.slice(0, C.MAX_UNITS)) {
      const u = this.units.get(id);
      if (!u || u.owner !== pid) continue;
      u.anchor = anchorId;
      u.capture = 0;
      u.path = [];
      u.dest = null;
      u.idleUntil = 0;
      n++;
    }
    return n ? null : 'No units selected';
  }

  isValidAnchor(pid, anchorId) {
    if (anchorId === 0) return true;
    const t = this.towers.get(anchorId);
    return !!t && t.kind === 'beacon' && t.owner === pid;
  }

  nearestAnchor(p, x, y) {
    let best = 0;
    let bestD = dist(x, y, p.core.x + 0.5, p.core.y + 0.5);
    for (const t of this.towers.values()) {
      if (t.owner !== p.id || t.kind !== 'beacon') continue;
      const d = dist(x, y, t.x + 0.5, t.y + 0.5);
      if (d < bestD) {
        bestD = d;
        best = t.id;
      }
    }
    return best;
  }

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
    if (t.kind === 'beacon') this.terrDirty = true;
    return null;
  }

  send(pid, kind, targetId) {
    const p = this.players.get(pid);
    const def = C.CREEPS[kind];
    if (!p || !p.alive || !def) return 'Invalid send';
    if (p.gold < def.cost) return 'Not enough gold';
    let owned = 0;
    for (const c of this.creeps.values()) if (c.owner === pid) owned++;
    if (owned >= C.MAX_CREEPS_PER_PLAYER) return 'Too many creeps in the field';
    let target = this.players.get(targetId);
    if (!target || !target.alive || target.id === pid) target = this.nearestEnemy(p.core.x, p.core.y, pid);
    if (!target) return 'No one to attack';
    p.gold -= def.cost;
    this.spawnCreep(kind, pid, target.id, p.core.x + 0.5, p.core.y + 0.5, 1);
    return null;
  }

  nearestEnemy(x, y, excludeId) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive || p.id === excludeId) continue;
      const d = dist(x, y, p.core.x, p.core.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  spawnCreep(kind, owner, target, x, y, hpMul) {
    const def = C.CREEPS[kind];
    const id = this.nextId++;
    const hp = Math.round(def.hp * hpMul);
    this.creeps.set(id, {
      id, kind, owner, target,
      x: x + (this.rand() - 0.5) * 0.6,
      y: y + (this.rand() - 0.5) * 0.6,
      hp, maxHp: hp, slowT: 0, slowF: 1, atkCd: 0, dead: false,
    });
  }

  spawnNeutralWave(p) {
    p.waveNum++;
    const n = 2 + Math.floor(p.waveNum * 0.9);
    const hpMul = 1 + p.waveNum * 0.17;
    const a = this.rand() * Math.PI * 2;
    const clamp = (v, max) => Math.max(1, Math.min(max - 2, v));
    const sx = clamp(p.core.x + Math.cos(a) * C.NEUTRAL_SPAWN_DIST, this.w);
    const sy = clamp(p.core.y + Math.sin(a) * C.NEUTRAL_SPAWN_DIST, this.h);
    for (let i = 0; i < n; i++) {
      const kind = p.waveNum >= 3 && i % 3 === 2 ? 'runner' : 'grunt';
      this.spawnCreep(kind, 0, p.id, sx + this.rand() * 1.5, sy + this.rand() * 1.5, hpMul);
    }
    for (let i = 0; i < Math.floor(p.waveNum / 4); i++) {
      this.spawnCreep('brute', 0, p.id, sx, sy, hpMul);
    }
  }

  // ---------------------------------------------------------------- combat

  damageCreep(c, amount, byPid) {
    if (c.dead) return;
    c.hp -= amount;
    if (c.hp <= 0) {
      c.dead = true;
      const p = this.players.get(byPid);
      if (p && p.alive) {
        p.gold += C.CREEPS[c.kind].bounty;
        p.kills++;
      }
    }
  }

  damageCore(p, amount, byPid) {
    p.core.hp -= amount;
    this.fx.push({ k: 'hit', x: p.core.x + 0.5, y: p.core.y + 0.5 });
    if (p.core.hp <= 0) this.killPlayer(p, byPid);
  }

  damageTower(t, amount) {
    t.hp -= amount;
    this.fx.push({ k: 'hit', x: t.x + 0.5, y: t.y + 0.5 });
    if (t.hp <= 0) this.destroyTower(t, true);
  }

  damageUnit(u, amount) {
    u.hp -= amount;
    this.fx.push({ k: 'hit', x: round2(u.x), y: round2(u.y) });
    if (u.hp <= 0 && this.units.has(u.id)) {
      this.units.delete(u.id);
      this.fx.push({ k: 'boom', x: round2(u.x), y: round2(u.y), r: 0.6 });
    }
  }

  destroyTower(t, explode) {
    this.towers.delete(t.id);
    this.grid[this.idx(t.x, t.y)] = 0;
    this.structVersion++;
    if (explode) this.fx.push({ k: 'boom', x: t.x + 0.5, y: t.y + 0.5, r: 0.8 });
    if (t.kind === 'beacon' && t.owner) this.terrDirty = true;
  }

  // ---------------------------------------------------------------- units

  // Where unit u is anchored: its beacon if still standing and owned, else its owner's core.
  anchorOf(u) {
    if (u.anchor) {
      const t = this.towers.get(u.anchor);
      if (t && t.owner === u.owner && t.kind === 'beacon') {
        return { x: t.x + 0.5, y: t.y + 0.5, leash: C.UNIT_LEASH_BEACON };
      }
      u.anchor = 0; // beacon lost: fall back to guarding the core
    }
    const p = this.players.get(u.owner);
    return { x: p.core.x + 0.5, y: p.core.y + 0.5, leash: C.UNIT_LEASH_CORE };
  }

  walkable(k, owner) {
    return this.terr[k] === owner && this.grid[k] === 0;
  }

  // Plan a path for u toward (gx, gy) over its owner's open land (BFS, no corner cutting past
  // structures). If the point itself can't be reached, head for the reachable tile nearest to it.
  // With `assault` (an enemy beacon under a capture order) the unit may also storm the enemy's
  // open tiles within CAPTURE_RANGE of that beacon.
  planUnit(u, gx, gy, assault = null) {
    const ok = assault
      ? (n) => this.walkable(n, u.owner) || (this.walkable(n, assault.owner)
        && dist((n % this.w) + 0.5, Math.floor(n / this.w) + 0.5, assault.x + 0.5, assault.y + 0.5) <= C.CAPTURE_RANGE)
      : (n) => this.walkable(n, u.owner);
    const w = this.w;
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
    // Stranded outside our land (territory shrank) with nowhere to walk: head straight home.
    if (!path.length && !ok(start)) {
      const a = this.anchorOf(u);
      u.dest = { x: a.x, y: a.y };
    }
  }

  // Advance u along its path. Returns true when it arrives at its destination.
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

  // Damage a creep or an enemy unit.
  hurt(obj, amount, byPid) {
    if (obj.isUnit) this.damageUnit(obj, amount);
    else this.damageCreep(obj, amount, byPid);
  }

  // Every enemy creep and enemy unit, for area damage.
  *foesOf(pid) {
    for (const c of this.creeps.values()) if (!c.dead && c.owner !== pid) yield c;
    for (const u of this.units.values()) if (u.owner !== pid && u.hp > 0) yield u;
  }

  unitFire(u, target, s, def) {
    u.cd = 1 / s.rate;
    if (def.aoe) {
      for (const f of [...this.foesOf(u.owner)]) {
        if (dist(u.x, u.y, f.x, f.y) > s.range) continue;
        if (!f.isUnit) {
          f.slowT = def.slowTime;
          f.slowF = def.slow;
        }
        this.hurt(f, s.damage, u.owner);
      }
      this.fx.push({ k: 'frost', x: round2(u.x), y: round2(u.y), r: s.range });
    } else if (def.splash) {
      for (const f of [...this.foesOf(u.owner)]) {
        if (dist(target.x, target.y, f.x, f.y) <= def.splash) this.hurt(f, s.damage, u.owner);
      }
      this.fx.push({ k: 'shell', x1: round2(u.x), y1: round2(u.y), x2: round2(target.x), y2: round2(target.y), r: def.splash });
    } else {
      this.hurt(target, s.damage, u.owner);
      this.fx.push({ k: 'bolt', x1: round2(u.x), y1: round2(u.y), x2: round2(target.x), y2: round2(target.y), o: u.owner });
    }
  }

  updateUnits(dt) {
    for (const u of this.units.values()) {
      if (u.hp <= 0) continue;
      const def = C.UNITS[u.kind];
      const s = C.towerStats(u.kind, u.level);
      const a = this.anchorOf(u);
      const minRange = def.minRange || 0;
      u.cd -= dt;

      // Drop a capture order that no longer makes sense.
      let capT = null;
      if (u.capture) {
        capT = this.towers.get(u.capture);
        if (!capT || !capT.owner || capT.owner === u.owner) {
          u.capture = 0;
          capT = null;
          u.path = [];
          u.dest = null;
        }
      }

      // 1. Anything (enemy creep or enemy unit) already in range? Stand and shoot.
      let shoot = null;
      let shootD = Infinity;
      for (const f of this.foesOf(u.owner)) {
        const d = dist(u.x, u.y, f.x, f.y);
        if (d <= s.range && d >= minRange && d < shootD) {
          shootD = d;
          shoot = f;
        }
      }
      if (shoot) {
        u.path = [];
        u.dest = null;
        if (u.cd <= 0) this.unitFire(u, shoot, s, def);
        continue;
      }

      // 2. Occupation order: walk to the spot on our land nearest the target beacon and hold it.
      if (capT) {
        if (this.time >= u.repathAt || (!u.dest && dist(u.x, u.y, capT.x + 0.5, capT.y + 0.5) > 1.5)) {
          this.planUnit(u, capT.x + 0.5, capT.y + 0.5, capT);
          u.repathAt = this.time + 1;
        }
        this.moveUnit(u, dt, def.speed);
        continue;
      }

      // 3. Chase enemy creeps that threaten our patch, staying on the leash.
      let target = null;
      let bestD = Infinity;
      for (const c of this.creeps.values()) {
        if (c.dead || c.owner === u.owner) continue;
        if (dist(a.x, a.y, c.x, c.y) > a.leash + s.range) continue;
        const d = dist(u.x, u.y, c.x, c.y);
        if (d < bestD) {
          bestD = d;
          target = c;
        }
      }
      if (target) {
        // Close the distance (or back off, for a mortar that's too close), staying on the leash.
        let gx = target.x;
        let gy = target.y;
        if (bestD < minRange) {
          const k = (minRange + 0.5) / Math.max(bestD, 0.01);
          gx = target.x + (u.x - target.x) * k;
          gy = target.y + (u.y - target.y) * k;
        }
        const da = dist(a.x, a.y, gx, gy);
        if (da > a.leash) {
          gx = a.x + ((gx - a.x) / da) * a.leash;
          gy = a.y + ((gy - a.y) / da) * a.leash;
        }
        if (this.time >= u.repathAt || !u.dest) {
          this.planUnit(u, gx, gy);
          u.repathAt = this.time + C.UNIT_REPATH;
        }
        this.moveUnit(u, dt, def.speed);
        continue;
      }

      // 4. No threat: patrol around the anchor.
      if (u.dest) {
        if (this.moveUnit(u, dt, def.speed)) u.idleUntil = this.time + 0.8 + this.rand() * 2;
        continue;
      }
      const k = this.idx(Math.floor(u.x), Math.floor(u.y));
      if (dist(u.x, u.y, a.x, a.y) > a.leash + 0.75 || !this.inBounds(Math.floor(u.x), Math.floor(u.y)) || this.terr[k] !== u.owner) {
        this.planUnit(u, a.x, a.y); // wandered off (reassigned, captured elsewhere, or land shrank): go home
        continue;
      }
      if (this.time < u.idleUntil) continue;
      const ang = this.rand() * Math.PI * 2;
      const r = a.leash * Math.sqrt(this.rand());
      this.planUnit(u, a.x + Math.cos(ang) * r, a.y + Math.sin(ang) * r);
      u.idleUntil = this.time + 0.5;
    }
  }

  // Occupation: units near an enemy beacon slowly take it over, unless its owner's units are there.
  updateCaptures(dt) {
    for (const t of this.towers.values()) {
      if (!t.owner) continue;
      const cx = t.x + 0.5;
      const cy = t.y + 0.5;
      const counts = new Map();
      for (const u of this.units.values()) {
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
      if (!defended && attacker) {
        if (t.capBy !== attacker) {
          t.capBy = attacker; // a new challenger starts from scratch
          t.cap = 0;
        }
        t.cap += (dt * (1 + C.CAPTURE_EXTRA_UNIT_SPEED * (most - 1))) / C.CAPTURE_TIME;
        if (t.cap >= 1) this.transferBeacon(t, attacker);
      } else if (t.cap) {
        // Contested or abandoned: progress drains away.
        t.cap = Math.max(0, t.cap - dt / C.CAPTURE_TIME);
        if (!t.cap) t.capBy = 0;
      }
    }
  }

  transferBeacon(t, newOwner) {
    const winner = this.players.get(newOwner);
    const loser = this.players.get(t.owner);
    t.owner = newOwner;
    t.cap = 0;
    t.capBy = 0;
    this.structVersion++;
    this.terrDirty = true;
    this.fx.push({ k: 'capture', x: t.x + 0.5, y: t.y + 0.5, o: newOwner });
    // The occupying squad stays on as the beacon's new guard.
    for (const u of this.units.values()) {
      if (u.owner === newOwner && u.capture === t.id) {
        u.capture = 0;
        u.anchor = t.id;
      }
    }
    if (winner && loser) this.pushFeed(`${winner.name} captured a beacon from ${loser.name}`);
  }

  // ---------------------------------------------------------------- pathfinding

  // Per-tile extra cost of walking into a tile. Beacons and cores are costly; ruins are rubble.
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

  // Flow field toward player pid's core. Rebuilt lazily, at most every PATH_RECOMPUTE_INTERVAL.
  getField(p) {
    let f = this.fields.get(p.id);
    const stale = !f || (f.version !== this.structVersion && this.time - f.at >= C.PATH_RECOMPUTE_INTERVAL);
    if (stale) {
      const goal = this.idx(p.core.x, p.core.y);
      f = { dist: Path.computeField(this.w, this.h, this.getExtra(), goal), goal, version: this.structVersion, at: this.time };
      this.fields.set(p.id, f);
    }
    return f;
  }

  // Attack whatever enemy structure sits on tile k. Returns true if the creep is busy attacking.
  creepAttackTile(c, k, target, damage) {
    const s = this.grid[k];
    if (s > 0) {
      const t = this.towers.get(s);
      if (!t || !t.owner || t.owner === c.owner) return false;
      if (c.atkCd <= 0) {
        c.atkCd = 1;
        this.damageTower(t, damage);
      }
      return true;
    }
    if (s < 0 && -s !== c.owner && -s !== target.id) {
      const blocker = this.players.get(-s);
      if (!blocker || !blocker.alive) return false;
      if (c.atkCd <= 0) {
        c.atkCd = 1;
        this.damageCore(blocker, damage, c.owner);
      }
      return true;
    }
    return false;
  }

  updateCreeps(dt) {
    for (const c of this.creeps.values()) {
      if (c.dead) continue;
      const target = this.players.get(c.target);
      if (!target || !target.alive) {
        // Target fell: the attackers disperse rather than swarming the nearest (often brand-new) player.
        c.dead = true;
        this.fx.push({ k: 'hit', x: round2(c.x), y: round2(c.y) });
        continue;
      }
      const def = C.CREEPS[c.kind];
      c.atkCd -= dt;
      if (c.slowT > 0) c.slowT -= dt;
      const speed = def.speed * (c.slowT > 0 ? c.slowF : 1);

      const cx = target.core.x + 0.5;
      const cy = target.core.y + 0.5;
      if (Math.hypot(cx - c.x, cy - c.y) < 0.9) {
        if (c.atkCd <= 0) {
          c.atkCd = 1;
          this.damageCore(target, def.damage, c.owner);
        }
        continue;
      }

      // Brawl with any enemy unit we bump into: units body-block creeps.
      let foe = null;
      let foeD = C.CREEP_UNIT_REACH;
      for (const u of this.units.values()) {
        if (u.owner === c.owner) continue;
        const d = dist(u.x, u.y, c.x, c.y);
        if (d < foeD) {
          foeD = d;
          foe = u;
        }
      }
      if (foe) {
        if (c.atkCd <= 0) {
          c.atkCd = 1;
          this.damageUnit(foe, def.damage);
        }
        continue;
      }

      // Divert to wreck an enemy beacon we pass near.
      let beacon = null;
      let beaconD = C.CREEP_AGGRO_RANGE;
      for (const t of this.towers.values()) {
        if (!t.owner || t.owner === c.owner) continue;
        const d = dist(t.x + 0.5, t.y + 0.5, c.x, c.y);
        if (d < beaconD) {
          beaconD = d;
          beacon = t;
        }
      }
      if (beacon) {
        if (beaconD < 0.95) {
          if (c.atkCd <= 0) {
            c.atkCd = 1;
            this.damageTower(beacon, def.damage);
          }
        } else {
          const step = Math.min(beaconD - 0.9, speed * dt);
          c.x += ((beacon.x + 0.5 - c.x) / beaconD) * step;
          c.y += ((beacon.y + 0.5 - c.y) / beaconD) * step;
        }
        continue;
      }

      // Follow the flow field one tile at a time.
      const field = this.getField(target);
      const tx = Math.max(0, Math.min(this.w - 1, Math.floor(c.x)));
      const ty = Math.max(0, Math.min(this.h - 1, Math.floor(c.y)));
      const here = this.idx(tx, ty);
      const next = Path.nextStep(field.dist, this.w, this.h, this.extra, here, field.goal);

      let gx = cx;
      let gy = cy;
      if (next >= 0 && next !== field.goal) {
        // The field routes through a structure only when going around is costlier: break it.
        if (this.creepAttackTile(c, next, target, def.damage)) continue;
        gx = (next % this.w) + 0.5;
        gy = Math.floor(next / this.w) + 0.5;
      }

      const dx = gx - c.x;
      const dy = gy - c.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      const step = Math.min(d, speed * dt);
      c.x += (dx / d) * step;
      c.y += (dy / d) * step;
    }
    for (const [id, c] of this.creeps) {
      if (c.dead) this.creeps.delete(id);
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
    if (bots < desired && this.time >= this.botSpawnAt) {
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

  // Random tile in p's land, between rMin and rMax from (cx, cy), preferring tiles closer to `toward`.
  botPickTile(p, cx, cy, rMin, rMax, toward) {
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < 25; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = rMin + this.rand() * (rMax - rMin);
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r);
      if (!this.inBounds(x, y)) continue;
      const k = this.idx(x, y);
      if (this.terr[k] !== p.id || this.grid[k] !== 0) continue;
      const score = (toward ? dist(x, y, toward.x, toward.y) : 0) + this.rand() * 4;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return best;
  }

  botThink(p) {
    const age = this.time - p.spawnTime;
    const beacons = [...this.towers.values()].filter((t) => t.owner === p.id);
    const units = [...this.units.values()].filter((u) => u.owner === p.id);
    const enemy = this.nearestEnemy(p.core.x, p.core.y, p.id);
    const roll = this.rand();

    // Expand: leapfrog outward from the core or an existing beacon.
    if (beacons.length < Math.min(5, 1 + Math.floor(age / 60)) && p.gold >= C.TOWERS.beacon.cost + 20 && roll < 0.35) {
      const bases = [p.core, ...beacons];
      const base = bases[Math.floor(this.rand() * bases.length)];
      for (let i = 0; i < 25; i++) {
        const ang = this.rand() * Math.PI * 2;
        const r = 5 + this.rand() * 3;
        const x = Math.round(base.x + Math.cos(ang) * r);
        const y = Math.round(base.y + Math.sin(ang) * r);
        if (this.inBounds(x, y) && this.build(p.id, x, y, 'beacon') === null) break;
      }
      return;
    }

    // Seize an enemy beacon: if one is in reach, send a squad; otherwise leap a siege beacon up to it.
    if (units.length >= 5 && p.gold >= 40 && this.time >= p.bot.nextCapture) {
      p.bot.nextCapture = this.time + 10 + this.rand() * 10;
      const enemyBeacons = [...this.towers.values()]
        .filter((t) => t.owner && t.owner !== p.id && dist(t.x, t.y, p.core.x, p.core.y) < 30)
        .sort((t1, t2) => dist(t1.x, t1.y, p.core.x, p.core.y) - dist(t2.x, t2.y, p.core.x, p.core.y));
      const prey = enemyBeacons.find((t) => this.canReachForCapture(p.id, t));
      if (prey) {
        if (![...this.units.values()].some((u) => u.owner === p.id && u.capture === prey.id)) {
          const squad = units
            .filter((u) => !u.capture)
            .sort((u1, u2) => dist(u1.x, u1.y, prey.x, prey.y) - dist(u2.x, u2.y, prey.x, prey.y))
            .slice(0, Math.max(3, Math.floor(units.length / 2)))
            .map((u) => u.id);
          if (squad.length) this.occupy(p.id, squad, prey.id);
        }
        p.bot.nextCapture = this.time + 25 + this.rand() * 20;
        return;
      }
      const near = enemyBeacons[0];
      if (near && p.gold >= C.TOWERS.beacon.cost) {
        for (let i = 0; i < 30; i++) {
          const ang = this.rand() * Math.PI * 2;
          const r = 5.3 + this.rand() * 1.5;
          const x = Math.round(near.x + Math.cos(ang) * r);
          const y = Math.round(near.y + Math.sin(ang) * r);
          if (this.inBounds(x, y) && this.build(p.id, x, y, 'beacon') === null) break;
        }
        return;
      }
    }

    // Attack
    if (enemy && this.time >= p.bot.nextAttack && p.gold >= 80) {
      p.bot.nextAttack = this.time + 12 + this.rand() * 18;
      const budget = p.gold * (0.5 + this.rand() * 0.4);
      let spent = 0;
      while (spent < budget) {
        const kind = CREEP_KEYS[Math.floor(this.rand() * CREEP_KEYS.length)];
        if (this.send(p.id, kind, enemy.id)) break;
        spent += C.CREEPS[kind].cost;
      }
      return;
    }

    // Upgrade when rich
    const owned = [...units, ...beacons];
    if (p.gold > 260 && owned.length && roll < 0.5) {
      this.upgrade(p.id, owned[Math.floor(this.rand() * owned.length)].id);
      return;
    }

    // Defend: buy a unit for whichever anchor is most under-guarded (the core counts double).
    if (p.gold >= 55 && units.length < Math.min(C.MAX_UNITS, 3 + age / 40)) {
      const r = this.rand();
      const kind = r < 0.5 ? 'bolt' : r < 0.75 ? 'frost' : 'mortar';
      if (p.gold < C.UNITS[kind].cost) return;
      const anchors = [{ id: 0, x: p.core.x, y: p.core.y, w: 2 }, ...beacons.map((t) => ({ id: t.id, x: t.x, y: t.y, w: 1 }))];
      let pick = anchors[0];
      let pickLoad = Infinity;
      for (const an of anchors) {
        const load = units.filter((u) => u.anchor === an.id).length / an.w + this.rand() * 0.1;
        if (load < pickLoad) {
          pickLoad = load;
          pick = an;
        }
      }
      const tile = this.botPickTile(p, pick.x, pick.y, 1, 2.5, null);
      if (tile) this.build(p.id, tile.x, tile.y, kind, pick.id);
    }
  }

  // ---------------------------------------------------------------- tick

  update(dt) {
    this.time += dt;

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      p.gold += (C.income(p.territory) * dt);
      if (this.time >= p.nextWave) {
        this.spawnNeutralWave(p);
        p.nextWave = this.time + C.NEUTRAL_WAVE_INTERVAL;
      }
    }

    this.updateBots();
    this.updateUnits(dt);
    this.updateCaptures(dt);
    this.updateCreeps(dt);

    for (const t of this.towers.values()) {
      if (t.ruin && this.time - t.ruinTime > C.RUIN_LIFETIME) this.destroyTower(t, false);
    }

    if (this.terrDirty) this.recomputeTerritory();
  }

  // Shared (non-personal) part of the state broadcast. Clears per-tick fx/feed.
  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      players.push([p.id, p.name, p.hue, p.core.x, p.core.y, Math.max(0, Math.round(p.core.hp)), p.core.maxHp,
        p.territory, p.kills, p.isBot ? 1 : 0]);
    }
    const towers = [];
    for (const t of this.towers.values()) {
      towers.push([t.id, KIND_KEYS.indexOf(t.kind), t.x, t.y, t.owner, t.level, Math.round(t.hp), t.maxHp, t.ruinOf || '',
        t.capBy || 0, t.cap ? round2(t.cap) : 0]);
    }
    const units = [];
    for (const u of this.units.values()) {
      units.push([u.id, UNIT_KEYS.indexOf(u.kind), round2(u.x), round2(u.y), u.owner, u.level, Math.round(u.hp), u.maxHp, u.anchor,
        u.capture || 0]);
    }
    const creeps = [];
    for (const c of this.creeps.values()) {
      creeps.push([c.id, CREEP_KEYS.indexOf(c.kind), round2(c.x), round2(c.y), c.owner, round2(c.hp / c.maxHp)]);
    }
    const snap = { players, towers, units, creeps, fx: this.fx, feed: this.feed };
    this.fx = [];
    this.feed = [];
    return snap;
  }
}

Game.KIND_KEYS = KIND_KEYS;
Game.UNIT_KEYS = UNIT_KEYS;
Game.CREEP_KEYS = CREEP_KEYS;

module.exports = Game;
