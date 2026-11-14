'use strict';

// Troop movement and fighting: flow-field pathfinding, targeting, defending, hunting, scouting, healing.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, Path, DIRS8, dist, round2, posOf } = require('./common');

module.exports = {
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
  },

  // Flow field toward a goal tile. Rebuilt lazily, at most every PATH_RECOMPUTE_INTERVAL.
  // Flow field to a goal tile. At most PATH_FIELDS_PER_TICK new fields are built per tick (each
  // costs ~2 ms); past that, a stale field is reused, or null is returned and the troop walks
  // straight for now (the map has no walls, so that's always safe).
  getFieldTo(goal) {
    let f = this.fields.get(goal);
    const stale = !f || (f.version !== this.structVersion && this.time - f.at >= C.PATH_RECOMPUTE_INTERVAL);
    if (stale && this.fieldBudget > 0) {
      this.fieldBudget--;
      f = { dist: Path.computeField(this.w, this.h, this.getExtra(), goal), goal, version: this.structVersion, at: this.time };
      this.fields.set(goal, f);
    } else {
      this.getExtra();
    }
    if (!f) return null;
    f.used = this.time;
    return f;
  },

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
  },

  // Resolve a troop's attack order into a destination, rolling on to the same enemy's next
  // structure when a tower falls or changes hands. Returns null when the order is finished.
  resolveAttack(u) {
    const a = u.attack;
    if (a.k === 'p') {
      return { x: (a.id % this.w) + 0.5, y: Math.floor(a.id / this.w) + 0.5, goal: a.id, struct: false, hold: true };
    }
    if (a.k === 'u') {
      let v = this.units.get(a.id);
      if (!v || !this.hostile(u.owner, v.owner)) {
        // The hunted troop is down (or changed sides): go after the nearest of its squadmates
        // around where it fell; if there are none, the hunt is over.
        v = null;
        let best = C.HUNT_ROLL_RANGE;
        for (const o of this.nearUnits(a.lx, a.ly, C.HUNT_ROLL_RANGE)) {
          if (o.owner !== a.owner || !this.hostile(u.owner, o.owner)) continue;
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
    if (this.allied(u.owner, a.owner)) return null; // we made peace
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
  },

  // Best thing for troop u to hit within `reach`: the nearest enemy troop, else monsters fighting
  // us (or the camp we were sent to), else - if `structures` - enemy towers and cores.
  pickTarget(u, def, reach, structures) {
    let best = null;
    let bestScore = Infinity;
    for (const v of this.nearUnits(u.x, u.y, reach)) {
      if (!this.hostile(u.owner, v.owner)) continue;
      const d = dist(u.x, u.y, v.x, v.y);
      if (d > reach) continue;
      if (d < bestScore) {
        bestScore = d;
        best = v;
      }
    }
    if (best) return best;
    for (const c of this.creeps.values()) {
      if (c.dead) continue;
      if (c.angry !== u.owner && !(u.attack && u.attack.k === 'j' && u.attack.id === c.camp)) continue;
      const d = dist(u.x, u.y, c.x, c.y);
      if (d > reach) continue;
      if (d < bestScore) {
        bestScore = d;
        best = c;
      }
    }
    if (best || !structures) return best;
    for (const t of this.towers.values()) {
      if (!this.hostile(u.owner, t.owner) || this.isShielded(this.players.get(t.owner))) continue;
      const d = dist(u.x, u.y, t.x + 0.5, t.y + 0.5);
      if (d > reach) continue;
      if (d < bestScore) {
        bestScore = d;
        best = t;
      }
    }
    for (const p of this.players.values()) {
      if (!p.alive || !this.hostile(u.owner, p.id) || this.isShielded(p)) continue;
      const d = dist(u.x, u.y, p.core.x + 0.5, p.core.y + 0.5);
      if (d > reach) continue;
      if (d < bestScore) {
        bestScore = d;
        best = p;
      }
    }
    return best;
  },

  onHomeLand(u) {
    const x = Math.floor(u.x);
    const y = Math.floor(u.y);
    return !this.suddenDeath() && this.inBounds(x, y) && this.terr[this.idx(x, y)] === u.owner;
  },

  unitFire(u, target, s, def) {
    u.cd = 1 / s.rate;
    // Troops that get shot remember who did it, so they can fight back (see updateUnits).
    if (target.isUnit) {
      target.provoker = u.id;
      target.provokedAt = this.time;
    }
    const [tx, ty] = posOf(target);
    const isStruct = target.isTower || target.isPlayer;
    const home = this.onHomeLand(u) ? 1 + C.HOME_DAMAGE_BONUS : 1;
    const buff = this.buffed(u.owner) ? 1 + C.JUNGLE_BUFF_DAMAGE : 1;
    const base = s.damage * buff;
    const siege = isStruct ? (def.siege || 1) * (this.suddenDeath() ? C.SUDDEN_DEATH_SIEGE : this.siegeRamp()) : 1;
    const dmg = base * home * siege;
    if (def.ranged) {
      // Archer: an arrow flies to the target.
      this.hurt(target, dmg, u.owner);
      this.fx.push({ k: 'arrow', x1: round2(u.x), y1: round2(u.y), x2: round2(tx), y2: round2(ty), o: u.owner });
    } else {
      this.hurt(target, dmg, u.owner);
      this.fx.push({ k: 'slash', x: round2(tx), y: round2(ty), a: u.id }); // a: who swung (for the lunge)
    }
  },

  walkable(k, owner) {
    return this.terr[k] === owner && this.grid[k] === 0;
  },

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
    u.wpKey = undefined; // a fresh plan: start tracking progress again
  },

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
      // Close enough counts as there: troops keep UNIT_SPACING apart, so several heading for the
      // same spot can't all reach it. And a troop that stops getting closer (jostled by the crowd)
      // for a second moves on rather than pushing forever.
      const near = C.UNIT_SPACING * (u.path.length ? 0.65 : 0.55);
      const wp = u.path.length ? u.path[0] : -1;
      if (u.wpKey !== wp || d < u.wpBest - 0.05) {
        u.wpKey = wp;
        u.wpBest = d;
        u.wpAt = this.time;
      }
      const stuck = this.time - u.wpAt > 1;
      if (d <= budget || d < near || stuck) {
        u.wpKey = undefined;
        if (d <= budget) {
          u.x = tx;
          u.y = ty;
          budget -= d;
        } else budget = 0;
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
  },

  // Step straight toward (x, y), stopping `stop` short of it.
  stepToward(u, x, y, stop, speed, dt) {
    const d = dist(u.x, u.y, x, y);
    if (d <= stop) return;
    const step = Math.min(d - stop, speed * dt);
    u.x += ((x - u.x) / d) * step;
    u.y += ((y - u.y) / d) * step;
  },

  // March across the map along the flow field toward goal tile (centre gx, gy).
  marchTo(u, goal, gx, gy, stop, speed, dt) {
    const d = dist(u.x, u.y, gx, gy);
    if (d <= stop) return true;
    // Close by, or no field available this tick: just walk straight there.
    const f = d < C.PATH_DIRECT_RANGE ? null : this.getFieldTo(goal);
    if (!f) {
      this.stepToward(u, gx, gy, stop, speed, dt);
      return false;
    }
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
  },

  // Where each squad is (centre of its troops, not counting scouts off exploring), how far its
  // troops may spread, and its slowest troop's speed.
  squadGroups() {
    const groups = new Map();
    for (const u of this.units.values()) {
      const def = C.UNITS[u.kind];
      if (def.scout && !u.attack) continue;
      let g = groups.get(u.sq);
      if (!g) groups.set(u.sq, (g = { x: 0, y: 0, n: 0, speed: Infinity }));
      g.x += u.x;
      g.y += u.y;
      g.n++;
      g.speed = Math.min(g.speed, def.speed);
    }
    for (const g of groups.values()) {
      g.x /= g.n;
      g.y /= g.n;
      g.r = C.SQUAD_SPREAD + 0.5 * C.UNIT_SPACING * Math.sqrt(g.n); // room for every troop at its spacing
    }
    return groups;
  },

  // Marching speed for troop u heading to (gx, gy) so its squad stays together: the squad's pace,
  // 0 (wait) when it has run ahead of the squad, or full speed to catch up when it's behind.
  squadPace(u, gx, gy, speed) {
    const g = this.groups && this.groups.get(u.sq);
    if (!g || g.n < 2) return speed;
    if (dist(u.x, u.y, g.x, g.y) > g.r) {
      const ahead = dist(u.x, u.y, gx, gy) + 0.3 < dist(g.x, g.y, gx, gy);
      if (ahead) {
        if (!u.waitSince) u.waitSince = this.time;
        if (this.time - u.waitSince < C.SQUAD_WAIT_MAX) return 0;
      }
      u.waitSince = 0;
      return speed;
    }
    u.waitSince = 0;
    return Math.min(speed, g.speed);
  },

  // Where a squad stands guard: its own spot around the core (spread by squad number), or at the
  // tower it defends.
  squadPost(u) {
    return u.slotPos || this.players.get(u.owner).core;
  },

  // ---- formations: troops standing still fill their hex evenly. A hex holds a troop in the
  // middle, a ring of 6 round it and an outer ring of 12 (19 in all); a hex with a building keeps its
  // middle free. More troops than fit spill into the next hexes.
  hexSlots() {
    if (!this.slotOffsets) {
      const o = [[0, 0]];
      for (let k = 0; k < 6; k++) o.push([C.SLOT_RING1 * Math.cos((k * Math.PI) / 3), C.SLOT_RING1 * Math.sin((k * Math.PI) / 3)]);
      for (let k = 0; k < 12; k++) {
        const a = ((15 + 30 * k) * Math.PI) / 180;
        o.push([C.SLOT_RING2 * Math.cos(a), C.SLOT_RING2 * Math.sin(a)]);
      }
      this.slotOffsets = o;
    }
    return this.slotOffsets;
  },

  // The hex a standing troop forms up in: the hex it holds, the tower it guards, or (guarding the
  // core) one of the hexes round the core, a different one for each squad. -1: not standing still.
  postHex(u) {
    if (u.attack) return u.attack.k === 'p' ? this.hex.tileHex[u.attack.id] : -1;
    if (u.anchor) {
      const t = this.towers.get(u.anchor);
      if (t) return this.hexAt(t.x, t.y);
    }
    const p = this.players.get(u.owner);
    const core = this.hex.hexes[this.hexAt(p.core.x, p.core.y)];
    const bh = this.buildingHexes();
    if (!p.postRing || p.postRingAt !== this.structVersion + this.terrVersion * 1e6) {
      // the hexes round the core that are mine and free, in a ring
      p.postRing = core.n.filter((j) => this.hexOwner[j] === p.id && !bh[j])
        .sort((a, b) => Math.atan2(this.hex.hexes[a].cy - core.cy, this.hex.hexes[a].cx - core.cx) - Math.atan2(this.hex.hexes[b].cy - core.cy, this.hex.hexes[b].cx - core.cx));
      p.postRingAt = this.structVersion + this.terrVersion * 1e6;
    }
    if (!p.postRing.length) return core.i;
    const num = p.squadNum.get(u.sq) || 1;
    return p.postRing[(num - 1) % p.postRing.length];
  },

  // Give every standing troop its spot (u.slotPos) in its hex's formation.
  assignSlots() {
    const offs = this.hexSlots();
    const byHex = new Map();
    for (const u of this.units.values()) {
      u.slotPos = null;
      if (C.UNITS[u.kind].scout && !u.attack) continue; // scouts off exploring
      const h = this.postHex(u);
      if (h < 0) continue;
      const key = `${u.owner}:${h}`;
      if (!byHex.has(key)) byHex.set(key, { h, list: [] });
      byHex.get(key).list.push(u);
    }
    const bh = this.buildingHexes();
    for (const { h, list } of byHex.values()) {
      list.sort((a, b) => a.sq - b.sq || a.id - b.id);
      const hx = this.hex.hexes[h];
      const free = bh[h] ? offs.slice(1) : offs; // keep the middle clear of a building
      list.forEach((u, k) => {
        let into = hx;
        let slot = k;
        if (k >= free.length) {
          // spill into the next hexes round it
          const extra = k - free.length;
          into = this.hex.hexes[hx.n[Math.floor(extra / offs.length) % hx.n.length]];
          slot = extra % offs.length;
          u.slotPos = { x: into.cx + offs[slot][0], y: into.cy + offs[slot][1] };
          return;
        }
        u.slotPos = { x: hx.cx + free[slot][0], y: hx.cy + free[slot][1] };
      });
    }
  },

  // Push troops apart so none sit on top of each other (friend or foe), and out of buildings and
  // barbarians (but never push a defender off its own land). Each overlap is resolved part of the way per tick, so crowds settle smoothly.
  separateUnits() {
    const before = new Map();
    for (const u of this.units.values()) if (!u.attack) before.set(u, [u.x, u.y]);
    for (const u of this.units.values()) {
      for (const v of this.nearUnits(u.x, u.y, C.UNIT_SPACING)) {
        if (v.id <= u.id) continue;
        // friends keep their full spacing; enemies may close in, so front lines meet
        const R = this.hostile(u.owner, v.owner) ? C.ENEMY_SPACING : C.UNIT_SPACING;
        let dx = v.x - u.x;
        let dy = v.y - u.y;
        let d = Math.hypot(dx, dy);
        if (d >= R) continue;
        if (d < 1e-4) {
          const a = (u.id * 2.39996 + v.id) % (Math.PI * 2); // exactly on top: split in a fixed direction
          dx = Math.cos(a);
          dy = Math.sin(a);
          d = 1;
        } else {
          dx /= d;
          dy /= d;
        }
        const push = (R - Math.min(d, R)) * 0.45;
        u.x -= dx * push;
        u.y -= dy * push;
        v.x += dx * push;
        v.y += dy * push;
      }
    }
    const solid = []; // buildings and barbarians: troops step out of their way
    for (const p of this.players.values()) if (p.alive) solid.push({ x: p.core.x + 0.5, y: p.core.y + 0.5, r: C.CORE_BODY });
    for (const t of this.towers.values()) solid.push({ x: t.x + 0.5, y: t.y + 0.5, r: C.STRUCT_BODY });
    for (const c of this.creeps.values()) solid.push({ x: c.x, y: c.y, r: C.CREEP_BODY });
    for (const o of solid) {
      for (const u of this.nearUnits(o.x, o.y, o.r)) {
        const dx = u.x - o.x;
        const dy = u.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d >= o.r) continue;
        const a = d < 1e-4 ? (u.id * 2.39996) % (Math.PI * 2) : Math.atan2(dy, dx);
        u.x = o.x + Math.cos(a) * o.r;
        u.y = o.y + Math.sin(a) * o.r;
      }
    }
    for (const u of this.units.values()) {
      u.x = Math.max(0.3, Math.min(this.w - 0.3, u.x));
      u.y = Math.max(0.3, Math.min(this.h - 0.3, u.y));
      // Defenders aren't shoved off their own land: if a push would take one over the border, it stays.
      const was = before.get(u);
      if (was) {
        const own = (x, y) => this.terr[this.idx(Math.floor(x), Math.floor(y))] === u.owner;
        if (own(was[0], was[1]) && !own(u.x, u.y)) {
          u.x = was[0];
          u.y = was[1];
        }
      }
    }
  },

  // Is (x, y) in owner's land, or within HOME_EDGE tiles of its border?
  nearHome(owner, x, y) {
    const e = C.HOME_EDGE;
    const x0 = Math.floor(x - e);
    const x1 = Math.floor(x + e);
    const y0 = Math.floor(y - e);
    const y1 = Math.floor(y + e);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.inBounds(tx, ty) || this.terr[this.idx(tx, ty)] !== owner) continue;
        // distance from (x, y) to the nearest point of tile (tx, ty)
        const dx = Math.max(tx - x, 0, x - tx - 1);
        const dy = Math.max(ty - y, 0, y - ty - 1);
        if (dx * dx + dy * dy <= e * e) return true;
      }
    }
    return false;
  },

  // The nearest enemy troop (or barbarian out for blood) within HOME_ALERT of troop u that's on its
  // land or right next to it, or null.
  homeIntruder(u) {
    let foe = null;
    let best = C.HOME_ALERT;
    for (const v of this.nearUnits(u.x, u.y, C.HOME_ALERT)) {
      if (!this.hostile(u.owner, v.owner)) continue;
      const d = dist(u.x, u.y, v.x, v.y);
      if (d < best && this.nearHome(u.owner, v.x, v.y)) {
        best = d;
        foe = v;
      }
    }
    for (const c of this.creeps.values()) {
      if (c.angry !== u.owner) continue;
      const d = dist(u.x, u.y, c.x, c.y);
      if (d < best && this.nearHome(u.owner, c.x, c.y)) {
        best = d;
        foe = c;
      }
    }
    return foe;
  },

  updateUnits(dt) {
    this.groups = this.squadGroups();
    this.assignSlots();
    for (const u of this.units.values()) {
      if (u.hp <= 0 || !this.units.has(u.id)) continue;
      const def = C.UNITS[u.kind];
      const s = C.towerStats(u.kind, u.level);
      u.cd -= dt;
      const speed = def.speed;
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
        if (tgt) {
          const pace = this.squadPace(u, tgt.x, tgt.y, speed);
          if (pace > 0) this.marchTo(u, tgt.goal, tgt.x, tgt.y, 2, pace, dt);
        } else this.scoutTick(u, speed, dt);
        continue;
      }

      if (tgt && tgt.unit && !def.heal) {
        // Hunting: focus on the chosen troop, ignoring everything else until it's down.
        const v = tgt.unit;
        const d = dist(u.x, u.y, v.x, v.y);
        if (d <= s.range) {
          u.path = [];
          u.dest = null;
          if (u.cd <= 0) this.unitFire(u, v, s, def);
        } else if (d < 10) {
          this.stepToward(u, v.x, v.y, s.range * 0.8, speed, dt);
        } else {
          this.marchTo(u, tgt.goal, v.x, v.y, s.range * 0.8, speed, dt);
        }
        continue;
      }

      // Marching to a far-off target: don't get pulled into fights on the way. Troops keep walking
      // and only shoot at enemy troops (or angry barbarians) in reach as they pass; once they're
      // within MARCH_ENGAGE of the target they fight everything there as usual.
      if (tgt && !def.heal && dist(u.x, u.y, tgt.x, tgt.y) > C.MARCH_ENGAGE) {
        if (u.cd <= 0) {
          const near = this.pickTarget(u, def, s.range, false);
          if (near) this.unitFire(u, near, s, def);
        }
        const gx = tgt.hold && u.slotPos ? u.slotPos.x : tgt.x;
        const gy = tgt.hold && u.slotPos ? u.slotPos.y : tgt.y;
        const pace = this.squadPace(u, gx, gy, speed);
        if (pace > 0) this.marchTo(u, tgt.goal, gx, gy, 1, pace, dt);
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
          // melee troops step right up to the troop or barbarian they're fighting
          if (def.melee && !shoot.isTower && !shoot.isPlayer) {
            const [fx, fy] = posOf(shoot);
            this.stepToward(u, fx, fy, C.MELEE_CLOSE, speed * 0.7, dt);
          }
          continue;
        }
      }

      if (tgt) {
        // On the march: engage enemies that come close, otherwise push on to the target.
        if (!def.heal) {
          let foe = this.pickTarget(u, def, s.range + C.TROOP_AGGRO, false);
          if (foe && tgt.hold) {
            // Holding a spot: only chase enemies that come near it.
            const [fx0, fy0] = posOf(foe);
            if (dist(fx0, fy0, tgt.x, tgt.y) > C.HOLD_LEASH) foe = null;
          }
          if (!foe && u.provoker && this.time - u.provokedAt < C.PROVOKE_TIME) {
            // Being shot from out of reach (an archer): turn on the shooter if it's close enough.
            const v = this.units.get(u.provoker);
            if (v && this.hostile(u.owner, v.owner) && dist(u.x, u.y, v.x, v.y) <= s.range + C.PROVOKE_RANGE) foe = v;
          }
          if (!foe && tgt.hold) {
            // ...and go after any enemy troop that steps within HOLD_LEASH of it.
            let best = C.HOLD_LEASH;
            for (const v of this.nearUnits(tgt.x, tgt.y, C.HOLD_LEASH)) {
              if (!this.hostile(u.owner, v.owner)) continue;
              const d = dist(v.x, v.y, tgt.x, tgt.y);
              if (d <= best) {
                best = d;
                foe = v;
              }
            }
          }
          if (foe) {
            const [fx, fy] = posOf(foe);
            this.stepToward(u, fx, fy, s.range * 0.9, speed, dt);
            continue;
          }
        }
        const stop = tgt.struct ? Math.max(0.6, s.range * 0.85) : tgt.hold ? 0.05 : 1;
        // holding a hex: each troop heads for its own spot in the formation
        const gx = tgt.hold && u.slotPos ? u.slotPos.x : tgt.x;
        const gy = tgt.hold && u.slotPos ? u.slotPos.y : tgt.y;
        const pace = this.squadPace(u, gx, gy, speed);
        if (pace > 0) this.marchTo(u, tgt.goal, gx, gy, stop, pace, dt);
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
        const pace = this.squadPace(u, a.x, a.y, speed);
        if (pace > 0) this.marchTo(u, a.goal, a.x, a.y, a.leash * 0.5, pace, dt);
        continue;
      }

      if (!def.heal) {
        // Home defence: go after enemies in (or right next to) my land nearby. Paths only cross my
        // own land, so troops meet them at the border and never wander out after them.
        const foe = this.homeIntruder(u);
        if (foe) {
          const [fx, fy] = posOf(foe);
          if (this.time >= u.repathAt || !u.dest) {
            this.planUnit(u, fx, fy);
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
      // Stand guard in formation: walk to my spot in the squad's hex and stay there.
      const post = this.squadPost(u);
      const off = dist(u.x, u.y, post.x, post.y);
      if (off <= 0.8) {
        this.stepToward(u, post.x, post.y, 0.02, speed * 0.6, dt); // the last bit, straight onto the spot
      } else {
        if (this.time >= u.idleUntil) {
          this.planUnit(u, post.x, post.y);
          u.idleUntil = this.time + 0.5;
        }
      }
    }
  },

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
    // Straight there: scouts pick spots clear of enemy guns, so they don't need pathfinding.
    this.stepToward(u, u.scoutTo.x, u.scoutTo.y, 1, speed, dt);
  },

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
        if (this.hostile(p.id, t.owner) && dist(x, y, t.x, t.y) < C.structSight(t.kind, t.level)) danger = true;
      }
      for (const q of this.players.values()) if (this.hostile(p.id, q.id) && dist(x, y, q.core.x, q.core.y) < C.CORE_RANGE + 2) danger = true;
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
  },
};
