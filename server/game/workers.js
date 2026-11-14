'use strict';

// Workers and wood: building sites, repairs, chopping forests and farming.
// - Each player has BASE_WORKERS plus WORKSHOP_WORKERS per finished Workshop. They're units (kind
//   'worker', no squad) that never fight; enemies can kill them for a bounty (and the wood they
//   carried). Fallen workers respawn with the troops, at the core and workshops.
// - Jobs have priorities (p.jobs: 0 off, 1 low, 2 high). About once a second each worker without a
//   manual job takes the highest-priority job that has work, workers sharing out jobs of equal
//   priority. A worker sent somewhere by hand (sendWorker) sticks to that until it's done.
// - build: buildings and walls are sites that rise as workers work on them (BUILD_TIME worker-
//   seconds); unfinished ones don't shoot, train, trade or block. repair: damaged buildings, walls
//   and the core, for a little gold. gather: chop forest hexes (in or next to your land) and carry
//   the wood to the core or a workshop. farm: work a plain hex of your land for gold. scout: run
//   off exploring the fog (fast, seeing far, keeping clear of enemy guns); at most SCOUT_WORKERS.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, dist, round2 } = require('./common');
const Terrain = require('../../shared/terrain');

const JOB_CODE = { build: 1, repair: 2, gather: 3, farm: 4, scout: 5 };

