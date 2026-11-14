'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { Game, seeded, duel, troops, run } = require('./helpers');

function ally(g, a, b) {
  g.proposeAlliance(a.id, b.id);
  g.acceptAlliance(b.id, a.id);
  assert.ok(g.allied(a.id, b.id));
}

// A free hex of p's land (not the core's) to build in.
function spotFor(g, p, minD = 3) {
  for (const h of g.hex.hexes) {
    if (g.hexOwner[h.i] !== p.id || !h.full || h.centre < 0 || g.buildingHexes()[h.i]) continue;
    const x = h.centre % g.w;
    const y = (h.centre - x) / g.w;
    if (Math.hypot(x - p.core.x, y - p.core.y) > minD) return [x, y];
  }
  throw new Error('no free hex');
}

function post(g, p) {
  const [x, y] = spotFor(g, p);
  assert.strictEqual(g.build(p.id, x, y, 'trade'), null);
  return [...g.towers.values()].find((t) => t.kind === 'trade' && t.owner === p.id && t.x === x && t.y === y);
}

const caravans = (g, p) => [...g.units.values()].filter((u) => u.trade && (!p || u.owner === p.id));

test('allied trade posts open a route by themselves, and deliveries pay both players', () => {
  const { g, a, b } = duel(60);
  ally(g, a, b);
  const pa = post(g, a);
  const pb = post(g, b);
  run(g, 1);
  assert.strictEqual(pa.partner, pb.id);
  assert.strictEqual(pb.partner, pa.id);
  const cargo = g.cargoOf(pa, pb);
  assert.ok(cargo > C.CARAVAN_BASE);
  assert.ok(run(g, 15, () => caravans(g, a).length > 0), 'a caravan sets off');
  const [u] = caravans(g, a);
  assert.strictEqual(u.trade.cargo, cargo);
  const ea = a.earned.trade;
  const eb = b.earned.trade;
  assert.ok(run(g, 120, () => !g.units.has(u.id)), 'it arrives');
  assert.ok(a.earned.trade - ea >= cargo, 'the sender is paid');
  assert.ok(b.earned.trade - eb >= cargo, 'and so is the receiver');
});

test('no route without an alliance; when it ends, caravans on the road vanish', () => {
  const { g, a, b } = duel(61);
  const pa = post(g, a);
  post(g, b);
  run(g, 12);
  assert.strictEqual(pa.partner || 0, 0);
  assert.strictEqual(caravans(g).length, 0);
  ally(g, a, b);
  assert.ok(run(g, 15, () => caravans(g).length > 0));
  const gold = a.earned.trade;
  g.breakAlliance(a.id, b.id);
  run(g, 0.2);
  assert.strictEqual(caravans(g).length, 0, 'caravans vanished');
  assert.strictEqual(pa.partner, 0, 'the route closed');
  assert.strictEqual(a.earned.trade, gold, 'nothing was paid');
});

test('raiders who destroy a caravan take half its cargo', () => {
  const g = new Game({ botTarget: 0, rand: seeded(62) });
  const [a, b, c] = ['A', 'B', 'C'].map((n) => g.addPlayer(n));
  for (const p of [a, b, c]) {
    p.gold = 1e6;
    p.spawnTime = -1000;
    p.nextWaveAt = Infinity;
  }
  g.update(0.05);
  ally(g, a, b);
  const pa = post(g, a);
  post(g, b);
  assert.ok(run(g, 15, () => caravans(g, a).length > 0));
  const [u] = caravans(g, a);
  run(g, 4); // out on the road
  const raiders = troops(g, c, 'soldier', 6, u.x + 1, u.y, 3);
  for (const r of raiders) r.attack = { k: 'u', id: u.id, owner: a.id, lx: u.x, ly: u.y };
  const before = c.earned.trade;
  assert.ok(run(g, 30, () => !g.units.has(u.id)), 'the caravan was destroyed');
  assert.strictEqual(Math.round(c.earned.trade - before), Math.round(u.trade.cargo * C.RAID_SHARE));
  assert.ok(pa.partner, 'the route itself is still open');
});

