'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { Game, seeded, duel, edgeTile, outpost, troops, run } = require('./helpers');

const mine = (g, p) => [...g.units.values()].filter((u) => u.owner === p.id && !u.worker); // troops (not workers)

// A barracks in the n-th hex next to p's core.
function barracksAt(g, p, n) {
  const h = g.hex.hexes[g.hex.hexes[g.hexAt(p.core.x, p.core.y)].n[n]];
  const x = h.centre % g.w;
  const y = (h.centre - x) / g.w;
  const err = g.build(p.id, x, y, 'barracks');
  if (err) throw new Error(err);
  return [...g.towers.values()].find((t) => t.x === x && t.y === y);
}

// Raise all four of p's squads to full size (four level-4 barracks round the core).
function raise(g, p) {
  if (g.armySize(p) === C.MAX_SQUADS * C.SQUAD_MAX_TROOPS) return;
  for (const n of [0, 1, 3, 4]) {
    const b = barracksAt(g, p, n);
    while (b.level < C.maxLevel('barracks')) g.upgrade(p.id, b.id);
  }
}

// Give squad i of p this mix (the rest of the squads empty), e.g. { soldier: 4 }, with room for it.
function setMix(g, p, i, mix) {
  raise(g, p);
  for (const q of p.squads) {
    for (const k of Object.keys(q.mix)) q.mix[k] = 0;
    q.capSeen = 1e9; // no new slots filling up with soldiers behind the test's back
  }
  Object.assign(p.squads[i].mix, mix);
}

// Respawn time: every fallen troop comes back now.
function respawn(g, p) {
  p.nextWaveAt = g.time;
  g.update(0.05);
  p.nextWaveAt = Infinity;
}

