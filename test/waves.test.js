'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { duel, outpost, troops, run } = require('./helpers');

const mine = (g, p) => [...g.units.values()].filter((u) => u.owner === p.id);

test('the core sends a free wave built from the army plan every interval', () => {
  const { g, a } = duel(1);
  a.nextWaveAt = g.time;
  g.update(0.05);
  const w1 = mine(g, a);
  assert.strictEqual(w1.length, 4);
  assert.deepStrictEqual(w1.map((u) => u.kind).sort(), ['archer', 'archer', 'guard', 'guard']);
  assert.ok(Math.abs(a.nextWaveAt - (g.time - 0.05 + C.WAVE_INTERVAL)) < 0.1);
  run(g, C.WAVE_INTERVAL);
  assert.strictEqual(mine(g, a).length, 8);
});

test('waves stop at the land-based troop cap', () => {
  const { g, a } = duel(2);
  const cap = C.unitCap(a.territory);
  a.army.archer = 10;
  for (let i = 0; i < 5; i++) {
    a.nextWaveAt = g.time;
    g.update(0.05);
  }
  assert.strictEqual(mine(g, a).length, cap);
});

test('the army plan: add, remove and level troop types', () => {
  const { g, a } = duel(3);
  const gold = a.gold;
  assert.strictEqual(g.armyAdd(a.id, 'mortar'), null);
  assert.strictEqual(a.army.mortar, 1);
  assert.strictEqual(a.gold, gold - C.armyAddCost('mortar', 0));
  assert.strictEqual(g.armyAdd(a.id, 'mortar'), null);
  assert.strictEqual(a.gold, gold - C.armyAddCost('mortar', 0) - C.armyAddCost('mortar', 1));
  assert.strictEqual(g.armyLevel(a.id, 'archer'), null);
  assert.strictEqual(a.levels.archer, 2);
  assert.match(g.armyAdd(a.id, 'dragon'), /Invalid/);
  while (!g.armyAdd(a.id, 'guard'));
  assert.match(g.armyAdd(a.id, 'guard'), /capped/);
  a.nextWaveAt = g.time;
  g.update(0.05);
  const archers = mine(g, a).filter((u) => u.kind === 'archer');
  assert.ok(archers.length && archers.every((u) => u.level === 2), 'new archers spawn at the new level');
  for (const k of Object.keys(a.army)) while (a.army[k] && !g.armyRemove(a.id, k));
  assert.match(g.armyRemove(a.id, 'guard'), /at least one|None/);
});

test('orders: everyone plus future waves, or only selected troops', () => {
  const { g, a, b } = duel(4);
  const t = outpost(g, b);
  const squad = troops(g, a, 'archer', 4, a.core.x + 0.5, a.core.y + 2);
  assert.strictEqual(g.order(a.id, [squad[0].id], { k: 't', id: t.id }), null);
  assert.deepStrictEqual(squad[0].attack, { k: 't', id: t.id, owner: b.id });
  assert.strictEqual(squad[1].attack, null);
  assert.strictEqual(a.order.type, 'defend', 'selection orders leave the standing order alone');
  assert.strictEqual(g.order(a.id, null, { k: 'c', id: b.id }), null);
  assert.ok(squad.every((u) => u.attack && u.attack.k === 'c'));
  a.nextWaveAt = g.time;
  g.update(0.05);
  assert.ok(mine(g, a).every((u) => u.attack && u.attack.k === 'c'), 'new waves follow the standing order');
  assert.strictEqual(g.order(a.id, null, { k: 'c', id: a.id }), null);
  assert.ok(mine(g, a).every((u) => !u.attack && u.anchor === 0));
  assert.match(g.order(a.id, null, { k: 't', id: 999 }), /No such/);
  assert.match(g.order(a.id, null, { k: 'x', id: 1 }), /Invalid/);
  assert.match(g.order(b.id, [squad[0].id], { k: 'c', id: a.id }), /No troops/);
});

test('an attack marches across the map and captures an undefended tower', () => {
  const { g, a, b } = duel(5);
  const t = outpost(g, b);
  const squad = troops(g, a, 'archer', 5, a.core.x + 0.5, a.core.y + 2);
  g.order(a.id, squad.map((u) => u.id), { k: 't', id: t.id });
  assert.ok(run(g, 120, () => t.owner !== b.id), 'tower should fall');
  assert.strictEqual(t.owner, a.id, 'with nobody defending, occupation captures it');
  for (const u of squad.filter((v) => g.units.has(v.id))) {
    assert.strictEqual(u.anchor, t.id, 'the attackers stay on as its garrison');
    assert.strictEqual(u.attack, null);
  }
});

test('when a tower is destroyed the attack rolls on to the next structure', () => {
  const { g, a, b } = duel(6);
  const saved = C.CAPTURE_RANGE;
  C.CAPTURE_RANGE = 0; // force destruction instead of capture
  try {
    const t = outpost(g, b);
    const squad = troops(g, a, 'mortar', 4, t.x - 3, t.y + 0.5, 3);
    g.order(a.id, squad.map((u) => u.id), { k: 't', id: t.id });
    const gold = a.gold;
    assert.ok(run(g, 120, () => t.ruin), 'tower should be destroyed');
    assert.ok(a.gold >= gold + C.TOWER_BOUNTY);
    g.update(0.05);
    const alive = squad.filter((u) => g.units.has(u.id));
    assert.ok(alive.length);
    for (const u of alive) assert.deepStrictEqual(u.attack, { k: 'c', id: b.id });
  } finally {
    C.CAPTURE_RANGE = saved;
  }
});

