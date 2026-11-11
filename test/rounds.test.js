'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { Game, seeded, duel, troops, run } = require('./helpers');

function roundGame(seed = 3) {
  const g = new Game({ botTarget: 0, rounds: true, rand: seeded(seed) });
  const a = g.addPlayer('A');
  const b = g.addPlayer('B');
  const c = g.addPlayer('C');
  for (const p of [a, b, c]) p.nextWaveAt = Infinity;
  g.update(0.05);
  return { g, a, b, c };
}

test('joining closes after the join window', () => {
  const { g } = roundGame();
  assert.ok(g.canJoin());
  run(g, C.ROUND_JOIN_WINDOW + 1);
  assert.ok(!g.canJoin());
  assert.strictEqual(new Game({ botTarget: 0 }).canJoin(), true);
});

test('last core standing wins and the standings are ranked', () => {
  const { g, a, b, c } = roundGame();
  run(g, C.ROUND_JOIN_WINDOW + 1);
  for (const p of [a, b, c]) p.spawnTime = -1000;
  g.damageCore(b, 1e6, c.id); // C takes out B
  g.update(0.05);
  assert.strictEqual(g.phase, 'playing');
  g.damageCore(c, 1e6, a.id); // A takes out C
  g.update(0.05);
  assert.strictEqual(g.phase, 'over');
  assert.strictEqual(g.winner.id, a.id);
  const st = g.standings();
  assert.deepStrictEqual(st.map((r) => r.name), ['A', 'C', 'B']);
  assert.deepStrictEqual(st.map((r) => r.place), [1, 2, 3]);
  assert.strictEqual(st[0].coresDestroyed, 1);
  // The map freezes once the round is decided.
  const t = g.time;
  g.update(0.05);
  assert.strictEqual(g.time, t);
});

test('no winner before the join window closes, and bots stop joining after it', () => {
  const g = new Game({ botTarget: 4, rounds: true, rand: seeded(5) });
  run(g, 3);
  assert.ok(g.players.size >= 1);
  const solo = [...g.players.values()][0];
  for (const p of g.players.values()) if (p !== solo) g.removePlayer(p.id);
  g.update(0.05);
  assert.strictEqual(g.phase, 'playing');
  run(g, C.ROUND_JOIN_WINDOW);
  // Bots refilled while the window was open, then stopped.
  const n = g.players.size;
  run(g, 10);
  assert.ok(g.players.size <= n);
});

test('sudden death: cores crumble (never below 1 HP) and home turf stops helping', () => {
  const { g, a } = roundGame();
  g.time = C.ROUND_SUDDEN_DEATH + 1;
  const hp = a.core.hp;
  run(g, 2);
  assert.ok(a.core.hp < hp);
  a.core.hp = 1.5;
  run(g, 5);
  assert.strictEqual(a.core.hp, 1);
  const [u] = troops(g, a, 'guard', 1, a.core.x + 1.5, a.core.y + 0.5);
  assert.strictEqual(g.onHomeLand(u), false);
});

test('clearing a golem camp buffs your troops: more damage dealt, less taken', () => {
  const { g, a, b } = duel(4);
  const camp = g.camps.find((c) => c.type === 'big');
  run(g, 1);
  const monsters = [...g.creeps.values()].filter((m) => m.camp === camp.id);
  assert.ok(monsters.length > 1);
  for (const m of monsters.slice(1)) g.damageCreep(m, 1e6, a.id);
  assert.ok(!g.buffed(a.id), 'not until the whole camp is down');
  g.damageCreep(monsters[0], 1e6, a.id);
  assert.ok(g.buffed(a.id));
  assert.ok(a.buffUntil - g.time > C.JUNGLE_BUFF_TIME - 1);

  const [ua] = troops(g, a, 'archer', 1, 50, 50);
  const [ub] = troops(g, b, 'archer', 1, 50, 50);
  g.damageUnit(ua, 100, b.id);
  assert.strictEqual(ua.hp, ua.maxHp - 100 * (1 - C.JUNGLE_BUFF_ARMOR));
  const hp = ub.hp;
  g.unitFire(ua, ub, C.towerStats('archer', 1), C.UNITS.archer);
  const home = g.onHomeLand(ua) ? 1 + C.HOME_DAMAGE_BONUS : 1;
  assert.ok(Math.abs(hp - ub.hp - C.UNITS.archer.damage * (1 + C.JUNGLE_BUFF_DAMAGE) * home) < 1e-9);

  g.time = a.buffUntil + 0.1;
  assert.ok(!g.buffed(a.id));
});

test('small camps give no buff', () => {
  const { g, a } = duel(4);
  const camp = g.camps.find((c) => c.type === 'small');
  run(g, 1);
  for (const m of [...g.creeps.values()].filter((m) => m.camp === camp.id)) g.damageCreep(m, 1e6, a.id);
  assert.ok(!g.buffed(a.id));
});
