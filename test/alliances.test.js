'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { C, seeded, duel, troops, run, Game } = (() => {
  const h = require('./helpers');
  return { ...h, C: require('../shared/config') };
})();

function ally(g, a, b) {
  assert.strictEqual(g.proposeAlliance(a.id, b.id), null);
  assert.strictEqual(g.acceptAlliance(b.id, a.id), null);
  assert.ok(g.allied(a.id, b.id) && g.allied(b.id, a.id));
}

test('allies offer and accept, and an offer back counts as accepting', () => {
  const { g, a, b } = duel(40);
  assert.strictEqual(g.proposeAlliance(a.id, b.id), null);
  assert.deepStrictEqual(g.offersTo(b.id), [a.id]);
  assert.ok(!g.allied(a.id, b.id));
  assert.strictEqual(g.proposeAlliance(b.id, a.id), null); // b offers back: that's a yes
  assert.ok(g.allied(a.id, b.id));
  assert.deepStrictEqual(g.offersTo(b.id), []);
  assert.deepStrictEqual(g.snapshot().players.find((r) => r[0] === a.id)[12], [b.id]);
});

test('offers run out', () => {
  const { g, a, b } = duel(41);
  g.proposeAlliance(a.id, b.id);
  run(g, C.ALLY_OFFER_TIME + 1);
  assert.notStrictEqual(g.acceptAlliance(b.id, a.id), null);
  assert.ok(!g.allied(a.id, b.id));
});

test('allied troops and towers leave each other alone; breaking it starts the fight', () => {
  const { g, a, b } = duel(42);
  ally(g, a, b);
  // b's soldiers right next to a's core and a's soldiers
  const x = a.core.x + 2.5;
  const y = a.core.y + 0.5;
  const mine = troops(g, a, 'soldier', 3, x, y);
  const theirs = troops(g, b, 'soldier', 3, x + 0.8, y);
  run(g, 6);
  for (const u of [...mine, ...theirs]) assert.ok(g.units.has(u.id) && u.hp === u.maxHp, 'nobody got hurt');
  assert.ok(g.order(a.id, null, { k: 'c', id: b.id }), 'ordering an attack on an ally is refused');
  g.breakAlliance(a.id, b.id);
  assert.ok(!g.allied(a.id, b.id));
  const more = troops(g, b, 'soldier', 3, x + 0.8, y);
  run(g, 3);
  assert.ok(more.some((u) => !g.units.has(u.id) || u.hp < u.maxHp), 'the fighting started');
});

test('allying calls off attacks between the two', () => {
  const { g, a, b } = duel(43);
  const t = troops(g, a, 'soldier', 2, a.core.x + 2.5, a.core.y + 0.5);
  assert.strictEqual(g.order(a.id, t.map((u) => u.id), { k: 'c', id: b.id }), null);
  assert.ok(t.every((u) => u.attack));
  ally(g, a, b);
  assert.ok(t.every((u) => !u.attack), 'troops stopped attacking');
  assert.strictEqual(a.lastOrder.type, 'defend');
});

test('allies see each other\'s bases, but not what each other\'s troops see', () => {
  const { g, a, b } = duel(44);
  g.update(0.1);
  const bk = g.idx(b.core.x, b.core.y);
  assert.strictEqual(a.vis[bk], 0);
  ally(g, a, b);
  // one of b's scouts out in the open, away from both bases
  let spot = -1;
  for (let k = 0; k < g.terr.length && spot < 0; k++) {
    const x = k % g.w;
    const y = Math.floor(k / g.w);
    if (!g.terr[k] && !a.vis[k] && Math.hypot(x - a.core.x, y - a.core.y) > 20 && Math.hypot(x - b.core.x, y - b.core.y) > 20) spot = k;
  }
  troops(g, b, 'scout', 1, (spot % g.w) + 0.5, Math.floor(spot / g.w) + 0.5);
  g.update(0.05);
  g.update(0.05);
  assert.strictEqual(a.vis[bk], 1, 'a sees b\'s core');
  assert.strictEqual(a.explored[bk], 1);
  assert.strictEqual(b.vis[spot], 1, 'b\'s scout sees around it');
  assert.strictEqual(a.vis[spot], 0, 'but a doesn\'t see what b\'s scout sees');
});

test('sudden death ends every alliance', () => {
  const g = new Game({ botTarget: 0, rand: seeded(45), rounds: true });
  const a = g.addPlayer('A');
  const b = g.addPlayer('B');
  g.addPlayer('C');
  ally(g, a, b);
  g.time = C.ROUND_SUDDEN_DEATH + 1;
  g.update(0.05);
  assert.ok(!g.allied(a.id, b.id));
  assert.notStrictEqual(g.proposeAlliance(a.id, b.id), null);
});

test('bots weigh offers up and hold a grudge when betrayed', () => {
  const g = new Game({ botTarget: 0, rand: seeded(46) });
  const h = g.addPlayer('Human');
  const bot = g.addPlayer('Bot', true);
  g.addPlayer('Other', true);
  h.spawnTime = bot.spawnTime = -1000;
  g.update(0.05);
  bot.bot.next = Infinity; // keep the bot still
  let tries = 0;
  while (!g.allied(h.id, bot.id) && tries++ < 10) {
    g.proposeAlliance(h.id, bot.id);
    run(g, 4);
  }
  assert.ok(g.allied(h.id, bot.id), 'the bot accepted at some point');
  g.breakAlliance(h.id, bot.id);
  for (let i = 0; i < 5; i++) {
    g.proposeAlliance(h.id, bot.id);
    run(g, 4);
  }
  assert.ok(!g.allied(h.id, bot.id), 'a betrayed bot never allies again');
});
