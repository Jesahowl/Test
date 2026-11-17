'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const { duel, troops, run } = require('./helpers');

const ofKind = (g, kind) => g.objectives.find((o) => o.kind === kind);

// Troops of p's standing still on (x, y) (an order to hold that spot).
function hold(g, p, kind, n, x, y) {
  const us = troops(g, p, kind, n, x - 0.3, y - 0.3);
  const ord = g.makeOrder(p.id, { k: 'p', id: g.idx(Math.floor(x), Math.floor(y)) });
  for (const u of us) {
    u.hp = u.maxHp = 1e6;
    g.applyOrder(u, ord);
  }
  return us;
}

// Give p a chain of hexes from their land to objective o (so it's linked), returning the chain.
function linkTo(g, p, o) {
  const hexes = g.hex.hexes;
  const start = g.hexAt(p.core.x, p.core.y);
  const prev = new Map([[start, -1]]);
  const queue = [start];
  let end = -1;
  while (queue.length && end < 0) {
    const i = queue.shift();
    for (const j of hexes[i].n) {
      if (prev.has(j) || g.mountains.has(j) || g.isObjectiveHex(j)) continue;
      prev.set(j, i);
      if (hexes[o.hex].n.includes(j)) { end = j; break; }
      queue.push(j);
    }
  }
  const chain = [];
  for (let i = end; i >= 0; i = prev.get(i)) chain.push(i);
  for (const i of chain) if (g.hexOwner[i] !== p.id) g.setHex(i, p.id);
  g.updateObjectiveLinks();
  return chain;
}

test('objectives: a real map has its five kinds, spread out, away from the bases; their hexes are nobody\'s', () => {
  const { g, a, b } = duel(5, { terrain: true });
  const want = Object.values(C.OBJECTIVES).reduce((s, n) => s + n, 0);
  assert.strictEqual(g.objectives.length, want, 'every objective found a spot');
  for (const [kind, n] of Object.entries(C.OBJECTIVES)) assert.strictEqual(g.objectives.filter((o) => o.kind === kind).length, n, kind);
  for (const o of g.objectives) {
    for (const q of g.objectives) if (q !== o) assert.ok(Math.hypot(o.x - q.x, o.y - q.y) >= C.OBJ_SPACING * 0.5, 'spread out');
    for (const p of [a, b]) assert.ok(Math.hypot(o.x - p.core.x, o.y - p.core.y) >= C.OBJ_BASE_GAP - 1, 'away from the bases');
    assert.ok(!g.mountains.has(o.hex) && !g.forest.has(o.hex) && !g.ore.has(o.hex), 'on open ground');
    assert.strictEqual(g.hexOwner[o.hex], 0);
    // a neighbour of a's: still can't be bought, nor walled off
    const nb = g.hex.hexes[o.hex].n[0];
    g.setHex(nb, a.id);
    assert.strictEqual(g.canBuyHex(a.id, o.hex), false, 'not for sale');
    assert.strictEqual(g.canWallEdge(a.id, nb, o.hex), false, 'not walled');
  }
  // open ground (most tests) and the tutorial have none
  assert.strictEqual(duel(5).g.objectives.length, 0);
});

test('objectives: capturing takes troops standing in the hex; more troops are faster; an enemy pauses it', () => {
  const { g, a, b } = duel(6, { terrain: true });
  const o = ofKind(g, 'mine');
  // one troop: about 15s
  const one = hold(g, a, 'soldier', 1, o.x, o.y);
  run(g, C.OBJ_CAPTURE[2][1] - 1.5);
  assert.strictEqual(o.holder, 0, 'not yet');
  assert.ok(o.progress > 0.7, `the ring fills (${o.progress.toFixed(2)})`);
  run(g, 2);
  assert.strictEqual(o.holder, a.id, 'taken by one troop in about 15s');
  for (const u of one) g.units.delete(u.id);
  // five of b's take it back faster, and an enemy in the hex pauses them
  const five = hold(g, b, 'soldier', 5, o.x, o.y);
  run(g, 3);
  const before = o.progress;
  assert.ok(before > 0.3, 'five troops fill it fast');
  const guard = hold(g, a, 'soldier', 1, o.x, o.y);
  run(g, 2);
  assert.ok(o.contested && Math.abs(o.progress - before) < 0.02, 'paused while contested');
  for (const u of guard) g.units.delete(u.id);
  run(g, C.OBJ_CAPTURE[0][1]);
  assert.strictEqual(o.holder, b.id, 'taken back');
  // left alone, a half-filled ring drains away
  for (const u of five) g.units.delete(u.id);
  const c = ofKind(g, 'ruins');
  const two = hold(g, a, 'soldier', 2, c.x, c.y);
  run(g, 5);
  for (const u of two) g.units.delete(u.id);
  const part = c.progress;
  run(g, C.OBJ_DECAY);
  assert.ok(part > 0.2 && c.progress === 0 && c.holder === 0, 'drains when nobody stands there');
});

