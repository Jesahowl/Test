'use strict';

// Walls on the edges between hexes, along a player's border.
// - A wall sits between one of its owner's hexes and a hex that isn't theirs. It blocks everyone's
//   troops and caravans (its owner's too) unless it is a gate: gates let their owner's and allies'
//   troops and caravans through. Every wall is the same strength (no upgrades).
// - Hostile troops break through: crossing a hostile wall costs their pathfinding extra (by its HP),
//   so they go round when there's a reasonable way, and a troop that walks into one hacks at it.
//   Soldiers hit walls harder.
// - If the wall's owner comes to own both sides (they bought the hex beyond it), it's removed and
//   partly refunded; if they own neither side any more (the hex was captured or released), it crumbles.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, Path, round2 } = require('./common');

module.exports = {
  initWalls() {
    this.walls = new Map(); // id -> { isWall, id, owner, a, b, hp, maxHp, gate, x, y }
    this.wallAt = new Map(); // edge key -> wall
    this.wallsTerrVersion = -1;
    this.wallBroken = new Map(); // edge key -> when a wall there was knocked down by enemies
  },

  edgeKey(a, b) {
    const n = this.hex.hexes.length;
    return a < b ? a * n + b : b * n + a;
  },

  wallBetween(a, b) {
    if (a === b || !this.walls.size) return null;
    return this.wallAt.get(this.edgeKey(a, b)) || null;
  },

  // Can a troop (or caravan) of `owner` pass wall w? Through gates of its own side only.
  wallOpenFor(w, owner) {
    if (w.progress < 1) return true; // still being built: no wall yet
    return w.gate && !this.hostile(owner, w.owner);
  },

  // Can unit u pass wall w? Through its side's gates; caravans (trade carts) also through every wall
  // of their own side and their allies'. Only enemy walls stop a caravan.
  wallPassable(w, u) {
    return this.wallOpenFor(w, u.owner) || (!!u.trade && !this.hostile(u.owner, w.owner));
  },

  // Is the edge between hexes a and b one pid can wall: neighbours, exactly one of them pid's?
  canWallEdge(pid, a, b) {
    const ha = this.hex.hexes[a];
    if (!ha || !this.hex.hexes[b] || !ha.n.includes(b)) return false;
    if ((this.hexOwner[a] === pid) === (this.hexOwner[b] === pid)) return false;
    return !this.wallBetween(a, b) && this.wallBuildProblem(pid, a, b) === null;
  },

  // Why pid can't wall edge a-b right now (null: they can): it was just broken, or enemies are at it.
  wallBuildProblem(pid, a, b) {
    const broke = this.wallBroken.get(this.edgeKey(a, b));
    if (broke !== undefined && this.time - broke < C.WALL_REBUILD_DELAY) return `That wall was just broken: rebuild it in ${Math.ceil(C.WALL_REBUILD_DELAY - (this.time - broke))}s`;
    const ha = this.hex.hexes[a];
    const hb = this.hex.hexes[b];
    const mx = (ha.cx + hb.cx) / 2;
    const my = (ha.cy + hb.cy) / 2;
    for (const u of this.nearUnits(mx, my, C.WALL_ENEMY_GAP)) {
      if (this.hostile(pid, u.owner) && Math.hypot(u.x - mx, u.y - my) <= C.WALL_ENEMY_GAP) return 'Enemies are too close to build a wall there';
    }
    return null;
  },

  // Build walls on edges [[a, b], ...] (in order) until gold runs out. Returns null or an error.
  buildWalls(pid, edges) {
    this.lastWalls = 0;
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid build';
    if (!Array.isArray(edges) || !edges.length) return 'No wall picked';
    let reason = null;
    for (const e of edges.slice(0, C.WALL_BUILD_MAX)) {
      if (!Array.isArray(e) || e.length !== 2) continue;
      const a = Number(e[0]);
      const b = Number(e[1]);
      if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
      if (!this.canWallEdge(pid, a, b)) {
        if (!reason) {
          const ha = this.hex.hexes[a];
          const border = ha && this.hex.hexes[b] && ha.n.includes(b) && (this.hexOwner[a] === pid) !== (this.hexOwner[b] === pid) && !this.wallBetween(a, b);
          reason = border ? this.wallBuildProblem(pid, a, b) : 'Walls go on your border, between your land and land that isn\'t yours';
        }
        continue;
      }
      if (p.gold < C.WALL_COST) {
        reason = 'Not enough gold';
        break;
      }
      p.gold -= C.WALL_COST;
      this.addWall(pid, a, b);
      this.lastWalls++;
    }
    return this.lastWalls ? null : reason || 'No wall built';
  },

  addWall(pid, a, b) {
    const id = this.nextId++;
    const ha = this.hex.hexes[a];
    const hb = this.hex.hexes[b];
    const hp = C.WALL_HP;
    const w = {
      isWall: true, id, owner: pid, a: Math.min(a, b), b: Math.max(a, b), hp, maxHp: hp, gate: false,
      progress: this.instantBuild ? 1 : 0, // a site until workers build it (see workers.js)
      x: (ha.cx + hb.cx) / 2, y: (ha.cy + hb.cy) / 2, // the middle of the edge
    };
    if (w.progress < 1) w.hp = Math.round(hp * C.SITE_START_HP);
    this.walls.set(id, w);
    this.wallAt.set(this.edgeKey(a, b), w);
    this.structVersion++; // paths change
    return w;
  },

  removeWall(w) {
    this.walls.delete(w.id);
    this.wallAt.delete(this.edgeKey(w.a, w.b));
    this.structVersion++;
  },

  // Gold put into a wall: the segment and its gate.
  wallSpent(w) {
    return C.WALL_COST + (w.gate ? C.WALL_GATE_COST : 0);
  },

  // Turn a wall into a gate (costs WALL_GATE_COST), or a gate back into a plain wall (free).
  toggleGate(pid, id) {
    const p = this.players.get(pid);
    const w = this.walls.get(id);
    if (!p || !p.alive || !w || w.owner !== pid) return 'Invalid gate';
    if (!w.gate) {
      if (p.gold < C.WALL_GATE_COST) return 'Not enough gold';
      p.gold -= C.WALL_GATE_COST;
    }
    w.gate = !w.gate;
    this.structVersion++;
    return null;
  },

  // Knock down one of your own walls (part of its cost back).
  demolishWall(pid, id) {
    const p = this.players.get(pid);
    const w = this.walls.get(id);
    if (!p || !p.alive || !w || w.owner !== pid) return 'Invalid wall';
    if (w.hitAt !== undefined && this.time - w.hitAt < C.SELL_LOCK) return "Can't knock it down while it's under attack";
    p.gold += Math.floor(this.wallSpent(w) * C.WALL_REFUND);
    this.removeWall(w);
    return null;
  },

  damageWall(w, amount) {
    if (!this.walls.has(w.id)) return;
    w.hp -= amount;
    w.hitAt = this.time;
    this.fx.push({ k: 'hit', x: round2(w.x), y: round2(w.y) });
    if (w.hp > 0) return;
    this.fx.push({ k: 'boom', x: round2(w.x), y: round2(w.y), r: 0.9 });
    this.wallBroken.set(this.edgeKey(w.a, w.b), this.time);
    this.removeWall(w);
  },

  // The two corners of the edge between neighbouring hexes a and b (or null).
  edgeCorners(a, b) {
    const ha = this.hex.hexes[a];
    for (let k = 0; k < 6; k++) {
      if (this.hex.across(ha, k) === b) {
        const cs = this.hex.corners(ha);
        return [cs[k], cs[(k + 1) % 6]];
      }
    }
    return null;
  },

  // pid just bought hex i: the walls of theirs on its edges with their land (now inside it) move out
  // onto i's free outer edges, as many as there were, so the wall line follows the border. Edges
  // that join up with pid's other walls take them first, then the ones nearest where they stood;
  // a gate stays a gate and a wall keeps its damage. Any that find no free edge are refunded.
  carryWallsOut(pid, i) {
    if (!this.walls.size) return;
    const h = this.hex.hexes[i];
    const moving = [];
    for (const j of h.n) {
      const w = this.wallBetween(i, j);
      if (w && w.owner === pid && this.hexOwner[j] === pid) moving.push(w);
    }
    if (!moving.length) return;
    for (const w of moving) this.removeWall(w);
    const key = ([x, y]) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
    const cornersOfMine = new Set();
    for (const w of this.walls.values()) {
      if (w.owner !== pid) continue;
      const e = this.edgeCorners(w.a, w.b);
      if (e) for (const c of e) cornersOfMine.add(key(c));
    }
    const mx = moving.reduce((t, w) => t + w.x, 0) / moving.length;
    const my = moving.reduce((t, w) => t + w.y, 0) / moving.length;
    const spots = [];
    for (const j of h.n) {
      if (this.hexOwner[j] === pid || this.wallBetween(i, j)) continue;
      const e = this.edgeCorners(i, j);
      if (!e) continue;
      const hj = this.hex.hexes[j];
      spots.push({ j, e, d: Math.hypot((h.cx + hj.cx) / 2 - mx, (h.cy + hj.cy) / 2 - my) });
    }
    const owner = this.players.get(pid);
    moving.sort((p, q) => Math.hypot(p.x - mx, p.y - my) - Math.hypot(q.x - mx, q.y - my));
    for (const old of moving) {
      // the free edge that joins most of pid's walls (counting ones just moved), then the nearest
      let best = -1;
      let bestJoins = -1;
      spots.forEach((sp, k) => {
        const joins = sp.e.filter((c) => cornersOfMine.has(key(c))).length;
        if (joins > bestJoins || (joins === bestJoins && sp.d < spots[best].d)) {
          best = k;
          bestJoins = joins;
        }
      });
      if (best < 0) {
        if (owner && owner.alive) owner.gold += Math.floor(this.wallSpent(old) * C.WALL_REFUND);
        continue;
      }
      const [spot] = spots.splice(best, 1);
      const w = this.addWall(pid, i, spot.j);
      w.hp = Math.min(w.maxHp, old.hp);
      w.gate = old.gate;
      for (const c of spot.e) cornersOfMine.add(key(c));
    }
  },

  // After land changes hands: walls with their owner on both sides are refunded and removed; walls
  // with their owner on neither side crumble.
  maintainWalls() {
    if (!this.walls.size || this.wallsTerrVersion === this.terrVersion) return;
    this.wallsTerrVersion = this.terrVersion;
    for (const w of [...this.walls.values()]) {
      const oa = this.hexOwner[w.a] === w.owner;
      const ob = this.hexOwner[w.b] === w.owner;
      if (oa && ob) {
        const p = this.players.get(w.owner);
        if (p && p.alive) p.gold += Math.floor(this.wallSpent(w) * C.WALL_REFUND);
        this.removeWall(w);
      } else if (!oa && !ob) {
        this.fx.push({ k: 'boom', x: round2(w.x), y: round2(w.y), r: 0.7 });
        this.removeWall(w);
      }
    }
  },

  // Pathfinding: the extra cost of stepping from tile u to tile v for `owner`'s troops (-1: can't).
  // Only steps between two hexes can cross a wall. Hostile walls cost by their strength (troops
  // break through the weakest point); own and allied walls are solid unless they're gates.
  // breakable = false (caravans): hostile walls are solid too.
  wallCostFn(owner, breakable = true) {
    if (!this.walls.size) return null;
    const th = this.hex.tileHex;
    return (u, v) => {
      const ha = th[u];
      const hb = th[v];
      if (ha === hb) return 0;
      const w = this.wallAt.get(this.edgeKey(ha, hb));
      if (!w) return 0;
      if (this.wallOpenFor(w, owner)) return 0;
      if (!breakable) return this.hostile(owner, w.owner) ? -1 : 0; // caravans: friendly walls are open
      if (!this.hostile(owner, w.owner)) return -1;
      return Path.structureCost(C, w.maxHp);
    };
  },

  // Each tick, after everyone has moved: nothing passes through a wall it can't. A troop that tried
  // to step through a hostile wall stays put and remembers it, so it can hack at it.
  enforceWalls() {
    if (!this.walls.size) return;
    const th = this.hex.tileHex;
    for (const u of this.units.values()) {
      if (u.px === undefined) continue;
      const ka = this.idx(Math.max(0, Math.min(this.w - 1, Math.floor(u.px))), Math.max(0, Math.min(this.h - 1, Math.floor(u.py))));
      const kb = this.idx(Math.max(0, Math.min(this.w - 1, Math.floor(u.x))), Math.max(0, Math.min(this.h - 1, Math.floor(u.y))));
      if (th[ka] === th[kb]) continue;
      const w = this.wallAt.get(this.edgeKey(th[ka], th[kb]));
      if (!w || this.wallPassable(w, u)) continue;
      u.x = u.px;
      u.y = u.py;
      if (this.hostile(u.owner, w.owner)) {
        u.wallHit = w.id;
        u.wallHitAt = this.time;
      }
    }
  },

  // Is a wall (that `owner` can't pass) between points (x1, y1) and (x2, y2) in neighbouring hexes?
  wallBlocks(owner, x1, y1, x2, y2) {
    if (!this.walls.size) return false;
    const th = this.hex.tileHex;
    const a = th[this.idx(Math.floor(x1), Math.floor(y1))];
    const b = th[this.idx(Math.floor(x2), Math.floor(y2))];
    const w = this.wallBetween(a, b);
    return !!w && !this.wallOpenFor(w, owner);
  },
};
