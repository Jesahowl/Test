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
  },

  // Best thing for troop u to hit within `reach`: the nearest enemy troop, else monsters fighting
  // us (or the camp we were sent to), else - if `structures` - enemy towers and cores.
  pickTarget(u, def, reach, structures) {
    let best = null;
    let bestScore = Infinity;
    for (const v of this.nearUnits(u.x, u.y, reach)) {
      if (v.owner === u.owner) continue;
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
      if (!t.owner || t.owner === u.owner || this.isShielded(this.players.get(t.owner))) continue;
      const d = dist(u.x, u.y, t.x + 0.5, t.y + 0.5);
      if (d > reach) continue;
      if (d < bestScore) {
        bestScore = d;
        best = t;
      }
    }
    for (const p of this.players.values()) {
      if (!p.alive || p.id === u.owner || this.isShielded(p)) continue;
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
    const [tx, ty] = posOf(target);
    const isStruct = target.isTower || target.isPlayer;
    const home = this.onHomeLand(u) ? 1 + C.HOME_DAMAGE_BONUS : 1;
    const buff = this.buffed(u.owner) ? 1 + C.JUNGLE_BUFF_DAMAGE : 1;
    const base = s.damage * buff; // what everything around a giant's target takes
    const siege = isStruct ? (def.siege || 1) * (this.suddenDeath() ? C.SUDDEN_DEATH_SIEGE : this.siegeRamp()) : 1;
    const dmg = base * home * siege;
    if (def.cleave) {
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
    } else {
      this.hurt(target, dmg, u.owner);
      this.fx.push({ k: 'slash', x: round2(tx), y: round2(ty) });
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

  updateUnits(dt) {
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
        if (tgt) this.marchTo(u, tgt.goal, tgt.x, tgt.y, 2, speed, dt);
        else this.scoutTick(u, speed, dt);
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
          let foe = this.pickTarget(u, def, s.range + C.TROOP_AGGRO, false);
          if (foe && tgt.hold) {
            // Holding a spot: only chase enemies that come near it.
            const [fx0, fy0] = posOf(foe);
            if (dist(fx0, fy0, tgt.x, tgt.y) > C.HOLD_LEASH) foe = null;
          }
          if (!foe && tgt.hold) {
            // ...and go after any enemy troop that steps within HOLD_LEASH of it.
            let best = C.HOLD_LEASH;
            for (const v of this.nearUnits(tgt.x, tgt.y, C.HOLD_LEASH)) {
              if (v.owner === u.owner) continue;
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
        const stop = tgt.struct ? Math.max(0.6, s.range * 0.85) : tgt.hold ? 1.2 : 1;
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
  },
};
