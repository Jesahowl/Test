'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { Game, seeded, duel, troops, run } = require('./helpers');

// Every edge of p's border that can take a wall (not along a river or a mountain), as [mine, theirs] hex pairs.
function border(g, p) {
  const out = [];
  for (const h of g.hex.hexes) {
    if (g.hexOwner[h.i] !== p.id) continue;
    for (const j of h.n) if (g.hexOwner[j] !== p.id && !g.riverBetween(h.i, j)) out.push([h.i, j]); // (not along a river or mountain)
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

test('troops and workers find their way round walls to a gate, however far, and never wedge in corners', () => {
  for (const seed of [51, 53]) {
    const { g, a } = duel(seed);
    // wall a's whole border, with one gate on the far (east) side
    const edges = [];
    for (const h of g.hex.hexes) if (g.hexOwner[h.i] === a.id) for (const j of h.n) if (g.canWallEdge(a.id, h.i, j)) edges.push([h.i, j]);
    g.buildWalls(a.id, edges);
    const ws = [...g.walls.values()].filter((w) => w.owner === a.id);
    g.toggleGate(a.id, ws.reduce((x, y) => (x.x > y.x ? x : y)).id);
    const west = ws.reduce((x, y) => (x.x < y.x ? x : y));
    const tx = Math.floor(west.x - 4);
    const ty = Math.floor(west.y);
    const [t] = troops(g, a, 'soldier', 1, a.core.x + 0.5, a.core.y + 1.5);
    g.order(a.id, null, { k: 'p', id: g.idx(tx, ty) }, [t.sq]);
    assert.ok(run(g, 40, () => Math.hypot(t.x - tx - 0.5, t.y - ty - 0.5) < 2.5), `seed ${seed}: the troop went out the gate and round to the far side`);
    // a worker sent to a forest just outside the west wall
    let best = -1;
    let bd = Infinity;
    for (const h of g.hex.hexes) if (h.full && !g.hexOwner[h.i]) { const d = Math.hypot(h.cx - (west.x - 4), h.cy - west.y); if (d < bd) { bd = d; best = h.i; } }
    g.forest.set(best, 200);
    a.nextWaveAt = g.time; g.update(0.05); a.nextWaveAt = Infinity;
    const w = g.workersOf(a)[0];
    for (const j of C.WORKER_JOBS) a.jobs[j] = 0;
    assert.strictEqual(g.sendWorker(a.id, w.id, { k: 'h', id: best }), null);
    assert.ok(run(g, 60, () => w.working), `seed ${seed}: the worker got there too`);
  }
});

test('rivers: troops only cross at bridges; no walls on them; no base starts beside one', () => {
  const { g, a, b } = duel(5, { terrain: true });
  assert.ok(g.rivers.length > 0 && g.riverEdges > 0, 'the map has rivers');
  for (const p of [a, b]) {
    const core = g.hex.hexes[g.hexAt(p.core.x, p.core.y)];
    assert.ok(![core.i, ...core.n].some((j) => g.riverHexes.has(j)), 'no river through a starting base');
  }
  // a river edge in the middle of the map (not a bridge), and the hexes on each side of it
  const edges = g.rivers.flatMap((r) => r.edges);
  const e = edges.filter((x) => !x.bridge && g.hex.hexes[x.a].full && g.hex.hexes[x.b].full)
    .sort((p, q) => Math.hypot((p.x1 + p.x2) / 2 - g.w / 2, (p.y1 + p.y2) / 2 - g.h / 2) - Math.hypot((q.x1 + q.x2) / 2 - g.w / 2, (q.y1 + q.y2) / 2 - g.h / 2))[0];
  assert.ok(g.riverBetween(e.a, e.b), 'a river edge blocks');
  const bridge = edges.find((x) => x.bridge);
  assert.ok(!g.riverBetween(bridge.a, bridge.b), 'a bridge does not');
  // no wall on a river, even for someone who owns one side
  g.setHex(e.a, a.id);
  assert.ok(!g.canWallEdge(a.id, e.a, e.b), 'no wall on a river edge');
  g.setHex(e.a, 0);
  // a troop just across the river from where it's sent gets there, by a bridge, never through the water
  const [ha, hb] = [g.hex.hexes[e.a], g.hex.hexes[e.b]];
  const [u] = troops(g, a, 'soldier', 1, ha.cx, ha.cy);
  u.hp = u.maxHp = 1e6;
  g.order(a.id, [u.id], { k: 'p', id: g.idx(Math.floor(hb.cx), Math.floor(hb.cy)) });
  let crossed = 0;
  let last = g.hexAt(Math.floor(u.x), Math.floor(u.y));
  const arrived = run(g, 90, () => {
    const h = g.hexAt(Math.floor(u.x), Math.floor(u.y));
    if (h !== last && g.riverBetween(h, last)) crossed++;
    last = h;
    return Math.hypot(u.x - hb.cx, u.y - hb.cy) < 2.5;
  });
  assert.strictEqual(crossed, 0, 'never stepped across the river');
  assert.ok(arrived, 'got across by a bridge');
});

test('mountains: impassable ridges; every map stays connected; iron and gold sit in the foothills', () => {
  const Terrain = require('../shared/terrain');
  // connected on every map: all open hexes reach each other (round mountains, over bridges)
  for (let seed = 1; seed <= 30; seed++) {
    const { g } = duel(seed, { terrain: true });
    const open = g.hex.hexes.filter((h) => !g.mountains.has(h.i));
    const seen = new Set([open[0].i]);
    const stack = [open[0].i];
    while (stack.length) {
      const i = stack.pop();
      for (const j of g.hex.hexes[i].n) {
        if (seen.has(j) || g.mountains.has(j) || g.riverBetween(i, j)) continue;
        seen.add(j);
        stack.push(j);
      }
    }
    assert.strictEqual(seen.size, open.length, `seed ${seed}: no land cut off (${open.length - seen.size} hexes)`);
  }
  const { g, a } = duel(8, { terrain: true });
  assert.ok(g.mountains.size > 15, `the map has mountains (${g.mountains.size})`);
  const layout = Terrain.mapTerrain(g.mapSeed, g.hex, g.w, g.h);
  const inHills = [...g.ore.keys()].filter((i) => layout.foothills.has(i)).length;
  assert.ok(inHills / g.ore.size > 0.7, `most iron in the foothills (${inHills}/${g.ore.size})`);
  for (const i of g.mountains) assert.ok(!g.forest.has(i) && !g.ore.has(i) && !g.veins.has(i));
  // nobody owns, buys or stands on a mountain
  const m = [...g.mountains][0];
  const next = g.hex.hexes[m].n.find((j) => !g.mountains.has(j));
  g.setHex(next, a.id);
  assert.ok(!g.canBuyHex(a.id, m), 'mountains can\'t be bought');
  const mh = g.hex.hexes[m];
  assert.match(g.makeOrder(a.id, { k: 'p', id: g.idx(Math.floor(mh.cx), Math.floor(mh.cy)) }), /mountains/);
  // a troop sent past a mountain goes round it, never into it
  const far = g.hex.hexes.find((h) => !g.mountains.has(h.i) && Math.hypot(h.cx - mh.cx, h.cy - mh.cy) > 6 && Math.hypot(h.cx - mh.cx, h.cy - mh.cy) < 9 && h.full);
  const [u] = troops(g, a, 'soldier', 1, g.hex.hexes[next].cx, g.hex.hexes[next].cy);
  u.hp = u.maxHp = 1e6;
  g.order(a.id, [u.id], { k: 'p', id: g.idx(Math.floor(far.cx), Math.floor(far.cy)) });
  let inside = 0;
  run(g, 25, () => {
    if (g.mountains.has(g.hexAt(Math.floor(u.x), Math.floor(u.y)))) inside++;
    return false;
  });
  assert.strictEqual(inside, 0, 'never set foot on the mountain');
});

test('mountains stay thin and spread out (no fortresses), and never near a base\'s starting land', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = new Game({ botTarget: 0, rand: seeded(seed * 17), rounds: true });
    const m = g.layout.mountains; // (g.mountains also has the sea)
    const seen = new Set();
    for (const i of m) {
      if (seen.has(i)) continue;
      let n = 0;
      const stack = [i];
      seen.add(i);
      while (stack.length) {
        const k = stack.pop();
        n++;
        for (const j of g.hex.hexes[k].n) if (m.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
      assert.ok(n <= 6, `seed ${seed}: a ridge of ${n} hexes`);
    }
    for (const h of g.hex.hexes) {
      const round = h.n.filter((j) => m.has(j)).length;
      assert.ok(round <= 2, `seed ${seed}: hex ${h.i} has ${round} mountains round it`);
    }
    for (let k = 0; k < 8; k++) {
      const p = g.addPlayer(`P${k}`, true);
      assert.ok(p, 'everyone finds a spot');
      const core = g.hex.hexes[g.hexAt(p.core.x, p.core.y)];
      const near = new Set([core.i, ...core.n]);
      for (const j of core.n) for (const x of g.hex.hexes[j].n) near.add(x);
      assert.ok(![...near].some((j) => g.mountains.has(j)), `seed ${seed}: no mountain (or sea) within two rings of a base`);
    }
  }
});

test('the sea and lakes: a tenth of the map at most, a few small lakes, rivers flow into them, and nobody builds, buys or walks there', () => {
  const Terrain = require('../shared/terrain');
  for (let seed = 1; seed <= 12; seed++) {
    const g = new Game({ botTarget: 0, rand: seeded(seed * 31), rounds: true });
    const L = g.layout;
    const tiles = [...L.ocean].reduce((n, i) => n + g.hex.hexes[i].tiles.length, 0) / (g.w * g.h);
    assert.ok(tiles > 0.05 && tiles <= 0.11, `seed ${seed}: the sea is ${(tiles * 100).toFixed(1)}% of the map`);
    // a few small lakes, inland
    assert.ok(L.lakes.size >= 2 && L.lakes.size <= 16, `seed ${seed}: ${L.lakes.size} lake hexes`);
    for (const i of L.lakes) assert.ok(!L.ocean.has(i) && !g.hex.hexes[i].n.some((j) => L.ocean.has(j)) && g.mountains.has(i), `seed ${seed}: a lake on the coast`);
    // every river ends at the coast, in a lake, or in another river
    const k = (p) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
    const coast = new Set();
    for (const i of [...L.ocean, ...L.lakes]) for (const c of g.hex.corners(g.hex.hexes[i])) coast.add(k(c));
    for (const r of L.rivers) {
      const end = k(r.pts[r.pts.length - 1]);
      const into = L.rivers.some((o) => o !== r && o.pts.some((p) => k(p) === end));
      assert.ok(coast.has(end) || into, `seed ${seed}: a river that doesn't reach the sea`);
    }
    // the sea is impassable, and never anyone's
    const sea = [...L.ocean].find((i) => g.hex.hexes[i].full);
    assert.ok(g.mountains.has(sea));
    const p = g.addPlayer('P', false);
    assert.ok(!g.canBuyHex(p.id, sea));
    const sh = g.hex.hexes[sea];
    assert.match(g.makeOrder(p.id, { k: 'p', id: sh.centre }), /swim/);
    const lake = g.hex.hexes[[...L.lakes][0]];
    assert.ok(!g.canBuyHex(p.id, lake.i));
    assert.match(g.makeOrder(p.id, { k: 'p', id: lake.centre }), /swim/);
    assert.ok(!Terrain.mapTerrain(g.mapSeed, g.hex, g.w, g.h, { rivers: true }).forest.has(sea));
  }
});
