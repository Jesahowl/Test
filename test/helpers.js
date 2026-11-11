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

// Build a tower for p, leapfrogged just outside its land in direction (dx, dy).
function outpost(g, p, dx = 1, dy = 0) {
  const t = edgeTile(g, p, dx, dy, 1);
  const err = g.build(p.id, t.x, t.y, 'tower');
  if (err) throw new Error(err);
  g.update(0.05);
  return [...g.towers.values()].find((o) => o.x === t.x && o.y === t.y);
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
  return out;
}

function run(g, seconds, until) {
  for (let i = 0; i < seconds * 20; i++) {
    g.update(0.05);
    if (until && until()) return true;
  }
  return false;
}

module.exports = { Game, seeded, duel, edgeTile, outpost, troops, run };
