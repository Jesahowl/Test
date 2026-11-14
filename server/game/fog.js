'use strict';

// Fog of war: what each player can see.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, Vision, dist, round2 } = require('./common');

module.exports = {
  // What each player's core, buildings and troops see right now (p.vis), and everywhere they have
  // ever seen (p.explored). Fog only hides ground nobody has explored: once cleared, an area stays
  // revealed with live activity.
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
      if (!p.vis) p.vis = new Uint8Array(n);
      if (!p.explored) p.explored = new Uint8Array(n);
      Vision.computeVision(p.vis, this.w, this.h, pid, this.terr, list);
    }
    // Allies see each other's bases (their land), but not what each other's troops and towers see.
    for (const pid of sources.keys()) {
      const p = this.players.get(pid);
      for (const aid of this.alliesOf(pid)) {
        for (let k = 0; k < n; k++) if (this.terr[k] === aid) p.vis[k] = 1;
      }
      for (let k = 0; k < n; k++) {
        if (p.vis[k] && !p.explored[k]) {
          p.explored[k] = 1;
          p.exploredCount = (p.exploredCount || 0) + 1; // tells the room to send the new map
        }
      }
    }
  },

  // Can player p see world point (x, y)? Yes anywhere they have explored.
  sees(p, x, y) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return !!p.explored && this.inBounds(tx, ty) && p.explored[this.idx(tx, ty)] === 1;
  },

  medicTick(u, def, s, tgt, speed, dt) {
    let healed = 0;
    const wounded = []; // in reach: the most wounded get treated (def.patients at a time)
    let patient = null;
    let worst = 1;
    let buddy = null;
    let buddyD = Infinity;
    for (const f of this.nearUnits(u.x, u.y, 12)) { // patients within 10, buddies within 12
      if (f.owner !== u.owner) continue;
      const fd = dist(u.x, u.y, f.x, f.y);
      if (f.hp < f.maxHp) {
        if (u.cd <= 0 && fd <= s.range) wounded.push(f);
        if (fd < 10 && f.hp / f.maxHp < worst) {
          worst = f.hp / f.maxHp;
          patient = f;
        }
      }
      if (f !== u && !C.UNITS[f.kind].heal && !f.trade && fd < buddyD && (!tgt || f.attack)) {
        buddyD = fd;
        buddy = f;
      }
    }
    if (wounded.length) {
      wounded.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
      for (const f of wounded.slice(0, def.patients || 1)) {
        f.hp = Math.min(f.maxHp, f.hp + s.heal);
        healed++;
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
  },

  // When tower t stops being `enemyId`'s, squads sent at it roll on to that enemy's nearest
  // remaining tower (or core), so their reinforcements keep pushing like a lane.
  rollOnOrders(t, enemyId) {
    for (const q of [...this.players.values()].flatMap((p) => p.squads)) {
      const o = q.order;
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
      if (next) q.order = { type: 'attack', target: { k: 't', id: next.id, owner: enemyId } };
      else if (enemy && enemy.alive) q.order = { type: 'attack', target: { k: 'c', id: enemyId } };
      else q.order = { type: 'defend', anchor: 0 };
    }
  },

};
