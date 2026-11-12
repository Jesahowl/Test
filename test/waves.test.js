'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { Game, seeded, duel, edgeTile, outpost, troops, run } = require('./helpers');

const mine = (g, p) => [...g.units.values()].filter((u) => u.owner === p.id);

test('the core sends a free wave of 5 every interval', () => {
  const { g, a } = duel(1);
  a.nextWaveAt = g.time;
  g.update(0.05);
  const w1 = mine(g, a);
  assert.strictEqual(w1.length, C.BASE_WAVE);
  assert.deepStrictEqual(w1.map((u) => u.kind).sort(), ['soldier', 'soldier', 'soldier', 'soldier', 'soldier']);
  assert.ok(Math.abs(a.nextWaveAt - (g.time - 0.05 + C.WAVE_INTERVAL)) < 0.1);
  run(g, C.WAVE_INTERVAL);
  assert.strictEqual(mine(g, a).length, C.BASE_WAVE * 2);
});

test('waves stop at the land-based troop cap', () => {
  const { g, a } = duel(2);
  const cap = C.unitCap(a.territory, g.waveSize(a));
  for (let i = 0; i < 8; i++) {
    a.nextWaveAt = g.time;
    g.update(0.05);
  }
  assert.strictEqual(mine(g, a).length, cap);
});

function barracksAt(g, p, dx, dy) {
  const err = g.build(p.id, p.core.x + dx, p.core.y + dy, 'barracks');
  if (err) throw new Error(err);
  return [...g.towers.values()].find((t) => t.x === p.core.x + dx && t.y === p.core.y + dy);
}

