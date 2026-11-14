'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { Game, seeded, run } = require('./helpers');

// Two players, rich in gold, with buildings that need workers to go up (unlike duel()).
function setup(seed) {
  const g = new Game({ botTarget: 0, rand: seeded(seed), mapSeed: seed });
  const a = g.addPlayer('A');
  const b = g.addPlayer('B');
  for (const p of [a, b]) {
    p.gold = 1e5;
    p.spawnTime = -1000;
    p.nextWaveAt = Infinity;
    for (const q of p.squads) for (const k of Object.keys(q.mix)) q.mix[k] = 0; // no troops in the way
    p.armySeen = 1e9;
  }
  g.update(0.05);
  return { g, a, b };
}

const workers = (g, p) => [...g.units.values()].filter((u) => u.owner === p.id && u.worker);
const respawn = (g, p) => {
  p.nextWaveAt = g.time;
  g.update(0.05);
  p.nextWaveAt = Infinity;
};
const only = (p, job) => {
  for (const j of C.WORKER_JOBS) p.jobs[j] = j === job ? 2 : 0;
};
// The free hex next to p's core in direction n, as a tile.
function spot(g, p, n) {
  const h = g.hex.hexes[g.hex.hexes[g.hexAt(p.core.x, p.core.y)].n[n]];
  return [h.centre % g.w, Math.floor(h.centre / g.w), h];
}

test('workers: you start with 3, they respawn with the troops, and take no army slots', () => {
  const { g, a } = setup(70);
  assert.strictEqual(g.workerCap(a), C.BASE_WORKERS);
  respawn(g, a);
  assert.strictEqual(workers(g, a).length, C.BASE_WORKERS);
  assert.ok(workers(g, a).every((u) => u.sq === 0), 'not in any squad');
  g.units.delete(workers(g, a)[0].id);
  respawn(g, a);
  assert.strictEqual(workers(g, a).length, C.BASE_WORKERS, 'a fallen worker comes back');
});

test('buildings are sites until workers build them; then they work', () => {
  const { g, a, b } = setup(71);
  only(a, 'build');
  const [x, y] = spot(g, a, 0);
  const gold = a.gold;
  const wood = a.wood;
  assert.strictEqual(g.build(a.id, x, y, 'tower'), null);
  assert.strictEqual(a.gold, gold - C.TOWERS.tower.cost);
  assert.strictEqual(a.wood, wood - C.TOWERS.tower.wood, 'it costs wood too');
  const t = [...g.towers.values()].find((o) => o.owner === a.id && o.kind === 'tower');
  assert.strictEqual(t.progress, 0);
  assert.ok(t.hp < t.maxHp * 0.2, 'a site starts weak');
  assert.match(g.upgrade(a.id, t.id), /Finish/);
  // an enemy next to the site isn't shot
  const foe = g.spawnTroop(b, 'soldier');
  foe.x = t.x + 2.5; foe.y = t.y + 0.5; foe.attack = { k: 'p', id: g.idx(t.x + 2, t.y) };
  run(g, 2, () => { foe.x = t.x + 2.5; foe.y = t.y + 0.5; return false; });
  assert.strictEqual(foe.hp, foe.maxHp, 'a site does not shoot');
  g.units.delete(foe.id);
  respawn(g, a);
  const done = run(g, C.BUILD_TIME.tower / 2 + 15, () => t.progress >= 1);
  assert.ok(done, 'the workers finished it');
  assert.ok(t.hp > t.maxHp * 0.95, 'at full strength');
  // building needs wood
  a.wood = 0;
  const [x2, y2] = spot(g, a, 3);
  assert.match(g.build(a.id, x2, y2, 'tower'), /wood/);
});

