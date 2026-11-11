'use strict';

const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/config');
const Path = require('../shared/pathfinding');
const Game = require('../server/game');

const W = 30;
const H = 30;
const WALL = Path.structureCost(C, C.TOWERS.wall.hp);
const at = (x, y) => y * W + x;

function trace(extra, start, goal) {
  const dist = Path.computeField(W, H, extra, goal);
  return Path.tracePath(dist, W, H, extra, start, goal);
}

test('open ground: path goes straight to the goal', () => {
  const extra = new Int32Array(W * H);
  const path = trace(extra, at(5, 15), at(20, 15));
  assert.strictEqual(path.length, 16);
  assert.strictEqual(path[path.length - 1], at(20, 15));
});

test('a wall with a gap is routed around, not through', () => {
  const extra = new Int32Array(W * H);
  for (let y = 0; y < H; y++) if (y !== 25) extra[at(15, y)] = WALL; // vertical wall, gap at y=25
  const path = trace(extra, at(5, 15), at(25, 15));
  assert.ok(path.includes(at(15, 25)), 'should pass through the gap');
  for (const i of path) assert.strictEqual(extra[i], 0, 'should never enter a wall tile');
});

test('a maze makes the path longer', () => {
  const open = new Int32Array(W * H);
  const maze = new Int32Array(W * H);
  // Two staggered walls force an S-shaped route.
  for (let y = 0; y < 24; y++) maze[at(10, y)] = WALL;
  for (let y = 6; y < H; y++) maze[at(18, y)] = WALL;
  const straight = trace(open, at(2, 15), at(27, 15)).length;
  const winding = trace(maze, at(2, 15), at(27, 15)).length;
  assert.ok(winding > straight + 15, `maze ${winding} vs open ${straight}`);
  for (const i of trace(maze, at(2, 15), at(27, 15))) assert.strictEqual(maze[i], 0);
});

test('a fully sealed goal is reached by breaking through exactly one structure', () => {
  const extra = new Int32Array(W * H);
  const g = { x: 15, y: 15 };
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) extra[at(g.x + dx, g.y + dy)] = WALL;
    }
  }
  const path = trace(extra, at(2, 15), at(g.x, g.y));
  assert.strictEqual(path[path.length - 1], at(g.x, g.y));
  assert.strictEqual(path.filter((i) => extra[i] > 0).length, 1);
});

test('no diagonal corner-cutting between two structures', () => {
  const extra = new Int32Array(W * H);
  // Walls at (11,10) and (10,11): stepping (10,10) -> (11,11) diagonally would squeeze between them.
  extra[at(11, 10)] = WALL;
  extra[at(10, 11)] = WALL;
  const dist = Path.computeField(W, H, extra, at(11, 11));
  assert.notStrictEqual(Path.nextStep(dist, W, H, extra, at(10, 10), at(11, 11)), at(11, 11));
});

test('in-game creeps walk around a wall line instead of breaking it', () => {
  let s = 42;
  const g = new Game({ botTarget: 0, rand: () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) });
  const a = g.addPlayer('A');
  const b = g.addPlayer('B');
  g.update(0.05);
  b.gold = 10000;
  // Wall line 3 tiles north of B's core, 7 wide.
  const walls = [];
  for (let dx = -3; dx <= 3; dx++) {
    assert.strictEqual(g.build(b.id, b.core.x + dx, b.core.y - 3, 'wall'), null);
    walls.push(g.grid[g.idx(b.core.x + dx, b.core.y - 3)]);
  }
  // A creep coming straight from the north.
  g.spawnCreep('grunt', a.id, b.id, b.core.x + 0.5, b.core.y - 12, 1);
  const hp = b.core.hp;
  for (let i = 0; i < 20 * 30 && b.core.hp === hp; i++) g.update(0.05);
  assert.ok(b.core.hp < hp, 'creep should reach the core');
  for (const id of walls) {
    const t = g.towers.get(id);
    assert.strictEqual(t.hp, t.maxHp, 'walls should be untouched');
  }
});

test('in-game creeps break through when a core is sealed in', () => {
  let s = 7;
  const g = new Game({ botTarget: 0, rand: () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) });
  const a = g.addPlayer('A');
  const b = g.addPlayer('B');
  g.update(0.05);
  b.gold = 10000;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) assert.strictEqual(g.build(b.id, b.core.x + dx, b.core.y + dy, 'wall'), null);
    }
  }
  for (let i = 0; i < 8; i++) g.spawnCreep('brute', a.id, b.id, b.core.x + 0.5, b.core.y - 10, 1);
  const hp = b.core.hp;
  for (let i = 0; i < 20 * 120 && b.core.hp === hp; i++) g.update(0.05);
  assert.ok(b.core.hp < hp, 'creeps should breach the walls and hit the core');
  const wallsLeft = [...g.towers.values()].filter((t) => t.kind === 'wall').length;
  assert.ok(wallsLeft >= 15, `breach should be narrow (walls left: ${wallsLeft})`);
});
