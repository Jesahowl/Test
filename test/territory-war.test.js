'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const Game = require('../server/game');

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function setup(seed = 1) {
  const g = new Game({ botTarget: 0, rand: seeded(seed) });
  const a = g.addPlayer('A');
  const b = g.addPlayer('B');
  for (const p of [a, b]) {
    p.nextWave = Infinity;
    p.gold = 10000;
  }
  g.update(0.05);
  return { g, a, b };
}

// First unclaimed tile in direction (dx, dy) from p's core, plus `extra` tiles further out.
function edgeTile(g, p, dx, dy, extra) {
  let x = p.core.x;
  let y = p.core.y;
  while (g.terr[g.idx(x, y)] === p.id) {
    x += dx;
    y += dy;
  }
  return { x: x + dx * extra, y: y + dy * extra };
}

// Plant an enemy (B) beacon just outside A's land, so A's land reaches within capture range of it.
function plantEnemyBeacon(g, a, b) {
  const t0 = edgeTile(g, a, 1, 0, 1);
  const id = g.nextId++;
  const t = { id, kind: 'beacon', x: t0.x, y: t0.y, owner: b.id, level: 1, hp: 400, maxHp: 400, ruin: false };
  g.towers.set(id, t);
  g.grid[g.idx(t.x, t.y)] = id;
  g.structVersion++;
  g.terrDirty = true;
  g.update(0.05);
  return t;
}

function addUnits(g, p, kind, n) {
  const ids = [];
  for (let r = 1; ids.length < n && r < 5; r++) {
    for (const [dx, dy] of [[-r, 0], [0, r], [0, -r], [-r, r], [-r, -r]]) {
      if (ids.length >= n) break;
      const before = new Set(g.units.keys());
      if (g.build(p.id, p.core.x + dx, p.core.y + dy, kind) === null) {
        ids.push([...g.units.keys()].find((k) => !before.has(k)));
      }
    }
  }
  return ids;
}

test('beacons can leap onto unclaimed land just beyond the border', () => {
  const { g, a } = setup(1);
  const near = edgeTile(g, a, 1, 0, C.BEACON_LEAP - 1);
  const far = edgeTile(g, a, -1, 0, C.BEACON_LEAP + 1);
  const before = a.territory;
  assert.match(g.build(a.id, far.x, far.y, 'beacon'), /leap at most/);
  assert.match(g.build(a.id, near.x, near.y, 'bolt'), /own land/, 'units cannot leap');
  assert.strictEqual(g.build(a.id, near.x, near.y, 'beacon'), null);
  g.update(0.05);
  assert.ok(a.territory > before + 40, `leap should claim new land (${before} -> ${a.territory})`);
  assert.strictEqual(g.terr[g.idx(near.x, near.y)], a.id);
});

test('beacons cannot be placed on enemy land', () => {
  const { g, a, b } = setup(2);
  assert.match(g.build(a.id, b.core.x + 2, b.core.y, 'beacon'), /enemy land/);
});

test('repeated leaps carry land far from the core', () => {
  const { g, a } = setup(3);
  let reach = 0;
  for (let hop = 0; hop < 3; hop++) {
    const t = edgeTile(g, a, 0, 1, C.BEACON_LEAP - 1);
    if (!g.inBounds(t.x, t.y)) break;
    assert.strictEqual(g.build(a.id, t.x, t.y, 'beacon'), null);
    g.update(0.05);
    reach = t.y - a.core.y;
  }
  assert.ok(reach >= 20, `three hops should reach 20+ tiles out (reached ${reach})`);
});

test('units occupy and capture an undefended enemy beacon', () => {
  const { g, a, b } = setup(4);
  const beacon = plantEnemyBeacon(g, a, b);
  assert.ok(g.canReachForCapture(a.id, beacon));
  const ids = addUnits(g, a, 'bolt', 2);
  const landBefore = a.territory;
  assert.strictEqual(g.occupy(a.id, ids, beacon.id), null);
  let t = 0;
  while (beacon.owner === b.id && t < 30) {
    g.update(0.05);
    t += 0.05;
  }
  assert.strictEqual(beacon.owner, a.id, 'beacon should be captured');
  assert.ok(t < C.CAPTURE_TIME + 5, `two units should capture in under ${C.CAPTURE_TIME + 5}s (took ${t.toFixed(1)}s)`);
  g.update(0.05);
  assert.ok(a.territory > landBefore, 'captured beacon brings its land');
  for (const id of ids) {
    const u = g.units.get(id);
    assert.strictEqual(u.anchor, beacon.id, 'capturing squad stays on as guards');
    assert.strictEqual(u.capture, 0);
  }
});

