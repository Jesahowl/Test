'use strict';

// Authoritative game simulation for Territory Siege.
//
// Positions are in tiles. A structure on tile (x, y) has its centre at (x + 0.5, y + 0.5).
// - Cores and towers sit on the grid. Both claim land and shoot enemy troops.
// - Every WAVE_INTERVAL seconds each core sends out a free wave of troops built from the player's
//   army plan. Troops follow orders: attack an enemy tower/core/jungle camp (marching across the
//   map via flow fields, fighting what they meet), or defend one of their own structures
//   (patrolling around it on their own land).
// - Jungle camps are neutral monsters that sit still, fight back when attacked, and pay out.
//
// The Game class is split by topic: this file holds the core (state, spatial grid, the tick and
// snapshots); the rest live in ./game/*.js and are mixed into Game's prototype below.

const Hex = require('../shared/hex');
const { C, KIND_KEYS, UNIT_KEYS, CREEP_KEYS, CAMP_KEYS, UGRID, UGRID_SLACK, dist } = require('./game/common');

class Game {
  constructor(opts = {}) {
    this.w = C.MAP_W;
    this.h = C.MAP_H;
    this.rand = opts.rand || Math.random;
    this.botTarget = opts.botTarget ?? C.BOT_TARGET;
    // Rounds (used by the server): joining closes after ROUND_JOIN_WINDOW, the last core standing
    // wins and the game freezes with phase 'over'. Without rounds, players come and go freely.
    this.rounds = !!opts.rounds;
    this.round = opts.round || 1;
    this.phase = 'playing';
    this.winner = null;
    this.roster = new Map(); // everyone who played this round: id -> standings entry

    this.players = new Map();
    this.towers = new Map();
    this.units = new Map(); // troops
    this.creeps = new Map(); // jungle monsters
    this.camps = [];

    // grid: 0 = empty, >0 = tower id, <0 = core of player -id
    this.grid = new Int32Array(this.w * this.h);
    // terr: owner player id per tile, 0 = unclaimed
    this.terr = new Int32Array(this.w * this.h);
    // the hex grid land is bought and drawn in (each hex covers a patch of tiles)
    this.hex = Hex.build(this.w, this.h, C.HEX_R);
    this.hexOwner = new Int32Array(this.hex.hexes.length);
    this.terrDirty = true;
    this.terrVersion = 0;

    // Pathfinding: structVersion bumps whenever a structure appears, disappears or changes max HP.
    this.structVersion = 0;
    this.extra = new Int32Array(this.w * this.h); // per-tile path entry cost
    this.extraVersion = -1;
    this.fields = new Map(); // goal tile -> { dist, version, at, used }

    // Scratch buffers for unit BFS (stamp-based so they never need clearing).
    this.bfsStamp = new Int32Array(this.w * this.h);
    this.bfsParent = new Int32Array(this.w * this.h);
    this.bfsQueue = new Int32Array(this.w * this.h);
    this.bfsGen = 0;

    this.nextId = 1;
    this.time = 0;
    this.botSpawnAt = 1;
    this.pruneAt = 5;

    this.fx = []; // visual effects produced this tick
    this.feed = []; // kill-feed messages produced this tick

    // Hook: called as onDeath(player, info) when a player's core is destroyed.
    this.onDeath = null;

    this.setupCamps();
    this.recomputeTerritory();
  }

  idx(x, y) {
    return y * this.w + x;
  }

  // ---- spatial grid for troops: rebuilt once per tick so "who is near here?" checks only look at
  // nearby cells instead of every troop on the map. Troops move < UGRID_SLACK tiles per tick, and
  // every candidate is still distance-checked exactly, so lookups pad the radius by that much.
  buildUnitGrid() {
    const gw = Math.ceil(this.w / UGRID);
    const gh = Math.ceil(this.h / UGRID);
    if (!this.ucells) this.ucells = Array.from({ length: gw * gh }, () => []);
    for (const c of this.ucells) c.length = 0;
    for (const u of this.units.values()) this.ucells[this.ucellOf(u.x, u.y)].push(u);
  }

  ucellOf(x, y) {
    const gw = Math.ceil(this.w / UGRID);
    const cx = Math.min(gw - 1, Math.max(0, Math.floor(x / UGRID)));
    const cy = Math.min(Math.ceil(this.h / UGRID) - 1, Math.max(0, Math.floor(y / UGRID)));
    return cy * gw + cx;
  }