module.exports = {
  // ---- the forest

  initForest() {
    this.forest = new Map(); // hex index -> wood left
    for (const h of this.hex.hexes) if (Terrain.isForest(this.mapSeed, h)) this.forest.set(h.i, C.FOREST_WOOD);
  },

  // Forest hexes that aren't full, as snapshot rows [hex, wood left in fifths (0-4)].
  forestRows() {
    const rows = [];
    for (const [i, wood] of this.forest) if (wood < C.FOREST_WOOD) rows.push([i, Math.min(4, Math.floor((5 * wood) / C.FOREST_WOOD))]);
    return rows;
  },

  // ---- counts

  finished(t) {
    return !(t.progress < 1);
  },

  workerCap(p) {
    let shops = 0;
    for (const t of this.towers.values()) if (t.owner === p.id && t.kind === 'workshop' && this.finished(t)) shops++;
    return C.BASE_WORKERS + C.WORKSHOP_WORKERS * Math.min(shops, C.MAX_WORKSHOPS);
  },

  workersOf(p) {
    return [...this.units.values()].filter((u) => u.owner === p.id && u.worker);
  },

  // Fallen workers come back (called with the troops' respawn).
  spawnWorkers(p) {
    const shops = [...this.towers.values()].filter((t) => t.owner === p.id && t.kind === 'workshop' && this.finished(t));
    const spots = [null, ...shops];
    const missing = this.workerCap(p) - this.workersOf(p).length;
    for (let n = 0; n < missing; n++) {
      const from = spots[n % spots.length];
      const id = this.nextId++;
      const a = this.rand() * Math.PI * 2;
      const ox = from ? from.x : p.core.x;
      const oy = from ? from.y : p.core.y;
      const u = {
        isUnit: true, worker: true, id, kind: 'worker', owner: p.id, level: 1, hp: C.UNITS.worker.hp, maxHp: C.UNITS.worker.hp, cd: 0,
        x: Math.max(0.5, Math.min(this.w - 0.5, ox + 0.5 + Math.cos(a) * 1.2)), y: Math.max(0.5, Math.min(this.h - 0.5, oy + 0.5 + Math.sin(a) * 1.2)),
        anchor: 0, attack: null, path: [], dest: null, repathAt: 0, idleUntil: 0, sq: 0,
        job: null, manual: false, carry: 0, thinkAt: 0,
      };
      this.units.set(id, u);
      if (this.ucells) this.ucells[this.ucellOf(u.x, u.y)].push(u);
    }
  },

  // ---- player controls

  setJobPriority(pid, job, level) {
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    if (!C.WORKER_JOBS.includes(job)) return 'Invalid job';
    if (![0, 1, 2].includes(level)) return 'Invalid priority';
    p.jobs[job] = level;
    for (const u of this.workersOf(p)) if (!u.manual) u.thinkAt = 0; // rethink now
    return null;
  },

  // Send worker `id` to a job: target { k: 't' building | 'w' wall | 'c' my core | 'h' hex, id }.
  sendWorker(pid, id, target) {
    const p = this.players.get(pid);
    const u = this.units.get(id);
    if (!p || !p.alive || !u || !u.worker || u.owner !== pid) return 'Pick one of your workers';
    if (!target || typeof target !== 'object') return 'Invalid target';
    const job = this.jobFor(p, target);
    if (typeof job === 'string') return job;
    u.job = job;
    u.manual = true;
    u.path = [];
    u.dest = null;
    return null;
  },

  // What a worker would do at target, or why it can't.
  jobFor(p, target) {
    const { k, id } = target;
    if (k === 't') {
      const t = this.towers.get(id);
      if (!t || t.owner !== p.id) return 'Workers only work on your own buildings';
      if (!this.finished(t)) return { type: 'build', k: 't', id };
      if (t.hp < t.maxHp) return { type: 'repair', k: 't', id };
      return 'That building needs no work';
    }
    if (k === 'w') {
      const w = this.walls.get(id);
      if (!w || w.owner !== p.id) return 'Workers only work on your own walls';
      if (!this.finished(w)) return { type: 'build', k: 'w', id };
      if (w.hp < w.maxHp) return { type: 'repair', k: 'w', id };
      return 'That wall needs no work';
    }
    if (k === 'c') {
      if (id !== p.id) return 'Workers only work on your own core';
      return p.core.hp < p.core.maxHp ? { type: 'repair', k: 'c', id } : 'Your core needs no repair';
    }
    if (k === 'h') {
      if (!Number.isInteger(id) || !this.hex.hexes[id]) return 'Invalid spot';
      if (this.forest.has(id)) return this.canChop(p, id) ? { type: 'gather', k: 'h', id } : 'Workers can only chop forests in or next to your land';
      return this.canFarm(p, id) ? { type: 'farm', k: 'h', id } : 'Workers farm open hexes of your own land';
    }
    return 'Invalid target';
  },

  canChop(p, i) {
    if (!this.forest.has(i) || this.forest.get(i) < 1) return false;
    const owner = this.hexOwner[i];
    if (owner === p.id) return true;
    if (owner) return false;
    return this.hex.hexes[i].n.some((j) => this.hexOwner[j] === p.id);
  },

  canFarm(p, i) {
    const h = this.hex.hexes[i];
    return this.hexOwner[i] === p.id && !this.forest.has(i) && !this.buildingHexes()[i] && h.full && i !== this.hexAt(p.core.x, p.core.y);
  },

  // ---- choosing jobs

  // Where a job's target is (null when it's gone).
  jobPos(p, job) {
    if (job.k === 't') {
      const t = this.towers.get(job.id);
      return t && t.owner === p.id ? { x: t.x + 0.5, y: t.y + 0.5, r: 1.3, obj: t } : null;
    }
    if (job.k === 'w') {
      const w = this.walls.get(job.id);
      return w && w.owner === p.id ? { x: w.x, y: w.y, r: 0.9, obj: w } : null;
    }
    if (job.k === 'c') return { x: p.core.x + 0.5, y: p.core.y + 0.5, r: 1.5, obj: p.core };
    const h = this.hex.hexes[job.id];
    return h ? { x: h.cx, y: h.cy, r: 1.4, obj: null } : null;
  },

  // Is a job still worth doing?
  jobLive(p, job) {
    const at = this.jobPos(p, job);
    if (!at) return false;
    if (job.type === 'build') return !this.finished(at.obj);
    if (job.type === 'repair') return this.finished(at.obj) && at.obj.hp < at.obj.maxHp && p.gold >= 1;
    if (job.type === 'gather') return this.canChop(p, job.id);
    if (job.type === 'farm') return this.canFarm(p, job.id);
    if (job.type === 'scout') return true;
    return false;
  },

  // The best task of a type for worker u (nearest, not over-crowded), or null.
  findTask(p, u, type, taken) {
    const busy = (key) => taken.get(key) || 0;
    let best = null;
    let bestD = Infinity;
    const consider = (job, x, y, cap) => {
      const key = `${job.k}:${job.id}`;
      if (busy(key) >= cap) return;
      const d = dist(u.x, u.y, x, y);
      if (d < bestD) {
        bestD = d;
        best = job;
      }
    };
    if (type === 'build') {
      for (const t of this.towers.values()) if (t.owner === p.id && !this.finished(t)) consider({ type, k: 't', id: t.id }, t.x + 0.5, t.y + 0.5, C.SITE_WORKERS);
      for (const w of this.walls.values()) if (w.owner === p.id && !this.finished(w)) consider({ type, k: 'w', id: w.id }, w.x, w.y, 1);
    } else if (type === 'repair') {
      if (p.gold < 1) return null;
      for (const t of this.towers.values()) if (t.owner === p.id && this.finished(t) && t.hp < t.maxHp) consider({ type, k: 't', id: t.id }, t.x + 0.5, t.y + 0.5, C.REPAIR_WORKERS);
      for (const w of this.walls.values()) if (w.owner === p.id && this.finished(w) && w.hp < w.maxHp) consider({ type, k: 'w', id: w.id }, w.x, w.y, 1);
      if (p.core.hp < p.core.maxHp) consider({ type, k: 'c', id: p.id }, p.core.x + 0.5, p.core.y + 0.5, C.REPAIR_WORKERS);
    } else if (type === 'gather') {
      for (const i of this.forest.keys()) {
        if (this.forest.get(i) < 3 || !this.canChop(p, i)) continue;
        const h = this.hex.hexes[i];
        consider({ type, k: 'h', id: i }, h.cx, h.cy, C.TREE_WORKERS);
      }
    } else if (type === 'scout') {
      consider({ type, k: 's', id: 0 }, u.x, u.y, C.SCOUT_WORKERS);
    } else if (type === 'farm') {
      for (const h of this.hex.hexes) if (this.hexOwner[h.i] === p.id && this.canFarm(p, h.i)) consider({ type, k: 'h', id: h.i }, h.cx, h.cy, 1);
    }
    return best;
  },

  // Give each of p's workers that's free to choose the job it should do.
  assignWorkers(p, workers) {
    const taken = new Map();
    for (const u of workers) if (u.job) taken.set(`${u.job.k}:${u.job.id}`, (taken.get(`${u.job.k}:${u.job.id}`) || 0) + 1);
    // job types by priority (high first); ties share workers out
    const levels = [2, 1].map((lv) => C.WORKER_JOBS.filter((j) => p.jobs[j] === lv)).filter((l) => l.length);
    const sorted = [...workers].sort((a, b) => a.id - b.id);
    sorted.forEach((u, n) => {
      if (u.manual) {
        if (this.jobLive(p, u.job)) return;
        u.manual = false;
        u.job = null;
      }
      if (u.job && !this.jobLive(p, u.job)) u.job = null;
      if (this.time < u.thinkAt && u.job) return;
      u.thinkAt = this.time + 1 + this.rand() * 0.5;
      if (u.carry > 0 && u.job && u.job.type === 'gather') return; // finish the trip first
      let pick = null;
      for (const types of levels) {
        // equal priorities: start from a different job for each worker so they share out
        for (let k = 0; k < types.length && !pick; k++) {
          const type = types[(n + k) % types.length];
          if (u.job && u.job.type === type) {
            pick = u.job;
            break;
          }
          pick = this.findTask(p, u, type, taken);
        }
        if (pick) break;
      }
      if (pick !== u.job) {
        if (u.job) taken.set(`${u.job.k}:${u.job.id}`, (taken.get(`${u.job.k}:${u.job.id}`) || 1) - 1);
        if (pick) taken.set(`${pick.k}:${pick.id}`, (taken.get(`${pick.k}:${pick.id}`) || 0) + 1);
        u.job = pick;
        u.path = [];
        u.dest = null;
      }
    });
  },

  updateWorkers(dt) {
    for (const [i, wood] of this.forest) if (wood < C.FOREST_WOOD) this.forest.set(i, Math.min(C.FOREST_WOOD, wood + C.FOREST_REGROW * dt));
    const by = new Map();
    for (const u of this.units.values()) {
      if (!u.worker) continue;
      if (!by.has(u.owner)) by.set(u.owner, []);
      by.get(u.owner).push(u);
    }
    for (const [pid, list] of by) {
      const p = this.players.get(pid);
      if (p && p.alive) this.assignWorkers(p, list);
    }
  },

  // ---- doing the work (one tick of worker u, from updateUnits)

  workerTick(u, dt) {
    const p = this.players.get(u.owner);
    if (!p) return;
    const speed = C.UNITS.worker.speed;
    const job = u.job;
    u.working = false;
    // carrying wood and done chopping (or the job changed): take it home
    if (u.carry > 0 && (!job || job.type !== 'gather' || u.carry >= C.WORKER_CARRY || !this.canChop(p, job.id))) {
      const drop = this.dropPoint(p, u);
      if (dist(u.x, u.y, drop.x, drop.y) <= 1.7) {
        p.wood += Math.floor(u.carry);
        u.carry = 0;
      } else this.stepToward(u, drop.x, drop.y, 1.4, speed, dt);
      return;
    }
    if (!job) {
      // idle: wait near the core
      const d = dist(u.x, u.y, p.core.x + 0.5, p.core.y + 0.5);
      if (d > 3) this.stepToward(u, p.core.x + 0.5, p.core.y + 0.5, 2.5, speed, dt);
      return;
    }
    if (job.type === 'scout') {
      this.scoutTick(u, C.SCOUT_SPEED, dt);
      return;
    }
    const at = this.jobPos(p, job);
    if (!at) {
      u.job = null;
      return;
    }
    // each worker takes its own spot round the target
    const a = (u.id * 2.39996) % (Math.PI * 2);
    const tx = at.x + Math.cos(a) * at.r * 0.8;
    const ty = at.y + Math.sin(a) * at.r * 0.8;
    if (dist(u.x, u.y, tx, ty) > 0.5) {
      this.stepToward(u, tx, ty, 0.3, speed, dt);
      return;
    }
    u.working = true;
    u.face = at.x >= u.x ? 1 : -1;
    if (job.type === 'build') this.buildTick(at.obj, dt);
    else if (job.type === 'repair') {
      const hp = Math.min(C.REPAIR_RATE * dt, at.obj.maxHp - at.obj.hp, p.gold / C.REPAIR_GOLD_PER_HP);
      if (hp > 0) {
        at.obj.hp += hp;
        p.gold -= hp * C.REPAIR_GOLD_PER_HP;
      }
    } else if (job.type === 'gather') {
      const left = this.forest.get(job.id) || 0;
      const chop = Math.min(C.CHOP_RATE * dt, left, C.WORKER_CARRY - u.carry);
      this.forest.set(job.id, left - chop);
      u.carry += chop;
    } else if (job.type === 'farm') {
      u.farmed = (u.farmed || 0) + C.FARM_GOLD * dt;
      if (u.farmed >= 3) {
        this.award(p, u.farmed, 'farm', u.x, u.y - 0.6);
        u.farmed = 0;
      }
    }
  },

  // A building site (or wall) rises by one worker's dt of work; done, it springs into use.
  buildTick(obj, dt) {
    const time = obj.isWall ? C.WALL_BUILD_TIME : C.BUILD_TIME[obj.kind] || 20;
    const dp = Math.min(1 - obj.progress, dt / time);
    obj.progress += dp;
    obj.hp = Math.min(obj.maxHp, obj.hp + obj.maxHp * (1 - C.SITE_START_HP) * dp);
    if (obj.progress >= 1 - 1e-9) {
      obj.progress = 1;
      this.structVersion++;
      if (!obj.isWall) this.terrDirty = true;
      this.fx.push({ k: 'built', x: round2(obj.isWall ? obj.x : obj.x + 0.5), y: round2(obj.isWall ? obj.y : obj.y + 0.5) });
    }
  },

  // Where a worker drops off wood: the nearest of the core and finished workshops.
  dropPoint(p, u) {
    let best = { x: p.core.x + 0.5, y: p.core.y + 0.5 };
    let bestD = dist(u.x, u.y, best.x, best.y);
    for (const t of this.towers.values()) {
      if (t.owner !== p.id || t.kind !== 'workshop' || !this.finished(t)) continue;
      const d = dist(u.x, u.y, t.x + 0.5, t.y + 0.5);
      if (d < bestD) {
        bestD = d;
        best = { x: t.x + 0.5, y: t.y + 0.5 };
      }
    }
    return best;
  },

  // How far a troop or worker sees (scouting workers see furthest).
  unitSight(u) {
    return u.worker && u.job && u.job.type === 'scout' ? C.SCOUT_SIGHT : C.UNITS[u.kind].sight || 5;
  },

  // For snapshots: what a worker is doing (0 idle, 1 build, 2 repair, 3 gather, 4 farm, 5 scout), +8 when
  // it's carrying wood, +16 while it's at work on the spot.
  workerCode(u) {
    return (u.job ? JOB_CODE[u.job.type] : 0) + (u.carry > 0 ? 8 : 0) + (u.working ? 16 : 0);
  },
};
