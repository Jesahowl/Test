'use strict';

// Territory: which player owns each tile, and its run-length encoding for clients.
// Land is kept tile by tile: a new core starts with a circle of it, players buy more with gold
// (empty tiles touching their land), and it opens up again when a tower or core falls.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C } = require('./common');

module.exports = {
  // Recount everyone's land after it changed.
  recomputeTerritory() {
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
  },

  // The land a new core starts with: the empty tiles in a circle around it.
  claimStart(p) {
    const r = C.CORE_CLAIM + 0.25;
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = p.core.x + dx;
        const y = p.core.y + dy;
        if (!this.inBounds(x, y) || Math.hypot(dx, dy) > r) continue;
        const k = this.idx(x, y);
        if (!this.terr[k]) this.terr[k] = p.id;
      }
    }
    this.terrDirty = true;
  },

  // pid's tiles within r of (cx, cy) become empty (r = Infinity: all of them).
  releaseLand(pid, cx = 0, cy = 0, r = Infinity) {
    for (let k = 0; k < this.terr.length; k++) {
      if (this.terr[k] !== pid) continue;
      if (r !== Infinity) {
        const x = k % this.w;
        const y = (k - x) / this.w;
        if (Math.hypot(x - cx, y - cy) > r + 0.25) continue;
      }
      this.terr[k] = 0;
    }
    this.terrDirty = true;
  },

  // The 3x3 block around (cx, cy) becomes pid's (the ground a captured building stands on).
  grantBlock(pid, cx, cy) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.inBounds(cx + dx, cy + dy)) this.terr[this.idx(cx + dx, cy + dy)] = pid;
      }
    }
    this.terrDirty = true;
  },

  // Can pid buy tile k: empty, touching their land, and not leaving two players' land touching
  // only at a corner (which can't be drawn cleanly)?
  canBuyTile(pid, k) {
    if (k < 0 || k >= this.terr.length || this.terr[k]) return false;
    const x = k % this.w;
    const y = (k - x) / this.w;
    const at = (tx, ty) => (this.inBounds(tx, ty) ? this.terr[this.idx(tx, ty)] : -1);
    if (at(x - 1, y) !== pid && at(x + 1, y) !== pid && at(x, y - 1) !== pid && at(x, y + 1) !== pid) return false;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      // a 2x2 block where my land would touch my land only diagonally, across another player's
      const h = at(x + dx, y);
      if (at(x + dx, y + dy) === pid && h > 0 && h !== pid && at(x, y + dy) === h) return false;
    }
    return true;
  },

  // Buy tiles (in order, so a drag along the border can grow outward). Each costs
  // C.landCost(land owned so far). Stops when gold runs out. Returns null or an error string;
  // this.lastBuy says how many tiles were bought and for how much.
  buyLand(pid, tiles) {
    this.lastBuy = { n: 0, gold: 0 };
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid purchase';
    if (!Array.isArray(tiles) || !tiles.length) return 'No land picked';
    let land = p.territory;
    let reason = null;
    for (const k of tiles.slice(0, C.LAND_BUY_MAX)) {
      if (!Number.isInteger(k)) continue;
      if (!this.canBuyTile(pid, k)) {
        if (!reason) reason = this.terr[k] > 0 && this.terr[k] !== pid ? "You can't buy someone else's land: take their towers" : 'Land must be empty and touch your land';
        continue;
      }
      const cost = C.landCost(land);
      if (p.gold < cost) {
        reason = 'Not enough gold';
        break;
      }
      p.gold -= cost;
      this.terr[k] = pid;
      land++;
      this.lastBuy.n++;
      this.lastBuy.gold += cost;
    }
    if (this.lastBuy.n) {
      p.territory = land;
      this.terrDirty = true;
      return null;
    }
    return reason || 'No land bought';
  },

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
  },
};