test('a defended tower is not captured', () => {
  const { g, a, b } = duel(7);
  const savedRegen = C.HOME_REGEN;
  C.HOME_REGEN = 0; // the defender has huge HP; regen would hide the hits it takes
  const t = outpost(g, b);
  const def = troops(g, b, 'guard', 1, t.x + 0.5, t.y + 1.5)[0];
  def.hp = def.maxHp = 1e9;
  g.order(b.id, [def.id], { k: 't', id: t.id });
  const squad = troops(g, a, 'archer', 3, t.x - 2, t.y + 0.5);
  g.order(a.id, squad.map((u) => u.id), { k: 't', id: t.id });
  run(g, 20);
  assert.strictEqual(t.owner, b.id);
  assert.ok(!t.cap);
  assert.ok(def.hp < def.maxHp, 'attackers fight the defender');
  C.HOME_REGEN = savedRegen;
});

test('towers and cores shoot enemy troops', () => {
  const { g, a, b } = duel(8);
  const t = outpost(g, a);
  const [nearTower] = troops(g, b, 'guard', 1, t.x + 0.5, t.y + 2.5);
  const [nearCore] = troops(g, b, 'guard', 1, a.core.x + 0.5, a.core.y + 3);
  for (const u of [nearTower, nearCore]) u.hp = u.maxHp = 1e6;
  g.order(b.id, [nearTower.id, nearCore.id], { k: 'c', id: b.id });
  for (const u of [nearTower, nearCore]) u.attack = null;
  run(g, 1.2);
  assert.ok(nearTower.hp < nearTower.maxHp, 'tower shot');
  assert.ok(nearCore.hp < nearCore.maxHp, 'core shot');
});

test('defenders patrol their tower on their own land and come home from the field', () => {
  const { g, a } = duel(9);
  const t = outpost(g, a, 0, 1);
  const squad = troops(g, a, 'archer', 4, a.core.x + 0.5, a.core.y + 1.5);
  g.order(a.id, squad.map((u) => u.id), { k: 't', id: t.id });
  run(g, 20);
  for (let i = 0; i < 20 * 40; i++) {
    g.update(0.05);
    for (const u of squad) {
      assert.strictEqual(g.terr[g.idx(Math.floor(u.x), Math.floor(u.y))], a.id, 'troop left its land');
      assert.ok(Math.hypot(u.x - t.x - 0.5, u.y - t.y - 0.5) <= C.UNIT_LEASH_TOWER + 0.75, 'troop strayed');
    }
  }
  // Drop one far away: it marches home.
  squad[0].x = 2;
  squad[0].y = 2;
  run(g, 60);
  assert.ok(Math.hypot(squad[0].x - t.x - 0.5, squad[0].y - t.y - 0.5) <= C.UNIT_LEASH_TOWER + 0.75);
});

test('guards taunt: enemy troops hit a nearby guard before anything else', () => {
  const { g, a, b } = duel(10);
  const [archer] = troops(g, a, 'archer', 1, 50, 50);
  const [enemyArcher] = troops(g, b, 'archer', 1, 51, 50);
  const [enemyGuard] = troops(g, b, 'guard', 1, 52, 50);
  assert.strictEqual(g.pickTarget(archer, C.UNITS.archer, 4.5, true), enemyGuard);
  enemyGuard.x = 54; // outside its taunt radius
  assert.strictEqual(g.pickTarget(archer, C.UNITS.archer, 4.5, true), enemyArcher);
});

test('medics heal, and troops heal slowly on their own land', () => {
  const { g, a } = duel(11);
  const [guard] = troops(g, a, 'guard', 1, 60, 60); // out in the field
  const [medic] = troops(g, a, 'medic', 1, 60.5, 60);
  guard.hp = 100;
  run(g, 2);
  assert.ok(guard.hp > 100, `medic heals (hp ${guard.hp})`);
  g.units.delete(medic.id);
  const [homeGuard] = troops(g, a, 'guard', 1, a.core.x + 0.5, a.core.y + 1.5);
  homeGuard.hp = 100;
  run(g, 2);
  assert.ok(homeGuard.hp > 100 && homeGuard.hp < 100 + homeGuard.maxHp * C.HOME_REGEN * 2.2, 'home regen');
});

test('the standing order rolls on to the next structure when its tower is taken', () => {
  const { g, a, b } = duel(12);
  const t1 = outpost(g, b, 1, 0);
  const t2 = outpost(g, b, 0, 1);
  g.order(a.id, null, { k: 't', id: t1.id });
  g.transferTower(t1, a.id);
  assert.deepStrictEqual(a.order, { type: 'attack', target: { k: 't', id: t2.id, owner: b.id } });
  g.damageTower(t2, 1e9, a.id);
  assert.deepStrictEqual(a.order, { type: 'attack', target: { k: 'c', id: b.id } });
});
