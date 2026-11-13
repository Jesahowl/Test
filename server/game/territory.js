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
      if (p.alive) sources.push({ x: p.core.x, y: p.core.y, r: C.CORE_CLAIM, owner: p.id, weight: 0.5, foot: C.CORE_FOOTPRINT });
    }
    for (const t of this.towers.values()) {
      if (t.owner) sources.push({ x: t.x, y: t.y, r: C.towerStats(t.kind, t.level).claim, owner: t.owner, weight: 1, foot: C.STRUCT_FOOTPRINT });
    }
    for (const s of sources) {
      const r = Math.ceil(Math.max(s.r, s.foot));
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = s.x + dx;
          const y = s.y + dy;
          if (!this.inBounds(x, y)) continue;
          const d = Math.hypot(dx, dy);
          // +0.25 rounds the claim off (no lone one-tile spikes at the four compass points).
          if (d > Math.max(s.r + 0.25, s.foot)) continue;
          // Cores hold their nearby land more strongly than towers, and a building's footprint
          // beats any ordinary claim (between two footprints, the nearer building wins).
          const eff = d <= s.foot ? d - 1000 : d * s.weight;
          const k = this.idx(x, y);
          if (eff < this.terrDist[k]) {
            this.terrDist[k] = eff;
            this.terr[k] = s.owner;
          }
        }
      }
    }
    this.tidyTerritory(sources);
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

  // Land is either one player's or another's, with clean borders between them: no one-tile
  // strands poking into a neighbour, and no two patches of the same land touching only at a
  // corner with someone else's land squeezed between (drawn smoothly, those look like two
  // borders crossing). Building footprints always stay their owner's.
  tidyTerritory(sources) {
    const W = this.w;
    const H = this.h;
    const terr = this.terr;
    const keep = new Set();
    for (let k = 0; k < terr.length; k++) if (this.terrDist[k] < -500) keep.add(k); // footprints
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : terr[y * W + x]);
    for (let pass = 0; pass < 3; pass++) {
      let changed = 0;
      // Corner-only contacts: a 2x2 block like  A B / B A  goes to whichever owner holds it more
      // strongly (closer to its claim), so one side's patches join and the other's separate.
      for (let y = 0; y < H - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
          const a = at(x, y);
          const b = at(x + 1, y);
          if (a === b || a !== at(x + 1, y + 1) || b !== at(x, y + 1)) continue;
          const ka = this.idx(x, y);
          const kb = this.idx(x + 1, y);
          // empty land never wins a corner; otherwise the stronger claim does
          let winner = a;
          if (!a) winner = b;
          else if (b && this.terrDist[kb] + this.terrDist[this.idx(x, y + 1)] < this.terrDist[ka] + this.terrDist[this.idx(x + 1, y + 1)]) winner = b;
          const loserTiles = winner === a ? [kb, this.idx(x, y + 1)] : [ka, this.idx(x + 1, y + 1)];
          for (const k of loserTiles) {
            if (keep.has(k)) continue;
            terr[k] = winner;
            changed++;
          }
        }
      }
      // Strands: an owned tile with at most one side touching its own land, but with land of a
      // single other owner on at least two sides, belongs to that neighbour.
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const k = y * W + x;
          const o = terr[k];
          if (!o || keep.has(k)) continue;
          const n = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
          if (n.filter((v) => v === o).length > 1) continue;
          const tally = new Map();
          for (const v of n) if (v !== o && v !== -1) tally.set(v, (tally.get(v) || 0) + 1);
          let best = 0;
          let bestN = 0;
          for (const [v, c] of tally) if (c > bestN) { best = v; bestN = c; }
          if (bestN < 2 || (best === 0 && n.includes(o))) continue; // keep edges facing open land
          terr[k] = best;
          changed++;
        }
      }
      if (!changed) break;
    }
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