test('workers chop forests next to their land and carry the wood home', () => {
  const { g, a } = setup(72);
  only(a, 'gather');
  // make sure there's a forest hex touching a's land
  const core = g.hex.hexes[g.hexAt(a.core.x, a.core.y)];
  const edge = g.hex.hexes.find((h) => !g.hexOwner[h.i] && h.full && h.n.some((j) => g.hexOwner[j] === a.id)
    && Math.hypot(h.cx - core.cx, h.cy - core.cy) < 14);
  g.forest.set(edge.i, C.FOREST_WOOD);
  const wood = a.wood;
  respawn(g, a);
  run(g, 45);
  assert.ok(a.wood > wood, `wood went up (${wood} -> ${a.wood})`);
  const chopped = [...g.forest.entries()].some(([, w]) => w < C.FOREST_WOOD);
  assert.ok(chopped, 'a forest was chopped');
  // forests grow back
  only(a, 'build');
  run(g, 20); // (anyone mid-chop fills their load and heads home)
  const [i, left] = [...g.forest.entries()].find(([, w]) => w < C.FOREST_WOOD);
  run(g, 5);
  assert.ok(g.forest.get(i) > left, 'and regrow');
});

test('workers farm their land for gold, and repair damaged buildings for gold', () => {
  const { g, a } = setup(73);
  only(a, 'farm');
  respawn(g, a);
  run(g, 25);
  assert.ok(a.earned.farm > 0, 'farming pays');
  // repair: a damaged, finished tower
  const [x, y] = spot(g, a, 1);
  g.instantBuild = true;
  g.build(a.id, x, y, 'tower');
  g.instantBuild = false;
  const t = [...g.towers.values()].find((o) => o.owner === a.id);
  t.hp = t.maxHp / 2;
  only(a, 'repair');
  const earned = () => Object.values(a.earned).reduce((x, y) => x + y, 0);
  const [gold, e0] = [a.gold, earned()];
  run(g, 30, () => t.hp >= t.maxHp);
  assert.strictEqual(t.hp, t.maxHp, 'repaired');
  const spent = gold + (earned() - e0) - a.gold;
  assert.ok(Math.abs(spent - (t.maxHp / 2) * C.REPAIR_GOLD_PER_HP) < 1, `for a little gold (${spent.toFixed(1)}g)`);
});

test('job priorities, sending a worker by hand, workshops and raids', () => {
  const { g, a, b } = setup(74);
  for (const j of C.WORKER_JOBS) assert.strictEqual(g.setJobPriority(a.id, j, 0), null);
  assert.match(g.setJobPriority(a.id, 'dance', 1), /Invalid/);
  assert.match(g.setJobPriority(a.id, 'farm', 5), /Invalid/);
  const [x, y] = spot(g, a, 2);
  g.build(a.id, x, y, 'workshop');
  const shop = [...g.towers.values()].find((o) => o.owner === a.id && o.kind === 'workshop');
  respawn(g, a);
  run(g, 5);
  assert.ok(workers(g, a).every((u) => !u.job), 'every job off: nobody works');
  assert.strictEqual(shop.progress, 0);
  // send one worker by hand: it builds the workshop even with building switched off
  const [w] = workers(g, a);
  assert.strictEqual(g.sendWorker(a.id, w.id, { k: 't', id: shop.id }), null);
  assert.match(g.sendWorker(b.id, w.id, { k: 't', id: shop.id }), /your workers/);
  assert.ok(run(g, C.BUILD_TIME.workshop + 20, () => shop.progress >= 1), 'built');
  assert.strictEqual(g.workerCap(a), C.BASE_WORKERS + C.WORKSHOP_WORKERS, 'a workshop adds workers');
  respawn(g, a);
  assert.strictEqual(workers(g, a).length, C.BASE_WORKERS + C.WORKSHOP_WORKERS);
  // killing a worker pays the raider, with the wood it carried
  const [v] = workers(g, a);
  v.carry = 7;
  const gold = b.gold;
  const wood = b.wood;
  g.damageUnit(v, 1e6, b.id);
  assert.strictEqual(b.gold, gold + C.WORKER_BOUNTY);
  assert.strictEqual(b.wood, wood + 7);
});
