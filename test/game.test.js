'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const Game = require('../server/game');

// Small deterministic PRNG so tests are repeatable.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function ownTile(game, p, minR = 2) {
  for (let r = minR; r <= C.CORE_CLAIM; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const x = p.core.x + dx;
      const y = p.core.y + dy;
      if (game.terr[game.idx(x, y)] === p.id && game.grid[game.idx(x, y)] === 0) return { x, y };
    }
  }
  return null;
}

test('a new player gets a core, gold and territory', () => {
  const g = new Game({ botTarget: 0, rand: seeded(1) });
  const p = g.addPlayer('Alice');
  g.update(0.05);
  assert.ok(p.alive);
  assert.ok(p.territory > 100, `territory ${p.territory}`);
  assert.ok(p.gold > C.START_GOLD);
  assert.strictEqual(g.grid[g.idx(p.core.x, p.core.y)], -p.id);
});

test('names are sanitised', () => {
  const g = new Game({ botTarget: 0, rand: seeded(2) });
  assert.strictEqual(g.addPlayer('<script>x</script>').name, 'scriptxscript');
  assert.strictEqual(g.addPlayer('').name, 'Player');
});

test('building is only allowed on your own empty land', () => {
  const g = new Game({ botTarget: 0, rand: seeded(3) });
  const a = g.addPlayer('A');
  const b = g.addPlayer('B');
  g.update(0.05);
  const tile = ownTile(g, a);
  assert.strictEqual(g.build(a.id, tile.x, tile.y, 'bolt'), null);
  assert.match(g.build(a.id, tile.x, tile.y, 'bolt'), /occupied/);
  assert.match(g.build(b.id, tile.x, tile.y, 'bolt'), /own land/);
  assert.match(g.build(a.id, b.core.x + 1, b.core.y, 'bolt'), /own land/);
  assert.match(g.build(a.id, -1, 0, 'bolt'), /bounds/);
  assert.match(g.build(a.id, 1.5, 0, 'bolt'), /bounds/);
});

test('beacons expand territory, selling them shrinks it again', () => {
  const g = new Game({ botTarget: 0, rand: seeded(4) });
  const p = g.addPlayer('A');
  g.update(0.05);
  const before = p.territory;
  const tile = ownTile(g, p, 5);
  assert.strictEqual(g.build(p.id, tile.x, tile.y, 'beacon'), null);
  g.update(0.05);
  assert.ok(p.territory > before, `${p.territory} > ${before}`);
  const beacon = [...g.towers.values()].find((t) => t.kind === 'beacon');
  p.gold += 1000;
  assert.strictEqual(g.upgrade(p.id, beacon.id), null);
  g.update(0.05);
  const upgraded = p.territory;
  assert.strictEqual(g.sell(p.id, beacon.id), null);
  g.update(0.05);
  assert.strictEqual(p.territory, before);
  assert.ok(upgraded > before);
});

test('towers kill creeps and pay bounty', () => {
  const g = new Game({ botTarget: 0, rand: seeded(5) });
  const a = g.addPlayer('A');
  const b = g.addPlayer('B');
  g.update(0.05);
  a.gold = 1000;
  b.gold = 1000;
  // Ring B's core with bolt towers
  for (let i = 0; i < 6; i++) {
    const tile = ownTile(g, b, 2);
    g.build(b.id, tile.x, tile.y, 'bolt');
  }
  const goldBefore = b.gold;
  g.send(a.id, 'grunt', b.id);
  let killed = false;
  for (let i = 0; i < 20 * 60 && !killed; i++) {
    g.update(0.05);
    killed = b.kills > 0;
  }
  assert.ok(killed, 'tower should kill the grunt');
  assert.ok(b.gold > goldBefore);
});

test('undefended core falls, killer gets bounty, base becomes ruins', () => {
  const g = new Game({ botTarget: 0, rand: seeded(6) });
  const a = g.addPlayer('A');
  const b = g.addPlayer('B');
  g.update(0.05);
  const tile = ownTile(g, b, 3);
  g.build(b.id, tile.x, tile.y, 'wall');
  let death = null;
  g.onDeath = (p, info) => { death = { p, info }; };
  a.gold = 100000;
  for (let i = 0; i < 10; i++) g.send(a.id, 'brute', b.id);
  for (let i = 0; i < 20 * 120 && !death; i++) g.update(0.05);
  assert.ok(death, 'B should die');
  assert.strictEqual(death.p.id, b.id);
  assert.strictEqual(death.info.killer, 'A');
  assert.ok(!g.players.has(b.id));
  assert.strictEqual(a.coresDestroyed, 1);
  const ruins = [...g.towers.values()].filter((t) => t.ruin);
  for (const r of ruins) assert.strictEqual(r.owner, 0);
});

test('ruins can be captured once inside your land', () => {
  const g = new Game({ botTarget: 0, rand: seeded(7) });
  const a = g.addPlayer('A');
  g.update(0.05);
  const tile = ownTile(g, a);
  g.build(a.id, tile.x, tile.y, 'bolt');
  const t = [...g.towers.values()][0];
  // Simulate t being a ruin on A's land
  t.owner = 0;
  t.ruin = true;
  t.ruinTime = g.time;
  t.ruinOf = 'Ghost';
  assert.strictEqual(g.capture(a.id, t.id), null);
  assert.strictEqual(t.owner, a.id);
  assert.match(g.capture(a.id, t.id), /Nothing/);
});

test('long simulation with bots stays consistent', () => {
  const g = new Game({ botTarget: 8, rand: seeded(8) });
  let deaths = 0;
  g.onDeath = () => { deaths++; };
  for (let i = 0; i < 20 * 60 * 8; i++) g.update(0.05); // 8 minutes
  // grid and towers agree
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
  assert.ok(g.towers.size > 10, `bots should build (towers: ${g.towers.size})`);
  assert.ok(g.players.size > 0);
  for (const p of g.players.values()) assert.ok(Number.isFinite(p.gold));
  const snap = g.snapshot();
  assert.doesNotThrow(() => JSON.stringify(snap));
  console.log(`  8 min sim: ${g.players.size} players, ${g.towers.size} towers, ${g.creeps.size} creeps, ${deaths} deaths`);
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
