'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { Game, seeded, duel, edgeTile, outpost, troops, run } = require('./helpers');

const mine = (g, p) => [...g.units.values()].filter((u) => u.owner === p.id);

test('the core sends a free wave of 4 (one of each type) every interval', () => {
  const { g, a } = duel(1);
  a.nextWaveAt = g.time;
  g.update(0.05);
  const w1 = mine(g, a);
  assert.strictEqual(w1.length, C.BASE_WAVE);
  assert.deepStrictEqual(w1.map((u) => u.kind).sort(), ['archer', 'medic', 'scout', 'soldier']);
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

// A barracks in the n-th hex next to p's core.
function barracksAt(g, p, n) {
  const h = g.hex.hexes[g.hex.hexes[g.hexAt(p.core.x, p.core.y)].n[n]];
  const x = h.centre % g.w;
  const y = (h.centre - x) / g.w;
  const err = g.build(p.id, x, y, 'barracks');
  if (err) throw new Error(err);
  return [...g.towers.values()].find((t) => t.x === x && t.y === y);
}

test('each barracks adds 4 troops to every wave, spawning at the barracks', () => {
  const { g, a } = duel(16);
  const gold = a.gold;
  const b1 = barracksAt(g, a, 0);
  assert.strictEqual(a.gold, gold - C.buildCost('barracks', 0));
  const b2 = barracksAt(g, a, 3);
  assert.strictEqual(a.gold, gold - C.buildCost('barracks', 0) - C.buildCost('barracks', 1));
  assert.ok(C.buildCost('barracks', 1) > C.buildCost('barracks', 0), 'each one costs more');
  assert.strictEqual(g.waveSize(a), C.BASE_WAVE + 2 * C.BARRACKS_TROOPS);
  a.nextWaveAt = g.time;
  g.update(0.05);
  const wave = mine(g, a);
  assert.strictEqual(wave.length, C.BASE_WAVE + 2 * C.BARRACKS_TROOPS);
  const near = (t) => wave.filter((u) => Math.hypot(u.x - t.x - 0.5, u.y - t.y - 0.5) < 1.6).length;
  assert.strictEqual(near(b1), C.BARRACKS_TROOPS);
  assert.strictEqual(near(b2), C.BARRACKS_TROOPS);
  assert.strictEqual(new Set(wave.map((u) => u.sq)).size, 1, 'the whole wave is one squad');
  // rules: own land only, a maximum count, no upgrades, and they don't shoot
  const out = edgeTile(g, a, 0, 1, 1);
  assert.match(g.build(a.id, out.x, out.y, 'barracks'), /own land/);
  assert.match(g.upgrade(a.id, b1.id), /can't be upgraded/);
  for (let i = 2; i < C.MAX_BARRACKS; i++) barracksAt(g, a, [1, 2, 4][i - 2]);
  { const h = g.hex.hexes[g.hex.hexes[g.hexAt(a.core.x, a.core.y)].n[5]]; assert.match(g.build(a.id, h.centre % g.w, Math.floor(h.centre / g.w), 'barracks'), /at most/); }
  assert.strictEqual(g.waveSize(a), C.BASE_WAVE + C.MAX_BARRACKS * C.BARRACKS_TROOPS);
});

test('losing a barracks shrinks your waves; the player who takes it gets the troops', () => {
  const { g, a, b } = duel(17);
  const bar = barracksAt(g, a, 0);
  assert.strictEqual(g.waveSize(b), C.BASE_WAVE);
  g.transferTower(bar, b.id, 'destroyed');
  assert.strictEqual(g.waveSize(a), C.BASE_WAVE);
  assert.strictEqual(g.waveSize(b), C.BASE_WAVE + C.BARRACKS_TROOPS);
});

test('the army plan sets the wave mix for free (one slot per troop); levels cost gold', () => {
  const { g, a } = duel(3);
  const gold = a.gold;
  for (const k of Object.keys(a.army)) a.army[k] = 0; // start from an all-soldier wave
  assert.strictEqual(g.armyAdd(a.id, 'archer'), null);
  assert.strictEqual(g.armyAdd(a.id, 'archer'), null);
  assert.strictEqual(a.gold, gold, 'assigning slots is free');
  assert.deepStrictEqual(g.waveList(a), ['archer', 'archer', 'soldier', 'soldier']);
  assert.strictEqual(g.armyAdd(a.id, 'scout'), null);
  assert.strictEqual(g.armyAdd(a.id, 'medic'), null);
  assert.match(g.armyAdd(a.id, 'medic'), /barracks/);
  assert.deepStrictEqual(g.waveList(a), ['scout', 'medic', 'archer', 'archer']);
  assert.match(g.armyAdd(a.id, 'dragon'), /Invalid/);
  assert.strictEqual(g.armyLevel(a.id, 'archer'), null);
  assert.strictEqual(a.levels.archer, 2);
  assert.ok(a.gold < gold);
  a.nextWaveAt = g.time;
  g.update(0.05);
  const archers = mine(g, a).filter((u) => u.kind === 'archer');
  assert.ok(archers.length === 2 && archers.every((u) => u.level === 2), 'new archers spawn at the new level');
  for (const k of Object.keys(a.army)) while (a.army[k] && !g.armyRemove(a.id, k));
  assert.match(g.armyRemove(a.id, 'soldier'), /None/);
  assert.strictEqual(g.waveList(a).length, C.BASE_WAVE, 'unassigned slots are filled with soldiers');
});

test('archers shoot from range', () => {
  const { g, a, b } = duel(18);
  const mx = Math.round((a.core.x + b.core.x) / 2);
  const my = Math.round((a.core.y + b.core.y) / 2);
  const [archer] = troops(g, a, 'archer', 1, mx, my);
  const [foe] = troops(g, b, 'soldier', 1, mx + 4, my); // within range 4.5, far out of melee reach
  foe.hp = foe.maxHp = 1e6;
  run(g, 2, () => {
    foe.x = mx + 4; // pinned in place
    foe.y = my;
    return false;
  });
  assert.ok(foe.hp < foe.maxHp, 'hit from 4 tiles away');
  assert.ok(Math.hypot(archer.x - foe.x, archer.y - foe.y) > 3, 'without walking up to it');
  assert.strictEqual(C.slotsOf('archer'), 1);
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

test('orders: every squad, or only picked troops (which split off as a squad of their own)', () => {
  const { g, a, b } = duel(4);
  const t = outpost(g, b);
  a.nextWaveAt = g.time;
  g.update(0.05);
  const squad = mine(g, a);
  const sq = squad[0].sq;
  assert.ok(squad.every((u) => u.sq === sq));
  assert.strictEqual(g.order(a.id, [squad[0].id], { k: 't', id: t.id }), null);
  assert.deepStrictEqual(squad[0].attack, { k: 't', id: t.id, owner: b.id });
  assert.strictEqual(squad[1].attack, null);
  assert.notStrictEqual(squad[0].sq, sq, 'a picked troop splits off into a new squad');
  assert.strictEqual(a.squadNum.size, 2);
  assert.strictEqual(g.order(a.id, null, { k: 'c', id: b.id }), null);
  assert.ok(squad.every((u) => u.attack && u.attack.k === 'c'));
  // new squads guard home by default...
  a.nextWaveAt = g.time;
  g.update(0.05);
  let fresh = mine(g, a).filter((u) => !squad.includes(u));
  assert.ok(fresh.length && fresh.every((u) => !u.attack), 'new squads guard home');
  // ...or follow your last order
  assert.strictEqual(g.setNewWaves(a.id, 'follow'), null);
  a.nextWaveAt = g.time;
  g.update(0.05);
  fresh = mine(g, a).filter((u) => !squad.includes(u) && !fresh.includes(u));
  assert.ok(fresh.length && fresh.every((u) => u.attack && u.attack.k === 'c'), 'new squads follow the last order');
  assert.strictEqual(g.order(a.id, null, { k: 'c', id: a.id }), null);
  assert.ok(mine(g, a).every((u) => !u.attack && u.anchor === 0));
  assert.match(g.order(a.id, null, { k: 't', id: 999 }), /No such/);
  assert.match(g.order(a.id, null, { k: 'x', id: 1 }), /Invalid/);
  assert.match(g.order(b.id, [squad[0].id], { k: 'c', id: a.id }), /No troops/);
  assert.match(g.setNewWaves(a.id, 'sometimes'), /Invalid/);
});

test('an attack marches across the map and takes an undefended tower', () => {
  const { g, a, b } = duel(5);
  const t = outpost(g, b);
  const squad = troops(g, a, 'soldier', 5, a.core.x + 0.5, a.core.y + 2);
  g.order(a.id, squad.map((u) => u.id), { k: 't', id: t.id });
  assert.ok(run(g, 120, () => t.owner !== b.id), 'tower should fall');
  assert.strictEqual(t.owner, a.id, 'the attackers destroy and claim it');
  for (const u of squad.filter((v) => g.units.has(v.id))) {
    assert.strictEqual(u.anchor, t.id, 'the attackers stay on as its garrison');
    assert.strictEqual(u.attack, null);
  }
});

test('destroying a tower claims it for the attacker', () => {
  const { g, a, b } = duel(6);
  {
    const t = outpost(g, b);
    t.level = 2;
    const landBefore = a.territory;
    const squad = troops(g, a, 'soldier', 8, t.x - 3, t.y + 0.5, 3);
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
    assert.deepStrictEqual(a.lastOrder, { type: 'attack', target: { k: 'c', id: b.id } }, 'the remembered order pushes on to the core');
  }
});

test("a destroyed core's towers go to the conqueror; with nobody to take them they fall to ruins", () => {
  const { g, a, b } = duel(15);
  const t = outpost(g, b);
  g.damageCore(b, 1e9, a.id);
  assert.strictEqual(t.owner, a.id);
  assert.ok(!t.ruin);
  g.killPlayer(a, null); // now a falls with no conqueror
  assert.ok(t.ruin);
  assert.strictEqual(t.owner, 0);
});

test('a defended tower holds while its defender lives', () => {
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
  assert.deepStrictEqual(a.lastOrder, { type: 'attack', target: { k: 't', id: t2.id, owner: b.id } });
  g.damageTower(t2, 1e9, a.id);
  assert.deepStrictEqual(a.lastOrder, { type: 'attack', target: { k: 'c', id: b.id } });
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
  // fight in the open, between the two bases
  const mx = Math.round((a.core.x + b.core.x) / 2) - 4;
  const my = Math.round((a.core.y + b.core.y) / 2);
  const hunters = troops(g, a, 'soldier', 4, mx, my);
  const prey = troops(g, b, 'soldier', 3, mx + 8, my); // the target and two squadmates
  const decoy = troops(g, b, 'soldier', 1, mx + 1, my + 2)[0]; // right next to the hunters
  const [target] = prey;
  for (const v of [...prey, decoy]) v.attack = { k: 'c', id: b.id }; // hold them still: no orders to follow
  const before = a.lastOrder;
  assert.strictEqual(g.order(a.id, null, { k: 'u', id: target.id }), null);
  assert.strictEqual(g.lastOrderCount, 4);
  assert.deepStrictEqual(a.lastOrder, before, 'a hunt is not remembered for new squads');
  assert.ok(hunters.every((u) => u.attack.k === 'u' && u.attack.id === target.id));
  // pin the prey in place and let the hunters work
  const pin = () => { for (const v of [...prey, decoy]) if (g.units.has(v.id)) { v.x = v === decoy ? mx + 1 : mx + 8 + prey.indexOf(v) * 0.4; v.y = v === decoy ? my + 2 : my; v.path = []; } };
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

test('right-clicking the ground sends troops to hold that spot', () => {
  const { g, a, b } = duel(23);
  const squad = troops(g, a, 'soldier', 3, a.core.x + 0.5, a.core.y + 1);
  const spot = { x: a.core.x + 12, y: a.core.y + 3 };
  assert.strictEqual(g.order(a.id, squad.map((u) => u.id), { k: 'p', id: g.idx(spot.x, spot.y) }), null);
  run(g, 15);
  for (const u of squad) assert.ok(Math.hypot(u.x - spot.x - 0.5, u.y - spot.y - 0.5) < 2.5, 'arrived and holding');
  // an enemy walks up: they fight it, then return to the spot
  const [foe] = troops(g, b, 'soldier', 1, spot.x + 3, spot.y + 0.5);
  foe.attack = { k: 'p', id: g.idx(spot.x + 3, spot.y) }; // it holds its own spot nearby
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

test('cleared fog stays clear: explored areas keep showing live activity', () => {
  const { g, a, b } = duel(25);
  g.update(0.05);
  g.update(0.05);
  const spot = { x: b.core.x + 0.5, y: b.core.y + 0.5 };
  assert.ok(!g.sees(a, spot.x, spot.y), 'unexplored at first');
  const [scout] = troops(g, a, 'scout', 1, spot.x, spot.y + 6);
  g.update(0.05);
  g.update(0.05);
  assert.ok(g.sees(a, spot.x, spot.y + 4), 'the scout reveals it');
  g.units.delete(scout.id); // the scout is gone...
  g.update(0.05);
  g.update(0.05);
  assert.ok(g.sees(a, spot.x, spot.y + 4), '...but the area stays revealed');
});

test('squads: every wave is a squad, numbered, and ordered on its own', () => {
  const { g, a, b } = duel(26);
  const t = outpost(g, b);
  const wave = () => {
    const before = new Set(mine(g, a));
    a.nextWaveAt = g.time;
    g.update(0.05);
    return mine(g, a).filter((u) => !before.has(u));
  };
  const w1 = wave();
  const w2 = wave();
  assert.strictEqual(w1.length, C.BASE_WAVE);
  const s1 = w1[0].sq;
  const s2 = w2[0].sq;
  assert.ok(w1.every((u) => u.sq === s1) && w2.every((u) => u.sq === s2) && s1 !== s2, 'one squad per wave');
  assert.deepStrictEqual([a.squadNum.get(s1), a.squadNum.get(s2)], [1, 2]);
  // send squad 2 at the tower; squad 1 stays home
  assert.strictEqual(g.order(a.id, null, { k: 't', id: t.id }, [s2]), null);
  assert.strictEqual(g.lastOrderCount, w2.length);
  assert.ok(w2.every((u) => u.attack) && w1.every((u) => !u.attack));
  assert.match(g.order(a.id, null, { k: 't', id: t.id }, [12345]), /no troops/);
  // a squad that's wiped out frees its number for the next wave
  for (const u of w1) g.units.delete(u.id);
  g.pruneSquads();
  const w3 = wave();
  assert.strictEqual(a.squadNum.get(w3[0].sq), 1);
});

test('squads: merging, and moving picked troops between squads', () => {
  const { g, a, b } = duel(27);
  const t = outpost(g, b);
  const wave = () => {
    const before = new Set(mine(g, a));
    a.nextWaveAt = g.time;
    g.update(0.05);
    return mine(g, a).filter((u) => !before.has(u));
  };
  for (const k of Object.keys(a.army)) a.army[k] = 0; // all soldiers: none wander off scouting
  barracksAt(g, a, 0); // 8 troops a wave
  const w1 = wave();
  const w2 = wave();
  g.order(a.id, null, { k: 't', id: t.id }, [w2[0].sq]);
  // move two troops of squad 1 into squad 2: they take on its attack
  assert.strictEqual(g.squadAssign(a.id, [w1[0].id, w1[1].id], w2[0].sq), null);
  assert.ok(w1[0].sq === w2[0].sq && w1[0].attack && w1[0].attack.k === 't');
  assert.ok(w1[2].sq !== w2[0].sq && !w1[2].attack);
  // two more into a new squad of their own
  assert.strictEqual(g.squadAssign(a.id, [w1[2].id, w1[3].id], 'new'), null);
  assert.ok(w1[2].sq === w1[3].sq && w1[2].sq !== w1[4].sq);
  assert.strictEqual(a.squadNum.size, 3);
  // merge it back into squad 1
  assert.strictEqual(g.squadMerge(a.id, [w1[4].sq, w1[2].sq]), null);
  assert.ok(w1[2].sq === w1[4].sq);
  assert.strictEqual(a.squadNum.size, 2);
  assert.match(g.squadMerge(a.id, [w1[4].sq]), /two or more/);
  assert.match(g.squadAssign(a.id, [w1[4].id], 999), /Invalid squad/);
  assert.match(g.squadAssign(b.id, [w1[4].id], 'new'), /No troops/);
});

test('squads stay together on the march and stand guard together at home', () => {
  const { g, a, b } = duel(28);
  a.army.scout = 1; // a fast scout in a squad of soldiers
  a.army.archer = 1;
  a.nextWaveAt = g.time;
  g.update(0.05);
  const sq = mine(g, a);
  assert.strictEqual(sq.length, C.BASE_WAVE);
  g.order(a.id, null, { k: 'c', id: b.id }, [sq[0].sq]);
  const spread = (home = false) => {
    const live = sq.filter((u) => g.units.has(u.id) && !(home && u.kind === 'scout')); // at home, scouts explore
    const cx = live.reduce((s, u) => s + u.x, 0) / live.length;
    const cy = live.reduce((s, u) => s + u.y, 0) / live.length;
    return Math.max(...live.map((u) => Math.hypot(u.x - cx, u.y - cy)));
  };
  let worst = 0;
  for (let i = 0; i < 20 * 8; i++) {
    g.update(0.05);
    if (i > 40) worst = Math.max(worst, spread());
  }
  assert.ok(worst < 3.2, `squad stayed together on the march (spread ${worst.toFixed(2)})`);
  // home again: they gather at their own post rather than spreading round the core
  g.order(a.id, null, { k: 'c', id: a.id });
  run(g, 25);
  assert.ok(spread(true) < 2.6, `squad stands guard together (spread ${spread(true).toFixed(2)})`);
});

test('troops keep their personal space: never on top of each other or inside buildings', () => {
  const { g, a, b } = duel(29);
  const mx = a.core.x + 0.5;
  const my = a.core.y + 0.5;
  // a pile of troops dropped right on the core, plus an enemy in the middle of them
  const pile = troops(g, a, 'soldier', 8, mx, my);
  for (const u of pile) { u.x = mx; u.y = my; }
  const [foe] = troops(g, b, 'soldier', 1, mx, my);
  foe.hp = foe.maxHp = 1e6;
  run(g, 1.5);
  const all = [...pile, foe].filter((u) => g.units.has(u.id));
  for (const u of all) {
    assert.ok(Math.hypot(u.x - mx, u.y - my) >= C.CORE_BODY - 0.05, 'pushed out of the core');
    for (const v of all) {
      if (v !== u) assert.ok(Math.hypot(u.x - v.x, u.y - v.y) > 0.4, 'troops spread apart');
    }
  }
});
