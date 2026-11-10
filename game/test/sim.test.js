// Headless check: AI-only matches should play out and reach a winner.
// Run with: node game/test/sim.test.js
'use strict';
const assert = require('assert');
const { generateMap } = require('../js/mapgen');
const { Game, PERSONALITIES, NATION_NAMES, NATION_COLORS } = require('../js/sim');

function runMatch(seed, aiCount) {
  const map = generateMap(480, 300, seed);
  const game = new Game(map, seed);
  const kinds = Object.keys(PERSONALITIES);
  const minDist = Math.sqrt(map.landCount / (aiCount + 1)) * 0.8;
  for (let k = 0; k < aiCount; k++) {
    const n = game.addNation(NATION_NAMES[k], NATION_COLORS[k], false, PERSONALITIES[kinds[k % kinds.length]]);
    const s = game.findSpawn(minDist);
    assert(s, 'spawn found');
    game.spawnNation(n, s.x, s.y);
  }
  game.stats();
  const maxTicks = 10 * 60 * 40; // 40 minutes
  const marks = {};
  while (!game.winner && game.tick < maxTicks) {
    game.update();
    if (game.tick % 600 === 0) {
      const neutral = map.landCount - game.nations.slice(1).reduce((s, n) => s + n.tiles, 0);
      marks[game.tick / 600] = Math.round(100 * neutral / map.landCount);
    }
  }
  // Invariant: tile counts match the ownership grid.
  const counts = new Array(game.nations.length).fill(0);
  for (let i = 0; i < game.owner.length; i++) {
    if (game.owner[i]) { assert(map.land[i], 'owned cell is land'); counts[game.owner[i]]++; }
  }
  for (const n of game.nations.slice(1)) assert.strictEqual(n.tiles, counts[n.id], `${n.name} tile count`);
  return { game, map, marks };
}

for (const seed of [1, 42, 777]) {
  const t0 = Date.now();
  const { game, map, marks } = runMatch(seed, 7);
  const ms = Date.now() - t0;
  const w = game.winner;
  console.log(`seed ${seed}: land=${map.landCount} ` +
    `winner=${w ? w.name + ' (' + w.personality.label + ')' : 'none'} ` +
    `at ${(game.tick / 600).toFixed(1)} min, sim took ${ms} ms (${(ms / game.tick).toFixed(2)} ms/tick)`);
  console.log('  neutral land % by minute:', JSON.stringify(marks));
  assert(w, 'match should end within 40 minutes');
}
console.log('OK');
