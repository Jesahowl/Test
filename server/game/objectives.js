'use strict';

// Map objectives: neutral landmarks, each in its own hex, spread between the bases (see
// OBJECTIVES in config). Stand troops in one's hex with no enemies there and a capture ring fills
// (faster with more troops; an enemy in the hex pauses it; left alone it drains). Once taken it
// stays yours until someone else takes it, with no need to leave troops there.
// Its perk works as long as you hold it (wherever it is: your land needn't reach it), for at most
// OBJ_MAX_ACTIVE objectives at once (the ones held longest), and never in sudden death:
//   mine        +MINE_GOLD gold a second
//   watchtower  no fog within WATCH_SIGHT tiles (enemy squads there show on the minimap)
//   shrine      +SHRINE_DAMAGE troop damage while it's awake (SHRINE_AWAKE windows)
//   spring      troops within SPRING_RANGE heal SPRING_HEAL of their max HP a second out of combat
//   ruins       stragglers rejoin every RUINS_TRICKLE seconds; wiped squads back sooner (RUINS_WIPE)
// Objective hexes belong to nobody: they can't be bought, built on or walled.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, dist } = require('./common');
const Terrain = require('../../shared/terrain');

const KINDS = Object.keys(C.OBJ_KINDS);

module.exports = {
  // Where this map's objectives go (from the map seed: the same map always has the same ones).
  // Real maps only (not the open ground some tests use, nor the tutorial).
  placeObjectives(on = true) {
    this.objectives = [];
    this.objByHex = new Map();
    if (!on || this.openGround || this.rules.tutorial) return;
    const L = this.layout;
    const hexes = this.hex.hexes;
    const campHex = new Set(this.camps.map((c) => this.hexAt(c.x, c.y)));
    const nearLake = new Set();
    for (const i of L.lakes) for (const j of hexes[i].n) for (const k of hexes[j].n) nearLake.add(k);
    const free = (h) => h.full && h.centre >= 0 && !this.mountains.has(h.i) && !this.forest.has(h.i) && !this.ore.has(h.i) && !this.veins.has(h.i)
      && !this.riverHexes.has(h.i) && !campHex.has(h.i) && !h.n.some((j) => campHex.has(j))
      && h.cx >= C.OBJ_EDGE && h.cy >= C.OBJ_EDGE && h.cx <= this.w - C.OBJ_EDGE && h.cy <= this.h - C.OBJ_EDGE;
    const cands = hexes.filter(free);
    // (one of each kind in turn, the Shrine first near the middle; then the seconds)
    const order = [];
    for (let n = 0; n < 4; n++) for (const k of ['shrine', 'ruins', 'mine', 'watchtower', 'spring']) if (n < (C.OBJECTIVES[k] || 0)) order.push(k);
    const prefer = {
      shrine: (h) => -dist(h.cx, h.cy, this.w / 2, this.h / 2) / 4,
      watchtower: (h) => (L.foothills.has(h.i) ? 8 : 0),
      spring: (h) => (nearLake.has(h.i) ? 8 : 0),
      mine: () => 0,
      ruins: () => 0,
    };
    let salt = 0;
    for (const kind of order) {
      let best = null;
      let bestScore = -Infinity;
      for (const h of cands) {
        if (this.objByHex.has(h.i)) continue;
        // (spread out: room from the others and from the camps counts, up to OBJ_SPACING)
        let room = C.OBJ_SPACING * 1.5;
        for (const o of this.objectives) room = Math.min(room, dist(h.cx, h.cy, o.x, o.y));
        if (this.objectives.length && room < C.OBJ_SPACING * 0.5) continue;
        const score = Math.min(room, C.OBJ_SPACING) * 2 + room * 0.2 + prefer[kind](h) + Terrain.hash(this.mapSeed + 900 + salt, h.i, 7) * 6;
        if (score > bestScore) {
          bestScore = score;
          best = h;
        }
      }
      salt++;
      if (!best) continue;
      const o = { id: this.nextId++, kind, hex: best.i, x: best.cx, y: best.cy, holder: 0, progress: 0, capturer: 0, heldSince: 0, linked: false, active: false, contested: false };
      this.objectives.push(o);
      this.objByHex.set(best.i, o);
    }
  },

  isObjectiveHex(i) {
    return !!(this.objByHex && this.objByHex.has(i));
  },

  // Is the Shrine of War burning right now? (and how long until it next changes)
  shrineAwake(t = this.time) {
    if (this.suddenDeath()) return false;
    return C.SHRINE_AWAKE.some(([a, b]) => t >= a && t < b);
  },

  // How many of p's objectives of `kind` are working for them now (see updateObjectiveLinks).
  perk(pid, kind) {
    const p = this.players.get(pid);
    return (p && p.perks && p.perks[kind]) || 0;
  },

  // Seconds for n troops to capture an objective.
  captureTime(n) {
    for (const [min, s] of C.OBJ_CAPTURE) if (n >= min) return s;
    return Infinity;
  },

  updateObjectives(dt) {
    if (!this.objectives || !this.objectives.length) return;
    // who's standing in each objective's hex (troops only: workers and caravans don't count)
    const th = this.hex.tileHex;
    const counts = new Map();
    for (const u of this.units.values()) {
      if (u.worker || u.trade || !u.owner) continue;
      const o = this.objByHex.get(th[this.idx(Math.floor(u.x), Math.floor(u.y))]);
      if (!o) continue;
      let c = counts.get(o);
      if (!c) counts.set(o, (c = new Map()));
      c.set(u.owner, (c.get(u.owner) || 0) + 1);
    }
    for (const o of this.objectives) {
      const c = counts.get(o);
      const owners = c ? [...c.keys()].filter((id) => this.players.get(id)?.alive) : [];
      o.contested = owners.some((a) => owners.some((b) => this.hostile(a, b)));
      if (!owners.length) {
        o.progress = Math.max(0, o.progress - dt / C.OBJ_DECAY);
        if (!o.progress) o.capturer = 0;
        continue;
      }
      if (o.contested) continue; // (an enemy in the hex: the ring waits)
      // one side in the hex (allies count together); if it holds the objective already, or is
      // allied to the holder, it's guarding it: a rival's half-filled ring drains away
      const lead = owners.reduce((a, b) => (c.get(b) > c.get(a) ? b : a));
      if (o.holder && !this.hostile(lead, o.holder)) {
        o.progress = Math.max(0, o.progress - (2 * dt) / C.OBJ_DECAY);
        if (!o.progress) o.capturer = 0;
        continue;
      }
      if (o.capturer !== lead) {
        // someone new: the ring starts over for them (and the holder hears about it)
        o.capturer = lead;
        o.progress = 0;
        if (o.holder) this.fx.push({ k: 'objAlert', id: o.id, o: o.holder, by: lead, x: o.x, y: o.y });
      }
      const n = owners.reduce((s, id) => s + c.get(id), 0);
      o.progress += dt / this.captureTime(n);
      if (o.progress >= 1) this.captureObjective(o, lead);
    }
    if (this.time >= (this.objLinkAt || 0)) {
      this.objLinkAt = this.time + 1;
      this.updateObjectiveLinks();
    }
    // the Shrine's warnings
    for (const [a] of C.SHRINE_AWAKE) {
      if (this.time - dt < a - C.SHRINE_WARN && this.time >= a - C.SHRINE_WARN && this.objectives.some((o) => o.kind === 'shrine') && !this.suddenDeath()) {
        this.pushFeed(`🔥 The Shrine of War wakes in ${C.SHRINE_WARN}s`);
      }
      if (this.time - dt < a && this.time >= a && this.objectives.some((o) => o.kind === 'shrine') && !this.suddenDeath()) this.pushFeed('🔥 The Shrine of War is awake: +10% damage for whoever holds it');
    }
    this.objectivePerks(dt);
  },

  captureObjective(o, pid) {
    const p = this.players.get(pid);
    const def = C.OBJ_KINDS[o.kind];
    const was = o.holder ? this.players.get(o.holder) : null;
    o.holder = pid;
    o.heldSince = this.time;
    o.progress = 0;
    o.capturer = 0;
    this.fx.push({ k: 'objCap', id: o.id, o: pid, x: o.x, y: o.y });
    this.pushFeed(`${def.icon} ${p ? p.name : '?'} ${was ? `took the ${def.name} from ${was.name}` : `captured the ${def.name}`}`);
    this.objLinkAt = 0; // (its perk starts at once)
  },

  // Which objectives give their perk: every one a player holds, wherever it is (no need for their
  // land to reach it), up to OBJ_MAX_ACTIVE (the ones held longest), and none in sudden death.
  // Fills p.perks: kind -> how many are working. About once a second.
  updateObjectiveLinks() {
    const sd = this.suddenDeath();
    for (const p of this.players.values()) p.perks = {};
    const held = new Map();
    for (const o of this.objectives) {
      const p = this.players.get(o.holder);
      o.active = false;
      if (!p || !p.alive) {
        if (o.holder) o.holder = 0;
        o.linked = false;
        continue;
      }
      o.linked = true; // (held: that's all it takes)
      if (!held.has(p.id)) held.set(p.id, []);
      held.get(p.id).push(o);
    }
    for (const [pid, list] of held) {
      const p = this.players.get(pid);
      list.sort((a, b) => a.heldSince - b.heldSince).slice(0, C.OBJ_MAX_ACTIVE).forEach((o) => {
        if (sd) return;
        o.active = true;
        p.perks[o.kind] = (p.perks[o.kind] || 0) + 1;
      });
    }
  },

  // The perks that work every tick: a mine's gold, and a spring's healing. (The Watchtower's sight
  // is in fog.js, the Shrine's damage in troops.js, the Ruins' respawns in army.js.)
  objectivePerks(dt) {
    for (const o of this.objectives) {
      if (!o.active) continue;
      const p = this.players.get(o.holder);
      if (!p) continue;
      if (o.kind === 'mine') this.award(p, C.MINE_GOLD * dt, 'objectives');
      else if (o.kind === 'spring') {
        for (const u of this.nearUnits(o.x, o.y, C.SPRING_RANGE)) {
          if (u.owner !== p.id || u.trade || dist(u.x, u.y, o.x, o.y) > C.SPRING_RANGE) continue;
          if (this.time - (u.hitAt ?? -1e9) < C.SPRING_CALM || u.hp >= u.maxHp) continue;
          u.hp = Math.min(u.maxHp, u.hp + u.maxHp * C.SPRING_HEAL * dt);
        }
      }
    }
  },

  // A knocked-out player's objectives go to whoever knocked them out (or back to nobody).
  passObjectives(p, killer) {
    for (const o of this.objectives || []) {
      if (o.holder !== p.id) continue;
      o.holder = killer ? killer.id : 0;
      o.heldSince = this.time;
    }
    this.objLinkAt = 0;
  },

  // For snapshots: [id, kind, hex, holder, progress %, capturer, flags (1 linked, 2 working, 4 contested)].
  objectiveRows() {
    return (this.objectives || []).map((o) => [o.id, KINDS.indexOf(o.kind), o.hex, o.holder, Math.floor(o.progress * 100), o.capturer,
      (o.linked ? 1 : 0) | (o.active ? 2 : 0) | (o.contested ? 4 : 0)]);
  },
};
