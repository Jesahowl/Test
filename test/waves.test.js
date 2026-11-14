'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { Game, seeded, duel, edgeTile, outpost, troops, run } = require('./helpers');

const mine = (g, p) => [...g.units.values()].filter((u) => u.owner === p.id && !u.worker); // troops (not workers)

// Give squad i of p this mix (the rest of the squads empty), e.g. { soldier: 4 }.
function setMix(p, i, mix) {
  p.armySeen = 1e9; // no spare slots joining squad 1 behind the test's back
  for (const q of p.squads) for (const k of Object.keys(q.mix)) q.mix[k] = 0;
  Object.assign(p.squads[i].mix, mix);
}

// Respawn time: every fallen troop comes back now.
function respawn(g, p) {
  p.nextWaveAt = g.time;
  g.update(0.05);
  p.nextWaveAt = Infinity;
}

test('every player has 4 lasting squads; fallen troops respawn into them every interval', () => {
  const { g, a } = duel(1);
  assert.strictEqual(a.squads.length, C.MAX_SQUADS);
  assert.deepStrictEqual(a.squads.map((q) => q.num), [1, 2, 3, 4]);
  setMix(a, 0, { soldier: 2, archer: 1 });
  Object.assign(a.squads[1].mix, { scout: 1, medic: 1 });
  respawn(g, a);
  const s1 = mine(g, a).filter((u) => u.sq === a.squads[0].id);
  const s2 = mine(g, a).filter((u) => u.sq === a.squads[1].id);
  assert.deepStrictEqual(s1.map((u) => u.kind).sort(), ['archer', 'soldier', 'soldier']);
  assert.deepStrictEqual(s2.map((u) => u.kind).sort(), ['medic', 'scout']);
  respawn(g, a);
  assert.strictEqual(mine(g, a).length, 5, 'a squad at full strength gets no more');
  // two fall; at the next respawn exactly those two come back
  g.units.delete(s1[0].id);
  g.units.delete(s2[0].id);
  a.nextWaveAt = g.time + 1;
  run(g, 0.5);
  assert.strictEqual(mine(g, a).length, 3, 'not before the timer');
  run(g, 1);
  assert.strictEqual(mine(g, a).length, 5, 'back when it runs out');
  assert.ok(Math.abs(a.nextWaveAt - (g.time + C.WAVE_INTERVAL)) < 1.2, 'and the timer starts over');
});

