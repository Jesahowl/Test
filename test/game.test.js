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
  assert.deepStrictEqual(p.army, { soldier: 0, scout: 1, medic: 1, archer: 1 });
  assert.deepStrictEqual(g.waveList(p), ['scout', 'medic', 'archer', 'soldier'], 'the first wave: one of each type');
  assert.strictEqual(p.squadNum.size, 0, 'no squads until the first wave');
  assert.strictEqual(p.newWaves, 'home');
});

test('names are sanitised', () => {
  const g = new Game({ botTarget: 0, rand: seeded(2) });
  assert.strictEqual(g.addPlayer('<script>x</script>').name, 'scriptxscript');
  assert.strictEqual(g.addPlayer('').name, 'Player');
});

test('buildings go on your own land, a tile in from the border; towers claim no land', () => {
  const { g, a, b } = duel(3);
  const inside = edgeTile(g, a, 0, 1, -2);
  const border = edgeTile(g, a, 1, 0, -1); // on my land but touching the edge
  const outside = edgeTile(g, a, -1, 0, 1);
  const before = a.territory;
  assert.strictEqual(g.build(a.id, inside.x, inside.y, 'tower'), null);
  g.update(0.05);
  assert.strictEqual(a.territory, before, 'a tower claims no land');
  assert.match(g.build(a.id, inside.x, inside.y, 'tower'), /occupied/);
  assert.match(g.build(a.id, a.core.x, a.core.y, 'tower'), /occupied/);
  assert.match(g.build(a.id, border.x, border.y, 'tower'), /own land/);
  assert.match(g.build(a.id, outside.x, outside.y, 'barracks'), /own land/);
  assert.match(g.build(a.id, b.core.x + 2, b.core.y, 'tower'), /own land|enemy/);
  assert.match(g.build(a.id, -1, 0, 'tower'), /bounds/);
  assert.match(g.build(a.id, 1.5, 0, 'tower'), /bounds/);
  assert.match(g.build(a.id, inside.x, inside.y, 'wall'), /Invalid/);
  const t = [...g.towers.values()].find((o) => o.owner === a.id);
  assert.strictEqual(g.upgrade(a.id, t.id), null);
  assert.strictEqual(t.maxHp, C.towerStats('tower', 2).hp);
  assert.strictEqual(g.sell(a.id, t.id), null);
  g.update(0.05);
  assert.strictEqual(a.territory, before, 'selling keeps the land');
});

test('land is bought tile by tile at the border, pricier as you grow', () => {
  const { g, a, b } = duel(4);
  a.gold = 1000;
  const start = a.territory;
  assert.ok(start > 100, 'a core starts with a circle of land');
  const edge = edgeTile(g, a, 1, 0); // first empty tile east of the core
  const k = g.idx(edge.x, edge.y);
  const far = g.idx(edge.x + 3, edge.y);
  assert.match(g.buyLand(a.id, [far]), /touch your land/);
  const cost1 = C.landCost(start);
  assert.strictEqual(g.buyLand(a.id, [k, g.idx(edge.x + 1, edge.y), g.idx(edge.x + 2, edge.y)]), null, 'a drag grows outward tile by tile');
  assert.strictEqual(g.lastBuy.n, 3);
  assert.strictEqual(a.gold, 1000 - cost1 - C.landCost(start + 1) - C.landCost(start + 2));
  g.update(0.05);
  assert.strictEqual(a.territory, start + 3);
  assert.ok(C.landCost(400) > C.landCost(100), 'bigger realms pay more per tile');
  // enemy land can't be bought, and gold runs out
  const enemyTile = g.idx(b.core.x, b.core.y + 1);
  assert.match(g.buyLand(a.id, [enemyTile]), /someone else|touch/);
  a.gold = 0;
  assert.match(g.buyLand(a.id, [g.idx(edge.x + 3, edge.y)]), /gold/);
});

