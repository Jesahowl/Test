'use strict';

// Trade: trade posts and the caravans they send to allies.
// - Each trade post trades with one of its owner's allies' trade posts (picked automatically, or
//   chosen by the player). Every CARAVAN_EVERY seconds it sends a caravan there.
// - A caravan is a unit (kind 'caravan', u.trade set): it shows up, gets hurt and is hunted like a
//   troop, but it isn't part of any squad or wave and can't be ordered. It follows a path planned
//   when it sets off that steers around hostile towers and cores; its guards shoot enemies in reach
//   as it rolls on.
// - On arrival, both players get the cargo. Raiders who destroy one take RAID_SHARE of it. If the
//   route breaks (the alliance ends, or the destination post is lost) caravans on it vanish.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, Path, dist, round2 } = require('./common');

module.exports = {
  // Is trade post t (of player pid) able to trade with tower o?
  canTradeWith(t, o) {
    return !!o && o !== t && o.kind === 'trade' && !!o.owner && !o.ruin && this.allied(t.owner, o.owner);
  },

  // Cargo of a caravan from post t to post o (paid to each of the two players).
  cargoOf(t, o) {
    const d = dist(t.x, t.y, o.x, o.y);
    return Math.round((C.CARAVAN_BASE + C.CARAVAN_PER_TILE * d) * (1 + C.CARAVAN_LEVEL_CARGO * (t.level - 1)));
  },

  // pid picks which allied trade post their post `id` trades with.
  setTradePartner(pid, id, partnerId) {
    const t = this.towers.get(id);
    if (!t || t.owner !== pid || t.kind !== 'trade') return 'Pick one of your trade posts';
    const o = this.towers.get(partnerId);
    if (!this.canTradeWith(t, o)) return 'You can only trade with an ally\'s trade post';
    if (t.partner !== o.id) {
      t.partner = o.id;
      t.nextCaravan = this.time + C.CARAVAN_EVERY;
      this.structVersion++;
    }
    return null;
  },

  // Each tick: keep every post's route valid (picking a partner if it has none), send caravans,
  // and move them.
  updateTrade() {
    const posts = [];
    for (const t of this.towers.values()) if (t.kind === 'trade' && t.owner && !t.ruin) posts.push(t);
    for (const t of posts) {
      const cur = this.towers.get(t.partner);
      if (t.partner && !this.canTradeWith(t, cur)) {
        t.partner = 0;
        t.road = null;
        this.structVersion++;
      }
      if (!t.partner) {
        // the nearest allied trade post, preferring one nobody of mine already trades with
        let best = null;
        let bestScore = Infinity;
        for (const o of posts) {
          if (!this.canTradeWith(t, o)) continue;
          const taken = posts.some((m) => m !== t && m.owner === t.owner && m.partner === o.id);
          const score = dist(t.x, t.y, o.x, o.y) + (taken ? 1000 : 0);
          if (score < bestScore) {
            bestScore = score;
            best = o;
          }
        }
        if (best) {
          t.partner = best.id;
          t.nextCaravan = this.time + Math.min(C.CARAVAN_EVERY, 8); // the first one sets off soon
          this.structVersion++;
        }
      }
      if (t.partner && this.time >= (t.nextCaravan || 0)) {
        t.nextCaravan = this.time + C.CARAVAN_EVERY;
        this.sendCaravan(t, this.towers.get(t.partner));
      }
    }
  },

  sendCaravan(t, o) {
    const p = this.players.get(t.owner);
    if (!p || !p.alive) return null;
    const id = this.nextId++;
    const stats = C.towerStats('caravan', t.level);
    // set off from the side of the post facing the destination
    const a = Math.atan2(o.y - t.y, o.x - t.x);
    const u = {
      isUnit: true, id, kind: 'caravan', owner: p.id, x: t.x + 0.5 + Math.cos(a) * 1.2, y: t.y + 0.5 + Math.sin(a) * 1.2,
      level: t.level, hp: stats.hp, maxHp: stats.hp, cd: 0, anchor: 0, attack: null, path: [], dest: null,
      repathAt: 0, idleUntil: 0, sq: 0,
      trade: { from: t.id, to: o.id, toOwner: o.owner, cargo: this.cargoOf(t, o) },
    };
    this.units.set(id, u);
    this.planCaravan(u);
    this.fx.push({ k: 'wave', x: t.x + 0.5, y: t.y + 0.5, o: p.id });
    return u;
  },

  // Plan a caravan's road to its destination: the cheapest path, where tiles in reach of hostile
  // towers and cores cost extra (so it goes round them when there's a reasonable way).
  planCaravan(u) {
    const o = this.towers.get(u.trade.to);
    if (!o) return;
    const base = this.getExtra();
    const extra = this.caravanExtra || (this.caravanExtra = new Int32Array(this.w * this.h));
    extra.set(base);
    const danger = Path.STEP * C.CARAVAN_DANGER;
    const mark = (cx, cy, r) => {
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(this.h - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(this.w - 1, Math.ceil(cx + r)); x++) {
          if (dist(x + 0.5, y + 0.5, cx, cy) <= r) extra[this.idx(x, y)] += danger;
        }
      }
    };
    for (const t of this.towers.values()) {
      if (!t.owner || !this.hostile(u.owner, t.owner)) continue;
      const s = C.towerStats(t.kind, t.level);
      if (s.damage) mark(t.x + 0.5, t.y + 0.5, s.range + 1);
    }
    for (const p of this.players.values()) if (p.alive && this.hostile(u.owner, p.id)) mark(p.core.x + 0.5, p.core.y + 0.5, C.CORE_RANGE + 1);
    const goal = this.idx(o.x, o.y);
    const edge = this.wallCostFn(u.owner, false); // caravans go through their side's gates only
    const field = Path.computeField(this.w, this.h, extra, goal, edge);
    const sx = Math.max(0, Math.min(this.w - 1, Math.floor(u.x)));
    const sy = Math.max(0, Math.min(this.h - 1, Math.floor(u.y)));
    const path = Path.tracePath(field, this.w, this.h, extra, this.idx(sx, sy), goal, 4000, edge);
    path.shift(); // the tile it's on
    if (path.length && path[path.length - 1] === goal) path.pop(); // it stops beside the post
    u.path = path;
    u.dest = { x: o.x + 0.5, y: o.y + 0.5 };
    u.wpKey = undefined;
    // the road it takes, for drawing: every few tiles of the path (tile indices)
    const from = this.towers.get(u.trade.from);
    if (from && from.partner === o.id) from.road = path.filter((k, i) => i % 4 === 0 || i === path.length - 1);
  },

  // One tick of a caravan: guards shoot what's in reach, the wagon rolls on, and it delivers or
  // vanishes when its route is gone.
  caravanTick(u, dt) {
    const o = this.towers.get(u.trade.to);
    if (!o || o.owner !== u.trade.toOwner || o.ruin || !this.allied(u.owner, o.owner)) {
      // the route is gone (alliance over, or the post was lost): the caravan and its cargo vanish
      this.units.delete(u.id);
      this.fx.push({ k: 'boom', x: round2(u.x), y: round2(u.y), r: 0.4 });
      return;
    }
    const def = C.UNITS.caravan;
    const s = C.towerStats('caravan', u.level);
    u.cd -= dt;
    if (u.cd <= 0) {
      const foe = this.pickTarget(u, def, s.range, false);
      if (foe) this.unitFire(u, foe, s, def);
    }
    if (dist(u.x, u.y, o.x + 0.5, o.y + 0.5) <= 1.8) {
      this.deliverCaravan(u, o);
      return;
    }
    // Head for the next point of the road. If a wall it can't pass is in the straight line there (it
    // cut a corner, or skipped a point while jostled), take a short detour round it instead.
    const next = u.path.length
      ? { x: (u.path[0] % this.w) + 0.5, y: Math.floor(u.path[0] / this.w) + 0.5 }
      : u.dest;
    if (next && this.walls.size && this.lineBlocked(u.owner, u.x, u.y, next.x, next.y, u)) {
      if (!this.detourStep(u, next.x, next.y, def.speed, dt)) this.planCaravan(u);
    } else {
      this.moveUnit(u, dt, def.speed);
    }
    if (!u.path.length && !u.dest) this.planCaravan(u); // pushed off course: plan again
    // No headway for a while (blocked by enemies, or a wall that went up on the road): plan again.
    const d = dist(u.x, u.y, o.x + 0.5, o.y + 0.5);
    if (u.trade.best === undefined || d < u.trade.best - 0.5) {
      u.trade.best = d;
      u.trade.bestAt = this.time;
    } else if (this.time - u.trade.bestAt > C.CARAVAN_STUCK) {
      u.trade.best = d;
      u.trade.bestAt = this.time;
      u.dpath = null;
      this.planCaravan(u);
    }
  },

  deliverCaravan(u, o) {
    this.units.delete(u.id);
    const from = this.players.get(u.owner);
    const to = this.players.get(o.owner);
    const cargo = u.trade.cargo;
    if (from && from.alive) this.award(from, cargo, 'trade', o.x + 0.5, o.y + 0.5);
    if (to && to.alive) this.award(to, cargo, 'trade', o.x + 0.5, o.y + 0.5);
    this.fx.push({ k: 'trade', x: o.x + 0.5, y: o.y + 0.5, g: cargo, o: u.owner, p: o.owner });
    if (from) from.trades = (from.trades || 0) + 1;
  },

  // A caravan was destroyed by byPid: the raiders take a share of its cargo.
  raidCaravan(u, byPid) {
    const p = this.players.get(byPid);
    const victim = this.players.get(u.owner);
    const loot = Math.round(u.trade.cargo * C.RAID_SHARE);
    this.fx.push({ k: 'raid', x: round2(u.x), y: round2(u.y), o: u.owner });
    if (p && p.alive && byPid !== u.owner) {
      this.award(p, loot, 'trade', u.x, u.y);
      if (victim) this.pushFeed(`${p.name} raided ${victim.name}'s caravan (+${loot}g)`);
    } else if (victim) {
      this.pushFeed(`${victim.name}'s caravan was destroyed`);
    }
  },
};
