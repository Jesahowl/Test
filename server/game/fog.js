'use strict';

// Fog of war: what each player can see.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, Vision, dist, round2 } = require('./common');

module.exports = {
  // What each player can see right now (p.vis), and everywhere they have ever seen (p.explored).
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
      if (!p.vis) {
        p.vis = new Uint8Array(n);
        p.explored = new Uint8Array(n);
      }
      Vision.computeVision(p.vis, this.w, this.h, pid, this.terr, list);
      for (let k = 0; k < n; k++) if (p.vis[k]) p.explored[k] = 1;
    }
  },

  // Can player p see world point (x, y)?
  sees(p, x, y) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return !!p.vis && this.inBounds(tx, ty) && p.vis[this.idx(tx, ty)] === 1;
  },

  medicTick(u, def, s, tgt, speed, dt) {
    let healed = 0;
    let patient = null;
    let worst = 1;
    let buddy = null;
    let buddyD = Infinity;
    for (const f of this.nearUnits(u.x, u.y, 12)) { // patients within 10, buddies within 12
      if (f.owner !== u.owner) continue;
      const fd = dist(u.x, u.y, f.x, f.y);
      if (f.hp < f.maxHp) {
        if (u.cd <= 0 && fd <= s.range) {
          f.hp = Math.min(f.maxHp, f.hp + s.heal);
          healed++;
        }
        if (fd < 10 && f.hp / f.maxHp < worst) {
          worst = f.hp / f.maxHp;
          patient = f;
        }
      }
      if (f !== u && !C.UNITS[f.kind].heal && fd < buddyD && (!tgt || f.attack)) {
        buddyD = fd;
        buddy = f;
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

  // When tower t stops being `enemyId`'s, standing attack orders on it roll on to that
  // enemy's nearest remaining tower (or core), so waves keep pushing like a lane.
  rollOnOrders(t, enemyId) {
    for (const p of this.players.values()) {
      const o = p.order;
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
      if (next) p.order = { type: 'attack', target: { k: 't', id: next.id, owner: enemyId } };
      else if (enemy && enemy.alive) p.order = { type: 'attack', target: { k: 'c', id: enemyId } };
      else p.order = { type: 'defend', anchor: 0 };
    }
  },

  // Hand tower t to newOwner (claimed by destroying it).
  transferTower(t, newOwner, how = 'captured') {
    const winner = this.players.get(newOwner);
    const loser = this.players.get(t.owner);
    const loserId = t.owner;
    t.owner = newOwner;
    this.structVersion++;
    this.terrDirty = true;
    this.fx.push({ k: 'capture', x: t.x + 0.5, y: t.y + 0.5, o: newOwner });
    // Troops that were attacking it stay on as its garrison.
    for (const u of this.units.values()) {
      if (u.owner === newOwner && u.attack && u.attack.k === 't' && u.attack.id === t.id) {
        u.attack = null;
        u.anchor = t.id;
      }
    }
    this.rollOnOrders(t, loserId);
    if (winner && loser) {
      this.pushFeed(how === 'destroyed'
        ? `${winner.name} destroyed and claimed ${loser.name}'s tower (+${C.TOWER_BOUNTY}g)`
        : `${winner.name} captured a tower from ${loser.name}`);
    }
  },
};
