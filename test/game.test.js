'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { Game, seeded, duel, edgeTile, outpost, troops, run } = require('./helpers');

test('a new player gets a core, gold, land and four empty squads', () => {
  const g = new Game({ botTarget: 0, rand: seeded(1) });
  const p = g.addPlayer('Alice');
  g.update(0.05);
  assert.ok(p.alive);
  assert.ok(p.territory > 100, `territory ${p.territory}`);
  assert.ok(p.gold > C.START_GOLD);
  assert.strictEqual(g.grid[g.idx(p.core.x, p.core.y)], -p.id);
  assert.strictEqual(p.squads.length, C.MAX_SQUADS);
  assert.ok(p.squads.every((q) => g.mixSlots(q.mix) === 0), 'no troops to start with');
  assert.strictEqual(g.armySize(p), 0, 'until a barracks raises a squad');
  assert.ok(p.squads.every((q) => q.stance === 'defensive' && q.order.type === 'defend'));
});

test('names are sanitised', () => {
  const g = new Game({ botTarget: 0, rand: seeded(2) });
  assert.strictEqual(g.addPlayer('<script>x</script>').name, 'scriptxscript');
  assert.strictEqual(g.addPlayer('').name, 'Player');
});

test('buildings stand at the centre of one of your hexes, one per hex; towers claim no land', () => {
  const { g, a, b } = duel(3);
  const core = g.hex.hexes[g.hexAt(a.core.x, a.core.y)];
  const next = g.hex.hexes[core.n[0]];
  const before = a.territory;
  // any tile in the hex will do: the tower goes to its centre
  const tile = next.tiles.find((k) => k !== next.centre);
  assert.strictEqual(g.build(a.id, tile % g.w, Math.floor(tile / g.w), 'tower'), null);
  const t = [...g.towers.values()].find((o) => o.owner === a.id);
  assert.strictEqual(g.idx(t.x, t.y), next.centre, 'snapped to the hex centre');
  g.update(0.05);
  assert.strictEqual(a.territory, before, 'a tower claims no land');
  assert.match(g.build(a.id, t.x, t.y, 'barracks'), /already a building/);
  assert.match(g.build(a.id, a.core.x, a.core.y, 'tower'), /already a building/);
  const outside = edgeTile(g, a, -1, 0, 2);
  assert.match(g.build(a.id, outside.x, outside.y, 'barracks'), /own land/);
  assert.match(g.build(a.id, b.core.x, b.core.y + 3, 'tower'), /own land/);
  assert.match(g.build(a.id, -1, 0, 'tower'), /bounds/);
  assert.match(g.build(a.id, 1.5, 0, 'tower'), /bounds/);
  assert.match(g.build(a.id, t.x, t.y, 'wall'), /Invalid/);
  assert.strictEqual(g.upgrade(a.id, t.id), null);
  assert.strictEqual(t.maxHp, C.towerStats('tower', 2).hp);
  assert.strictEqual(g.sell(a.id, t.id), null);
  g.update(0.05);
  assert.strictEqual(a.territory, before, 'selling keeps the land');
});

test('land is claimed hex by hex at the border, pricier as you grow', () => {
  const { g, a, b } = duel(4);
  a.gold = 5000;
  const start = a.territory;
  assert.ok(start > 90, `a core starts with its hex and the six round it (${start} tiles)`);
  const core = g.hex.hexes[g.hexAt(a.core.x, a.core.y)];
  assert.ok(core.n.every((j) => g.hexOwner[j] === a.id));
  const ring = g.hex.hexes.filter((h) => g.canBuyHex(a.id, h.i));
  assert.ok(ring.length >= 6, 'the hexes touching my land are for sale');
  const far = g.hex.hexes.find((h) => !g.hexOwner[h.i] && !g.canBuyHex(a.id, h.i) && g.hex.dist(h, core) > 4);
  assert.match(g.buyLand(a.id, [far.i]), /touch your land/);
  const h1 = ring[0];
  const cost1 = g.hexCost(h1.i, start);
  assert.strictEqual(cost1, C.landCost(start) * h1.tiles.length);
  assert.strictEqual(g.buyLand(a.id, [h1.i]), null);
  assert.strictEqual(a.gold, 5000 - cost1);
  g.update(0.05);
  assert.strictEqual(a.territory, start + h1.tiles.length);
  assert.ok(h1.tiles.every((k) => g.terr[k] === a.id), 'every tile in the hex is mine');
  // a drag: hexes in order, each touching my land or the one before
  const h2 = g.hex.hexes[h1.n.find((j) => !g.hexOwner[j] && g.hex.dist(g.hex.hexes[j], core) > g.hex.dist(h1, core))];
  assert.strictEqual(g.buyLand(a.id, [h2.i]), null);
  assert.ok(C.landCost(400) > C.landCost(100), 'bigger realms pay more');
  // enemy land can't be bought, and gold runs out
  assert.match(g.buyLand(a.id, [g.hexAt(b.core.x, b.core.y)]), /someone else|touch/);
  a.gold = 0;
  assert.match(g.buyLand(a.id, [g.hex.hexes.find((h) => g.canBuyHex(a.id, h.i)).i]), /gold/);
});

