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
  // straight for now (walls and rivers stop it at the edge until a field is ready).
  // mode 'troop': hostile walls can be broken through (at a cost); 'solid' (workers): no wall can,
  // only gates of their own side let them through.
  getFieldTo(goal, owner = 0, mode = 'troop') {
    // with walls about, each player gets their own fields (gates and walls differ per side)
    const key = this.walls.size && owner ? `${goal}:${owner}:${mode}` : goal;
    let f = this.fields.get(key);
    const stale = !f || (f.version !== this.structVersion && this.time - f.at >= C.PATH_RECOMPUTE_INTERVAL);
    if (stale && this.fieldBudget > 0) {
      this.fieldBudget--;
      const edge = this.walls.size && owner ? this.wallCostFn(owner, true, mode === 'solid') : this.riverEdges ? this.wallCostFn(0, true, false, true) : null;
      f = { dist: Path.computeField(this.w, this.h, this.getExtra(), goal, edge), goal, edge, version: this.structVersion, at: this.time };
      this.fields.set(key, f);
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
    if (a.k === 'e') {
      // Escorting one of our caravans: keep up with it and fight what comes near it. Done when it's
      // delivered (or lost).
      const v = this.units.get(a.id);
      if (!v || !v.trade || v.owner !== u.owner) return null;
      return { x: v.x, y: v.y, goal: this.idx(Math.floor(v.x), Math.floor(v.y)), struct: false, hold: true, escort: true };
    }
    if (a.k === 'j') {
      const camp = this.camps[a.id];
      if (!camp) return null;
      if (camp.alive) a.wait = 0; // it's back: once it's cleared, the order is done
      else if (!a.wait) return null; // cleared
      return { x: camp.x + 0.5, y: camp.y + 0.5, goal: this.idx(camp.x, camp.y), struct: false, campWait: !camp.alive };
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
      if (def.melee && this.wallBlocks(u.owner, u.x, u.y, v.x, v.y)) continue; // no swinging through a wall
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

  // The nearest hostile wall, building or core within reach of a siege ram, or null.
  breakerTarget(u, reach) {
    let best = null;
    let bestD = reach + 0.6;
    const take = (obj, x, y) => {
      const d = dist(u.x, u.y, x, y);
      if (d < bestD) {
        bestD = d;
        best = obj;
      }
    };
    for (const w of this.walls.values()) if (!(w.progress < 1) && this.hostile(u.owner, w.owner)) take(w, w.x, w.y);
    for (const t of this.towers.values()) {
      if (t.owner && this.hostile(u.owner, t.owner) && !this.isShielded(this.players.get(t.owner))) take(t, t.x + 0.5, t.y + 0.5);
    }
    for (const p of this.players.values()) if (p.alive && this.hostile(u.owner, p.id) && !this.isShielded(p)) take(p, p.core.x + 0.5, p.core.y + 0.5);
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
    const wallBonus = !target.isWall ? 1 : def.wallBreaker || (u.kind === 'soldier' ? C.WALL_SOLDIER_BONUS : 1);
    const home = this.onHomeLand(u) ? 1 + C.HOME_DAMAGE_BONUS : 1;
    const buff = this.buffed(u.owner) ? 1 + C.JUNGLE_BUFF_DAMAGE : 1;
    const base = s.damage * buff;
    // (momentum: each core its owner has destroyed adds CONQUEST_SIEGE against buildings)
    const won = Math.min(C.CONQUEST_MAX, (this.players.get(u.owner) || {}).conquests || 0);
    const siege = isStruct ? (def.siege || 1) * (this.suddenDeath() ? C.SUDDEN_DEATH_SIEGE : this.siegeRamp()) * (1 + C.CONQUEST_SIEGE * won) : 1;
    const dmg = base * home * siege * wallBonus;
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
    // (no stepping across a river edge, or a wall it can't pass, between two hexes)
    const th = this.hex.tileHex;
    const bar = this.hasBarriers();
    const cross = (a, b) => {
      if (!bar || th[a] === th[b]) return true;
      const wl = this.wallBetween(th[a], th[b]);
      return !wl || this.wallPassable(wl, u);
    };
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
        if (stamp[n] === gen || !ok(n) || !cross(k, n)) continue;
        if (dx && dy) {
          const a = this.idx(x + dx, y);
          const b = this.idx(x, y + dy);
          if (!ok(a) || !ok(b) || !cross(k, a) || !cross(a, n) || !cross(k, b) || !cross(b, n)) continue;
        }
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

  // Step toward (x, y), stopping `stop` short of it: straight, unless a wall u can't pass is in the
  // way, in which case it follows a short detour (round the wall, or through a gate).
  // A wall too long for a short detour: follow the flow field instead, which finds the way round
  // (an opening or a gate of its side) however far it is.
  stepToward(u, x, y, stop, speed, dt) {
    if (this.hasBarriers() && dist(u.x, u.y, x, y) > stop && this.lineBlocked(u.owner, u.x, u.y, x, y, u)) {
      if (this.detourStep(u, x, y, speed, dt)) return;
      if (this.fieldStep(u, x, y, speed, dt)) return;
    }
    this.stepRaw(u, x, y, stop, speed, dt);
  },

  // One step along the flow field toward (x, y): the long way round walls. False when there's no
  // field this tick, or no way there at all.
  fieldStep(u, x, y, speed, dt) {
    const gx = Math.max(0, Math.min(this.w - 1, Math.floor(x)));
    const gy = Math.max(0, Math.min(this.h - 1, Math.floor(y)));
    const goal = this.idx(gx, gy);
    const f = this.getFieldTo(goal, u.owner, u.worker ? 'solid' : 'troop');
    if (!f) return false;
    const here = this.idx(Math.max(0, Math.min(this.w - 1, Math.floor(u.x))), Math.max(0, Math.min(this.h - 1, Math.floor(u.y))));
    if (f.dist[here] >= Path.INF) return false; // walled off: nothing to do but wait
    const next = Path.nextStep(f.dist, this.w, this.h, this.extra, here, goal, f.edge);
    if (next < 0) return false;
    this.stepRaw(u, (next % this.w) + 0.5, Math.floor(next / this.w) + 0.5, 0, speed, dt);
    return true;
  },

  // Is there a wall `owner` can't pass on the straight line between two points?
  lineBlocked(owner, x1, y1, x2, y2, unit = null) {
    const th = this.hex.tileHex;
    const d = dist(x1, y1, x2, y2);
    const n = Math.min(120, Math.ceil(d / 0.4));
    let prev = th[this.idx(Math.floor(x1), Math.floor(y1))];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const tx = Math.floor(x1 + (x2 - x1) * t);
      const ty = Math.floor(y1 + (y2 - y1) * t);
      if (!this.inBounds(tx, ty)) continue;
      const h = th[this.idx(tx, ty)];
      if (h !== prev) {
        const w = this.wallBetween(prev, h);
        if (w && !(unit ? this.wallPassable(w, unit) : this.wallOpenFor(w, owner))) return true;
        prev = h;
      }
    }
    return false;
  },

  // Follow a short detour (planned at most once a second) toward (x, y). False if there's none.
  detourStep(u, x, y, speed, dt) {
    const gx = Math.max(0, Math.min(this.w - 1, Math.floor(x)));
    const gy = Math.max(0, Math.min(this.h - 1, Math.floor(y)));
    const goal = this.idx(gx, gy);
    if (!u.dpath || u.dgoal !== goal || this.time >= u.dAt) {
      u.dpath = this.planDetour(u, gx, gy);
      u.dgoal = goal;
      u.dAt = this.time + 1;
    }
    while (u.dpath && u.dpath.length) {
      const k = u.dpath[0];
      const tx = (k % this.w) + 0.5;
      const ty = Math.floor(k / this.w) + 0.5;
      if (dist(u.x, u.y, tx, ty) < 0.35) {
        u.dpath.shift();
        continue;
      }
      this.stepRaw(u, tx, ty, 0, speed, dt);
      return true;
    }
    return false;
  },

  // Breadth-first search for a way from u to tile (gx, gy) that doesn't cross walls u can't pass
  // (hostile ones included), within DETOUR_RANGE tiles. Returns tile indices, or null.
  planDetour(u, gx, gy) {
    const w = this.w;
    const R = C.DETOUR_RANGE;
    const sx = Math.max(0, Math.min(w - 1, Math.floor(u.x)));
    const sy = Math.max(0, Math.min(this.h - 1, Math.floor(u.y)));
    const th = this.hex.tileHex;
    const blocked = (a, b) => {
      if (th[a] === th[b]) return false;
      const wl = this.wallBetween(th[a], th[b]);
      return !!wl && !this.wallPassable(wl, u);
    };
    const gen = ++this.bfsGen;
    const stamp = this.bfsStamp;
    const parent = this.bfsParent;
    const queue = this.bfsQueue;
    const start = this.idx(sx, sy);
    const goal = this.idx(gx, gy);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    stamp[start] = gen;
    parent[start] = -1;
    let found = false;
    while (head < tail) {
      const k = queue[head++];
      if (k === goal) {
        found = true;
        break;
      }
      const x = k % w;
      const y = (k - x) / w;
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inBounds(nx, ny) || Math.abs(nx - sx) > R || Math.abs(ny - sy) > R) continue;
        const n = this.idx(nx, ny);
        if (stamp[n] === gen || blocked(k, n)) continue;
        if (dx && dy && (blocked(k, this.idx(x + dx, y)) || blocked(k, this.idx(x, y + dy))
          || blocked(this.idx(x + dx, y), n) || blocked(this.idx(x, y + dy), n))) continue;
        stamp[n] = gen;
        parent[n] = k;
        queue[tail++] = n;
      }
    }
    if (!found) return null;
    const path = [];
    for (let k = goal; k !== start && k !== -1; k = parent[k]) path.push(k);
    path.reverse();
    return path;
  },

  // Step straight toward (x, y), stopping `stop` short of it.
  stepRaw(u, x, y, stop, speed, dt) {
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
    // (with walls about, only the last stretch is walked straight: a wall could be in the way)
    // (also once it's as near the goal as its own spot is: its spot in a formation spilling round
    // the goal is past the goal, and following the goal's field would pull it back and forth)
    const ox = (goal % this.w) + 0.5;
    const oy = Math.floor(goal / this.w) + 0.5;
    // (only where the straight line there is clear of walls and rivers)
    const clear = () => !this.hasBarriers() || !this.lineBlocked(u.owner, u.x, u.y, gx, gy, u);
    const past = dist(u.x, u.y, ox, oy) <= dist(gx, gy, ox, oy) + 1 && clear();
    const f = past || (d < C.PATH_DIRECT_RANGE && clear()) ? null : this.getFieldTo(goal, u.owner);
    if (!f) {
      this.stepToward(u, gx, gy, stop, speed, dt);
      return false;
    }
    const tx = Math.max(0, Math.min(this.w - 1, Math.floor(u.x)));
    const ty = Math.max(0, Math.min(this.h - 1, Math.floor(u.y)));
    const next = Path.nextStep(f.dist, this.w, this.h, this.extra, this.idx(tx, ty), goal, f.edge);
    if (next < 0 || next === goal) {
      // at the goal: the last bit to the exact spot (round a wall or river if one's in the way)
      this.stepToward(u, gx, gy, stop, speed, dt);
      return false;
    }
    this.stepRaw(u, (next % this.w) + 0.5, Math.floor(next / this.w) + 0.5, 0, speed, dt);
    return false;
  },

  // Where each squad is (centre of its troops, not counting scouts off exploring), how far its
  // troops may spread, and its slowest troop's speed.
  squadGroups() {
    const groups = new Map();
    for (const u of this.units.values()) {
      const def = C.UNITS[u.kind];
      if ((def.scout && !u.attack) || u.trade || u.worker) continue;
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

  // ---- formations: troops standing still stand on an even triangular grid of spots laid over
  // the whole map (SLOT_SPACING apart), so no two spots anywhere, even in neighbouring hexes, make
  // troops overlap. A hex holds about 18; a squad fills its own hex from the middle out, then spills
  // into the hexes round it.
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

  // Every formation spot on the map, per hex: the middle of each tile (troops stand one to a tile),
  // nearest the hex's middle first. Built once.
  slotTable() {
    if (this.slotsByHex) return this.slotsByHex;
    const mountains = this.mountains || new Set();
    const byHex = this.hex.hexes.map((h) => (mountains.has(h.i) ? [] : h.tiles.map((k) => [(k % this.w) + 0.5, Math.floor(k / this.w) + 0.5])));
    // no spots hard against a river or mountain (troops would stand in the water, or get caught
    // on the rock's corners)
    for (const h of this.hex.hexes) {
      if (byHex[h.i].length && this.nearBarrierHex(h.i)) byHex[h.i] = byHex[h.i].filter(([x, y]) => !this.nearBarrier(x, y, 0.45));
      byHex[h.i].sort((p, q) => Math.hypot(p[0] - h.cx, p[1] - h.cy) - Math.hypot(q[0] - h.cx, q[1] - h.cy));
    }
    this.slotsByHex = byHex;
    return byHex;
  },

  // The formation spots of hex h that troops can use: none inside a building's body.
  freeSlots(h) {
    const key = this.structVersion;
    if (this.freeSlotsKey !== key) {
      this.freeSlotsKey = key;
      this.freeSlotsCache = new Map();
    }
    let list = this.freeSlotsCache.get(h);
    if (list) return list;
    const all = this.slotTable()[h];
    const solid = [];
    for (const t of this.towers.values()) if (this.hexAt(t.x, t.y) === h) solid.push([t.x + 0.5, t.y + 0.5, C.STRUCT_BODY]);
    for (const p of this.players.values()) if (p.alive && this.hexAt(p.core.x, p.core.y) === h) solid.push([p.core.x + 0.5, p.core.y + 0.5, C.CORE_BODY]);
    list = solid.length ? all.filter(([x, y]) => solid.every(([sx, sy, r]) => Math.hypot(x - sx, y - sy) > r + 0.3)) : all;
    this.freeSlotsCache.set(h, list);
    return list;
  },

  // Has u (standing in a formation that faces an enemy) stepped out of the hex it holds?
  leftPost(u) {
    if (!u.slotPos || !u.slotPos.engaged) return false;
    const tx = Math.max(0, Math.min(this.w - 1, Math.floor(u.x)));
    const ty = Math.max(0, Math.min(this.h - 1, Math.floor(u.y)));
    return this.hex.tileHex[this.idx(tx, ty)] !== u.slotPos.h;
  },

  // The enemy troop nearest the middle of hex h, if one is within FRONT_RANGE of it (squads
  // standing there then push up to face it). null if none.
  frontFoe(owner, h) {
    const hx = this.hex.hexes[h];
    let best = null;
    let bd = C.FRONT_RANGE;
    for (const v of this.nearUnits(hx.cx, hx.cy, C.FRONT_RANGE)) {
      if (v.worker || v.trade || !this.hostile(owner, v.owner)) continue;
      const d = Math.hypot(v.x - hx.cx, v.y - hx.cy);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  },

  // Give every standing troop its spot (u.slotPos): one troop to a tile. A squad holding a hex
  // stands in its middle in ranks FORMATION_WIDE wide, facing out from its core, soldiers in front
  // ('rect', the default) or spread out from the middle ('spread', F). With enemy troops near,
  // it pushes up instead: it takes the tiles of its hex nearest them, soldiers in the front ranks,
  // archers behind, medics at the back. Troops with no room left in the hex take the nearest tiles
  // round it (never across a river; home guards only on their own land).
  assignSlots() {
    const spreadSq = new Set();
    for (const p of this.players.values()) for (const q of p.squads || []) if (q.formation === 'spread') spreadSq.add(q.id);
    const byHex = new Map();
    for (const u of this.units.values()) {
      u.slotPos = null;
      if ((C.UNITS[u.kind].scout && !u.attack) || u.trade || u.worker) continue; // scouts off exploring; caravans; workers
      const h = this.postHex(u);
      if (h < 0) continue;
      const key = `${u.owner}:${h}`;
      if (!byHex.has(key)) byHex.set(key, { h, owner: u.owner, first: u.sq, home: !u.attack, spread: 0, list: [] });
      const grp = byHex.get(key);
      grp.list.push(u);
      grp.first = Math.min(grp.first, u.sq);
      if (spreadSq.has(u.sq)) grp.spread++;
    }
    const taken = new Map(); // owner -> tile keys in use
    const groups = [...byHex.values()].sort((a, b) => a.owner - b.owner || a.first - b.first || a.h - b.h);
    // front to back: soldiers, then siege rams (shielded by them), archers, medics
    const rank = (u) => (C.UNITS[u.kind].heal ? 3 : C.UNITS[u.kind].breaker ? 1 : C.UNITS[u.kind].melee ? 0 : 2);
    for (const grp of groups) {
      const { h, owner, home, list } = grp;
      if (!taken.has(owner)) taken.set(owner, new Set());
      const used = taken.get(owner);
      const hx = this.hex.hexes[h];
      const tkey = (x, y) => Math.floor(y) * this.w + Math.floor(x);
      const free = (x, y) => !used.has(tkey(x, y)) && (!home || this.terr[tkey(x, y)] === owner);
      // the post hex's free tiles, then (only if needed) those of the hexes round it
      let cands = this.freeSlots(h).filter(([x, y]) => free(x, y));
      if (cands.length < list.length) {
        const extra = [];
        for (const j of this.sameSideHexes(h, 2)) {
          if (j === h || (home && this.hexOwner[j] !== owner)) continue;
          for (const sp of this.freeSlots(j)) if (free(sp[0], sp[1])) extra.push(sp);
        }
        extra.sort((p, q) => Math.hypot(p[0] - hx.cx, p[1] - hx.cy) - Math.hypot(q[0] - hx.cx, q[1] - hx.cy));
        cands = cands.concat(extra.slice(0, list.length - cands.length + 8));
      }
      const inPost = new Set(this.hex.hexes[h].tiles);
      list.sort((a, b) => rank(a) - rank(b) || a.sq - b.sq || a.id - b.id);
      const foe = this.frontFoe(owner, h);
      let spots;
      if (foe) {
        // engaged: the tiles nearest the enemy first (the front follows the hex's edge), the post
        // hex before any spill-over
        const fl = Math.hypot(foe.x - hx.cx, foe.y - hx.cy) || 1;
        const ux = (foe.x - hx.cx) / fl;
        const uy = (foe.y - hx.cy) / fl;
        spots = cands.map(([x, y]) => {
          const fwd = (x - hx.cx) * ux + (y - hx.cy) * uy;
          const lat = Math.abs((y - hx.cy) * ux - (x - hx.cx) * uy);
          return [x, y, fwd - lat * 0.55 - (inPost.has(tkey(x, y)) ? 0 : 100)];
        }).sort((a, b) => b[2] - a[2]);
      } else if (grp.spread * 2 > list.length) {
        spots = cands; // spread: from the middle out
      } else {
        spots = this.rankSpots(grp, cands, inPost);
      }
      let k = 0;
      for (const sp of spots) {
        if (k >= list.length) break;
        const t = tkey(sp[0], sp[1]);
        if (used.has(t)) continue;
        used.add(t);
        list[k++].slotPos = { x: sp[0], y: sp[1], h, engaged: !!foe };
      }
      // no spot left nearby: stand where it is rather than shove into the crowd
      for (; k < list.length; k++) list[k].slotPos = { x: list[k].x, y: list[k].y, loose: true, h };
    }
  },

  // A holding squad's ranks: rows FORMATION_WIDE tiles wide (wider for a big crowd) centred on its
  // hex, square to the map and facing whichever way (up, down, left or right) points away from its
  // core. Front row first, each row from the middle out. Spots the ranks want but can't have (a
  // building, a river, the hex's edge) are made up from the free tiles nearest the middle.
  rankSpots(grp, cands, inPost) {
    const { h, owner, list } = grp;
    const hx = this.hex.hexes[h];
    const p = this.players.get(owner);
    let fx = hx.cx - (p.core.x + 0.5);
    let fy = hx.cy - (p.core.y + 0.5);
    if (Math.hypot(fx, fy) < 0.5) {
      fx = 0;
      fy = -1;
    } else if (Math.abs(fx) > Math.abs(fy)) {
      fx = Math.sign(fx);
      fy = 0;
    } else {
      fy = Math.sign(fy);
      fx = 0;
    }
    const n = list.length;
    const cols = n <= C.FORMATION_WIDE * 5 ? Math.min(n, C.FORMATION_WIDE) : Math.ceil(Math.sqrt(n * 1.3));
    const rows = Math.ceil(n / cols);
    const byTile = new Map();
    for (const sp of cands) byTile.set(Math.floor(sp[1]) * this.w + Math.floor(sp[0]), sp);
    const out = [];
    const seen = new Set();
    for (let r = rows - 1; r >= 0; r--) {
      const inRow = Math.min(cols, n - (rows - 1 - r) * cols) || cols;
      const along = [];
      for (let c = 0; c < inRow; c++) along.push(c - (inRow - 1) / 2);
      along.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
      const ro = r - (rows - 1) / 2;
      for (const co of along) {
        const x = hx.cx + -fy * co + fx * ro;
        const y = hx.cy + fx * co + fy * ro;
        const t = Math.floor(y) * this.w + Math.floor(x);
        const sp = byTile.get(t);
        if (sp && !seen.has(t)) {
          seen.add(t);
          out.push(sp);
        }
      }
    }
    // (what's missing: the free tiles nearest the middle)
    for (const sp of cands) {
      const t = Math.floor(sp[1]) * this.w + Math.floor(sp[0]);
      if (!seen.has(t)) {
        seen.add(t);
        out.push(sp);
      }
    }
    return out;
  },

  // The permanent barrier edges (rivers without bridges, mountain sides) as segments, and the
  // hexes that have one. Built once.
  barrierSegs() {
    if (this.barrierCache) return this.barrierCache;
    const segs = [];
    const hexes = new Set();
    for (const w of this.wallAt.values()) {
      if (!w.river) continue;
      const e = this.edgeCorners(w.a, w.b);
      if (!e) continue;
      segs.push([e[0][0], e[0][1], e[1][0], e[1][1]]);
      hexes.add(w.a);
      hexes.add(w.b);
    }
    this.barrierCache = { segs, hexes };
    return this.barrierCache;
  },

  nearBarrierHex(h) {
    return this.barrierSegs().hexes.has(h);
  },

  // Is (x, y) within r of a river or mountain edge?
  nearBarrier(x, y, r) {
    for (const [x1, y1, x2, y2] of this.barrierSegs().segs) {
      if (Math.abs(x - x1) > 4 && Math.abs(x - x2) > 4) continue;
      if (Math.abs(y - y1) > 4 && Math.abs(y - y2) > 4) continue;
      const vx = x2 - x1;
      const vy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / (vx * vx + vy * vy)));
      if (Math.hypot(x - x1 - vx * t, y - y1 - vy * t) < r) return true;
    }
    return false;
  },

  // The hexes within `depth` steps of hex h that can be reached without crossing a river.
  sameSideHexes(h, depth) {
    const seen = new Set([h]);
    let ring = [h];
    for (let d = 0; d < depth && ring.length; d++) {
      const next = [];
      for (const j of ring) {
        for (const n of this.hex.hexes[j].n) {
          if (seen.has(n) || this.riverBetween(j, n)) continue;
          seen.add(n);
          next.push(n);
        }
      }
      ring = next;
    }
    return seen;
  },

  // Push troops apart so none sit on top of each other (friend or foe), and out of buildings and
  // barbarians (but never push a defender off its own land). Each overlap is resolved part of the way per tick, so crowds settle smoothly.
  separateUnits() {
    // In formation: at (or stepping onto) its own spot. Spots are SLOT_SPACING apart, so troops in
    // formation never need pushing apart; one coming in to its spot past others is let through.
    const member = (u) => u.slotPos && !u.slotPos.loose;
    const inForm = (u) => member(u) && Math.abs(u.x - u.slotPos.x) + Math.abs(u.y - u.slotPos.y) < 1.2;
    const before = new Map();
    for (const u of this.units.values()) if (!u.attack) before.set(u, [u.x, u.y]);
    for (const u of this.units.values()) {
      for (const v of this.nearUnits(u.x, u.y, C.UNIT_SPACING)) {
        if (v.id <= u.id) continue;
        // Friendly and allied units (troops, workers, caravans) walk straight through each other,
        // so nobody blocks anybody's way; only standing troops spread out a little (a squad at its
        // post keeps its formation). Enemies can't pass: front lines meet.
        const foes = this.hostile(u.owner, v.owner);
        if (!foes && (u.trade || v.trade || u.worker || v.worker || u.moving || v.moving)) continue;
        const R = foes ? C.ENEMY_SPACING : C.UNIT_SPACING;
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
        // A troop in formation holds its spot; one that isn't steps aside instead (otherwise the
        // two would shove each other back and forth for ever).
        const fu = !foes && inForm(u);
        const fv = !foes && inForm(v);
        // (both in formation, or one in it and the other on its way to its own spot: no pushing)
        if ((fu || fv) && member(u) && member(v)) continue;
        const pu = fu ? 0 : fv ? 2 : 1;
        const push = (R - Math.min(d, R)) * 0.45;
        u.x -= dx * push * pu;
        u.y -= dy * push * pu;
        v.x += dx * push * (2 - pu);
        v.y += dy * push * (2 - pu);
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

  // How far each tile is from owner's land (0 on it, up to RAID_RANGE + 1), rebuilt when land changes.
  homeZone(owner) {
    if (!this.zones) this.zones = new Map();
    let z = this.zones.get(owner);
    if (z && z.ver === this.terrVersion) return z.d;
    const n = this.w * this.h;
    const d = z ? z.d : new Uint8Array(n);
    const far = C.RAID_RANGE + 1;
    d.fill(far);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (let k = 0; k < n; k++) {
      if (this.terr[k] === owner) {
        d[k] = 0;
        queue[tail++] = k;
      }
    }
    while (head < tail) {
      const k = queue[head++];
      if (d[k] >= far - 1) continue;
      const x = k % this.w;
      const y = (k - x) / this.w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const j = ny * this.w + nx;
          if (d[j] > d[k] + 1) {
            d[j] = d[k] + 1;
            queue[tail++] = j;
          }
        }
      }
    }
    this.zones.set(owner, { ver: this.terrVersion, d });
    return d;
  },

  // The nearest enemy troop or worker (or barbarian out for blood) within RAID_RANGE of troop u's
  // owner's border and HOME_ALERT + RAID_RANGE of u, or null. (Caravans are left alone.)
  borderRaider(u) {
    if (this.suddenDeath()) return null;
    const zone = this.homeZone(u.owner);
    const reach = C.HOME_ALERT + C.RAID_RANGE;
    const near = (x, y) => this.inBounds(Math.floor(x), Math.floor(y)) && zone[this.idx(Math.floor(x), Math.floor(y))] <= C.RAID_RANGE;
    let foe = null;
    let best = reach;
    for (const v of this.nearUnits(u.x, u.y, reach)) {
      if (v.trade || !this.hostile(u.owner, v.owner)) continue;
      const d = dist(u.x, u.y, v.x, v.y);
      if (d < best && near(v.x, v.y)) {
        best = d;
        foe = v;
      }
    }
    for (const c of this.creeps.values()) {
      if (c.angry !== u.owner) continue;
      const d = dist(u.x, u.y, c.x, c.y);
      if (d < best && near(c.x, c.y)) {
        best = d;
        foe = c;
      }
    }
    return foe;
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
      if (u.trade) {
        this.caravanTick(u, dt);
        continue;
      }
      if (u.worker) {
        this.workerTick(u, dt);
        continue;
      }
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

      if (u.wallHit && this.time - u.wallHitAt < 0.6 && !def.heal) {
        // Walked into a hostile wall on the way: hack at it until it's down.
        const w = this.walls.get(u.wallHit);
        if (w && this.hostile(u.owner, w.owner)) {
          if (u.cd <= 0) this.unitFire(u, w, s, def);
          continue;
        }
        u.wallHit = 0;
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

      // Stances: 'aggressive' squads fight everything they meet on the way; 'defensive' ones (the
      // default) march past fights; 'hold' squads never chase, only fight what's in reach.
      const stance = u.stance || 'defensive';

      // Marching to a far-off target: don't get pulled into fights on the way. Troops keep walking
      // and only shoot at enemy troops (or angry barbarians) in reach as they pass; once they're
      // within MARCH_ENGAGE of the target they fight everything there as usual.
      // (attacking a base: once on that player's land, troops fight everything there)
      const inBase = u.attack && u.attack.k === 'c' && this.terr[this.idx(Math.max(0, Math.min(this.w - 1, Math.floor(u.x))), Math.max(0, Math.min(this.h - 1, Math.floor(u.y))))] === u.attack.id;
      if (tgt && !def.heal && stance !== 'aggressive' && !inBase && dist(u.x, u.y, tgt.x, tgt.y) > C.MARCH_ENGAGE) {
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
        // In range of something? Stand and fight. (In sudden death, a troop sent at a building hits
        // that building whenever it can reach it, defenders or not: cores are at 1 HP by then. Siege
        // rams always go for walls and buildings in reach first.)
        let shoot = def.breaker ? this.breakerTarget(u, s.range) : null;
        if (tgt && tgt.struct && this.suddenDeath() && u.attack) {
          const obj = u.attack.k === 'c' ? this.players.get(u.attack.id) : this.towers.get(u.attack.id);
          if (obj && dist(u.x, u.y, tgt.x, tgt.y) <= s.range + 0.6 && !this.isShielded(u.attack.k === 'c' ? obj : this.players.get(obj.owner))) shoot = obj;
        }
        if (!shoot) shoot = this.pickTarget(u, def, s.range, true);
        if (shoot) {
          u.path = [];
          u.dest = null;
          if (u.cd <= 0) this.unitFire(u, shoot, s, def);
          const held = u.slotPos && !u.slotPos.loose && (u.slotPos.engaged || !def.melee);
          if (held) {
            // in a formation facing the enemy (and archers in any formation): fight from its own
            // spot, walking on to it if it isn't there yet, so the ranks stay neat and the front
            // lines meet at the hexes' border
            if (Math.abs(u.x - u.slotPos.x) + Math.abs(u.y - u.slotPos.y) > 0.15) this.stepToward(u, u.slotPos.x, u.slotPos.y, 0.05, speed * 0.8, dt);
          } else if (def.melee && !shoot.isTower && !shoot.isPlayer) {
            // otherwise melee troops step right up to the troop or barbarian they're fighting
            const [fx, fy] = posOf(shoot);
            this.stepToward(u, fx, fy, C.MELEE_CLOSE, speed * 0.7, dt);
          }
          continue;
        }
      }

      if (tgt) {
        // On the march: engage enemies that come close (unless holding back), otherwise push on.
        if (!def.heal && stance !== 'hold') {
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
          // In formation facing an enemy: hold the line, fighting what's in reach from its spot,
          // and only step out after enemies that have got into its own hex.
          if (foe && u.slotPos && u.slotPos.engaged) {
            const [fx0, fy0] = posOf(foe);
            if (this.hex.tileHex[this.idx(Math.max(0, Math.min(this.w - 1, Math.floor(fx0))), Math.max(0, Math.min(this.h - 1, Math.floor(fy0))))] !== u.slotPos.h) foe = null;
          }
          if (foe) {
            const [fx, fy] = posOf(foe);
            const [ox, oy] = [u.x, u.y];
            this.stepToward(u, fx, fy, s.range * 0.9, speed, dt);
            if (this.leftPost(u)) [u.x, u.y] = [ox, oy];
            continue;
          }
        }
        // (waiting for a camp to come back: stand round its edge, ready to pounce)
        const stop = tgt.struct ? Math.max(0.6, s.range * 0.85) : tgt.escort ? 1.8 : tgt.hold ? 0.05 : tgt.campWait ? 2.5 : 1;
        // holding a hex: each troop heads for its own spot in the formation
        const gx = tgt.hold && u.slotPos ? u.slotPos.x : tgt.x;
        const gy = tgt.hold && u.slotPos ? u.slotPos.y : tgt.y;
        // (forming up at a held spot: no waiting for the squad, the formation spreads it out anyway)
        const pace = tgt.hold ? speed : this.squadPace(u, gx, gy, speed);
        if (pace > 0) this.marchTo(u, tgt.goal, gx, gy, stop, pace, dt);
        continue;
      }

      // Defending.
      if (stance === 'aggressive' && !def.heal) {
        // An aggressive squad at home goes out after enemy troops near the border (within
        // RAID_RANGE of it), then comes back.
        const foe = this.borderRaider(u);
        if (foe) {
          const [fx, fy] = posOf(foe);
          this.stepToward(u, fx, fy, s.range * 0.9, speed, dt);
          continue;
        }
      }
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

      if (!def.heal && stance !== 'hold') {
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
      if (off <= 1.5) {
        this.stepToward(u, post.x, post.y, 0.02, speed * 0.6, dt); // the last bit, straight onto the spot
      } else if (this.time >= u.idleUntil) {
        this.planUnit(u, post.x, post.y);
        u.idleUntil = this.time + 0.5;
        // (already in the tile nearest the spot: no path to walk, so just step straight there)
        if (!u.dest) this.stepToward(u, post.x, post.y, 0.02, speed * 0.6, dt);
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
    // A new spot once this one has been uncovered (scouts see far: no need to walk all the way),
    // reached, or taken too long.
    const seenIt = u.scoutTo && p.explored && p.explored[this.idx(Math.floor(u.scoutTo.x), Math.floor(u.scoutTo.y))];
    if (!u.scoutTo || seenIt || this.time > u.scoutUntil || dist(u.x, u.y, u.scoutTo.x, u.scoutTo.y) < 1.5) {
      u.scoutTo = this.pickScoutSpot(u, p);
      u.scoutUntil = this.time + C.SCOUT_LEG_TIME;
    }
    // Straight there (round walls and rivers when they're in the way): scouts pick spots clear of
    // enemy guns.
    this.stepToward(u, u.scoutTo.x, u.scoutTo.y, 1, speed, dt);
  },

  // Where a scout heads next: the fog. Looks over the whole map on a coarse grid for unexplored
  // spots out of reach of enemy towers and cores, and picks one with a lot of fog round it that's
  // near the scout (the nearest fog first, so it sweeps outward rather than zigzagging), away from
  // where its owner's other scouts are going.
  pickScoutSpot(u, p) {
    const ex = p.explored;
    const unseen = (x, y) => this.inBounds(x, y) && !(ex && ex[this.idx(x, y)]);
    const others = [];
    for (const v of this.units.values()) if (v !== u && v.owner === p.id && v.worker && v.scoutTo && v.job && v.job.type === 'scout') others.push(v.scoutTo);
    const danger = [];
    for (const t of this.towers.values()) if (this.hostile(p.id, t.owner)) danger.push([t.x, t.y, C.structSight(t.kind, t.level) + 1]);
    for (const q of this.players.values()) if (q.alive && this.hostile(p.id, q.id)) danger.push([q.core.x, q.core.y, C.CORE_RANGE + 3]);
    const STEP = 5;
    let best = null;
    let bestScore = -Infinity;
    for (let y = 2; y < this.h - 2; y += STEP) {
      for (let x = 2; x < this.w - 2; x += STEP) {
        const cx = x + ((y / STEP) % 2 ? STEP / 2 : 0);
        if (!unseen(Math.floor(cx), y)) continue;
        if (this.mountains.has(this.hex.tileHex[this.idx(Math.floor(cx), y)])) continue; // (scouts see over mountains, but can't climb them)
        if (danger.some(([dx, dy, r]) => dist(cx, y, dx, dy) < r)) continue;
        let fog = 0; // how much fog round it (a 7x7 sample, 3 tiles apart)
        for (let oy = -9; oy <= 9; oy += 3) for (let ox = -9; ox <= 9; ox += 3) if (unseen(Math.floor(cx + ox), y + oy)) fog++;
        const d = dist(u.x, u.y, cx, y);
        let score = fog * 1.5 - d * 1.2 + this.rand() * 4;
        for (const o of others) if (dist(o.x, o.y, cx, y) < 18) score -= 40; // spread out
        if (score > bestScore) {
          bestScore = score;
          best = { x: cx, y };
        }
      }
    }
    return best || { x: p.core.x + 0.5, y: p.core.y + 0.5 }; // all explored (or all guarded): home
  },
};
