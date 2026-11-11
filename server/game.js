'use strict';

// Authoritative game simulation for Territory Siege.
// Units: positions are in tiles. A structure on tile (x, y) has its centre at (x + 0.5, y + 0.5).

const C = require('../shared/config');
const Path = require('../shared/pathfinding');

const BOT_NAMES = [
  'Ironclad', 'Warden', 'Bulwark', 'Rampart', 'Sentinel', 'Citadel', 'Palisade', 'Keepr',
  'Moatzilla', 'TurretTom', 'Bastille', 'Gatekeep', 'Stonewall', 'Outpost', 'Redoubt', 'Barbican',
];

const KIND_KEYS = Object.keys(C.TOWERS);
const CREEP_KEYS = Object.keys(C.CREEPS);

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
    this.towers = new Map();
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
      bot: isBot ? { next: this.time + 1, nextAttack: this.time + 25 + this.rand() * 25 } : null,
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
        t.ruin = true;
        t.ruinOf = p.name;
        t.ruinTime = this.time;
      }
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

  build(pid, x, y, kind) {
    const p = this.players.get(pid);
    const def = C.TOWERS[kind];
    if (!p || !p.alive || !def) return 'Invalid build';
    if (!Number.isInteger(x) || !Number.isInteger(y) || !this.inBounds(x, y)) return 'Out of bounds';
    const k = this.idx(x, y);
    if (this.terr[k] !== pid) return 'You can only build on your own land';
    if (this.grid[k] !== 0) return 'Tile is occupied';
    if (p.gold < def.cost) return 'Not enough gold';
    p.gold -= def.cost;
    const id = this.nextId++;
    const stats = C.towerStats(kind, 1);
    this.towers.set(id, {
      id, kind, x, y, owner: pid, level: 1, hp: stats.hp, maxHp: stats.hp, cd: 0, ruin: false,
    });
    this.grid[k] = id;
    this.structVersion++;
    if (kind === 'beacon') this.terrDirty = true;
    return null;
  }

  upgrade(pid, towerId) {
    const p = this.players.get(pid);
    const t = this.towers.get(towerId);
    if (!p || !p.alive || !t || t.owner !== pid) return 'Invalid upgrade';
    if (t.level >= C.MAX_LEVEL) return 'Already max level';
    const cost = C.upgradeCost(t.kind, t.level);
    if (p.gold < cost) return 'Not enough gold';
    p.gold -= cost;
    t.level++;
    const stats = C.towerStats(t.kind, t.level);
    t.hp += stats.hp - t.maxHp;
    t.maxHp = stats.hp;
    this.structVersion++;
    if (t.kind === 'beacon') this.terrDirty = true;
    return null;
  }

  sell(pid, towerId) {
    const p = this.players.get(pid);
    const t = this.towers.get(towerId);
    if (!p || !p.alive || !t || t.owner !== pid) return 'Invalid sell';
    p.gold += C.sellValue(t.kind, t.level);
    this.destroyTower(t, false);
    return null;
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
    const hpMul = 1 + p.waveNum * 0.2;
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

  destroyTower(t, explode) {
    this.towers.delete(t.id);
    this.grid[this.idx(t.x, t.y)] = 0;
    this.structVersion++;
    if (explode) this.fx.push({ k: 'boom', x: t.x + 0.5, y: t.y + 0.5, r: 0.8 });
    if (t.kind === 'beacon' && t.owner) this.terrDirty = true;
  }

  updateTowers(dt) {
    for (const t of this.towers.values()) {
      if (!t.owner) continue;
      const def = C.TOWERS[t.kind];
      if (!def.damage) continue;
      t.cd -= dt;
      if (t.cd > 0) continue;
      const s = C.towerStats(t.kind, t.level);
      const cx = t.x + 0.5;
      const cy = t.y + 0.5;

      if (def.aoe) {
        let fired = false;
        for (const c of this.creeps.values()) {
          if (c.dead || c.owner === t.owner) continue;
          if (dist(cx, cy, c.x, c.y) > s.range) continue;
          fired = true;
          c.slowT = def.slowTime;
          c.slowF = def.slow;
          this.damageCreep(c, s.damage, t.owner);
        }
        if (fired) {
          this.fx.push({ k: 'frost', x: cx, y: cy, r: s.range });
          t.cd = 1 / s.rate;
        }
        continue;
      }

      let target = null;
      let bestD = Infinity;
      for (const c of this.creeps.values()) {
        if (c.dead || c.owner === t.owner) continue;
        const d = dist(cx, cy, c.x, c.y);
        if (d > s.range || d < (def.minRange || 0)) continue;
        if (d < bestD) {
          bestD = d;
          target = c;
        }
      }
      if (!target) continue;
      t.cd = 1 / s.rate;

      if (def.splash) {
        for (const c of this.creeps.values()) {
          if (c.dead || c.owner === t.owner) continue;
          if (dist(target.x, target.y, c.x, c.y) <= def.splash) this.damageCreep(c, s.damage, t.owner);
        }
        this.fx.push({ k: 'shell', x1: cx, y1: cy, x2: round2(target.x), y2: round2(target.y), r: def.splash });
      } else {
        this.damageCreep(target, s.damage, t.owner);
        this.fx.push({ k: 'bolt', x1: cx, y1: cy, x2: round2(target.x), y2: round2(target.y), o: t.owner });
      }
    }
  }

  // ---------------------------------------------------------------- pathfinding

  // Per-tile extra cost of walking into a tile. Live towers and cores are costly; ruins are rubble.
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
    const mine = [...this.towers.values()].filter((t) => t.owner === p.id);
    const beacons = mine.filter((t) => t.kind === 'beacon');
    const enemy = this.nearestEnemy(p.core.x, p.core.y, p.id);
    const toward = enemy ? enemy.core : null;
    const roll = this.rand();

    // Expand
    if (beacons.length < Math.min(4, 1 + Math.floor(age / 60)) && p.gold >= C.TOWERS.beacon.cost + 20 && roll < 0.35) {
      const tile = this.botPickTile(p, p.core.x, p.core.y, 4, 6, null);
      if (tile) this.build(p.id, tile.x, tile.y, 'beacon');
      return;
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
    if (p.gold > 260 && mine.length && roll < 0.5) {
      const t = mine[Math.floor(this.rand() * mine.length)];
      this.upgrade(p.id, t.id);
      return;
    }

    // Defend
    const defenders = mine.length - beacons.length;
    if (p.gold >= 50 && defenders < Math.min(24, 5 + age / 25)) {
      const r = this.rand();
      const kind = r < 0.45 ? 'bolt' : r < 0.65 ? 'frost' : r < 0.85 ? 'mortar' : 'wall';
      if (p.gold < C.TOWERS[kind].cost) return;
      const base = beacons.length && this.rand() < 0.3 ? beacons[Math.floor(this.rand() * beacons.length)] : p.core;
      const tile = this.botPickTile(p, base.x, base.y, 1.5, 3.5, this.rand() < 0.5 ? toward : null);
      if (tile) this.build(p.id, tile.x, tile.y, kind);
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
    this.updateTowers(dt);
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
      towers.push([t.id, KIND_KEYS.indexOf(t.kind), t.x, t.y, t.owner, t.level, Math.round(t.hp), t.maxHp, t.ruinOf || '']);
    }
    const creeps = [];
    for (const c of this.creeps.values()) {
      creeps.push([c.id, CREEP_KEYS.indexOf(c.kind), round2(c.x), round2(c.y), c.owner, round2(c.hp / c.maxHp)]);
    }
    const snap = { players, towers, creeps, fx: this.fx, feed: this.feed };
    this.fx = [];
    this.feed = [];
    return snap;
  }
}

Game.KIND_KEYS = KIND_KEYS;
Game.CREEP_KEYS = CREEP_KEYS;

module.exports = Game;
