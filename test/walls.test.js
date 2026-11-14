'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { duel, troops, run } = require('./helpers');

// Every edge of p's border, as [mine, theirs] hex pairs.
function border(g, p) {
  const out = [];
  for (const h of g.hex.hexes) {
    if (g.hexOwner[h.i] !== p.id) continue;
    for (const j of h.n) if (g.hexOwner[j] !== p.id) out.push([h.i, j]);
  }
  return out;
}

const hexOf = (g, x, y) => g.hex.tileHex[g.idx(Math.floor(x), Math.floor(y))];

test('walls go on your border only and cost gold', () => {
  const { g, a, b } = duel(70);
  const edges = border(g, a);
  const gold = a.gold;
  assert.strictEqual(g.buildWalls(a.id, edges.slice(0, 3)), null);
  assert.strictEqual(g.walls.size, 3);
  assert.strictEqual(a.gold, gold - 3 * C.WALL_COST);
  // not inside my land, not on someone else's border, not twice
  const core = g.hexAt(a.core.x, a.core.y);
  const inner = g.hex.hexes[core].n.find((j) => g.hexOwner[j] === a.id);
  assert.notStrictEqual(g.buildWalls(a.id, [[core, inner]]), null);
  assert.notStrictEqual(g.buildWalls(a.id, [border(g, b)[0]]), null);
  assert.notStrictEqual(g.buildWalls(a.id, [edges[0]]), null);
  const w = [...g.walls.values()][0];
  assert.strictEqual(w.maxHp, C.WALL_HP);
});

test('a walled-in core holds until attackers break through the wall', () => {
  const { g, a, b } = duel(71);
  assert.strictEqual(g.buildWalls(b.id, border(g, b)), null);
  const squad = troops(g, a, 'soldier', 6, a.core.x + 0.5, a.core.y + 2.5, 3);
  assert.strictEqual(g.order(a.id, squad.map((u) => u.id), { k: 'c', id: b.id }), null);
  const walls = g.walls.size;
  const hp = b.core.hp;
  // never inside b's land while every wall stands
  let leaked = false;
  const broke = run(g, 150, () => {
    if (g.walls.size === walls) {
      for (const u of squad) if (g.units.has(u.id) && g.hexOwner[hexOf(g, u.x, u.y)] === b.id) leaked = true;
    }
    return g.walls.size < walls;
  });
  assert.ok(!leaked, 'nobody slipped through');
  assert.ok(broke, 'they broke a wall down');
  assert.ok(run(g, 90, () => b.core.hp < hp), 'and reached the core');
});

test('your own walls block your troops too; gates let them (and allies) through', () => {
  const { g, a } = duel(72);
  const edges = border(g, a);
  assert.strictEqual(g.buildWalls(a.id, edges), null);
  const [u] = troops(g, a, 'soldier', 1, a.core.x + 0.5, a.core.y + 2.5);
  // a spot well outside my land, on the far side from the enemy
  const out = edges[0];
  const far = g.hex.hexes[out[1]];
  const spot = g.idx(Math.floor(far.cx), Math.floor(far.cy));
  assert.strictEqual(g.order(a.id, [u.id], { k: 'p', id: spot }), null);
  run(g, 25);
  assert.strictEqual(g.hexOwner[hexOf(g, u.x, u.y)], a.id, 'without a gate it stays inside');
  const gate = g.wallBetween(out[0], out[1]);
  assert.strictEqual(g.toggleGate(a.id, gate.id), null);
  assert.ok(gate.gate);
  assert.ok(run(g, 40, () => Math.hypot(u.x - far.cx, u.y - far.cy) < 1.5), 'through the gate and out');
});

test('soldiers hit walls harder', () => {
  const { g, a, b } = duel(73);
  g.buildWalls(b.id, border(g, b).slice(0, 1));
  const w = [...g.walls.values()][0];
  const [s] = troops(g, a, 'soldier', 1, w.x, w.y);
  const [r] = troops(g, a, 'archer', 1, w.x, w.y);
  const def = C.UNITS;
  w.hp = 1e6;
  g.unitFire(s, w, C.towerStats('soldier', 1), def.soldier);
  const afterS = 1e6 - w.hp;
  w.hp = 1e6;
  g.unitFire(r, w, C.towerStats('archer', 1), def.archer);
  const afterA = 1e6 - w.hp;
  assert.ok(afterS / C.towerStats('soldier', 1).damage > 1.9 * (afterA / C.towerStats('archer', 1).damage));
});

test('buying the hex beyond a wall moves it out; losing a hex makes its walls crumble', () => {
  const { g, a } = duel(74);
  // a border edge whose outside hex is empty and can be bought
  const e = border(g, a).find(([, j]) => g.canBuyHex(a.id, j));
  g.buildWalls(a.id, [e]);
  const gold = a.gold;
  assert.strictEqual(g.buyLand(a.id, [e[1]]), null);
  const cost = gold - a.gold;
  g.update(0.05);
  assert.strictEqual(g.wallBetween(e[0], e[1]), null, 'the wall is gone from inside my land');
  assert.ok(g.hex.hexes[e[1]].n.some((j) => g.hexOwner[j] !== a.id && g.wallBetween(e[1], j)), 'and stands on the new border');
  assert.ok(a.gold - (gold - cost) < 1, 'no refund: it moved (only a moment of income)');
  // now a wall whose own side is released
  const e2 = border(g, a).find(([i]) => i !== g.hexAt(a.core.x, a.core.y));
  g.buildWalls(a.id, [e2]);
  g.setHex(e2[0], 0);
  g.update(0.05);
  assert.strictEqual(g.wallBetween(e2[0], e2[1]), null, 'crumbled');
});