test('caravans steer round hostile towers', () => {
  const g = new Game({ botTarget: 0, rand: seeded(63) });
  const [a, b, c] = ['A', 'B', 'C'].map((n) => g.addPlayer(n));
  for (const p of [a, b, c]) {
    p.gold = 1e6;
    p.spawnTime = -1000;
    p.nextWaveAt = Infinity;
  }
  g.update(0.05);
  ally(g, a, b);
  const pa = post(g, a);
  const pb = post(g, b);
  // a hostile tower right in the middle of the road (placed directly, for the test)
  const mx = Math.round((pa.x + pb.x) / 2);
  const my = Math.round((pa.y + pb.y) / 2);
  const id = g.nextId++;
  const st = C.towerStats('tower', 1);
  g.towers.set(id, { isTower: true, id, kind: 'tower', x: mx, y: my, owner: c.id, level: 1, hp: st.hp, maxHp: st.hp, cd: 0, ruin: false });
  g.grid[g.idx(mx, my)] = id;
  g.structVersion++;
  const u = g.sendCaravan(pa, pb);
  const reach = st.range;
  const inReach = u.path.filter((k) => Math.hypot((k % g.w) + 0.5 - (mx + 0.5), Math.floor(k / g.w) + 0.5 - (my + 0.5)) <= reach).length;
  assert.strictEqual(inReach, 0, 'the road stays out of the tower\'s reach');
});

test('a squad can escort a caravan; caravans are never part of squads or orders', () => {
  const { g, a, b } = duel(64);
  ally(g, a, b);
  const pa = post(g, a);
  post(g, b);
  const squad = troops(g, a, 'soldier', 3, a.core.x + 0.5, a.core.y + 2.5);
  assert.ok(run(g, 15, () => caravans(g, a).length > 0));
  const [u] = caravans(g, a);
  // a general order doesn't pick up the caravan
  assert.strictEqual(g.order(a.id, null, { k: 'c', id: a.id }), null);
  assert.strictEqual(g.lastOrderCount, squad.length);
  assert.ok(!u.attack && !u.anchor);
  assert.strictEqual(g.order(a.id, squad.map((v) => v.id), { k: 'e', id: u.id }), null);
  assert.ok(squad.every((v) => v.attack && v.attack.k === 'e'), 'right-clicking my own caravan means escort');
  run(g, 15);
  assert.ok(squad.every((v) => Math.hypot(v.x - u.x, v.y - u.y) < 5), 'the escort keeps up with it');
  assert.ok(run(g, 120, () => !g.units.has(u.id)), 'delivered');
  run(g, 0.5);
  assert.ok(squad.every((v) => !v.attack), 'then the escort is done');
  assert.ok(pa.partner);
});

test('at most two trade posts each', () => {
  const { g, a } = duel(65);
  post(g, a);
  post(g, a);
  const [x, y] = spotFor(g, a);
  assert.match(g.build(a.id, x, y, 'trade'), /at most/);
});

test('caravans roll straight through a crowd of friendly troops at the trade post', () => {
  const { g, a, b } = duel(60);
  ally(g, a, b);
  post(g, a);
  const pb = post(g, b);
  const guards = troops(g, b, 'soldier', 30, pb.x + 0.5, pb.y + 0.5);
  g.order(b.id, guards.map((v) => v.id), { k: 't', id: pb.id }); // standing guard round the post
  assert.ok(run(g, 15, () => caravans(g, a).length > 0));
  const [u] = caravans(g, a);
  let near = null;
  run(g, 200, () => {
    if (near === null && Math.hypot(u.x - pb.x - 0.5, u.y - pb.y - 0.5) < 5) near = g.time;
    return !g.units.has(u.id);
  });
  assert.ok(!g.units.has(u.id), 'delivered');
  assert.ok(g.time - near < 6, `the last 5 tiles took ${(g.time - near).toFixed(1)}s`);
});
