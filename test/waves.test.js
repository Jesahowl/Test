'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { Game, seeded, duel, outpost, troops, run } = require('./helpers');

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

test('destroying a tower claims it for the attacker', () => {
  const { g, a, b } = duel(6);
  const saved = C.CAPTURE_RANGE;
  C.CAPTURE_RANGE = 0; // no occupation: the tower has to be knocked down
  try {
    const t = outpost(g, b);
    t.level = 2;
    const landBefore = a.territory;
    const squad = troops(g, a, 'mortar', 4, t.x - 3, t.y + 0.5, 3);
    g.order(a.id, null, { k: 't', id: t.id });
    const gold = a.gold;
    assert.ok(run(g, 120, () => t.owner !== b.id), 'tower should fall');
    assert.strictEqual(t.owner, a.id, 'the destroyer claims it');
    assert.ok(!t.ruin);
    assert.strictEqual(t.level, 2, 'it keeps its level');
    assert.ok(t.hp > 0 && t.hp <= Math.round(t.maxHp * C.TOWER_CLAIM_HP) + 1, `patched up to ${C.TOWER_CLAIM_HP * 100}% (hp ${t.hp})`);
    assert.ok(a.gold >= gold + C.TOWER_BOUNTY);
    assert.strictEqual(a.towersDestroyed, 1);
    g.update(0.05);
    assert.ok(a.territory > landBefore, 'its land comes with it');
    for (const u of squad.filter((v) => g.units.has(v.id))) assert.strictEqual(u.anchor, t.id, 'the attackers garrison it');
    assert.deepStrictEqual(a.order, { type: 'attack', target: { k: 'c', id: b.id } }, 'new waves push on to the core');
  } finally {
    C.CAPTURE_RANGE = saved;
  }
});