test('caravans use their side\'s gates and never smash walls', () => {
  const { g, a, b } = duel(75);
  g.proposeAlliance(a.id, b.id);
  g.acceptAlliance(b.id, a.id);
  const spot = (p) => {
    for (const h of g.hex.hexes) {
      if (g.hexOwner[h.i] !== p.id || !h.full || h.centre < 0 || g.buildingHexes()[h.i]) continue;
      const x = h.centre % g.w;
      const y = (h.centre - x) / g.w;
      if (Math.hypot(x - p.core.x, y - p.core.y) > 3) return [x, y];
    }
    return null;
  };
  const [ax, ay] = spot(a);
  const [bx, by] = spot(b);
  g.build(a.id, ax, ay, 'trade');
  g.build(b.id, bx, by, 'trade');
  const edges = border(g, b);
  g.buildWalls(b.id, edges);
  // b's gate on the side facing a
  const gate = edges.map(([i, j]) => g.wallBetween(i, j))
    .sort((w1, w2) => Math.hypot(w1.x - a.core.x, w1.y - a.core.y) - Math.hypot(w2.x - a.core.x, w2.y - a.core.y))[0];
  g.toggleGate(b.id, gate.id);
  const walls = g.walls.size;
  const ea = a.earned.trade;
  assert.ok(run(g, 150, () => a.earned.trade > ea), 'a caravan got through to b\'s post');
  assert.strictEqual(g.walls.size, walls, 'without breaking any wall');
});

test('a broken wall can\'t be rebuilt straight away, nor walls built with enemies at them', () => {
  const { g, a, b } = duel(76);
  const [e, e2] = border(g, b);
  g.buildWalls(b.id, [e]);
  const w = g.wallBetween(e[0], e[1]);
  g.damageWall(w, 1e6, a.id);
  assert.strictEqual(g.wallBetween(e[0], e[1]), null);
  assert.match(g.buildWalls(b.id, [e]), /just broken/);
  run(g, C.WALL_REBUILD_DELAY + 1);
  assert.strictEqual(g.buildWalls(b.id, [e]), null, 'fine once the dust settles');
  const ha = g.hex.hexes[e2[0]];
  const hb = g.hex.hexes[e2[1]];
  troops(g, a, 'soldier', 1, (ha.cx + hb.cx) / 2, (ha.cy + hb.cy) / 2);
  assert.match(g.buildWalls(b.id, [e2]), /too close/);
});

test('buying a hex beyond your walls moves those walls out onto its outer edges', () => {
  const { g, a } = duel(77);
  g.buildWalls(a.id, border(g, a));
  // find buyable hexes touching 1, 2 and 3 of my walls
  const touching = (i) => g.hex.hexes[i].n.filter((j) => g.hexOwner[j] === a.id && g.wallBetween(i, j)).length;
  const seen = new Set();
  for (const want of [1, 2, 3]) {
    const i = g.hex.hexes.map((h) => h.i).find((k) => !seen.has(k) && g.canBuyHex(a.id, k) && touching(k) === want);
    if (i === undefined) continue;
    seen.add(i);
    const h = g.hex.hexes[i];
    const before = g.walls.size;
    const gold = a.gold;
    const free = h.n.filter((j) => g.hexOwner[j] !== a.id && !g.wallBetween(i, j)).length;
    assert.strictEqual(g.buyLand(a.id, [i]), null);
    g.update(0.05);
    const inner = h.n.filter((j) => g.hexOwner[j] === a.id && g.wallBetween(i, j)).length;
    const outer = h.n.filter((j) => g.hexOwner[j] !== a.id && g.wallBetween(i, j)).length;
    assert.strictEqual(inner, 0, `${want}: no wall left inside`);
    assert.strictEqual(outer, Math.min(want, free), `${want}: ${want} walls moved onto the new hex's outer edges`);
    assert.strictEqual(g.walls.size, before, `${want}: no walls lost`);
    assert.ok(a.gold <= gold, `${want}: no refund for walls that moved`);
  }
  assert.ok(seen.size >= 2, 'found hexes to test');
});

test('a gate keeps being a gate when it moves out', () => {
  const { g, a } = duel(78);
  g.buildWalls(a.id, border(g, a));
  const i = g.hex.hexes.map((h) => h.i).find((k) => g.canBuyHex(a.id, k) && g.hex.hexes[k].n.filter((j) => g.hexOwner[j] === a.id && g.wallBetween(k, j)).length === 1);
  const j = g.hex.hexes[i].n.find((n) => g.hexOwner[n] === a.id && g.wallBetween(i, n));
  g.toggleGate(a.id, g.wallBetween(i, j).id);
  const gates = [...g.walls.values()].filter((w) => w.gate).length;
  g.buyLand(a.id, [i]);
  g.update(0.05);
  assert.strictEqual([...g.walls.values()].filter((w) => w.gate).length, gates);
  assert.ok(g.hex.hexes[i].n.some((n) => g.hexOwner[n] !== a.id && g.wallBetween(i, n)?.gate), 'the gate is on the new hex\'s border');
});
