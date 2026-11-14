'use strict';

// Territory on the hex grid: which player owns each hex. Each hex covers a patch of fine tiles
// (game.terr per tile is kept in step, for movement, fog and drawing). A new core starts with its
// hex and the six around it; players buy empty hexes that touch their land;
// whoever takes a building gets the hex it stands on, and a destroyed core's land all goes to whoever destroyed it.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C } = require('./common');

module.exports = {
  // Recount everyone's land (in tiles) after it changed.
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

  hexAt(x, y) {
    return this.hex.tileHex[this.idx(x, y)];
  },

  // Hex i becomes pid's (0: empty).
  setHex(i, pid) {
    const h = this.hex.hexes[i];
    this.hexOwner[i] = pid;
    for (const k of h.tiles) this.terr[k] = pid;
    this.terrDirty = true;
  },

  // Who owns the building standing in each hex (0 = none). Rebuilt when buildings change.
  buildingHexes() {
    const key = `${this.structVersion}:${this.players.size}`;
    if (this.bhKey === key) return this.bh;
    this.bhKey = key;
    if (!this.bh) this.bh = new Int32Array(this.hex.hexes.length);
    this.bh.fill(0);
    for (const t of this.towers.values()) if (t.owner) this.bh[this.hexAt(t.x, t.y)] = t.owner;
    for (const p of this.players.values()) if (p.alive) this.bh[this.hexAt(p.core.x, p.core.y)] = p.id;
    return this.bh;
  },

  // The land a new core starts with: its hex and the empty hexes around it.
  claimStart(p) {
    const i = this.hexAt(p.core.x, p.core.y);
    this.setHex(i, p.id);
    for (const j of this.hex.hexes[i].n) if (!this.hexOwner[j]) this.setHex(j, p.id);
  },

  // pid's hexes within `rings` of the hex at tile (x, y) become empty (rings = Infinity: all of
  // them), except hexes with one of pid's buildings in.
  releaseLand(pid, x = 0, y = 0, rings = Infinity) {
    const bh = this.buildingHexes();
    const centre = rings === Infinity ? null : this.hex.hexes[this.hexAt(x, y)];
    for (const h of this.hex.hexes) {
      if (this.hexOwner[h.i] !== pid || bh[h.i] === pid) continue;
      if (centre && this.hex.dist(h, centre) > rings) continue;
      this.setHex(h.i, 0);
    }
  },

  // The hex at tile (x, y) becomes pid's (the ground a captured building stands on), unless
  // someone else's building is in it.
  grantBlock(pid, x, y) {
    const i = this.hexAt(x, y);
    const b = this.buildingHexes()[i];
    if (b && b !== pid) return;
    this.setHex(i, pid);
  },

  // All of `from`'s hexes become `to`'s. Returns how many tiles changed hands.
  transferLand(from, to) {
    let tiles = 0;
    for (const h of this.hex.hexes) {
      if (this.hexOwner[h.i] !== from) continue;
      this.setHex(h.i, to);
      tiles += h.tiles.length;
    }
    return tiles;
  },

  // Can pid buy hex i: empty, touching their land, and not where a barbarian camp stands?
  canBuyHex(pid, i) {
    const h = this.hex.hexes[i];
    if (!h || this.hexOwner[i]) return false;
    if (!h.n.some((j) => this.hexOwner[j] === pid)) return false;
    for (const c of this.camps) if (c.alive && this.hexAt(c.x, c.y) === i) return false;
    return true;
  },

  // Gold for hex i for a player who owns `land` tiles: the land price per tile, for each tile in it.
  hexCost(i, land) {
    return C.landCost(land) * this.hex.hexes[i].tiles.length;
  },

  // Buy hexes (in order, so a drag along the border can grow outward). Stops when gold runs out.
  // Returns null or an error string; this.lastBuy says how many hexes were bought, for how much.
  buyLand(pid, hexes) {
    this.lastBuy = { n: 0, gold: 0 };
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid purchase';
    if (!Array.isArray(hexes) || !hexes.length) return 'No land picked';
    let land = p.territory;
    let reason = null;
    for (const i of hexes.slice(0, C.LAND_BUY_MAX)) {
      if (!Number.isInteger(i) || i < 0 || i >= this.hexOwner.length) continue;
      if (!this.canBuyHex(pid, i)) {
        if (!reason) reason = this.hexOwner[i] > 0 && this.hexOwner[i] !== pid ? "You can't buy someone else's land" : 'Land must be empty and touch your land';
        continue;
      }
      const cost = this.hexCost(i, land);
      if (p.gold < cost) {
        reason = 'Not enough gold';
        break;
      }
      p.gold -= cost;
      this.setHex(i, pid);
      this.carryWallsOut(pid, i);
      land += this.hex.hexes[i].tiles.length;
      this.lastBuy.n++;
      this.lastBuy.gold += cost;
    }
    if (this.lastBuy.n) {
      p.territory = land;
      return null;
    }
    return reason || 'No land bought';
  },

  // Run-length encoded territory per tile: [owner, count, owner, count, ...]
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