test('the army size comes from land and barracks; squads can only use that many slots', () => {
  const { g, a } = duel(2);
  g.fitArmy(a);
  const size = g.armySize(a);
  assert.strictEqual(size, C.armySize(a.territory, 0));
  assert.strictEqual(g.slotsUsed(a), size, 'a new army is full: the spare slots join squad 1 as soldiers');
  assert.match(g.squadMix(a.id, a.squads[1].id, 'dragon', 1), /Invalid/);
  // more land: the new slots join squad 1
  const before = a.squads[0].mix.soldier;
  a.territory += C.LAND_PER_UNIT * 2;
  g.fitArmy(a);
  assert.strictEqual(a.squads[0].mix.soldier, before + 2);
  // less land: troops come off the last squads first
  a.squads[3].mix.archer = 2;
  a.squads[0].mix.soldier -= 2;
  a.territory -= C.LAND_PER_UNIT * 2;
  g.fitArmy(a);
  assert.strictEqual(g.slotsUsed(a), g.armySize(a));
  assert.strictEqual(a.squads[3].mix.archer, 0);
  // respawns never go past the army size, even with extra troops about
  respawn(g, a);
  troops(g, a, 'soldier', 3, a.core.x + 0.5, a.core.y + 2);
  for (const u of mine(g, a).filter((v) => v.sq === a.squads[0].id).slice(0, 2)) g.units.delete(u.id);
  respawn(g, a);
  assert.ok(mine(g, a).length <= g.armySize(a) + 1);
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

test('each barracks adds 4 troops to the army, and troops respawn there too', () => {
  const { g, a } = duel(16);
  g.fitArmy(a);
  const gold = a.gold;
  const size = g.armySize(a);
  const b1 = barracksAt(g, a, 0);
  assert.strictEqual(a.gold, gold - C.buildCost('barracks', 0));
  const b2 = barracksAt(g, a, 3);
  assert.strictEqual(a.gold, gold - C.buildCost('barracks', 0) - C.buildCost('barracks', 1));
  assert.ok(C.buildCost('barracks', 1) > C.buildCost('barracks', 0), 'each one costs more');
  assert.strictEqual(g.armySize(a), size + 2 * C.BARRACKS_TROOPS);
  respawn(g, a);
  const army = mine(g, a);
  assert.strictEqual(army.length, size + 2 * C.BARRACKS_TROOPS, 'the new slots fill at once');
  const near = (t) => army.filter((u) => Math.hypot(u.x - t.x - 0.5, u.y - t.y - 0.5) < 1.6).length;
  assert.ok(near(b1) >= 3 && near(b2) >= 3, 'troops take turns spawning at the core and each barracks');
  // rules: own land only, a maximum count, no upgrades, and they don't shoot
  const out = edgeTile(g, a, 0, 1, 1);
  assert.match(g.build(a.id, out.x, out.y, 'barracks'), /own land/);
  assert.match(g.upgrade(a.id, b1.id), /can't be upgraded/);
  for (let i = 2; i < C.MAX_BARRACKS; i++) barracksAt(g, a, [1, 2, 4][i - 2]);
  { const h = g.hex.hexes[g.hex.hexes[g.hexAt(a.core.x, a.core.y)].n[5]]; assert.match(g.build(a.id, h.centre % g.w, Math.floor(h.centre / g.w), 'barracks'), /at most/); }
  assert.strictEqual(g.armySize(a), Math.min(C.MAX_UNITS, size + C.MAX_BARRACKS * C.BARRACKS_TROOPS));
});

test('losing a barracks shrinks your army; whoever destroys it gains nothing but the bounty', () => {
  const { g, a, b } = duel(17);
  g.fitArmy(a);
  const size = g.armySize(a);
  const bar = barracksAt(g, a, 0);
  g.update(0.05);
  const gold = b.gold;
  g.damageTower(bar, 1e9, b.id);
  assert.ok(!g.towers.has(bar.id), 'it is gone');
  g.update(0.05);
  assert.strictEqual(g.armySize(a), size);
  assert.strictEqual(g.slotsUsed(a), size, 'the squads shrink to fit');
  assert.ok(b.gold >= gold + C.TOWER_BOUNTY);
});

test('squad mixes are free to change (one slot per troop); levels cost gold', () => {
  const { g, a, b } = duel(3);
  g.fitArmy(a);
  const gold = a.gold;
  const [s1, s2] = a.squads;
  // the army starts full, so + on squad 2 moves a troop over from squad 1 (the biggest)
  const archers = s1.mix.archer;
  assert.strictEqual(g.squadMix(a.id, s2.id, 'archer', 1), null);
  assert.strictEqual(s1.mix.archer, archers - 1);
  assert.strictEqual(s2.mix.archer, 1);
  assert.strictEqual(a.gold, gold, 'changing squads is free');
  // with no archer left to move, a soldier makes room instead
  s1.mix.soldier += s1.mix.archer; // (keeping the army full)
  s1.mix.archer = 0;
  const soldiers = s1.mix.soldier;
  assert.strictEqual(g.squadMix(a.id, s2.id, 'archer', 1), null);
  assert.strictEqual(s1.mix.soldier, soldiers - 1);
  assert.strictEqual(s2.mix.archer, 2);
  // − frees a slot; + then uses it without touching other squads
  assert.strictEqual(g.squadMix(a.id, s2.id, 'archer', -1), null);
  assert.strictEqual(g.squadMix(a.id, a.squads[2].id, 'medic', 1), null);
  assert.strictEqual(s1.mix.soldier, soldiers - 1);
  assert.match(g.squadMix(a.id, a.squads[3].id, 'medic', -1), /None/);
  assert.match(g.squadMix(a.id, 999, 'medic', 1), /Invalid squad/);
  assert.match(g.squadMix(b.id, s1.id, 'medic', 1), /Invalid squad/);
  // levels
  assert.strictEqual(g.armyLevel(a.id, 'archer'), null);
  assert.strictEqual(a.levels.archer, 2);
  assert.ok(a.gold < gold);
  respawn(g, a);
  const lv = mine(g, a).filter((u) => u.kind === 'archer');
  assert.ok(lv.length && lv.every((u) => u.level === 2), 'new archers spawn at the new level');
});

test('moving a troop to another squad sends one of the living ones over at once', () => {
  const { g, a } = duel(37);
  setMix(a, 0, { soldier: 3, archer: 2 });
  a.squads[1].mix.soldier = g.armySize(a) - 5;
  respawn(g, a);
  const before = mine(g, a).filter((u) => u.sq === a.squads[0].id && u.kind === 'archer');
  assert.strictEqual(before.length, 2);
  assert.strictEqual(g.squadMix(a.id, a.squads[1].id, 'archer', 1), null);
  assert.strictEqual(mine(g, a).filter((u) => u.sq === a.squads[1].id && u.kind === 'archer').length, 1, 'an archer changed squads');
  respawn(g, a);
  assert.strictEqual(mine(g, a).filter((u) => u.kind === 'archer').length, 2, 'and no extra one appeared');
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

test('orders go to every squad or the picked ones, and reinforcements follow their squad', () => {
  const { g, a, b } = duel(4);
  const t = outpost(g, b);
  setMix(a, 0, { soldier: 3 });
  a.squads[1].mix.soldier = 3;
  respawn(g, a);
  const s1 = mine(g, a).filter((u) => u.sq === a.squads[0].id);
  const s2 = mine(g, a).filter((u) => u.sq === a.squads[1].id);
  assert.strictEqual(g.order(a.id, null, { k: 't', id: t.id }, [a.squads[1].id]), null);
  assert.strictEqual(g.lastOrderCount, 3);
  assert.ok(s2.every((u) => u.attack && u.attack.id === t.id) && s1.every((u) => !u.attack));
  assert.deepStrictEqual(a.squads[1].order, { type: 'attack', target: { k: 't', id: t.id, owner: b.id } });
  // a squad with no troops left still takes orders: its reinforcements head there
  assert.strictEqual(g.order(a.id, null, { k: 'c', id: b.id }, [a.squads[2].id]), null);
  a.squads[2].mix.soldier = 1;
  a.squads[0].mix.soldier = 2;
  g.units.delete(s1[0].id);
  respawn(g, a);
  const s3 = mine(g, a).filter((u) => u.sq === a.squads[2].id);
  assert.ok(s3.length === 1 && s3[0].attack && s3[0].attack.k === 'c', 'the new troop follows its squad');
  // a fallen squadmate's replacement joins its squad's attack
  g.units.delete(s2[0].id);
  respawn(g, a);
  const fresh = mine(g, a).filter((u) => u.sq === a.squads[1].id && !s2.includes(u));
  assert.ok(fresh.length === 1 && fresh[0].attack && fresh[0].attack.id === t.id);
  // ...picked troops: their squads get the order
  assert.strictEqual(g.order(a.id, [s1[1].id], { k: 'c', id: a.id }), null);
  assert.ok(mine(g, a).filter((u) => u.sq === a.squads[0].id).every((u) => !u.attack));
  assert.strictEqual(g.order(a.id, null, { k: 'c', id: a.id }), null);
  assert.ok(mine(g, a).every((u) => !u.attack && u.anchor === 0));
  assert.match(g.order(a.id, null, { k: 't', id: 999 }), /No such/);
  assert.match(g.order(a.id, null, { k: 'x', id: 1 }), /Invalid/);
  assert.match(g.order(a.id, null, { k: 'c', id: b.id }, [12345]), /Invalid squad/);
  assert.match(g.order(b.id, [s1[1].id], { k: 'c', id: a.id }), /No troops/);
});

test('an attack marches across the map and takes an undefended tower', () => {
  const { g, a, b } = duel(5);
  const t = outpost(g, b);
  const squad = troops(g, a, 'soldier', 9, a.core.x + 0.5, a.core.y + 2);
  g.order(a.id, squad.map((u) => u.id), { k: 't', id: t.id });
  assert.ok(run(g, 120, () => !g.towers.has(t.id)), 'tower should fall');
  for (const u of squad.filter((v) => g.units.has(v.id))) {
    assert.ok(u.attack && (u.attack.k === 'c' ? u.attack.id === b.id : u.attack.owner === b.id), 'the attackers push on to that player\'s next building');
  }
});

test('destroying a tower just destroys it: bounty, but no tower and no land', () => {
  const { g, a, b } = duel(6);
  const t = outpost(g, b);
  const hexI = g.hexAt(t.x, t.y);
  const landBefore = a.territory;
  const bLand = b.territory;
  troops(g, a, 'soldier', 8, t.x - 3, t.y + 0.5, 3);
  g.order(a.id, null, { k: 't', id: t.id });
  const gold = a.gold;
  assert.ok(run(g, 120, () => !g.towers.has(t.id)), 'tower should fall');
  assert.ok(![...g.towers.values()].some((o) => o.owner === a.id), 'nobody takes it over');
  assert.ok(a.gold >= gold + C.TOWER_BOUNTY);
  assert.strictEqual(a.towersDestroyed, 1);
  g.update(0.05);
  assert.strictEqual(g.hexOwner[hexI], b.id, 'its hex stays the owner\'s');
  assert.strictEqual(a.territory, landBefore, 'the attacker gains no land');
  assert.strictEqual(b.territory, bLand, 'the owner loses none');
  assert.deepStrictEqual(a.squads[0].order, { type: 'attack', target: { k: 'c', id: b.id } }, 'the squad\'s order pushes on to the core');
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

test('a squad\'s order rolls on to the next structure when its tower is destroyed', () => {
  const { g, a, b } = duel(12);
  const t1 = outpost(g, b, 1, 0);
  const t2 = outpost(g, b, 0, 1);
  g.order(a.id, null, { k: 't', id: t1.id });
  g.damageTower(t1, 1e9, a.id);
  assert.deepStrictEqual(a.squads[0].order, { type: 'attack', target: { k: 't', id: t2.id, owner: b.id } });
  g.damageTower(t2, 1e9, a.id);
  assert.ok(a.squads.every((q) => q.order.target.k === 'c' && q.order.target.id === b.id), 'every squad sent there pushes on to the core');
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
  assert.strictEqual(g.order(a.id, null, { k: 'u', id: target.id }), null);
  assert.strictEqual(g.lastOrderCount, 4);
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

test('stances: aggressive squads fight on the way, defensive ones march past, hold never chases', () => {
  const { g, a, b } = duel(26);
  assert.strictEqual(a.squads[0].stance, 'defensive');
  assert.match(g.squadStance(a.id, a.squads[0].id, 'berserk'), /Invalid/);
  const trial = (stance) => {
    for (const u of [...g.units.values()]) g.units.delete(u.id);
    g.squadStance(a.id, a.squads[0].id, stance);
    const mx = Math.round((a.core.x + b.core.x) / 2);
    const my = Math.round((a.core.y + b.core.y) / 2);
    const squad = troops(g, a, 'soldier', 3, mx - 6, my);
    assert.ok(squad.every((u) => u.stance === stance), 'troops take their squad\'s stance');
    const [foe] = troops(g, b, 'soldier', 1, mx - 2, my + 2.4); // beside the path, out of reach
    foe.hp = foe.maxHp = 1e6;
    foe.attack = { k: 'p', id: g.idx(Math.floor(foe.x), Math.floor(foe.y)) };
    g.order(a.id, null, { k: 'c', id: b.id }, [a.squads[0].id]);
    let chased = 0;
    const [fx, fy] = [foe.x, foe.y];
    run(g, 3, () => {
      foe.x = fx; // it stays put
      foe.y = fy;
      for (const u of squad) if (g.units.has(u.id) && Math.hypot(u.x - foe.x, u.y - foe.y) < 1.6) chased++;
      return false;
    });
    return chased;
  };
  assert.ok(trial('aggressive') > 0, 'aggressive: turns on the enemy beside its path');
  assert.strictEqual(trial('defensive'), 0, 'defensive: marches on');
  assert.strictEqual(trial('hold'), 0, 'hold: marches on');
});

test('hold: troops at home never chase intruders, defensive ones do', () => {
  const { g, a, b } = duel(38);
  setMix(a, 0, { soldier: 4 });
  respawn(g, a);
  run(g, 12);
  const guards = mine(g, a);
  const core = g.hex.hexes[g.hexAt(a.core.x, a.core.y)];
  const post = guards[0].slotPos;
  const far = g.hex.hexes.filter((h) => g.hexOwner[h.i] === a.id && h !== core)
    .sort((p, q) => Math.hypot(q.cx - post.x, q.cy - post.y) - Math.hypot(p.cx - post.x, p.cy - post.y))[0];
  g.squadStance(a.id, a.squads[0].id, 'hold');
  const [foe] = troops(g, b, 'soldier', 1, far.cx, far.cy);
  foe.hp = foe.maxHp = 1e6;
  foe.attack = { k: 'p', id: g.idx(Math.floor(far.cx), Math.floor(far.cy)) };
  const start = guards.map((u) => [u.x, u.y]);
  run(g, 4);
  assert.ok(guards.every((u, i) => Math.hypot(u.x - start[i][0], u.y - start[i][1]) < 1), 'holding: they stay at their post');
  g.squadStance(a.id, a.squads[0].id, 'defensive');
  run(g, 4);
  assert.ok(guards.some((u, i) => Math.hypot(u.x - start[i][0], u.y - start[i][1]) > 2), 'defensive: they go after it');
});

test('squads stay together on the march and stand guard together at home', () => {
  const { g, a, b } = duel(28);
  setMix(a, 0, { soldier: 2, scout: 1, archer: 1 }); // a fast scout in a squad of soldiers
  respawn(g, a);
  const sq = mine(g, a);
  assert.strictEqual(sq.length, 4);
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

test('standing troops fill their hex in an even formation', () => {
  const { g, a } = duel(32);
  setMix(a, 0, { soldier: 4 }); // all soldiers
  respawn(g, a);
  const squad = mine(g, a);
  run(g, 20);
  const hexes = new Set(squad.map((u) => g.hexAt(Math.floor(u.x), Math.floor(u.y))));
  assert.strictEqual(hexes.size, 1, 'the squad stands in one hex');
  const [h] = hexes;
  const core = g.hexAt(a.core.x, a.core.y);
  assert.ok(g.hex.hexes[core].n.includes(h), 'a hex next to the core');
  for (const u of squad) {
    assert.ok(u.slotPos && Math.hypot(u.x - u.slotPos.x, u.y - u.slotPos.y) < 0.3, 'on its spot');
    for (const v of squad) if (v !== u) assert.ok(Math.hypot(u.x - v.x, u.y - v.y) > 0.9, 'evenly spaced');
  }
  // a second squad forms up in a different hex
  a.squads[1].mix.soldier = 4;
  respawn(g, a);
  const second = mine(g, a).filter((u) => !squad.includes(u));
  run(g, 20);
  const h2 = new Set(second.map((u) => g.hexAt(Math.floor(u.x), Math.floor(u.y))));
  assert.strictEqual(h2.size, 1);
  assert.notStrictEqual([...h2][0], h, 'each squad has its own hex');
});

test("a tower's lightning chains on to nearby enemies, weaker each jump", () => {
  const { g, a, b } = duel(33);
  const t = outpost(g, b);
  // three of a's soldiers in a tight line, the first in the tower's range
  const near = troops(g, a, 'soldier', 3, t.x + 0.5 - 3, t.y + 0.5);
  near.forEach((u, i) => { u.x = t.x + 0.5 - 3 - i * 1.0; u.y = t.y + 0.5; u.hp = u.maxHp = 1e6; u.attack = { k: 'p', id: g.idx(Math.floor(u.x), Math.floor(u.y)) }; });
  g.buildUnitGrid();
  t.cd = 0;
  g.updateStructures(0.05);
  const lost = near.map((u) => 1e6 - u.hp);
  const dmg = C.towerStats('tower', t.level).damage;
  assert.ok(Math.abs(lost[0] - dmg) < 1e-6, 'the nearest is hit in full');
  assert.ok(Math.abs(lost[1] - dmg * C.CHAIN_FALLOFF) < 1e-6, 'the bolt jumps on, weaker');
  assert.ok(Math.abs(lost[2] - dmg * C.CHAIN_FALLOFF ** 2) < 1e-6, 'and again');
});

test('troops at home fight enemies coming into their land, without leaving it', () => {
  const { g, a, b } = duel(34);
  setMix(a, 0, { soldier: 4 }); // all soldiers
  respawn(g, a);
  const guards = mine(g, a);
  run(g, 15); // formed up next to the core
  // an intruder on a's land, well away from the guards' post (beyond the old guard leash)
  const core = g.hex.hexes[g.hexAt(a.core.x, a.core.y)];
  const post = guards[0].slotPos;
  const target = g.hex.hexes.filter((h) => g.hexOwner[h.i] === a.id && h !== core)
    .sort((p, q) => Math.hypot(q.cx - post.x, q.cy - post.y) - Math.hypot(p.cx - post.x, p.cy - post.y))[0];
  const [foe] = troops(g, b, 'soldier', 1, target.cx, target.cy);
  foe.attack = { k: 'p', id: g.idx(Math.floor(target.cx), Math.floor(target.cy)) }; // it holds its ground
  assert.ok(Math.hypot(foe.x - post.x, foe.y - post.y) > C.UNIT_LEASH_CORE, 'out of reach of the old guard rule');
  let offLand = 0;
  run(g, 25, () => {
    for (const u of guards) if (g.units.has(u.id) && g.terr[g.idx(Math.floor(u.x), Math.floor(u.y))] !== a.id) offLand++;
    return !g.units.has(foe.id);
  });
  assert.ok(!g.units.has(foe.id), 'the home troops dealt with the intruder');
  assert.strictEqual(offLand, 0, 'without stepping off their land');
});

test('home troops react to enemies within 1 tile of their border, not further out', () => {
  const { g, a } = duel(35);
  const edge = (gap) => {
    // a point `gap` tiles straight out from a's border, on empty ground
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w - 6; x++) {
        if (g.terr[g.idx(x, y)] !== a.id || g.terr[g.idx(x + 1, y)] === a.id) continue;
        let ok = true;
        for (let k = 1; k <= gap + 2; k++) if (g.terr[g.idx(x + k, y)]) ok = false;
        if (ok) return [x + 1 + gap - 0.5, y + 0.5];
      }
    }
    return null;
  };
  const [nx, ny] = edge(1);
  assert.ok(g.nearHome(a.id, nx, ny), 'half a tile past the border counts');
  const [fx, fy] = edge(3);
  assert.ok(!g.nearHome(a.id, fx, fy), 'two and a half tiles out does not');
});

test('troops sent somewhere march past enemies on the way instead of stopping to fight them', () => {
  const { g, a, b } = duel(36);
  const squad = troops(g, a, 'soldier', 4, a.core.x + 0.5, a.core.y + 2.5);
  assert.strictEqual(g.order(a.id, squad.map((u) => u.id), { k: 'c', id: b.id }), null);
  // a group of b's soldiers holding a spot halfway along
  const mx = (a.core.x + b.core.x) / 2;
  const my = (a.core.y + b.core.y) / 2;
  const guards = troops(g, b, 'soldier', 6, mx, my);
  const spot = g.idx(Math.floor(mx), Math.floor(my));
  g.order(b.id, guards.map((u) => u.id), { k: 'p', id: spot });
  const far = Math.hypot(a.core.x - b.core.x, a.core.y - b.core.y);
  const arrived = run(g, (far / C.UNITS.soldier.speed) * 1.8 + 5,
    () => squad.some((u) => g.units.has(u.id) && Math.hypot(u.x - b.core.x - 0.5, u.y - b.core.y - 0.5) <= 7));
  assert.ok(arrived, 'the squad got to the target without getting bogged down');
  assert.ok(squad.filter((u) => g.units.has(u.id)).length >= 3, 'and most of it is still standing');
});