test('destroying a tower leaves all the land, its hex included, with its owner', () => {
  const { g, a, b } = duel(5);
  const t = outpost(g, b);
  const th = g.hex.hexes[g.hexAt(t.x, t.y)];
  const ringOwned = th.n.filter((j) => g.hexOwner[j] === b.id);
  assert.ok(ringOwned.length, 'b owns hexes round its tower');
  g.damageTower(t, 1e9, a.id);
  g.update(0.05);
  assert.strictEqual(g.hexOwner[th.i], b.id, "the tower's hex stays b's");
  assert.ok(ringOwned.every((j) => g.hexOwner[j] === b.id), 'and so do the hexes next to it');
  assert.notStrictEqual(g.buyLand(a.id, [th.i]), null, "and they can't be bought");
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
      const m = C.SPAWN_MARGIN - C.HEX_R; // (cores sit at hex centres)
      assert.ok(a.core.x >= m && a.core.y >= m && a.core.x < g.w - m && a.core.y < g.h - m);
      for (const b of ps) {
        if (a !== b) assert.ok(Math.hypot(a.core.x - b.core.x, a.core.y - b.core.y) >= 26, 'six bases well apart');
      }
    }
  }
  assert.ok(firsts.size >= 5, 'a different layout each game');
});

test("a building's hex stays its owner's: never released, claimed or granted away", () => {
  const { g, a, b } = duel(5);
  const t = outpost(g, b);
  const th = g.hex.hexes[g.hexAt(t.x, t.y)];
  // a second tower of b's in the next hex (b owns it: it's next to the outpost on b's side)
  const nj = th.n.find((j) => g.hexOwner[j] === b.id && g.hex.hexes[j].centre >= 0 && g.hex.hexes[j].full);
  const nh = g.hex.hexes[nj];
  assert.strictEqual(g.build(b.id, nh.centre % g.w, Math.floor(nh.centre / g.w), 'tower'), null);
  g.damageTower(t, 1e9, a.id);
  assert.strictEqual(g.hexOwner[th.i], b.id, "the destroyed tower's hex stays b's");
  assert.strictEqual(g.hexOwner[nj], b.id, "b's other tower keeps its hex");
  // nobody can be granted the hex of someone else's building
  g.grantBlock(a.id, nh.centre % g.w, Math.floor(nh.centre / g.w));
  assert.strictEqual(g.hexOwner[nj], b.id);
});

test("a building can't be sold while it's under attack", () => {
  const { g, a, b } = duel(6);
  const t = outpost(g, b);
  g.damageTower(t, 10, a.id);
  assert.match(g.sell(b.id, t.id), /under attack/);
  for (let i = 0; i < 20 * (C.SELL_LOCK + 0.5); i++) g.update(0.05);
  assert.strictEqual(g.sell(b.id, t.id), null);
});

test('players get clearly different colours: 12 hues, then paler tones', () => {
  const g = new Game({ botTarget: 0, rand: seeded(7) });
  const ps = [];
  for (let i = 0; i < 14; i++) ps.push(g.addPlayer(`P${i}`));
  const first = ps.slice(0, 12).map((p) => `${p.hue}:${p.tone}`);
  assert.strictEqual(new Set(first).size, 12);
  assert.ok(ps.slice(0, 12).every((p) => p.tone === 0));
  assert.strictEqual(ps[12].tone, 1);
  // the first few are spread round the colour wheel
  const gap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  assert.ok(gap(ps[0].hue, ps[1].hue) >= 150);
  // a knocked-out player's colour goes to the next newcomer
  g.killPlayer(ps[3], null);
  const late = g.addPlayer('Late');
  assert.strictEqual(late.hue, ps[3].hue);
  assert.strictEqual(late.tone, 0);
});