test('taking a tower opens up the land around it', () => {
  const { g, a, b } = duel(5);
  const t = outpost(g, b);
  const near = g.idx(t.x - 2, t.y);
  assert.strictEqual(g.terr[near], b.id);
  g.transferTower(t, a.id);
  assert.strictEqual(g.terr[g.idx(t.x, t.y)], a.id, 'the new owner gets the ground the tower stands on');
  assert.strictEqual(g.terr[g.idx(t.x + 1, t.y + 1)], a.id);
  assert.strictEqual(g.terr[near], 0, "the old owner's land nearby opens up");
  assert.strictEqual(g.buyLand(a.id, [near]), null, 'and the taker can buy it');
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

test('the conqueror takes the gold, all the land, the surviving troops and the core site', () => {
  const { g, a, b } = duel(6);
  const t = outpost(g, b);
  const loyal = troops(g, b, 'soldier', 3, b.core.x + 0.5, b.core.y + 2);
  let death = null;
  g.onDeath = (p, info) => { death = { p, info }; };
  b.gold = 777;
  const gold = a.gold;
  const site = { x: b.core.x, y: b.core.y };
  const theirLand = [];
  for (let k = 0; k < g.terr.length; k++) if (g.terr[k] === b.id) theirLand.push(k);
  g.damageCore(b, C.CORE_HP, a.id);
  assert.ok(theirLand.every((k) => g.terr[k] === a.id), 'every tile of their land is now the conqueror\'s');

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
  assert.strictEqual(t.owner, a.id, 'their other towers become the conqueror\'s');
  assert.ok(!t.ruin);
  g.update(0.05);
  assert.strictEqual(g.terr[g.idx(site.x, site.y)], a.id, 'the site claims land for the conqueror');

});

test('a player who leaves is replaced by a bot that keeps their base', () => {
  const { g, a, b } = duel(16);
  const t = outpost(g, b);
  const army = troops(g, b, 'soldier', 2, b.core.x + 0.5, b.core.y + 2);
  const land = b.territory;
  b.gold = 321;
  g.playerLeft(b.id);
  assert.ok(g.players.has(b.id) && b.alive, 'still in the game');
  assert.ok(b.isBot && b.bot, 'now played by a bot');
  assert.strictEqual(b.name, 'B', 'under the same name');
  assert.strictEqual(t.owner, b.id);
  assert.ok(army.every((u) => g.units.has(u.id) && u.owner === b.id));
  assert.strictEqual(b.gold, 321);
  g.update(0.05);
  assert.strictEqual(b.territory, land);
  run(g, 5); // and it plays on
  assert.ok(b.alive);
  // a player removed outright (not a round in progress) takes nothing with them
  g.removePlayer(a.id);
  assert.ok(!g.players.has(a.id));
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
  const [enemy] = troops(g, b, 'soldier', 1, 50, 50, 2);
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
  for (let l = 1; l < 5; l++) assert.strictEqual(g.armyLevel(a.id, 'soldier'), null);
  assert.strictEqual(a.levels.soldier, 5);
  // Levels past 3 cost far more than the early ones, and land reach stops growing at level 3.
  assert.ok(C.upgradeCost('tower', 4) > 3 * C.upgradeCost('tower', 3));
  assert.ok(C.armyLevelCost('soldier', 3) > 3 * C.armyLevelCost('soldier', 2));
  assert.strictEqual(C.towerStats('tower', 5).claim, C.towerStats('tower', 3).claim);
  assert.strictEqual(C.sellValue('tower', 2), Math.floor((C.TOWERS.tower.cost + C.upgradeCost('tower', 1)) * C.SELL_REFUND));
});

test('bases spawn at random spots, spread far apart', () => {
  const firsts = new Set();
  for (let seed = 1; seed <= 6; seed++) {
    const g = new Game({ botTarget: 0, rand: seeded(seed * 7) });
    const ps = [];
    for (let i = 0; i < 6; i++) ps.push(g.addPlayer(`P${i}`));
    firsts.add(`${ps[0].core.x},${ps[0].core.y}`);
    for (const a of ps) {
      assert.ok(a.core.x >= C.SPAWN_MARGIN && a.core.y >= C.SPAWN_MARGIN && a.core.x < g.w - C.SPAWN_MARGIN && a.core.y < g.h - C.SPAWN_MARGIN);
      for (const b of ps) {
        if (a !== b) assert.ok(Math.hypot(a.core.x - b.core.x, a.core.y - b.core.y) >= 30, 'six bases at least 30 tiles apart');
      }
    }
  }
  assert.ok(firsts.size >= 5, 'a different layout each game');
});

test("a building's ground stays its owner's: never released, bought or granted away", () => {
  const { g, a, b } = duel(5);
  const t = outpost(g, b);
  // a second tower of b's right next to the first (on the core's side of it)
  const t2x = t.x - 2;
  assert.strictEqual(g.build(b.id, t2x, t.y, 'tower'), null);
  g.transferTower(t, a.id);
  assert.strictEqual(g.terr[g.idx(t.x, t.y)], a.id, 'the captor gets the captured tower\'s tile');
  assert.strictEqual(g.terr[g.idx(t2x, t.y)], b.id, "b's other tower keeps its ground");
  assert.strictEqual(g.terr[g.idx(t2x - 1, t.y)], b.id, '...and the ring around it');
  // and nobody can buy the ground around an enemy building
  const k = g.idx(t2x - 1, t.y + 1);
  g.terr[k] = 0; g.terrDirty = true;
  assert.ok(!g.canBuyTile(a.id, k));
});

test("a building can't be sold while it's under attack", () => {
  const { g, a, b } = duel(6);
  const t = outpost(g, b);
  g.damageTower(t, 10, a.id);
  assert.match(g.sell(b.id, t.id), /under attack/);
  for (let i = 0; i < 20 * (C.SELL_LOCK + 0.5); i++) g.update(0.05);
  assert.strictEqual(g.sell(b.id, t.id), null);
});
