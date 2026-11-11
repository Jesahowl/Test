'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { Game, seeded, duel, edgeTile, outpost, troops, run } = require('./helpers');

test('a new player gets a core, gold, land and a starting army plan', () => {
  const g = new Game({ botTarget: 0, rand: seeded(1) });
  const p = g.addPlayer('Alice');
  g.update(0.05);
  assert.ok(p.alive);
  assert.ok(p.territory > 100, `territory ${p.territory}`);
  assert.ok(p.gold > C.START_GOLD);
  assert.strictEqual(g.grid[g.idx(p.core.x, p.core.y)], -p.id);
  assert.deepStrictEqual(p.army, { guard: 2, archer: 2, frost: 0, mortar: 0, medic: 0 });
  assert.deepStrictEqual(p.order, { type: 'defend', anchor: 0 });
});

test('names are sanitised', () => {
  const g = new Game({ botTarget: 0, rand: seeded(2) });
  assert.strictEqual(g.addPlayer('<script>x</script>').name, 'scriptxscript');
  assert.strictEqual(g.addPlayer('').name, 'Player');
});

test('towers go on your land or leap just past it, never on enemy land', () => {
  const { g, a, b } = duel(3);
  const inside = edgeTile(g, a, 0, 1, -2);
  const leap = edgeTile(g, a, 1, 0, C.TOWER_LEAP - 1);
  const tooFar = edgeTile(g, a, -1, 0, C.TOWER_LEAP + 1);
  assert.strictEqual(g.build(a.id, inside.x, inside.y, 'tower'), null);
  assert.match(g.build(a.id, inside.x, inside.y, 'tower'), /occupied/);
  assert.match(g.build(a.id, a.core.x, a.core.y, 'tower'), /occupied/);
  assert.match(g.build(a.id, tooFar.x, tooFar.y, 'tower'), /leap at most/);
  assert.match(g.build(a.id, b.core.x + 2, b.core.y, 'tower'), /enemy land/);
  assert.match(g.build(a.id, -1, 0, 'tower'), /bounds/);
  assert.match(g.build(a.id, 1.5, 0, 'tower'), /bounds/);
  assert.match(g.build(a.id, leap.x, leap.y, 'wall'), /Invalid/);
  const before = a.territory;
  assert.strictEqual(g.build(a.id, leap.x, leap.y, 'tower'), null);
  g.update(0.05);
  assert.ok(a.territory > before + 40, `a leap claims new land (${before} -> ${a.territory})`);
});

test('upgrading a tower widens its land, selling it gives the land back', () => {
  const { g, a } = duel(4);
  const before = a.territory;
  const t = outpost(g, a);
  const withTower = a.territory;
  assert.strictEqual(g.upgrade(a.id, t.id), null);
  g.update(0.05);
  assert.ok(a.territory > withTower);
  assert.strictEqual(t.maxHp, C.towerStats('tower', 2).hp);
  assert.strictEqual(g.sell(a.id, t.id), null);
  g.update(0.05);
  assert.strictEqual(a.territory, before);
});

test('spawn protection keeps a new core and its towers from taking damage', () => {
  const { g, a, b } = duel(5);
  b.spawnTime = g.time;
  const t = outpost(g, b);
  g.damageCore(b, 500, a.id);
  g.damageTower(t, 500, a.id);
  assert.strictEqual(b.core.hp, C.CORE_HP);
  assert.strictEqual(t.hp, t.maxHp);
  b.spawnTime = -1000;
  g.damageCore(b, 500, a.id);
  assert.strictEqual(b.core.hp, C.CORE_HP - 500);
});

test('the conqueror takes the gold, the surviving troops and the core site', () => {
  const { g, a, b } = duel(6);
  const t = outpost(g, b);
  const loyal = troops(g, b, 'archer', 3, b.core.x + 0.5, b.core.y + 2);
  let death = null;
  g.onDeath = (p, info) => { death = { p, info }; };
  b.gold = 777;
  const gold = a.gold;
  const site = { x: b.core.x, y: b.core.y };
  g.damageCore(b, C.CORE_HP, a.id);

  assert.ok(death);
  assert.strictEqual(death.info.killer, 'A');
  assert.strictEqual(death.info.killerId, a.id);
  assert.strictEqual(death.info.troopsTaken, 3);
  assert.strictEqual(death.info.goldTaken, 777);
  assert.ok(!g.players.has(b.id), 'the victim is out of the game');
  assert.strictEqual(a.gold, gold + C.CORE_KILL_BOUNTY + 777, 'all of their gold plus the bounty');

  const newTower = g.towers.get(g.grid[g.idx(site.x, site.y)]);
  assert.ok(newTower, 'the core site is now a tower');
  assert.strictEqual(newTower.owner, a.id);
  assert.ok(!newTower.ruin);
  for (const u of loyal) {
    assert.ok(g.units.has(u.id));
    assert.strictEqual(u.owner, a.id, 'troops defect');
    assert.strictEqual(u.anchor, newTower.id, 'and garrison the new tower');
    assert.strictEqual(u.attack, null);
  }
  assert.ok(t.ruin, 'other towers become ruins');
  g.update(0.05);
  assert.strictEqual(g.terr[g.idx(site.x, site.y)], a.id, 'the site claims land for the conqueror');

  // Ruins can still be bought back once your land reaches them.
  g.terr[g.idx(t.x, t.y)] = a.id;
  assert.strictEqual(g.capture(a.id, t.id), null);
  assert.strictEqual(t.owner, a.id);
});

