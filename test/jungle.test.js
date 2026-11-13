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
  const [u] = troops(g, a, 'soldier', 1, camp.x + 1.5, camp.y + 0.5);
  u.anchor = 0;
  const hp = u.hp;
  g.update(0.05);
  for (const c of g.creeps.values()) assert.strictEqual(c.angry, 0);
  assert.ok(u.hp >= hp);
});

test('clearing a camp pays out, angry monsters fight back, and the camp respawns', () => {
  const { g, a } = duel(2);
  const camp = g.camps.find((c) => c.type === 'large');
  const squad = troops(g, a, 'soldier', 6, camp.x - 2, camp.y + 0.5, 3);
  const gold = a.gold;
  assert.strictEqual(g.order(a.id, squad.map((u) => u.id), { k: 'j', id: camp.id }), null);
  let hurt = false;
  assert.ok(run(g, 60, () => {
    hurt = hurt || squad.some((u) => !g.units.has(u.id) || u.hp < u.maxHp);
    return !camp.alive;
  }), 'camp should be cleared');
  assert.ok(hurt, 'monsters fight back');
  const bounty = Object.entries(C.CAMP_TYPES.large).reduce((n, [k, c]) => n + C.CREEPS[k].bounty * c, 0);
  assert.ok(a.gold - gold >= bounty - 1, `bounty paid (${a.gold - gold} >= ${bounty})`);
  g.update(0.05);
  assert.ok(squad.filter((u) => g.units.has(u.id)).every((u) => !u.attack), 'order finished');
  run(g, C.CAMP_RESPAWN + 1);
  assert.ok(!camp.alive, 'the warlord\'s fort takes longer to come back');
  run(g, C.BUFF_CAMP_RESPAWN - C.CAMP_RESPAWN);
  assert.ok(camp.alive, 'camp respawns');
  assert.match(g.order(a.id, null, { k: 'j', id: 999 }), /empty/);
});

test('monsters give up when dragged away from their camp', () => {
  const { g, a } = duel(3);
  const camp = g.camps[1];
  const [u] = troops(g, a, 'soldier', 1, camp.x + 0.5, camp.y + 4);
  const creep = [...g.creeps.values()].find((c) => c.camp === camp.id);
  g.damageCreep(creep, 1, a.id);
  assert.strictEqual(creep.angry, a.id);
  u.x = camp.x + 20; // flee
  run(g, 5);
  assert.strictEqual(creep.angry, 0);
  assert.ok(Math.hypot(creep.x - creep.hx, creep.y - creep.hy) < 0.5, 'back home');
});

test('a cleared camp comes back somewhere new, away from cores and other camps', () => {
  const { g, a, b } = duel(5);
  run(g, 1);
  for (let round = 0; round < 3; round++) {
    const camp = g.camps.find((c) => c.alive && c.type === 'small');
    const before = { x: camp.x, y: camp.y };
    for (const m of [...g.creeps.values()].filter((m) => m.camp === camp.id)) g.damageCreep(m, 1e6, a.id);
    g.update(0.05);
    assert.ok(!camp.alive);
    assert.ok(Math.hypot(camp.x - before.x, camp.y - before.y) >= C.CAMP_MOVE_MIN, 'moved far enough');
    for (const p of [a, b]) assert.ok(Math.hypot(camp.x - p.core.x, camp.y - p.core.y) >= C.CAMP_CORE_DIST);
    for (const o of g.camps) if (o !== camp) assert.ok(Math.hypot(camp.x - o.x, camp.y - o.y) >= C.CAMP_SPACING);
    // the spot is known while it's empty, and monsters appear there when it respawns
    run(g, C.CAMP_RESPAWN + 0.5);
    assert.ok(camp.alive);
    const members = [...g.creeps.values()].filter((m) => m.camp === camp.id);
    assert.ok(members.length > 0 && members.every((m) => Math.hypot(m.hx - camp.x - 0.5, m.hy - camp.y - 0.5) < 1.5));
  }
});


test('camps keep well apart, at the start and as they move', () => {
  const { g, a } = duel(31);
  const minGap = () => {
    let m = Infinity;
    for (const c of g.camps) for (const o of g.camps) if (c !== o) m = Math.min(m, Math.hypot(c.x - o.x, c.y - o.y));
    return m;
  };
  assert.ok(minGap() >= C.CAMP_SPACING, `start: ${minGap()}`);
  run(g, 1);
  for (let k = 0; k < 6; k++) {
    const camp = g.camps.find((c) => c.alive);
    for (const m of [...g.creeps.values()].filter((m) => m.camp === camp.id)) g.damageCreep(m, 1e6, a.id);
    g.update(0.05);
    assert.ok(minGap() >= C.CAMP_SPACING, `after a move: ${minGap()}`);
  }
});
