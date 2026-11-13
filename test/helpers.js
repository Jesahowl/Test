'use strict';

const Game = require('../server/game');

// Small deterministic PRNG so tests are repeatable.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A game with two players far apart: rich, past spawn protection, and no automatic waves
// (tests spawn troops themselves).
function duel(seed = 1) {
  const g = new Game({ botTarget: 0, rand: seeded(seed) });
  const a = g.addPlayer('A');
  const b = g.addPlayer('B');
  for (const p of [a, b]) {
    p.gold = 1e6;
    p.spawnTime = -1000;
    p.nextWaveAt = Infinity;
  }
  g.update(0.05);
  return { g, a, b };
}

// First unclaimed tile walking from p's core in direction (dx, dy), plus `extra` tiles further.
function edgeTile(g, p, dx, dy, extra = 0) {
  let x = p.core.x;
  let y = p.core.y;
  while (g.terr[g.idx(x, y)] === p.id) {
    x += dx;
    y += dy;
  }
  return { x: x + dx * extra, y: y + dy * extra };
}

// Claim hexes for p out towards (tx, ty) (as a player would, along the way), so it can build there.
function claimTowards(g, p, tx, ty) {
  const target = g.hex.hexes[g.hexAt(tx, ty)];
  for (let n = 0; n < 40 && g.hexOwner[target.i] !== p.id; n++) {
    let best = -1;
    let bestD = Infinity;
    for (const h of g.hex.hexes) {
      if (!g.canBuyHex(p.id, h.i)) continue;
      const d = Math.hypot(h.cx - target.cx, h.cy - target.cy);
      if (d < bestD) { bestD = d; best = h.i; }
    }
    if (best < 0 || g.buyLand(p.id, [best])) break;
  }
  // and the hexes round it, so it isn't on the border
  for (const j of target.n) if (g.canBuyHex(p.id, j)) g.buyLand(p.id, [j]);
  g.update(0.05);
  return target;
}

// Build a tower for p out in direction (dx, dy), about 12 tiles from its core (claiming the land
// on the way first).
function outpost(g, p, dx = 1, dy = 0, far = 12) {
  for (let d = far; d >= 6; d--) {
    const tx = Math.round(p.core.x + dx * d);
    const ty = Math.round(p.core.y + dy * d);
    if (!g.inBounds(tx, ty)) continue;
    const h = g.hex.hexes[g.hexAt(tx, ty)];
    if (h.centre < 0 || !h.full) continue;
    claimTowards(g, p, tx, ty);
    const err = g.build(p.id, tx, ty, 'tower');
    if (err) throw new Error(err);
    g.update(0.05);
    return [...g.towers.values()].find((o) => g.hexAt(o.x, o.y) === h.i);
  }
  throw new Error('no room for an outpost');
}
// Spawn n troops for p at (x, y).
function troops(g, p, kind, n, x, y, level = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    p.levels[kind] = level;
    const u = g.spawnTroop(p, kind);
    u.x = x + (i % 3) * 0.3;
    u.y = y + Math.floor(i / 3) * 0.3;
    out.push(u);
  }
  g.buildUnitGrid(); // troops were teleported: refresh the spatial grid
  return out;
}

function run(g, seconds, until) {
  for (let i = 0; i < seconds * 20; i++) {
    g.update(0.05);
    if (until && until()) return true;
  }
  return false;
}

module.exports = { Game, seeded, duel, edgeTile, claimTowards, outpost, troops, run };