test('a player who leaves takes nothing with them and leaves no spoils', () => {
  const { g, a, b } = duel(16);
  troops(g, b, 'archer', 2, b.core.x + 0.5, b.core.y + 2);
  const gold = a.gold;
  g.removePlayer(b.id);
  assert.ok(!g.players.has(b.id));
  assert.strictEqual([...g.units.values()].filter((u) => u.owner === b.id).length, 0);
  assert.strictEqual(g.grid[g.idx(b.core.x, b.core.y)], 0);
  assert.strictEqual(a.gold, gold);
});

test('territory RLE encodes the full map', () => {
  const g = new Game({ botTarget: 0, rand: seeded(9) });
  g.addPlayer('A');
  g.update(0.05);
  const rle = g.encodeTerritory();
  let total = 0;
  for (let i = 1; i < rle.length; i += 2) total += rle[i];
  assert.strictEqual(total, C.MAP_W * C.MAP_H);
});

test('long simulation with bots stays consistent', () => {
  const g = new Game({ botTarget: 8, rand: seeded(8) });
  let deaths = 0;
  g.onDeath = () => { deaths++; };
  run(g, 60 * 8);
  let structures = 0;
  for (let i = 0; i < g.grid.length; i++) {
    const v = g.grid[i];
    if (v > 0) {
      structures++;
      const t = g.towers.get(v);
      assert.ok(t, `grid references missing tower ${v}`);
      assert.strictEqual(g.idx(t.x, t.y), i);
    } else if (v < 0) {
      assert.ok(g.players.get(-v)?.alive, 'grid references dead core');
    }
  }
  assert.strictEqual(structures, g.towers.size);
  assert.ok(g.units.size > 20, `bots should field armies (troops: ${g.units.size})`);
  for (const u of g.units.values()) {
    assert.ok(g.players.get(u.owner)?.alive, 'troops of dead players are removed');
    assert.ok(Number.isFinite(u.x) && Number.isFinite(u.y) && u.x >= 0 && u.y >= 0 && u.x <= g.w && u.y <= g.h, 'troop on the map');
  }
  for (const p of g.players.values()) assert.ok(Number.isFinite(p.gold));
  assert.doesNotThrow(() => JSON.stringify(g.snapshot()));
  console.log(`  8 min sim: ${g.players.size} players, ${g.towers.size} towers, ${g.units.size} troops, ${deaths} deaths`);
});

test('gold is tracked by source and kills pay bounties', () => {
  const { g, a, b } = duel(17);
  const [enemy] = troops(g, b, 'archer', 1, 50, 50, 2);
  const before = { ...a.earned };
  g.damageUnit(enemy, 1e9, a.id);
  assert.strictEqual(a.earned.troops - before.troops, C.TROOP_BOUNTY + C.TROOP_BOUNTY_PER_LEVEL);
  const fx = g.fx.find((f) => f.k === 'gold' && f.o === a.id);
  assert.ok(fx, 'a gold popup for the killer');
  assert.strictEqual(fx.n, C.TROOP_BOUNTY + C.TROOP_BOUNTY_PER_LEVEL);
  const income = a.earned.income;
  g.update(1);
  assert.ok(a.earned.income > income, 'land income is tracked too');
  // Fighting pays far more than a few seconds of land.
  assert.ok(C.TOWER_BOUNTY > C.income(a.territory) * 30);
});

test('troops and towers level up to 5, with steep late levels', () => {
  const C = require('../shared/config');
  const { duel, outpost } = require('./helpers');
  const { g, a } = duel(12);
  const t = outpost(g, a);
  for (let l = 1; l < 5; l++) assert.strictEqual(g.upgrade(a.id, t.id), null);
  assert.strictEqual(t.level, 5);
  assert.ok(g.upgrade(a.id, t.id));
  for (let l = 1; l < 5; l++) assert.strictEqual(g.armyLevel(a.id, 'archer'), null);
  assert.strictEqual(a.levels.archer, 5);
  // Levels past 3 cost far more than the early ones, and land reach stops growing at level 3.
  assert.ok(C.upgradeCost('tower', 4) > 3 * C.upgradeCost('tower', 3));
  assert.ok(C.armyLevelCost('archer', 3) > 3 * C.armyLevelCost('archer', 2));
  assert.strictEqual(C.towerStats('tower', 5).claim, C.towerStats('tower', 3).claim);
  assert.strictEqual(C.sellValue('tower', 2), Math.floor((C.TOWERS.tower.cost + C.upgradeCost('tower', 1)) * C.SELL_REFUND));
});