test('every player has 4 squads and no troops until a barracks raises one; fallen troops respawn', () => {
  const { g, a } = duel(1);
  assert.strictEqual(a.squads.length, C.MAX_SQUADS);
  assert.deepStrictEqual(a.squads.map((q) => q.num), [1, 2, 3, 4]);
  assert.strictEqual(g.armySize(a), 0, 'no barracks, no troops');
  respawn(g, a);
  assert.strictEqual(mine(g, a).length, 0);
  setMix(g, a, 0, { soldier: 2, archer: 1 });
  Object.assign(a.squads[1].mix, { siege: 1, medic: 1 });
  respawn(g, a);
  const s1 = mine(g, a).filter((u) => u.sq === a.squads[0].id);
  const s2 = mine(g, a).filter((u) => u.sq === a.squads[1].id);
  assert.deepStrictEqual(s1.map((u) => u.kind).sort(), ['archer', 'soldier', 'soldier']);
  assert.deepStrictEqual(s2.map((u) => u.kind).sort(), ['medic', 'siege']);
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

test('each barracks raises a squad: 5 troops a level, up to 20; troops respawn there too', () => {
  const { g, a, b } = duel(16);
  const gold = a.gold;
  const b1 = barracksAt(g, a, 0);
  assert.strictEqual(a.gold, gold - C.buildCost('barracks', 0));
  assert.strictEqual(b1.squad, 1, 'the first barracks raises squad 1');
  g.update(0.05);
  assert.strictEqual(g.squadCap(a, a.squads[0]), C.BARRACKS_TROOPS);
  assert.strictEqual(a.squads[0].mix.soldier, C.BARRACKS_TROOPS, 'its troops start as soldiers');
  assert.strictEqual(g.squadCap(a, a.squads[1]), 0);
  // upgrades: +5 a level up to 20
  for (let lv = 2; lv <= 4; lv++) {
    const before = a.gold;
    assert.strictEqual(g.upgrade(a.id, b1.id), null);
    assert.strictEqual(a.gold, before - C.upgradeCost('barracks', lv - 1));
    g.update(0.05);
    assert.strictEqual(g.squadCap(a, a.squads[0]), C.BARRACKS_TROOPS * lv);
  }
  assert.strictEqual(g.squadCap(a, a.squads[0]), C.SQUAD_MAX_TROOPS);
  assert.match(g.upgrade(a.id, b1.id), /max/i);
  // the next barracks raise squads 2, 3 and 4
  const b2 = barracksAt(g, a, 3);
  assert.ok(C.buildCost('barracks', 1) > C.buildCost('barracks', 0), 'each one costs more');
  const b3 = barracksAt(g, a, 1);
  const b4 = barracksAt(g, a, 4);
  assert.deepStrictEqual([b2.squad, b3.squad, b4.squad], [2, 3, 4]);
  { const h = g.hex.hexes[g.hex.hexes[g.hexAt(a.core.x, a.core.y)].n[5]]; assert.match(g.build(a.id, h.centre % g.w, Math.floor(h.centre / g.w), 'barracks'), /at most/); }
  respawn(g, a);
  const army = mine(g, a);
  assert.strictEqual(army.length, C.SQUAD_MAX_TROOPS + 3 * C.BARRACKS_TROOPS);
  const near = (t) => army.filter((u) => Math.hypot(u.x - t.x - 0.5, u.y - t.y - 0.5) < 1.6).length;
  assert.ok(near(b1) >= 3 && near(b2) >= 3, 'troops take turns spawning at the core and each barracks');
  // losing a barracks: its squad has no room any more; the next one built raises it again
  g.damageTower(b2, 1e9, b.id);
  g.update(0.05);
  assert.strictEqual(g.squadCap(a, a.squads[1]), 0);
  assert.strictEqual(g.mixSlots(a.squads[1].mix), 0, 'its mix empties');
  const again = barracksAt(g, a, 3);
  assert.strictEqual(again.squad, 2, 'a new barracks fills the gap');
  const out = edgeTile(g, a, 0, 1, 1);
  assert.match(g.build(a.id, out.x, out.y, 'barracks'), /own land/);
});

test('squad mixes are free to change; a full squad swaps soldiers out; levels cost gold', () => {
  const { g, a, b } = duel(3);
  const gold = a.gold;
  const [s1, s2] = a.squads;
  assert.match(g.squadMix(a.id, s1.id, 'archer', 1), /no barracks/);
  barracksAt(g, a, 0);
  g.update(0.05);
  assert.deepStrictEqual(g.mixSlots(s1.mix), 5);
  // full: + swaps a soldier for it (a ram takes two)
  assert.strictEqual(g.squadMix(a.id, s1.id, 'archer', 1), null);
  assert.strictEqual(g.squadMix(a.id, s1.id, 'siege', 1), null);
  assert.deepStrictEqual([s1.mix.soldier, s1.mix.archer, s1.mix.siege], [2, 1, 1]);
  assert.match(g.squadMix(a.id, s1.id, 'soldier', 1), /upgrade its barracks/);
  // − frees a slot; + fills it
  assert.strictEqual(g.squadMix(a.id, s1.id, 'archer', -1), null);
  assert.strictEqual(g.squadMix(a.id, s1.id, 'medic', 1), null);
  assert.strictEqual(g.mixSlots(s1.mix), 5);
  assert.match(g.squadMix(a.id, s1.id, 'archer', -1), /None/);
  assert.match(g.squadMix(a.id, s2.id, 'medic', 1), /no barracks/);
  assert.match(g.squadMix(a.id, 999, 'medic', 1), /Invalid squad/);
  assert.match(g.squadMix(b.id, s1.id, 'medic', 1), /Invalid squad/);
  assert.match(g.squadMix(a.id, s1.id, 'dragon', 1), /Invalid/);
  assert.match(g.squadMix(a.id, s1.id, 'worker', 1), /Invalid/);
  assert.ok(a.gold >= gold - C.buildCost('barracks', 0), 'changing squads is free');
  // levels
  assert.strictEqual(g.armyLevel(a.id, 'medic'), null);
  assert.strictEqual(a.levels.medic, 2);
  respawn(g, a);
  const lv = mine(g, a).filter((u) => u.kind === 'medic');
  assert.ok(lv.length && lv.every((u) => u.level === 2), 'new troops spawn at the new level');
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

test('scouting is a worker job: they explore on their own and see further', () => {
  const { g, a } = duel(19);
  for (const j of C.WORKER_JOBS) a.jobs[j] = j === 'scout' ? 2 : 0;
  respawn(g, a);
  run(g, 2);
  const scouts = [...g.units.values()].filter((u) => u.owner === a.id && u.worker && u.job && u.job.type === 'scout');
  assert.strictEqual(scouts.length, Math.min(C.SCOUT_WORKERS, g.workerCap(a)), 'at most SCOUT_WORKERS go scouting');
  const start = scouts.map((u) => [u.x, u.y]);
  const exploredBefore = a.explored.reduce((n, v) => n + v, 0);
  run(g, 15);
  assert.ok(scouts.some((u, i) => Math.hypot(u.x - start[i][0], u.y - start[i][1]) > 10), 'went exploring');
  assert.ok(a.explored.reduce((n, v) => n + v, 0) > exploredBefore + 200, 'uncovered new ground');
  assert.strictEqual(g.unitSight(scouts[0]), C.SCOUT_SIGHT);
  assert.ok(C.SCOUT_SIGHT > C.UNITS.soldier.sight);
  assert.ok(!C.UNITS.scout, 'no scout troops any more');
});

test('siege rams smash walls and buildings far faster than soldiers', () => {
  const { g, a, b } = duel(39);
  const mx = Math.round((a.core.x + b.core.x) / 2);
  const my = Math.round((a.core.y + b.core.y) / 2);
  const wall = { isWall: true, id: 1e6, owner: b.id, hp: 1e5, maxHp: 1e5, progress: 1, x: mx, y: my };
  const s = C.towerStats('soldier', 1);
  const r = C.towerStats('siege', 1);
  const [sol] = troops(g, a, 'soldier', 1, mx - 1, my);
  const [ram] = troops(g, a, 'siege', 1, mx - 1, my + 1);
  g.walls.set(wall.id, wall);
  g.unitFire(sol, wall, s, C.UNITS.soldier);
  const bySoldier = 1e5 - wall.hp;
  wall.hp = 1e5;
  g.unitFire(ram, wall, r, C.UNITS.siege);
  const byRam = 1e5 - wall.hp;
  assert.ok(byRam * r.rate > 3 * bySoldier * s.rate, `a ram breaks walls much faster (${(byRam * r.rate).toFixed(0)}/s vs ${(bySoldier * s.rate).toFixed(0)}/s)`);
  assert.strictEqual(C.slotsOf('siege'), 2, 'a ram takes two army slots');
  // a ram goes for the wall in reach rather than the enemy troop beside it
  const [foe] = troops(g, b, 'soldier', 1, ram.x + 0.4, ram.y);
  wall.x = ram.x + 0.8;
  wall.y = ram.y - 0.5;
  assert.strictEqual(g.breakerTarget(ram, r.range), wall);
  g.walls.delete(wall.id);
  assert.notStrictEqual(g.breakerTarget(ram, r.range), foe, 'troops are not its target');
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
  setMix(g, a, 0, { soldier: 3 });
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
  const [scout] = troops(g, a, 'soldier', 1, spot.x, spot.y + 6);
  g.update(0.05);
  g.update(0.05);
  assert.ok(g.sees(a, spot.x, spot.y + 4), 'the troop reveals it');
  g.units.delete(scout.id); // the troop is gone...
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
  setMix(g, a, 0, { soldier: 4 });
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
  setMix(g, a, 0, { soldier: 2, siege: 1, archer: 1 }); // a slow ram in a squad of soldiers
  respawn(g, a);
  const sq = mine(g, a);
  assert.strictEqual(sq.length, 4);
  sq.forEach((u, i) => { u.x = a.core.x + 0.5 + (i % 2) * 0.9; u.y = a.core.y + 2.5 + Math.floor(i / 2) * 0.9; }); // (they respawned at different barracks)
  g.buildUnitGrid();
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
  setMix(g, a, 0, { soldier: 4 }); // all soldiers
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
  setMix(g, a, 0, { soldier: 4 }); // all soldiers
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

test('pillage: a squad hunts the camps on its own, nearest first, then the next', () => {
  const { g, a } = duel(40);
  setMix(g, a, 0, { soldier: 12, archer: 4, medic: 2 });
  for (const l of [1, 2, 3]) a.levels.soldier = a.levels.archer = l + 1; // strong enough to clear camps
  respawn(g, a);
  const q = a.squads[0];
  a.explored.fill(1); // (it only goes for camps it has discovered: see the next test)
  assert.strictEqual(g.squadStance(a.id, q.id, 'pillage'), null);
  run(g, 1.5);
  assert.strictEqual(q.order.type, 'attack');
  assert.strictEqual(q.order.target.k, 'j', 'it set off for a camp by itself');
  const first = q.order.target.id;
  const mine = [...g.units.values()].filter((u) => u.owner === a.id && u.sq === q.id);
  const cx = mine.reduce((s, u) => s + u.x, 0) / mine.length;
  const cy = mine.reduce((s, u) => s + u.y, 0) / mine.length;
  const nearest = g.camps.filter((c) => c.alive).sort((p, r) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(r.x - cx, r.y - cy))[0];
  assert.strictEqual(first, nearest.id, 'the nearest one');
  // once it's cleared, the squad moves on to another camp
  for (const c of g.creeps.values()) if (c.camp === first) g.damageCreep(c, 1e9, a.id);
  run(g, 2);
  assert.ok(q.order.target.k === 'j' && q.order.target.id !== first, 'then the next');
  // sending it somewhere else ends the pillaging
  g.order(a.id, null, { k: 'c', id: a.id }, [q.id]);
  assert.strictEqual(q.stance, 'defensive');
});

test('barbarians attack anyone who comes within a tile of their camp', () => {
  const { g, a } = duel(41);
  const camp = g.camps.find((c) => c.alive);
  const monsters = [...g.creeps.values()].filter((c) => c.camp === camp.id);
  assert.ok(monsters.every((c) => !c.angry), 'calm at first');
  const m = monsters[0];
  const [far] = troops(g, a, 'soldier', 1, m.x + 3, m.y);
  far.attack = { k: 'p', id: g.idx(Math.floor(far.x), Math.floor(far.y)) };
  g.update(0.05);
  assert.ok(monsters.every((c) => !c.angry), 'three tiles off: left alone');
  far.x = m.x + 1.2;
  far.y = m.y;
  g.buildUnitGrid();
  g.update(0.05);
  assert.ok(monsters.every((c) => c.angry === a.id), 'within a tile: the whole camp turns on them');
});

test('pillage: only camps that have been discovered; a camp back nearer home comes first', () => {
  const { g, a } = duel(42);
  setMix(g, a, 0, { soldier: 6 });
  respawn(g, a);
  const q = a.squads[0];
  const near = (c) => Math.hypot(c.x - a.core.x, c.y - a.core.y);
  const camps = g.camps.filter((c) => c.alive).sort((x, y) => near(x) - near(y));
  // nothing discovered: the squad stays home
  a.explored.fill(0);
  g.squadStance(a.id, q.id, 'pillage');
  run(g, 1.5);
  a.explored.fill(0);
  g.updatePillage(a);
  assert.strictEqual(q.order.type, 'defend', 'no camp in sight: it waits at home');
  // discover only the second-nearest: it goes there, not to the (unseen) nearest
  const [first, second] = camps;
  a.explored.fill(0);
  a.explored[g.idx(second.x, second.y)] = 1;
  a.pillageAt = 0;
  g.updatePillage(a);
  assert.deepStrictEqual([q.order.target.k, q.order.target.id], ['j', second.id], 'only a discovered camp');
  // the nearest is cleared and comes back (discovered, nearer home): the squad goes there first
  for (const m of g.creeps.values()) if (m.camp === first.id) m.dead = true;
  g.updateCreeps(0.05);
  g.time += 1; // (a little later)
  first.respawnAt = g.time;
  first.x = Math.round(a.core.x + Math.sign(second.x - a.core.x) * 3) || a.core.x + 3; // somewhere near home
  g.updateCreeps(0.05);
  assert.ok(first.alive);
  a.explored[g.idx(first.x, first.y)] = 1;
  if (near(first) < near(second)) {
    a.pillageAt = 0;
    g.updatePillage(a);
    assert.strictEqual(q.order.target.id, first.id, 'a camp back nearer home comes first');
  }
});
