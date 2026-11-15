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

test('workers chop forests and carry the wood home', () => {
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
  for (const u of workers(g, a)) g.units.delete(u.id); // nobody chopping any more
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

test('iron: workers mine ore deposits and carry it home; troop levels cost iron', () => {
  const { g, a, b } = setup(76);
  assert.ok(g.ore.size > 10, `the map has ore deposits (${g.ore.size})`);
  assert.strictEqual(a.iron, C.START_IRON);
  // troop levels need iron as well as gold
  a.iron = 0;
  assert.match(g.armyLevel(a.id, 'soldier'), /iron/);
  a.iron = C.armyLevelIron('soldier', 1);
  const gold = a.gold;
  assert.strictEqual(g.armyLevel(a.id, 'soldier'), null);
  assert.strictEqual(a.iron, 0, 'the iron was spent');
  assert.strictEqual(a.gold, gold - C.armyLevelCost('soldier', 1));
  assert.ok(C.armyLevelIron('soldier', 3) > C.armyLevelIron('soldier', 1) && C.armyLevelIron('siege', 1) > C.armyLevelIron('soldier', 1), 'more for higher levels and bigger troops');
  // mining: a deposit near a's core
  only(a, 'mine');
  const core = g.hex.hexes[g.hexAt(a.core.x, a.core.y)];
  const near = g.hex.hexes.filter((h) => !g.hexOwner[h.i] && h.full && !g.forest.has(h.i) && Math.hypot(h.cx - core.cx, h.cy - core.cy) < 14)[0];
  g.ore.set(near.i, C.IRON_ORE);
  const iron0 = a.iron;
  respawn(g, a);
  run(g, 60);
  assert.ok(a.iron > iron0, `iron came home (${iron0} -> ${a.iron})`);
  assert.ok([...g.ore.values()].some((v) => v < C.IRON_ORE), 'a deposit was mined');
  // deposits build back up
  for (const u of workers(g, a)) g.units.delete(u.id);
  const [i, left] = [...g.ore.entries()].find(([, v]) => v < C.IRON_ORE);
  run(g, 5);
  assert.ok(g.ore.get(i) > left, 'and build back up');
  // a raided miner pays its iron to the raider
  respawn(g, a);
  const [v] = workers(g, a);
  v.carry = 5;
  v.carryKind = 'iron';
  const bi = b.iron;
  g.damageUnit(v, 1e6, b.id);
  assert.strictEqual(b.iron, bi + 5);
});

test('sudden death: workers can\'t patch a crumbling core back up', () => {
  const g = new Game({ botTarget: 0, rand: seeded(77), mapSeed: 77, rounds: true });
  const a = g.addPlayer('A');
  g.addPlayer('B');
  a.gold = 1e5;
  a.spawnTime = -1000;
  only(a, 'repair');
  a.nextWaveAt = g.time;
  g.update(0.05);
  a.nextWaveAt = Infinity;
  g.time = g.rules.suddenDeath + 1;
  a.core.hp = a.core.maxHp * 0.6;
  const hp = a.core.hp;
  run(g, 10);
  assert.ok(a.core.hp < hp, `the core kept crumbling (${Math.round(hp)} -> ${Math.round(a.core.hp)})`);
  assert.ok(workers(g, a).every((u) => !u.job || u.job.k !== 'c'), 'nobody repairing it');
});

test('gold veins: rare; farming one on your land pays four times as much, and veins come first', () => {
  const { g, a } = setup(78);
  assert.ok(g.veins.size >= 1 && g.veins.size <= 12, `rare (${g.veins.size} on this map)`);
  for (const i of g.veins) assert.ok(!g.forest.has(i) && !g.ore.has(i), 'never on a forest or ore');
  // put a vein on a's land (and keep a plain hex too)
  const core = g.hex.hexes[g.hexAt(a.core.x, a.core.y)];
  const [vh, plain] = core.n.filter((j) => g.hexOwner[j] === a.id && !g.forest.has(j) && !g.ore.has(j));
  g.veins.add(vh);
  only(a, 'farm');
  respawn(g, a);
  run(g, 10);
  const onVein = workers(g, a).filter((u) => u.job && u.job.id === vh).length;
  assert.strictEqual(onVein, Math.min(C.VEIN_WORKERS, workers(g, a).length), 'the vein is farmed first, by up to VEIN_WORKERS');
  const e0 = a.earned.farm || 0;
  run(g, 20);
  const rate = ((a.earned.farm || 0) - e0) / 20;
  assert.ok(rate > onVein * C.VEIN_GOLD * 0.7, `vein pays well (${rate.toFixed(2)}g/s)`);
  assert.ok(C.VEIN_GOLD >= 4 * C.FARM_GOLD);
  assert.ok(plain !== undefined);
});
