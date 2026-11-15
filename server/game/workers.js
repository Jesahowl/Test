'use strict';

// Workers, wood and iron: building sites, repairs, chopping forests, mining iron ore and farming.
// - Each player has BASE_WORKERS plus WORKSHOP_WORKERS per finished Workshop. They're units (kind
//   'worker', no squad) that never fight; enemies can kill them for a bounty (and the wood they
//   carried). Fallen workers respawn with the troops, at the core and workshops.
// - p.jobs: build and repair are on (1) or off (0); gather, mine, farm and scout are how many workers
//   each wants. About once a second the free workers are shared out: every one builds while
//   there are sites, then repairs (once a building hasn't been hit for REPAIR_AFTER), then each
//   counted job gets its workers (those already at it first), and any spare workers chop wood (with
//   chopping off: share out the counted jobs that are on). A worker sent somewhere by hand (sendWorkers) sticks to that until
//   it's done, then takes the next target it was given (Shift: a queue), then goes back to the plan.
// - p.workerFlee: workers run home from enemy troops (and go back to work after). p.keepForest:
//   forests near the core are left standing. p.buildOrder: building sites in the order to build them.
// - build: buildings and walls are sites that rise as workers work on them (BUILD_TIME worker-
//   seconds); unfinished ones don't shoot, train, trade or block. repair: damaged buildings, walls
//   and the core, for a little gold. gather: chop forest hexes anywhere (nearest first) and carry
//   the wood to the core or a workshop. farm: work a plain hex of your land for gold. scout: run
//   off exploring the fog (fast, seeing far, keeping clear of enemy guns); at most SCOUT_WORKERS.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, dist, round2 } = require('./common');
const Terrain = require('../../shared/terrain');

const JOB_CODE = { build: 1, repair: 2, gather: 3, farm: 4, scout: 5, mine: 6 };