test('towers still fall to ruins when their owner is wiped out', () => {
  const { g, a, b } = duel(15);
  const t = outpost(g, b);
  g.damageCore(b, 1e9, a.id);
  assert.ok(t.ruin);
  assert.strictEqual(t.owner, 0);
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

test('send a percentage: that share of troops, keeping the mix, nearest first', () => {
  const { g, a, b } = duel(13);
  const t = outpost(g, b);
  const near = troops(g, a, 'archer', 4, t.x - 6, t.y + 0.5);
  const far = troops(g, a, 'archer', 4, a.core.x + 0.5, a.core.y + 1);
  const guards = troops(g, a, 'guard', 4, a.core.x + 0.5, a.core.y - 1);
  const standing = { ...a.order };
  assert.strictEqual(g.order(a.id, null, { k: 't', id: t.id }, 0.5), null);
  assert.strictEqual(g.lastOrderCount, 6);
  const sent = [...near, ...far, ...guards].filter((u) => u.attack);
  assert.strictEqual(sent.length, 6);
  assert.strictEqual(sent.filter((u) => u.kind === 'guard').length, 2, 'half the guards');
  assert.strictEqual(sent.filter((u) => u.kind === 'archer').length, 4, 'half the archers');
  assert.ok(near.every((u) => u.attack), 'the archers nearest the target go first');
  assert.deepStrictEqual(a.order, standing, 'new waves keep their standing order');

  // Sending another 50% picks from the troops that aren't already on it.
  assert.strictEqual(g.order(a.id, null, { k: 't', id: t.id }, 0.5), null);
  assert.strictEqual([...near, ...far, ...guards].filter((u) => u.attack).length, 12);

  // 25% home again, and 100% still means everyone plus new waves.
  assert.strictEqual(g.order(a.id, null, { k: 'c', id: a.id }, 0.25), null);
  assert.strictEqual([...near, ...far, ...guards].filter((u) => !u.attack).length, 3);
  assert.strictEqual(g.order(a.id, null, { k: 't', id: t.id }, 1), null);
  assert.strictEqual(a.order.type, 'attack');
});

test('a percentage of a tiny army still sends at least one troop', () => {
  const { g, a, b } = duel(14);
  troops(g, a, 'archer', 1, a.core.x + 0.5, a.core.y + 1);
  assert.strictEqual(g.order(a.id, null, { k: 'c', id: b.id }, 0.25), null);
  assert.strictEqual(g.lastOrderCount, 1);
  assert.match(g.order(a.id, null, { k: 'c', id: b.id }, 0.25), /No troops available/);
});

test('capture speed is capped, and higher-level towers take longer to capture', () => {
  assert.strictEqual(C.captureSpeed(1), 1);
  assert.strictEqual(C.captureSpeed(20), C.CAPTURE_MAX_SPEED);
  assert.ok(C.captureTime(3) > C.captureTime(1));
  const { g, a, b } = duel(14);
  const t = outpost(g, b);
  troops(g, a, 'guard', 12, t.x + 0.5, t.y + 2);
  // 12 troops on an unguarded level-1 tower: no faster than the capped speed allows
  const minTime = C.captureTime(1) / C.CAPTURE_MAX_SPEED;
  let secs = 0;
  run(g, 30, () => {
    secs += 0.05;
    for (const u of g.units.values()) if (u.owner === a.id) u.attack = null;
    return t.owner === a.id;
  });
  assert.strictEqual(t.owner, a.id);
  assert.ok(secs >= minTime - 0.1, `took ${secs.toFixed(2)}s, at least ${minTime}s`);
});

test('the spatial grid finds the same nearby troops as a full scan', () => {
  const g = new Game({ botTarget: 6, rand: seeded(21) });
  let checks = 0;
  for (let i = 0; i < 20 * 150; i++) {
    g.update(0.05);
    if (i % 40) continue;
    for (const u of [...g.units.values()].slice(0, 30)) {
      const near = new Set(g.nearUnits(u.x, u.y, 5));
      for (const v of g.units.values()) {
        if (Math.hypot(v.x - u.x, v.y - u.y) <= 5) {
          assert.ok(near.has(v), 'grid missed a troop');
          checks++;
        }
      }
    }
  }
  assert.ok(checks > 100);
});

test('hunting: troops chase a chosen enemy troop, focus it, then move on to its squadmates', () => {
  const { g, a, b } = duel(15);
  const hunters = troops(g, a, 'archer', 4, 50, 50);
  const prey = troops(g, b, 'guard', 3, 58, 50); // the target and two squadmates
  const decoy = troops(g, b, 'archer', 1, 51, 52)[0]; // right next to the hunters
  const [target] = prey;
  for (const v of [...prey, decoy]) v.attack = { k: 'c', id: b.id }; // hold them still: no orders to follow
  const before = a.order;
  assert.strictEqual(g.order(a.id, null, { k: 'u', id: target.id }, 1), null);
  assert.strictEqual(g.lastOrderCount, 4);
  assert.deepStrictEqual(a.order, before, 'new waves keep their standing order');
  assert.ok(hunters.every((u) => u.attack.k === 'u' && u.attack.id === target.id));
  // pin the prey in place and let the hunters work
  const pin = () => { for (const v of [...prey, decoy]) if (g.units.has(v.id)) { v.x = v === decoy ? 51 : 58 + prey.indexOf(v) * 0.4; v.y = v === decoy ? 52 : 50; v.path = []; } };
  run(g, 30, () => { pin(); return !g.units.has(target.id); });
  assert.ok(!g.units.has(target.id), 'target killed');
  assert.ok(g.units.has(decoy.id) && decoy.hp > decoy.maxHp * 0.5, 'decoy ignored while hunting');
  g.update(0.05);
  const living = hunters.filter((u) => g.units.has(u.id));
  assert.ok(living.length && living.every((u) => u.attack && u.attack.k === 'u' && prey.some((p) => p.id === u.attack.id)), 'rolled on to a squadmate');
  run(g, 60, () => { pin(); return prey.every((v) => !g.units.has(v.id)); });
  g.update(0.05);
  assert.ok(hunters.filter((u) => g.units.has(u.id)).every((u) => !u.attack || u.attack.k !== 'u'), 'hunt over once the squad is gone');
  const mine = troops(g, a, 'guard', 1, 40, 40)[0];
  assert.match(g.order(a.id, null, { k: 'u', id: mine.id }), /own troop/);
  assert.match(g.order(a.id, null, { k: 'u', id: 99999 }), /gone/);
});