test('objectives: perks work while linked to your land, for at most 3 at once, and not in sudden death', () => {
  const { g, a } = duel(7, { terrain: true });
  const mine = ofKind(g, 'mine');
  mine.holder = a.id;
  mine.heldSince = g.time;
  g.updateObjectiveLinks();
  assert.strictEqual(mine.linked, false, 'far from a\'s land: not linked');
  let gold = a.gold;
  run(g, 2);
  const income = C.income(a.territory) * 2;
  assert.ok(a.gold - gold < income + 0.5, 'no mine gold while not linked');
  linkTo(g, a, mine);
  assert.ok(mine.linked && mine.active, 'linked by a chain of land: working');
  gold = a.gold;
  const land = a.territory;
  run(g, 2);
  assert.ok(a.gold - gold > C.income(land) * 2 + C.MINE_GOLD * 1.8, 'the mine pays');
  // a 4th objective gives nothing while 3 others work
  const all = g.objectives.slice(0, 4);
  all.forEach((o, k) => { o.holder = a.id; o.heldSince = g.time + k; });
  for (const o of all) linkTo(g, a, o);
  assert.strictEqual(all.filter((o) => o.active).length, C.OBJ_MAX_ACTIVE, 'only 3 at once');
  assert.ok(!all[3].active, 'the one held most recently waits');
  // sudden death (rounds only): all off
  g.rounds = true;
  g.time = g.rules.suddenDeath + 1;
  g.updateObjectiveLinks();
  assert.ok(g.objectives.every((o) => !o.active), 'off in sudden death');
});

test('objectives: the shrine\'s damage while awake, the spring\'s healing, the ruins\' respawns, the watchtower\'s sight', () => {
  const { g, a, b } = duel(8, { terrain: true });
  const own = (kind) => {
    const o = ofKind(g, kind);
    o.holder = a.id;
    o.heldSince = g.time;
    linkTo(g, a, o);
    return o;
  };
  // shrine: +10% damage, only while awake
  own('shrine');
  const hit = (t) => {
    g.time = t;
    const [s] = troops(g, a, 'soldier', 1, 20, 20);
    const [v] = troops(g, b, 'soldier', 1, 20.5, 20);
    v.hp = v.maxHp = 1e6;
    const st = C.towerStats('soldier', s.level);
    g.unitFire(s, v, st, C.UNITS.soldier);
    g.units.delete(s.id);
    g.units.delete(v.id);
    return 1e6 - v.hp;
  };
  const asleep = hit(10);
  const awake = hit(C.SHRINE_AWAKE[0][0] + 5);
  assert.ok(Math.abs(awake / asleep - (1 + C.SHRINE_DAMAGE)) < 0.01, `+10% while awake (${asleep} -> ${awake})`);
  g.time = 30;
  // spring: heals near it, out of combat only
  const sp = own('spring');
  const [w] = troops(g, a, 'soldier', 1, sp.x + 2, sp.y);
  w.hp = w.maxHp * 0.4;
  w.hitAt = g.time;
  g.objectivePerks(1);
  assert.strictEqual(w.hp, w.maxHp * 0.4, 'not while it was just hit');
  w.hitAt = g.time - C.SPRING_CALM - 1;
  g.objectivePerks(1);
  assert.ok(Math.abs(w.hp - w.maxHp * (0.4 + C.SPRING_HEAL)) < 1e-6, 'heals 3% a second at rest');
  g.units.delete(w.id);
  // ruins: stragglers every 2s, and a wiped squad back sooner
  own('ruins');
  a.holdRespawns = false;
  const q = a.squads[0];
  for (const k of Object.keys(q.mix)) q.mix[k] = 0;
  q.mix.soldier = 5;
  g.respawnAll(a);
  const inSq = () => [...g.units.values()].filter((u) => u.owner === a.id && u.sq === q.id && !u.worker);
  for (const u of inSq().slice(0, 2)) g.units.delete(u.id);
  run(g, C.RUINS_TRICKLE * 2 + 0.3);
  assert.strictEqual(inSq().length, 5, 'two stragglers back in about 4s');
  for (const u of inSq()) g.units.delete(u.id);
  run(g, 0.2);
  assert.strictEqual(g.personal(a).squads[0][8], Math.round(C.wipeCooldown(5) * C.RUINS_WIPE), 'a shorter wipe cooldown');
  // watchtower: sees far round itself
  const wt = own('watchtower');
  g.updateVision();
  const edge = g.idx(Math.floor(wt.x + C.WATCH_SIGHT - 2), Math.floor(wt.y));
  assert.ok(a.vis[edge], 'sees 14 tiles out');
});

test('objectives: a knocked-out player\'s go to whoever knocked them out', () => {
  const { g, a, b } = duel(9, { terrain: true });
  const o = ofKind(g, 'mine');
  o.holder = b.id;
  g.killPlayer(b, a.id);
  assert.strictEqual(o.holder, a.id);
});

test('objectives: fair to every base: each new base looks for one at a fair distance', () => {
  const Game = require('../server/game');
  const { seeded } = require('./helpers');
  let within = 0;
  let farthest = 0;
  const maps = 8;
  for (let seed = 1; seed <= maps; seed++) {
    const g = new Game({ botTarget: 0, rounds: true, rand: seeded(seed * 977), mapSeed: seed * 131 });
    const ps = [];
    for (let k = 0; k < 8; k++) ps.push(g.addPlayer('P' + k, true));
    assert.ok(ps.every(Boolean), 'all 8 bases still find room');
    const near = ps.map((p) => Math.min(...g.objectives.map((o) => Math.hypot(p.core.x - o.x, p.core.y - o.y))));
    within += near.filter((d) => d <= 30).length;
    farthest += Math.max(...near);
  }
  assert.ok(within / maps >= 6.5, `most bases have an objective within 30 tiles (${(within / maps).toFixed(1)} of 8)`);
  assert.ok(farthest / maps <= 40, `and none is left far from them all (farthest ${(farthest / maps).toFixed(1)} tiles on average)`);
});
