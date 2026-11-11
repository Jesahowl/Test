'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { duel, troops, run } = require('./helpers');

test('camps spawn across the map and stay passive until attacked', () => {
  const { g, a } = duel(1);
  assert.strictEqual(g.camps.length, C.CAMP_COUNT);
  assert.ok(g.camps.every((c) => c.alive));
  const camp = g.camps[0];
  const [u] = troops(g, a, 'guard', 1, camp.x + 1.5, camp.y + 0.5);
  u.anchor = 0;
  const hp = u.hp;
  g.update(0.05);
  for (const c of g.creeps.values()) assert.strictEqual(c.angry, 0);
  assert.ok(u.hp >= hp);
});

test('clearing a camp pays out, angry monsters fight back, and the camp respawns', () => {
  const { g, a } = duel(2);
  const camp = g.camps.find((c) => c.type === 'big');
  const squad = troops(g, a, 'archer', 6, camp.x - 2, camp.y + 0.5, 3);
  const gold = a.gold;
  assert.strictEqual(g.order(a.id, squad.map((u) => u.id), { k: 'j', id: camp.id }), null);
  let hurt = false;
  assert.ok(run(g, 60, () => {
    hurt = hurt || squad.some((u) => !g.units.has(u.id) || u.hp < u.maxHp);
    return !camp.alive;
  }), 'camp should be cleared');
  assert.ok(hurt, 'monsters fight back');
  const bounty = Object.entries(C.CAMP_TYPES.big).reduce((n, [k, c]) => n + C.CREEPS[k].bounty * c, 0);
  assert.ok(a.gold - gold >= bounty - 1, `bounty paid (${a.gold - gold} >= ${bounty})`);
  g.update(0.05);
  assert.ok(squad.filter((u) => g.units.has(u.id)).every((u) => !u.attack), 'order finished');
  run(g, C.CAMP_RESPAWN + 1);
  assert.ok(!camp.alive, 'golem camps take longer to come back');
  run(g, C.BUFF_CAMP_RESPAWN - C.CAMP_RESPAWN);
  assert.ok(camp.alive, 'camp respawns');
  assert.match(g.order(a.id, null, { k: 'j', id: 999 }), /empty/);
});

test('monsters give up when dragged away from their camp', () => {
  const { g, a } = duel(3);
  const camp = g.camps[1];
  const [u] = troops(g, a, 'archer', 1, camp.x + 0.5, camp.y + 4);
  const creep = [...g.creeps.values()].find((c) => c.camp === camp.id);
  g.damageCreep(creep, 1, a.id);
  assert.strictEqual(creep.angry, a.id);
  u.x = camp.x + 20; // flee
  run(g, 5);
  assert.strictEqual(creep.angry, 0);
  assert.ok(Math.hypot(creep.x - creep.hx, creep.y - creep.hy) < 0.5, 'back home');
});
