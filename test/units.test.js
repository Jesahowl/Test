'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const Game = require('../server/game');

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Two players far apart, no bots, no neutral waves.
function setup(seed = 1) {
  const g = new Game({ botTarget: 0, rand: seeded(seed) });
  const a = g.addPlayer('A');
  const b = g.addPlayer('B');
  for (const p of [a, b]) {
    p.nextWave = Infinity;
    p.gold = 10000;
  }
  g.update(0.05);
  return { g, a, b };
}

function openTileNear(g, p, x0, y0, rMin = 1, rMax = 3) {
  for (let r = rMin; r <= rMax; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (g.inBounds(x, y) && g.terr[g.idx(x, y)] === p.id && g.grid[g.idx(x, y)] === 0) return { x, y };
      }
    }
  }
  throw new Error('no open tile');
}

function addBeacon(g, p) {
  // Put a beacon ~5 tiles from the core.
  for (const [dx, dy] of [[5, 0], [-5, 0], [0, 5], [0, -5], [4, 3]]) {
    if (g.build(p.id, p.core.x + dx, p.core.y + dy, 'beacon') === null) {
      g.update(0.05);
      return [...g.towers.values()].find((t) => t.owner === p.id && t.x === p.core.x + dx && t.y === p.core.y + dy);
    }
  }
  throw new Error('could not place beacon');
}

test('units guard the nearest anchor and do not occupy tiles', () => {
  const { g, a } = setup(1);
  const beacon = addBeacon(g, a);
  const nearCore = openTileNear(g, a, a.core.x, a.core.y);
  const nearBeacon = openTileNear(g, a, beacon.x, beacon.y);
  assert.strictEqual(g.build(a.id, nearCore.x, nearCore.y, 'bolt'), null);
  assert.strictEqual(g.build(a.id, nearBeacon.x, nearBeacon.y, 'frost'), null);
  assert.strictEqual(g.build(a.id, nearBeacon.x, nearBeacon.y, 'mortar'), null, 'units can share a tile');
  const [u1, u2, u3] = [...g.units.values()];
  assert.strictEqual(u1.anchor, 0);
  assert.strictEqual(u2.anchor, beacon.id);
  assert.strictEqual(u3.anchor, beacon.id);
  assert.strictEqual(g.grid[g.idx(nearBeacon.x, nearBeacon.y)], 0);
});

test('unit cap is enforced', () => {
  const { g, a } = setup(2);
  const t = openTileNear(g, a, a.core.x, a.core.y);
  for (let i = 0; i < C.MAX_UNITS; i++) assert.strictEqual(g.build(a.id, t.x, t.y, 'bolt'), null);
  assert.match(g.build(a.id, t.x, t.y, 'bolt'), /limit/);
});

test('patrolling units stay on their land and near their anchor', () => {
  const { g, a } = setup(3);
  const beacon = addBeacon(g, a);
  for (let i = 0; i < 4; i++) {
    const t = openTileNear(g, a, a.core.x, a.core.y);
    g.build(a.id, t.x, t.y, ['bolt', 'frost', 'mortar'][i % 3]);
    const tb = openTileNear(g, a, beacon.x, beacon.y);
    g.build(a.id, tb.x, tb.y, 'bolt');
  }
  const start = new Map([...g.units.values()].map((u) => [u.id, [u.x, u.y]]));
  for (let i = 0; i < 20 * 90; i++) {
    g.update(0.05);
    for (const u of g.units.values()) {
      assert.strictEqual(g.terr[g.idx(Math.floor(u.x), Math.floor(u.y))], a.id, 'unit left its land');
      const an = g.anchorOf(u);
      assert.ok(Math.hypot(u.x - an.x, u.y - an.y) <= an.leash + 0.75, 'unit strayed past its leash');
    }
  }
  const moved = [...g.units.values()].filter((u) => Math.hypot(u.x - start.get(u.id)[0], u.y - start.get(u.id)[1]) > 0.5);
  assert.ok(moved.length >= 6, `units should roam (moved: ${moved.length})`);
});