  // Living troops that may be within r of (x, y) (callers check the exact distance).
  nearUnits(x, y, r) {
    if (!this.ucells) this.buildUnitGrid();
    const gw = Math.ceil(this.w / UGRID);
    const gh = Math.ceil(this.h / UGRID);
    const pad = r + UGRID_SLACK;
    const x0 = Math.max(0, Math.floor((x - pad) / UGRID));
    const x1 = Math.min(gw - 1, Math.floor((x + pad) / UGRID));
    const y0 = Math.max(0, Math.floor((y - pad) / UGRID));
    const y1 = Math.min(gh - 1, Math.floor((y + pad) / UGRID));
    const out = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (const u of this.ucells[cy * gw + cx]) if (this.units.has(u.id)) out.push(u);
      }
    }
    return out;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  update(dt) {
    if (this.phase === 'over') return; // the round is decided: the map freezes under the scoreboard
    this.time += dt;
    this.fieldBudget = C.PATH_FIELDS_PER_TICK;

    if (this.suddenDeath()) {
      for (const p of this.players.values()) {
        if (p.alive) p.core.hp = Math.max(1, p.core.hp - p.core.maxHp * C.SUDDEN_DEATH_DECAY * dt);
      }
    }

    for (const p of this.players.values()) {
      if (p.alive) this.award(p, C.income(p.territory) * dt, 'income');
    }

    this.updateWaves();
    this.buildUnitGrid();
    this.updateBots();
    this.updateUnits(dt);
    this.updateStructures(dt);
    this.updateCreeps(dt);
    this.separateUnits();

    for (const t of this.towers.values()) {
      if (t.ruin && this.time - t.ruinTime > C.RUIN_LIFETIME) this.removeTower(t);
    }
    if (this.time >= this.pruneAt) {
      this.pruneAt = this.time + 5;
      for (const [goal, f] of this.fields) if (this.time - f.used > 10) this.fields.delete(goal);
    }

    if (this.terrDirty) this.recomputeTerritory();
    this.visionTick = (this.visionTick || 0) + 1;
    if (this.visionTick % 2 === 0) this.updateVision();
    this.checkRoundOver();
  }

  // Shared (non-personal) part of the state broadcast. Clears per-tick fx/feed.
  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      players.push([p.id, p.name, p.hue, p.core.x, p.core.y, Math.max(0, Math.round(p.core.hp)), p.core.maxHp,
        p.territory, p.kills, p.isBot ? 1 : 0, this.isShielded(p) ? Math.ceil(C.SPAWN_SHIELD - (this.time - p.spawnTime)) : 0,
        Math.max(0, Math.ceil(p.buffUntil - this.time))]);
    }
    const towers = [];
    for (const t of this.towers.values()) {
      towers.push([t.id, KIND_KEYS.indexOf(t.kind), t.x, t.y, t.owner, t.level, Math.ceil(t.hp), t.maxHp, t.ruinOf || 0]);
    }
    const units = [];
    for (const u of this.units.values()) {
      const a = u.attack;
      // positions in tenths of a tile; max HP follows from kind + level on the client
      units.push([u.id, UNIT_KEYS.indexOf(u.kind), Math.round(u.x * 10), Math.round(u.y * 10), u.owner, u.level, Math.ceil(u.hp), u.anchor,
        a ? `${a.k}:${a.id}` : 0, u.sq || 0]);
    }
    const creeps = [];
    for (const c of this.creeps.values()) {
      creeps.push([c.id, CREEP_KEYS.indexOf(c.kind), Math.round(c.x * 10), Math.round(c.y * 10), c.angry, Math.ceil((100 * c.hp) / c.maxHp), c.camp]);
    }
    const camps = this.camps.map((c) => [c.id, c.x, c.y, CAMP_KEYS.indexOf(c.type), c.alive ? 1 : 0,
      c.alive ? 0 : Math.max(0, Math.ceil(c.respawnAt - this.time))]);
    const snap = { players, towers, units, creeps, camps, fx: this.fx, feed: this.feed };
    if (this.rounds) {
      snap.round = {
        n: this.round, phase: this.phase, t: Math.floor(this.time),
        join: Math.max(0, Math.ceil(C.ROUND_JOIN_WINDOW - this.time)),
        sd: Math.ceil(C.ROUND_SUDDEN_DEATH - this.time), // <= 0: sudden death is on
      };
    }
    this.fx = [];
    this.feed = [];
    return snap;
  }

  // Personal state for one player (sent only to them).
  personal(p) {
    // My squads as [id, number] (their troops carry the id), and what new squads do.
    const squads = [...p.squadNum].sort((x, y) => x[1] - y[1]);
    const lo = p.lastOrder;
    const follow = lo.type === 'defend' ? (lo.anchor ? `t:${lo.anchor}` : `c:${p.id}`) : `${lo.target.k}:${lo.target.id}`;
    return {
      id: p.id,
      gold: Math.floor(p.gold),
      nextWave: Math.max(0, Math.ceil(p.nextWaveAt - this.time)),
      waveSize: this.waveSize(p),
      army: p.army,
      levels: p.levels,
      squads,
      newWaves: p.newWaves,
      follow,
    };
  }
}

Object.assign(Game.prototype,
  require('./game/players'),
  require('./game/territory'),
  require('./game/structures'),
  require('./game/army'),
  require('./game/jungle'),
  require('./game/combat'),
  require('./game/troops'),
  require('./game/fog'),
  require('./game/bots'),
);

Game.KIND_KEYS = KIND_KEYS;
Game.UNIT_KEYS = UNIT_KEYS;
Game.CREEP_KEYS = CREEP_KEYS;
Game.CAMP_KEYS = CAMP_KEYS;

module.exports = Game;
