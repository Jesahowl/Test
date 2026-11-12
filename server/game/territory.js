'use strict';

// Territory: which player owns each tile, and its run-length encoding for clients.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C } = require('./common');

module.exports = {
  recomputeTerritory() {
    this.terr.fill(0);
    this.terrDist.fill(Infinity);
    const sources = [];
    for (const p of this.players.values()) {
      if (p.alive) sources.push({ x: p.core.x, y: p.core.y, r: C.CORE_CLAIM, owner: p.id, weight: 0.5 });
    }
    for (const t of this.towers.values()) {
      if (t.owner) sources.push({ x: t.x, y: t.y, r: C.towerStats(t.kind, t.level).claim, owner: t.owner, weight: 1 });
    }
    for (const s of sources) {
      const r = Math.ceil(s.r);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = s.x + dx;
          const y = s.y + dy;
          if (!this.inBounds(x, y)) continue;
          const d = Math.hypot(dx, dy);
          // +0.25 rounds the claim off (no lone one-tile spikes at the four compass points).
          if (d > s.r + 0.25) continue;
          // Cores hold their nearby land more strongly than towers.
          const eff = d * s.weight;
          const k = this.idx(x, y);
          if (eff < this.terrDist[k]) {
            this.terrDist[k] = eff;
            this.terr[k] = s.owner;
          }
        }
      }
    }
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