module.exports = {
  // ---- the forest

  initForest() {
    this.forest = new Map(); // hex index -> wood left
    // the map's layout (shared/terrain.js): rivers, mountains, forests, iron and gold veins
    this.layout = Terrain.mapTerrain(this.mapSeed, this.hex, this.w, this.h, { rivers: this.riversOn, mountains: !this.openGround });
    this.mountains = this.layout.blocked; // impassable hexes: mountains, the sea and lakes (see walls.js initRivers)
    this.water = new Set([...this.layout.ocean, ...this.layout.lakes]);
    for (const i of this.layout.forest) this.forest.set(i, C.FOREST_WOOD);
    this.veins = new Set(this.layout.veins); // gold vein hexes: farmed on your own land, they pay VEIN_GOLD a worker
    this.ore = new Map(); // hex index -> iron left in an ore deposit
    for (const i of this.layout.iron) this.ore.set(i, C.IRON_ORE);
  },

  // Ore deposits that aren't full, as snapshot rows [hex, iron left in fifths (0-4)].
  oreRows() {
    const rows = [];
    for (const [i, iron] of this.ore) if (iron < C.IRON_ORE) rows.push([i, Math.min(4, Math.floor((5 * iron) / C.IRON_ORE))]);
    return rows;
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

  // How many workers a job wants (build and repair: 0 off, 1 on).
  setJobPriority(pid, job, level) {
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    if (!C.WORKER_JOBS.includes(job)) return 'Invalid job';
    const max = job === 'build' || job === 'repair' ? 1 : C.WORKER_COUNT_MAX;
    if (!Number.isInteger(level) || level < 0 || level > max) return 'Invalid number of workers';
    p.jobs[job] = level;
    p.assignAt = 0; // rethink now
    return null;
  },

  // The worker switches: flee (run home from raiders), keepForest (leave forests near the core).
  setWorkerPlan(pid, plan) {
    const p = this.players.get(pid);
    if (!p || !p.alive || !plan || typeof plan !== 'object') return 'Invalid order';
    if (plan.flee !== undefined) p.workerFlee = !!plan.flee;
    if (plan.keepForest !== undefined) p.keepForest = !!plan.keepForest;
    p.assignAt = 0;
    return null;
  },

  // The order to put up p's building sites in (ids of its unfinished buildings, first first).
  setBuildOrder(pid, ids) {
    const p = this.players.get(pid);
    if (!p || !p.alive || !Array.isArray(ids)) return 'Invalid order';
    p.buildOrder = ids.slice(0, 40).map(Number).filter((id) => {
      const t = this.towers.get(id);
      return t && t.owner === pid && !this.finished(t);
    });
    p.assignAt = 0;
    return null;
  },

  // Send worker `id` to a job: target { k: 't' building | 'w' wall | 'c' my core | 'h' hex, id }.
  sendWorker(pid, id, target, queue = false) {
    return this.sendWorkers(pid, [id], target, queue);
  },

  // Send several workers to a job. Where one target can't take them all (a forest takes
  // TREE_WORKERS, a site SITE_WORKERS...), the rest take the nearest work of the same kind.
  // queue (Shift): it's done after the ones they've already been given.
  sendWorkers(pid, ids, target, queue = false) {
    const p = this.players.get(pid);
    if (!p || !p.alive || !Array.isArray(ids) || !ids.length) return 'Pick one of your workers';
    const list = ids.slice(0, 60).map((id) => this.units.get(Number(id))).filter((u) => u && u.worker && u.owner === pid);
    if (!list.length) return 'Pick one of your workers';
    if (!target || typeof target !== 'object') return 'Invalid target';
    const job = this.jobFor(p, target);
    if (typeof job === 'string') return job;
    const cap = { build: C.SITE_WORKERS, repair: C.REPAIR_WORKERS, gather: C.TREE_WORKERS, mine: C.MINE_WORKERS, farm: this.veins.has(job.id) ? C.VEIN_WORKERS : 1 }[job.type] || 99;
    const taken = new Map();
    for (const u of this.workersOf(p)) if (u.job && !list.includes(u)) taken.set(`${u.job.k}:${u.job.id}`, (taken.get(`${u.job.k}:${u.job.id}`) || 0) + 1);
    const key = `${job.k}:${job.id}`;
    list.forEach((u) => {
      let j = job;
      if ((taken.get(key) || 0) >= cap) j = this.findTask(p, { x: this.jobPos(p, job).x, y: this.jobPos(p, job).y }, job.type, taken) || job;
      taken.set(`${j.k}:${j.id}`, (taken.get(`${j.k}:${j.id}`) || 0) + 1);
      if (queue && u.manual && u.job) {
        u.queue = (u.queue || []).concat([j]).slice(-8);
        return;
      }
      u.queue = [];
      u.job = j;
      u.manual = true;
      u.path = [];
      u.dest = null;
    });
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
      if (this.suddenDeath()) return 'In sudden death cores crumble: they can\'t be repaired';
      return p.core.hp < p.core.maxHp ? { type: 'repair', k: 'c', id } : 'Your core needs no repair';
    }
    if (k === 'h') {
      if (!Number.isInteger(id) || !this.hex.hexes[id]) return 'Invalid spot';
      if (this.forest.has(id)) return this.canChop(p, id) ? { type: 'gather', k: 'h', id } : 'That forest has been chopped bare: it\'s growing back';
      if (this.ore.has(id)) return this.canMine(p, id) ? { type: 'mine', k: 'h', id } : 'That deposit is mined out for now: it builds back up slowly';
      return this.canFarm(p, id) ? { type: 'farm', k: 'h', id } : 'Workers farm open hexes of your own land';
    }
    return 'Invalid target';
  },

  // Forests a player's workers may chop: any with wood left, anywhere on the map (they take the
  // nearest ones first).
  canChop(p, i) {
    return this.forest.has(i) && this.forest.get(i) >= 1;
  },

  // Ore deposits a player's workers may mine: any with iron left, anywhere on the map.
  canMine(p, i) {
    return this.ore.has(i) && this.ore.get(i) >= 1 && !this.buildingHexes()[i]; // (not under a building)
  },

  canFarm(p, i) {
    const h = this.hex.hexes[i];
    return this.hexOwner[i] === p.id && !this.forest.has(i) && !this.ore.has(i) && !this.buildingHexes()[i] && h.full && i !== this.hexAt(p.core.x, p.core.y);
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
    if (job.type === 'repair') return this.finished(at.obj) && at.obj.hp < at.obj.maxHp && p.gold >= 1 && !(job.k === 'c' && this.suddenDeath());
    if (job.type === 'gather') return this.canChop(p, job.id);
    if (job.type === 'mine') return this.canMine(p, job.id);
    if (job.type === 'farm') return this.canFarm(p, job.id);
    if (job.type === 'scout') return true;
    return false;
  },

  // The best task of a type for worker u (nearest, not over-crowded), or null.
  findTask(p, u, type, taken) {
    const busy = (key) => taken.get(key) || 0;
    let best = null;
    let bestD = Infinity;
    // (bias: subtracted from the distance, to put some tasks first)
    const consider = (job, x, y, cap, bias = 0) => {
      const key = `${job.k}:${job.id}`;
      if (busy(key) >= cap) return;
      const d = dist(u.x, u.y, x, y) - bias;
      if (d < bestD) {
        bestD = d;
        best = job;
      }
    };
    if (type === 'build') {
      // (sites in the player's build order come first, in that order)
      const order = p.buildOrder || [];
      for (const t of this.towers.values()) {
        if (t.owner !== p.id || this.finished(t)) continue;
        const q = order.indexOf(t.id);
        consider({ type, k: 't', id: t.id }, t.x + 0.5, t.y + 0.5, C.SITE_WORKERS, q < 0 ? 0 : 1e4 * (order.length - q));
      }
      for (const w of this.walls.values()) if (w.owner === p.id && !this.finished(w)) consider({ type, k: 'w', id: w.id }, w.x, w.y, 1);
    } else if (type === 'repair') {
      if (p.gold < 1) return null;
      // (only once the fighting's over there: nothing hit in the last REPAIR_AFTER seconds)
      const calm = (o) => o.hitAt === undefined || this.time - o.hitAt >= C.REPAIR_AFTER;
      for (const t of this.towers.values()) if (t.owner === p.id && this.finished(t) && t.hp < t.maxHp && calm(t)) consider({ type, k: 't', id: t.id }, t.x + 0.5, t.y + 0.5, C.REPAIR_WORKERS);
      for (const w of this.walls.values()) if (w.owner === p.id && this.finished(w) && w.hp < w.maxHp && calm(w)) consider({ type, k: 'w', id: w.id }, w.x, w.y, 1);
      // (in sudden death cores crumble, and can't be patched back up: every round ends)
      if (p.core.hp < p.core.maxHp && !this.suddenDeath() && calm(p.core)) consider({ type, k: 'c', id: p.id }, p.core.x + 0.5, p.core.y + 0.5, C.REPAIR_WORKERS);
    } else if (type === 'gather') {
      for (const i of this.forest.keys()) {
        if (this.forest.get(i) < 3 || !this.canChop(p, i)) continue;
        const h = this.hex.hexes[i];
        if (p.keepForest && dist(h.cx, h.cy, p.core.x + 0.5, p.core.y + 0.5) < C.KEEP_FOREST_RANGE) continue; // (kept standing)
        consider({ type, k: 'h', id: i }, h.cx, h.cy, C.TREE_WORKERS);
      }
    } else if (type === 'mine') {
      for (const i of this.ore.keys()) {
        if (this.ore.get(i) < 2 || !this.canMine(p, i)) continue;
        const h = this.hex.hexes[i];
        consider({ type, k: 'h', id: i }, h.cx, h.cy, C.MINE_WORKERS);
      }
    } else if (type === 'scout') {
      consider({ type, k: 's', id: 0 }, u.x, u.y, C.SCOUT_WORKERS);
    } else if (type === 'farm') {
      // (my gold veins first: they pay four times as much, and take a few workers)
      for (const h of this.hex.hexes) {
        if (this.hexOwner[h.i] !== p.id || !this.canFarm(p, h.i)) continue;
        const vein = this.veins.has(h.i);
        consider({ type, k: 'h', id: h.i }, h.cx, h.cy, vein ? C.VEIN_WORKERS : 1, vein ? 1e3 : 0);
      }
    }
    return best;
  },

  // Share p's workers out (see the top of this file). Runs about once a second per player.
  assignWorkers(p, workers) {
    // hand-sent workers: on to their next queued target when one is done, then back to the plan
    for (const u of workers) {
      if (!u.manual || this.jobLive(p, u.job)) continue;
      u.job = null;
      u.manual = false;
      while (u.queue && u.queue.length) {
        const next = u.queue.shift();
        if (this.jobLive(p, next)) {
          u.job = next;
          u.manual = true;
          break;
        }
      }
    }
    for (const u of workers) if (!u.manual && u.job && !this.jobLive(p, u.job)) u.job = null;
    if (this.time < (p.assignAt || 0)) return;
    p.assignAt = this.time + 1;
    const taken = new Map();
    const count = (j) => taken.set(`${j.k}:${j.id}`, (taken.get(`${j.k}:${j.id}`) || 0) + 1);
    const uncount = (j) => taken.set(`${j.k}:${j.id}`, (taken.get(`${j.k}:${j.id}`) || 1) - 1);
    for (const u of workers) if (u.job) count(u.job);
    // the free ones (a worker carrying a load home finishes that trip first)
    const busy = (u) => u.manual || (u.carry > 0 && u.job && (u.job.type === 'gather' || u.job.type === 'mine'));
    let pool = workers.filter((u) => !busy(u)).sort((a, b) => a.id - b.id);
    const give = (u, job) => {
      if (u.job === job) return;
      if (u.job) uncount(u.job);
      count(job);
      u.job = job;
      u.path = [];
      u.dest = null;
    };
    // Fill `type` with up to n of the pool (those already at it first). Returns how many it took.
    const fill = (type, n) => {
      let got = 0;
      const order = [...pool].sort((a, b) => (b.job && b.job.type === type) - (a.job && a.job.type === type));
      for (const u of order) {
        if (got >= n) break;
        const job = u.job && u.job.type === type ? u.job : this.findTask(p, u, type, taken);
        if (!job) break;
        give(u, job);
        pool = pool.filter((v) => v !== u);
        got++;
      }
      return got;
    };
    // (workers already carrying a load count toward their job)
    const carrying = (type) => workers.filter((u) => !u.manual && busy(u) && u.job && u.job.type === type).length;
    if (p.jobs.build > 0) fill('build', Infinity);
    if (p.jobs.repair > 0) fill('repair', Infinity);
    const counted = ['mine', 'gather', 'farm', 'scout'];
    for (const type of counted) fill(type, Math.max(0, (p.jobs[type] || 0) - carrying(type)));
    // spare hands chop wood (or, with chopping off, share out the counted jobs that are on)
    const on = p.jobs.gather > 0 ? ['gather'] : counted.filter((t) => p.jobs[t] > 0);
    for (let k = 0, most = pool.length + 1; pool.length && on.length && k < most; k++) {
      const before = pool.length;
      for (const t of on) if (pool.length) fill(t, 1);
      if (pool.length === before) break; // no more work anywhere
    }
    for (const u of pool) if (u.job) {
      uncount(u.job);
      u.job = null;
    }
  },

  // Workers (with fleeing on) that have enemy troops close run home for FLEE_TIME, then go back
  // to work. Tells the owner when a group starts to run.
  checkFlee(p, workers) {
    if (p.workerFlee === false) return;
    let started = 0;
    let at = null;
    for (const u of workers) {
      let near = false;
      for (const v of this.nearUnits(u.x, u.y, C.FLEE_RANGE)) {
        if (v.worker || v.trade || !this.hostile(u.owner, v.owner)) continue;
        near = true;
        break;
      }
      if (!near) continue;
      if (!(u.fleeUntil > this.time)) {
        started++;
        at = at || u;
      }
      u.fleeUntil = this.time + C.FLEE_TIME;
    }
    if (started) this.fx.push({ k: 'flee', o: p.id, n: started, x: round2(at.x), y: round2(at.y) });
  },

  updateWorkers(dt) {
    for (const [i, wood] of this.forest) if (wood < C.FOREST_WOOD) this.forest.set(i, Math.min(C.FOREST_WOOD, wood + C.FOREST_REGROW * dt));
    for (const [i, iron] of this.ore) if (iron < C.IRON_ORE) this.ore.set(i, Math.min(C.IRON_ORE, iron + C.IRON_REGROW * dt));
    const by = new Map();
    for (const u of this.units.values()) {
      if (!u.worker) continue;
      if (!by.has(u.owner)) by.set(u.owner, []);
      by.get(u.owner).push(u);
    }
    for (const [pid, list] of by) {
      const p = this.players.get(pid);
      if (!p || !p.alive) continue;
      this.assignWorkers(p, list);
      if (this.time >= (p.fleeCheckAt || 0)) {
        p.fleeCheckAt = this.time + 0.25;
        this.checkFlee(p, list);
      }
    }
  },

  // ---- doing the work (one tick of worker u, from updateUnits)

  workerTick(u, dt) {
    const p = this.players.get(u.owner);
    if (!p) return;
    const speed = C.UNITS.worker.speed;
    const job = u.job;
    u.working = false;
    if (u.fleeUntil > this.time) {
      // running home from raiders (the job waits)
      const d = dist(u.x, u.y, p.core.x + 0.5, p.core.y + 0.5);
      if (d > 2) this.stepToward(u, p.core.x + 0.5, p.core.y + 0.5, 1.5, speed * 1.15, dt);
      return;
    }
    // carrying wood (or iron) and done with that job (or it changed, or the load is full): take it home
    const iron = u.carryKind === 'iron';
    const still = job && (iron ? job.type === 'mine' && u.carry < C.IRON_CARRY && this.canMine(p, job.id)
      : job.type === 'gather' && u.carry < C.WORKER_CARRY && this.canChop(p, job.id));
    if (u.carry > 0 && !still) {
      const drop = this.dropPoint(p, u);
      if (dist(u.x, u.y, drop.x, drop.y) <= 1.7) {
        if (iron) p.iron += Math.floor(u.carry);
        else p.wood += Math.floor(u.carry);
        u.carry = 0;
        u.carryKind = null;
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
    // each worker takes its own spot round the target (kept inside the map). One that's close but
    // can't quite get onto its spot (crowded, or up against something) gets to work where it is.
    const a = (u.id * 2.39996) % (Math.PI * 2);
    const tx = Math.max(0.6, Math.min(this.w - 0.6, at.x + Math.cos(a) * at.r * 0.8));
    const ty = Math.max(0.6, Math.min(this.h - 0.6, at.y + Math.sin(a) * at.r * 0.8));
    const d = dist(u.x, u.y, tx, ty);
    const key = `${job.k}:${job.id}`;
    if (u.spotKey !== key || d < u.spotBest - 0.05) {
      u.spotKey = key;
      u.spotBest = d;
      u.spotAt = this.time;
    }
    const stuck = this.time - u.spotAt > 1.5 && dist(u.x, u.y, at.x, at.y) <= at.r + 0.8;
    if (d > 0.5 && !stuck) {
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
      u.carryKind = 'wood';
    } else if (job.type === 'mine') {
      const left = this.ore.get(job.id) || 0;
      const dug = Math.min(C.MINE_RATE * dt, left, C.IRON_CARRY - u.carry);
      this.ore.set(job.id, left - dug);
      u.carry += dug;
      u.carryKind = 'iron';
    } else if (job.type === 'farm') {
      u.farmed = (u.farmed || 0) + (this.veins.has(job.id) ? C.VEIN_GOLD : C.FARM_GOLD) * dt;
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

  // For snapshots: what a worker is doing (0 idle, 1 build, 2 repair, 3 gather, 4 farm, 5 scout,
  // 6 mine), +8 when it's carrying wood or iron, +16 while it's at work on the spot, +32 while
  // it's running from raiders.
  workerCode(u) {
    return (u.job ? JOB_CODE[u.job.type] : 0) + (u.carry > 0 ? 8 : 0) + (u.working ? 16 : 0) + (u.fleeUntil > this.time ? 32 : 0);
  },
};