test('a defended beacon cannot be captured', () => {
  const { g, a, b } = setup(5);
  const beacon = plantEnemyBeacon(g, a, b);
  // A tough defender parked on the beacon.
  const bt = { x: beacon.x + 1, y: beacon.y };
  assert.strictEqual(g.terr[g.idx(bt.x, bt.y)], b.id);
  assert.strictEqual(g.build(b.id, bt.x, bt.y, 'mortar'), null);
  const def = [...g.units.values()].find((u) => u.owner === b.id);
  def.hp = def.maxHp = 1e9;
  def.anchor = beacon.id;
  const ids = addUnits(g, a, 'bolt', 3);
  assert.strictEqual(g.occupy(a.id, ids, beacon.id), null);
  for (let i = 0; i < 20 * 20; i++) g.update(0.05);
  assert.strictEqual(beacon.owner, b.id);
  assert.ok(!beacon.cap, 'no capture progress while defended');
  assert.ok(def.hp < def.maxHp, 'attackers shoot the defender');
});

test('capture progress drains when the attackers leave', () => {
  const { g, a, b } = setup(6);
  const beacon = plantEnemyBeacon(g, a, b);
  const ids = addUnits(g, a, 'bolt', 1);
  g.occupy(a.id, ids, beacon.id);
  for (let i = 0; i < 20 * 30 && !(beacon.cap > 0.3); i++) g.update(0.05);
  assert.ok(beacon.cap > 0.3);
  g.assign(a.id, ids, 0); // recall
  for (let i = 0; i < 20 * 15; i++) g.update(0.05);
  assert.strictEqual(beacon.owner, b.id);
  assert.strictEqual(beacon.cap, 0);
});

test('occupy rejects bad targets', () => {
  const { g, a, b } = setup(7);
  const ids = addUnits(g, a, 'bolt', 1);
  const own = edgeTile(g, a, 0, 1, -2);
  g.build(a.id, own.x, own.y, 'beacon');
  const ownBeacon = [...g.towers.values()].find((t) => t.owner === a.id);
  assert.match(g.occupy(a.id, ids, ownBeacon.id), /enemy beacons/);
  // A far-away enemy beacon on B's side.
  const far = edgeTile(g, b, 0, 1, -2);
  g.build(b.id, far.x, far.y, 'beacon');
  const farBeacon = [...g.towers.values()].find((t) => t.owner === b.id);
  assert.match(g.occupy(a.id, ids, farBeacon.id), /Too far/);
});

test('leapfrogging up to an enemy beacon puts it within capture reach', () => {
  const { g, a, b } = setup(8);
  // An enemy beacon well beyond A's leap range, on open ground.
  const spot = edgeTile(g, a, 1, 0, C.BEACON_LEAP + 7);
  const id = g.nextId++;
  const enemy = { id, kind: 'beacon', x: spot.x, y: spot.y, owner: b.id, level: 1, hp: 400, maxHp: 400, ruin: false };
  g.towers.set(id, enemy);
  g.grid[g.idx(spot.x, spot.y)] = id;
  g.structVersion++;
  g.terrDirty = true;
  g.update(0.05);
  assert.ok(!g.canReachForCapture(a.id, enemy), 'out of reach to begin with');

  // Leapfrog toward it, each hop as close as the rules allow, until we have a foothold.
  let hops = 0;
  while (!g.canReachForCapture(a.id, enemy) && hops < 3) {
    let best = null;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const k = g.idx(x, y);
        if (g.terr[k] !== 0 || g.grid[k] !== 0 || !g.withinLeap(a.id, x, y)) continue;
        const d = Math.hypot(x - enemy.x, y - enemy.y);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    assert.ok(best, 'somewhere to leap to');
    assert.strictEqual(g.build(a.id, best.x, best.y, 'beacon'), null);
    g.update(0.05);
    hops++;
  }
  assert.ok(g.canReachForCapture(a.id, enemy), `foothold after ${hops} hops`);
  assert.ok(hops >= 2, 'the target started more than one hop away');

  const ids = addUnits(g, a, 'bolt', 3);
  assert.strictEqual(g.occupy(a.id, ids, enemy.id), null);
  for (let i = 0; i < 20 * 40 && enemy.owner === b.id; i++) g.update(0.05);
  assert.strictEqual(enemy.owner, a.id);
});