test('each barracks adds 5 troops to every wave, spawning at the barracks', () => {
  const { g, a } = duel(16);
  const gold = a.gold;
  const b1 = barracksAt(g, a, 4, 0);
  assert.strictEqual(a.gold, gold - C.buildCost('barracks', 0));
  const b2 = barracksAt(g, a, -4, 0);
  assert.strictEqual(a.gold, gold - C.buildCost('barracks', 0) - C.buildCost('barracks', 1));
  assert.ok(C.buildCost('barracks', 1) > C.buildCost('barracks', 0), 'each one costs more');
  assert.strictEqual(g.waveSize(a), C.BASE_WAVE + 2 * C.BARRACKS_TROOPS);
  a.nextWaveAt = g.time;
  g.update(0.05);
  const wave = mine(g, a);
  assert.strictEqual(wave.length, 15);
  const near = (t) => wave.filter((u) => Math.hypot(u.x - t.x - 0.5, u.y - t.y - 0.5) < 1.6).length;
  assert.strictEqual(near(b1), 5);
  assert.strictEqual(near(b2), 5);
  assert.ok(wave.filter((u) => u.anchor === b1.id).length === 5, 'barracks troops guard their barracks');
  // rules: own land only, a maximum count, no upgrades, and they don't shoot
  const out = edgeTile(g, a, 0, 1, 1);
  assert.match(g.build(a.id, out.x, out.y, 'barracks'), /own land/);
  assert.match(g.upgrade(a.id, b1.id), /can't be upgraded/);
  for (let i = 2; i < C.MAX_BARRACKS; i++) barracksAt(g, a, 0, i === 2 ? 2 : i === 3 ? -2 : 3);
  assert.match(g.build(a.id, a.core.x + 3, a.core.y + 3, 'barracks'), /at most/);
  assert.strictEqual(g.waveSize(a), C.BASE_WAVE + C.MAX_BARRACKS * C.BARRACKS_TROOPS);
});

test('losing a barracks shrinks your waves; the player who takes it gets the troops', () => {
  const { g, a, b } = duel(17);
  const bar = barracksAt(g, a, 2, 0);
  assert.strictEqual(g.waveSize(b), C.BASE_WAVE);
  g.transferTower(bar, b.id, 'destroyed');
  assert.strictEqual(g.waveSize(a), C.BASE_WAVE);
  assert.strictEqual(g.waveSize(b), C.BASE_WAVE + C.BARRACKS_TROOPS);
});

test('the army plan sets the wave mix for free (a giant takes 3 slots); levels cost gold', () => {
  const { g, a } = duel(3);
  const gold = a.gold;
  assert.strictEqual(g.armyAdd(a.id, 'giant'), null);
  assert.strictEqual(a.gold, gold, 'assigning slots is free');
  assert.deepStrictEqual(g.waveList(a), ['giant', 'soldier', 'soldier']);
  assert.match(g.armyAdd(a.id, 'giant'), /takes 3/);
  assert.strictEqual(g.armyAdd(a.id, 'scout'), null);
  assert.strictEqual(g.armyAdd(a.id, 'medic'), null);
  assert.match(g.armyAdd(a.id, 'medic'), /barracks/);
  assert.deepStrictEqual(g.waveList(a), ['scout', 'medic', 'giant']);
  assert.match(g.armyAdd(a.id, 'dragon'), /Invalid/);
  assert.strictEqual(g.armyLevel(a.id, 'giant'), null);
  assert.strictEqual(a.levels.giant, 2);
  assert.ok(a.gold < gold);
  a.nextWaveAt = g.time;
  g.update(0.05);
  const giants = mine(g, a).filter((u) => u.kind === 'giant');
  assert.ok(giants.length === 1 && giants[0].level === 2, 'new giants spawn at the new level');
  for (const k of Object.keys(a.army)) while (a.army[k] && !g.armyRemove(a.id, k));
  assert.match(g.armyRemove(a.id, 'soldier'), /None/);
  assert.strictEqual(g.waveList(a).length, C.BASE_WAVE, 'unassigned slots are filled with soldiers');
});

test('giants smash everything around their target and knock troops back', () => {
  const { g, a, b } = duel(18);
  const [giant] = troops(g, a, 'giant', 1, 50, 50);
  const foes = troops(g, b, 'soldier', 3, 51, 50);
  const before = foes.map((u) => ({ hp: u.hp, x: u.x }));
  g.unitFire(giant, foes[0], C.towerStats('giant', 1), C.UNITS.giant);
  foes.forEach((u, i) => {
    assert.ok(u.hp < before[i].hp, 'all hit');
    assert.ok(u.x > before[i].x, 'knocked back');
  });
});

test('scouts never fight, explore on their own, and see further', () => {
  const { g, a, b } = duel(19);
  const [scout] = troops(g, a, 'scout', 1, a.core.x + 0.5, a.core.y + 1.5);
  troops(g, b, 'soldier', 1, a.core.x + 1, a.core.y + 1.5); // an enemy right next to it
  const start = { x: scout.x, y: scout.y };
  const exploredBefore = a.explored.reduce((n, v) => n + v, 0);
  run(g, 15);
  assert.ok(g.units.has(scout.id));
  assert.ok(Math.hypot(scout.x - start.x, scout.y - start.y) > 10, 'went exploring');
  assert.ok(a.explored.reduce((n, v) => n + v, 0) > exploredBefore + 200, 'uncovered new ground');
  assert.ok(C.UNITS.scout.sight > C.UNITS.soldier.sight);
});

test('fog of war: you see your land and what your core, buildings and troops can see', () => {
  const { g, a, b } = duel(20);
  g.update(0.05);
  g.update(0.05);
  assert.ok(g.sees(a, a.core.x + 0.5, a.core.y + 0.5));
  assert.ok(!g.sees(a, b.core.x + 0.5, b.core.y + 0.5), "can't see the rival's base");
  const [u] = troops(g, a, 'soldier', 1, b.core.x + 0.5, b.core.y + 7);
  u.attack = { k: 'c', id: b.id };
  g.update(0.05);
  g.update(0.05);
  assert.ok(g.sees(a, u.x, u.y + 2), 'troops see around them');
});

test('orders: everyone plus future waves, or only selected troops', () => {
  const { g, a, b } = duel(4);
  const t = outpost(g, b);
  const squad = troops(g, a, 'soldier', 4, a.core.x + 0.5, a.core.y + 2);
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
  const squad = troops(g, a, 'soldier', 5, a.core.x + 0.5, a.core.y + 2);
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
    const squad = troops(g, a, 'giant', 4, t.x - 3, t.y + 0.5, 3);
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
  const def = troops(g, b, 'soldier', 1, t.x + 0.5, t.y + 1.5)[0];
  def.hp = def.maxHp = 1e9;
  g.order(b.id, [def.id], { k: 't', id: t.id });
  const squad = troops(g, a, 'soldier', 3, t.x - 2, t.y + 0.5);
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
  const [nearTower] = troops(g, b, 'soldier', 1, t.x + 0.5, t.y + 2.5);
  const [nearCore] = troops(g, b, 'soldier', 1, a.core.x + 0.5, a.core.y + 3);
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
  const squad = troops(g, a, 'soldier', 4, a.core.x + 0.5, a.core.y + 1.5);
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

test('medics heal, and troops heal slowly on their own land', () => {
  const { g, a } = duel(11);
  const [guard] = troops(g, a, 'soldier', 1, 60, 60); // out in the field
  const [medic] = troops(g, a, 'medic', 1, 60.5, 60);
  guard.hp = 100;
  run(g, 2);
  assert.ok(guard.hp > 100, `medic heals (hp ${guard.hp})`);
  g.units.delete(medic.id);
  const [homeGuard] = troops(g, a, 'soldier', 1, a.core.x + 0.5, a.core.y + 1.5);
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
  const near = troops(g, a, 'soldier', 4, t.x - 6, t.y + 0.5);
  const far = troops(g, a, 'soldier', 4, a.core.x + 0.5, a.core.y + 1);
  const guards = troops(g, a, 'medic', 4, a.core.x + 0.5, a.core.y - 1);
  const standing = { ...a.order };
  assert.strictEqual(g.order(a.id, null, { k: 't', id: t.id }, 0.5), null);
  assert.strictEqual(g.lastOrderCount, 6);
  const sent = [...near, ...far, ...guards].filter((u) => u.attack);
  assert.strictEqual(sent.length, 6);
  assert.strictEqual(sent.filter((u) => u.kind === 'medic').length, 2, 'half the medics');
  assert.strictEqual(sent.filter((u) => u.kind === 'soldier').length, 4, 'half the soldiers');
  assert.ok(near.every((u) => u.attack), 'the soldiers nearest the target go first');
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
  troops(g, a, 'soldier', 1, a.core.x + 0.5, a.core.y + 1);
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
  const squad = troops(g, a, 'soldier', 12, t.x + 0.5, t.y + 2);
  for (const u of squad) u.hp = u.maxHp = 1e6; // survive the tower's fire
  // 12 troops on an unguarded level-1 tower: no faster than the capped speed allows
  const minTime = C.captureTime(1) / C.CAPTURE_MAX_SPEED;
  let secs = 0;
  run(g, 30, () => {
    secs += 0.05;
    squad.forEach((u, i) => { // stand still next to it, not attacking
      u.attack = null;
      u.x = t.x + 0.5 + (i % 4) * 0.3;
      u.y = t.y + 2 + Math.floor(i / 4) * 0.3;
    });
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
  const hunters = troops(g, a, 'soldier', 4, 50, 50);
  const prey = troops(g, b, 'soldier', 3, 58, 50); // the target and two squadmates
  const decoy = troops(g, b, 'soldier', 1, 51, 52)[0]; // right next to the hunters
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
  const mine = troops(g, a, 'soldier', 1, 40, 40)[0];
  assert.match(g.order(a.id, null, { k: 'u', id: mine.id }), /own troop/);
  assert.match(g.order(a.id, null, { k: 'u', id: 99999 }), /gone/);
});

test('orders can be limited to certain troop types', () => {
  const { g, a, b } = duel(22);
  const t = outpost(g, b);
  const soldiers = troops(g, a, 'soldier', 4, a.core.x + 0.5, a.core.y + 1);
  const giants = troops(g, a, 'giant', 2, a.core.x + 0.5, a.core.y - 1);
  const medics = troops(g, a, 'medic', 2, a.core.x - 1, a.core.y + 0.5);
  const standing = { ...a.order };
  // only giants, everyone of that type
  assert.strictEqual(g.order(a.id, null, { k: 't', id: t.id }, 1, ['giant']), null);
  assert.strictEqual(g.lastOrderCount, 2);
  assert.ok(giants.every((u) => u.attack) && soldiers.every((u) => !u.attack) && medics.every((u) => !u.attack));
  assert.deepStrictEqual(a.order, standing, 'a filtered order leaves new waves alone');
  // 50% of soldiers + medics
  assert.strictEqual(g.order(a.id, null, { k: 't', id: t.id }, 0.5, ['soldier', 'medic']), null);
  assert.strictEqual(g.lastOrderCount, 3);
  assert.strictEqual(soldiers.filter((u) => u.attack).length, 2);
  assert.strictEqual(medics.filter((u) => u.attack).length, 1);
  // a selection, filtered
  assert.strictEqual(g.order(a.id, [...soldiers, ...giants].map((u) => u.id), { k: 'c', id: a.id }, 1, ['giant']), null);
  assert.ok(giants.every((u) => !u.attack) && soldiers.filter((u) => u.attack).length === 2);
  assert.match(g.order(a.id, soldiers.map((u) => u.id), { k: 'c', id: a.id }, 1, ['scout']), /chosen types/);
  assert.match(g.order(a.id, null, { k: 't', id: t.id }, 1, ['scout']), /no troops of the chosen types/);
  // all types ticked = a normal order (new waves follow)
  assert.strictEqual(g.order(a.id, null, { k: 't', id: t.id }, 1, ['soldier', 'scout', 'medic', 'giant']), null);
  assert.strictEqual(a.order.type, 'attack');
});

test('right-clicking the ground sends troops to hold that spot', () => {
  const { g, a, b } = duel(23);
  const squad = troops(g, a, 'soldier', 3, a.core.x + 0.5, a.core.y + 1);
  const spot = { x: a.core.x + 12, y: a.core.y + 3 };
  assert.strictEqual(g.order(a.id, squad.map((u) => u.id), { k: 'p', id: g.idx(spot.x, spot.y) }), null);
  run(g, 15);
  for (const u of squad) assert.ok(Math.hypot(u.x - spot.x - 0.5, u.y - spot.y - 0.5) < 2.5, 'arrived and holding');
  // an enemy walks up: they fight it, then return to the spot
  const [foe] = troops(g, b, 'soldier', 1, spot.x + 3, spot.y + 0.5);
  foe.attack = { k: 'c', id: b.id };
  run(g, 20, () => !g.units.has(foe.id));
  assert.ok(!g.units.has(foe.id), 'enemy near the spot is dealt with');
  run(g, 5);
  for (const u of squad.filter((v) => g.units.has(v.id))) assert.ok(Math.hypot(u.x - spot.x - 0.5, u.y - spot.y - 0.5) < 3);
  // an enemy far from the spot is ignored
  const [far] = troops(g, b, 'soldier', 1, spot.x + 9, spot.y + 0.5);
  far.attack = { k: 'c', id: b.id };
  run(g, 3, () => { far.x = spot.x + 9; far.y = spot.y + 0.5; return false; });
  for (const u of squad.filter((v) => g.units.has(v.id))) assert.ok(Math.hypot(u.x - spot.x - 0.5, u.y - spot.y - 0.5) < 3, 'stayed put');
  assert.match(g.order(a.id, null, { k: 'p', id: -5 }), /Invalid/);
});