test('units chase and kill creeps entering their patch', () => {
  const { g, a, b } = setup(4);
  for (let i = 0; i < 3; i++) {
    const t = openTileNear(g, b, b.core.x, b.core.y);
    g.build(b.id, t.x, t.y, 'bolt');
  }
  for (let i = 0; i < 4; i++) g.send(a.id, 'grunt', b.id);
  for (let i = 0; i < 20 * 120 && b.kills < 4; i++) g.update(0.05);
  assert.strictEqual(b.kills, 4);
  assert.ok(b.core.hp > C.CORE_HP * 0.8, `core should be well defended (hp ${b.core.hp})`);
});

test('assign sends units to guard a beacon', () => {
  const { g, a, b } = setup(5);
  const beacon = addBeacon(g, a);
  const t = openTileNear(g, a, a.core.x, a.core.y);
  g.build(a.id, t.x, t.y, 'bolt');
  g.build(a.id, t.x, t.y, 'frost');
  const ids = [...g.units.keys()];
  assert.match(g.assign(a.id, ids, 12345), /only guard/);
  assert.match(g.assign(b.id, ids, 0), /No units/, 'cannot command someone else\'s units');
  assert.strictEqual(g.assign(a.id, ids, beacon.id), null);
  for (let i = 0; i < 20 * 10; i++) g.update(0.05);
  for (const u of g.units.values()) {
    assert.strictEqual(u.anchor, beacon.id);
    assert.ok(Math.hypot(u.x - beacon.x - 0.5, u.y - beacon.y - 0.5) <= C.UNIT_LEASH_BEACON + 0.75);
  }
});

test('units fall back to the core when their beacon is destroyed', () => {
  const { g, a } = setup(6);
  const beacon = addBeacon(g, a);
  const t = openTileNear(g, a, beacon.x, beacon.y);
  g.build(a.id, t.x, t.y, 'bolt');
  const u = [...g.units.values()][0];
  assert.strictEqual(u.anchor, beacon.id);
  g.destroyTower(beacon, true);
  for (let i = 0; i < 20 * 15; i++) g.update(0.05);
  assert.strictEqual(u.anchor, 0);
  assert.ok(Math.hypot(u.x - a.core.x - 0.5, u.y - a.core.y - 0.5) <= C.UNIT_LEASH_CORE + 0.75, 'unit should be back home');
  assert.strictEqual(g.terr[g.idx(Math.floor(u.x), Math.floor(u.y))], a.id);
});

test('creeps raid unguarded beacons they pass', () => {
  const { g, a, b } = setup(7);
  const beacon = addBeacon(g, b);
  // A creep appears right next to B's beacon on its way to B's core.
  g.spawnCreep('brute', a.id, b.id, beacon.x + 0.5 + 1.5, beacon.y + 0.5, 1);
  for (let i = 0; i < 20 * 5; i++) g.update(0.05);
  assert.ok(beacon.hp < beacon.maxHp, 'beacon should be under attack');
});

test('creeps fight units that block them', () => {
  const { g, a, b } = setup(8);
  const t = openTileNear(g, b, b.core.x, b.core.y, 2, 3);
  g.build(b.id, t.x, t.y, 'mortar'); // mortars can't shoot point-blank
  const u = [...g.units.values()][0];
  g.spawnCreep('brute', a.id, b.id, u.x + 0.2, u.y, 1);
  for (let i = 0; i < 20 * 2; i++) g.update(0.05);
  assert.ok(!g.units.has(u.id) || u.hp < u.maxHp, 'unit should take damage');
});

test('units can be upgraded and sold, and die with their owner', () => {
  const { g, a, b } = setup(9);
  const t = openTileNear(g, a, a.core.x, a.core.y);
  g.build(a.id, t.x, t.y, 'bolt');
  const u = [...g.units.values()][0];
  assert.strictEqual(g.upgrade(a.id, u.id), null);
  assert.strictEqual(u.level, 2);
  assert.match(g.upgrade(b.id, u.id), /Invalid/);
  const gold = a.gold;
  assert.strictEqual(g.sell(a.id, u.id), null);
  assert.strictEqual(a.gold, gold + C.sellValue('bolt', 2));
  assert.strictEqual(g.units.size, 0);

  g.build(a.id, t.x, t.y, 'bolt');
  g.killPlayer(a, b.id);
  assert.strictEqual(g.units.size, 0);
});
