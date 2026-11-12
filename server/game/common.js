'use strict';

// Shared constants and small helpers for the game simulation modules.

const C = require('../../shared/config');
const Vision = require('../../shared/vision');
const Path = require('../../shared/pathfinding');

const BOT_NAMES = [
  'Ironclad', 'Warden', 'Bulwark', 'Rampart', 'Sentinel', 'Citadel', 'Palisade', 'Keepr',
  'Moatzilla', 'TurretTom', 'Bastille', 'Gatekeep', 'Stonewall', 'Outpost', 'Redoubt', 'Barbican',
];

const KIND_KEYS = Object.keys(C.TOWERS);
const UNIT_KEYS = Object.keys(C.UNITS);
const CREEP_KEYS = Object.keys(C.CREEPS);
const CAMP_KEYS = Object.keys(C.CAMP_TYPES);

// 8-way neighbour offsets for unit path planning.
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const BOT_JUNGLE_RANGE = 34; // how far from their core bots go to farm camps
const UGRID = 4; // spatial grid cell size (tiles)
const UGRID_SLACK = 1; // how far a troop can have moved since the grid was built

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function sanitizeName(name) {
  const clean = String(name || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16);
  return clean || 'Player';
}

// World position of anything that can be fought: troop, monster, tower, or player (= their core).
function posOf(o) {
  if (o.isTower) return [o.x + 0.5, o.y + 0.5];
  if (o.isPlayer) return [o.core.x + 0.5, o.core.y + 0.5];
  return [o.x, o.y];
}

module.exports = { C, Vision, Path, BOT_NAMES, KIND_KEYS, UNIT_KEYS, CREEP_KEYS, CAMP_KEYS, DIRS8, BOT_JUNGLE_RANGE, UGRID, UGRID_SLACK, dist, round2, sanitizeName, posOf };
