'use strict';

// Army plan (wave mix, levels), orders, and the waves themselves.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, UNIT_KEYS, dist } = require('./common');

module.exports = {
  // Wave slots: BASE_WAVE from the core plus BARRACKS_TROOPS per barracks.
  waveSize(p) {
    return C.waveSize(this.countOwned(p.id, 'barracks'));
  },

  // The troops of the next wave, in order: assigned slots first, the rest soldiers.
  waveList(p) {
    const size = this.waveSize(p);
    const list = [];
    let used = 0;
    for (const kind of UNIT_KEYS) {
      for (let i = 0; i < p.army[kind] && used + C.slotsOf(kind) <= size; i++) {
        list.push(kind);
        used += C.slotsOf(kind);
      }
    }
    for (; used < size; used++) list.push('soldier');
    return list;
  },

  slotsUsed(p) {
    return UNIT_KEYS.reduce((n, k) => n + p.army[k] * C.slotsOf(k), 0);
  },

  // Assigning wave slots is free; barracks are what add slots.
  armyAdd(pid, kind) {
    const p = this.players.get(pid);
    if (!p || !p.alive || !C.UNITS[kind]) return 'Invalid troop type';
    if (this.slotsUsed(p) + C.slotsOf(kind) > this.waveSize(p)) {
      return C.slotsOf(kind) > 1
        ? `Not enough free wave slots (a ${C.UNITS[kind].name} takes ${C.slotsOf(kind)}): build a barracks, or remove a troop`
        : 'Every wave slot is assigned: build a barracks for more, or remove a troop';
    }
    p.army[kind]++;
    return null;
  },

  armyRemove(pid, kind) {
    const p = this.players.get(pid);
    if (!p || !p.alive || !C.UNITS[kind]) return 'Invalid troop type';
    if (p.army[kind] <= 0) return 'None to remove';
    p.army[kind]--;
    return null;
  },

  armyLevel(pid, kind) {
    const p = this.players.get(pid);
    if (!p || !p.alive || !C.UNITS[kind]) return 'Invalid troop type';
    const level = p.levels[kind];
    if (level >= C.MAX_LEVEL) return 'Already max level';
    const cost = C.armyLevelCost(kind, level);
    if (p.gold < cost) return 'Not enough gold';
    p.gold -= cost;
    p.levels[kind]++;
    return null;
  },

  // Turn a clicked target into an order for pid's troops.
  // target: { k: 't', id } tower | { k: 'c', id } core (player id) | { k: 'j', id } jungle camp
  makeOrder(pid, target) {
    if (!target || typeof target !== 'object') return 'Invalid target';
    const { k, id } = target;
    if (k === 't') {
      const t = this.towers.get(id);
      if (!t) return 'No such tower';
      if (t.owner === pid) return { type: 'defend', anchor: t.id };
      if (!t.owner) return 'That tower is a ruin';
      return { type: 'attack', target: { k: 't', id: t.id, owner: t.owner } };
    }
    if (k === 'c') {
      if (id === pid) return { type: 'defend', anchor: 0 };
      const enemy = this.players.get(id);
      if (!enemy || !enemy.alive) return 'No such core';
      return { type: 'attack', target: { k: 'c', id } };
    }
    if (k === 'j') {
      const camp = this.camps[id];
      if (!camp || !camp.alive) return 'That camp is empty';
      return { type: 'attack', target: { k: 'j', id } };
    }
    if (k === 'p') {
      // Move to a spot on the map and hold it (id = tile index).
      if (!Number.isInteger(id) || id < 0 || id >= this.w * this.h) return 'Invalid spot';
      return { type: 'attack', target: { k: 'p', id } };
    }
    if (k === 'u') {
      // Hunt an enemy troop: chase it down, then go after its nearby squadmates.
      const v = this.units.get(id);
      if (!v) return 'That troop is gone';
      if (v.owner === pid) return 'That is your own troop';
      return { type: 'attack', target: { k: 'u', id, owner: v.owner, lx: v.x, ly: v.y } };
    }
    return 'Invalid target';
  },

  // Order troops at a target.
  // - ids: exactly those troops, as a one-off (their squads' standing orders stay as they are).
  // - otherwise squads: the squad numbers (0-based) to order, or null for every squad. Each squad's
  //   troops go, and the order becomes the squad's standing order: troops that join it later
  //   follow it too. Hunting a single troop is a one-off for the troops now in the squad.
  // Returns null on success or an error string; this.lastOrderCount says how many troops moved.
  order(pid, ids, target, squads = null) {
    this.lastOrderCount = 0;
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    const ord = this.makeOrder(pid, target);
    if (typeof ord === 'string') return ord;
    let chosen;
    if (Array.isArray(ids) && ids.length) {
      chosen = ids.slice(0, C.MAX_UNITS).map((id) => this.units.get(id)).filter((u) => u && u.owner === pid);
      if (!chosen.length) return 'No troops selected';
    } else {
      const which = this.squadList(squads);
      if (!which) return 'Invalid squad';
      if (ord.target?.k !== 'u') for (const i of which) p.squads[i].order = ord;
      chosen = [...this.units.values()].filter((u) => u.owner === pid && which.includes(u.sq || 0));
      if (!chosen.length && ord.target?.k === 'u') return 'No troops in that squad';
    }
    for (const u of chosen) this.applyOrder(u, ord);
    this.lastOrderCount = chosen.length;
    return null;
  },

  // Validate a list of squad numbers (null = all). Returns the list or null if invalid.
  squadList(squads) {
    if (squads === null || squads === undefined) return Array.from({ length: C.SQUADS }, (_, i) => i);
    if (!Array.isArray(squads) || !squads.length) return null;
    const out = [...new Set(squads)].filter((i) => Number.isInteger(i) && i >= 0 && i < C.SQUADS);
    return out.length ? out : null;
  },

  // Move troops into squad `sq`: they take on its standing order.
  squadAssign(pid, ids, sq) {
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    if (!Number.isInteger(sq) || sq < 0 || sq >= C.SQUADS) return 'Invalid squad';
    if (!Array.isArray(ids) || !ids.length) return 'No troops selected';
    const moved = ids.slice(0, C.MAX_UNITS).map((id) => this.units.get(id)).filter((u) => u && u.owner === pid);
    if (!moved.length) return 'No troops selected';
    const ord = p.squads[sq].order;
    for (const u of moved) {
      u.sq = sq;
      if (this.orderValid(pid, ord)) this.applyOrder(u, ord);
    }
    this.lastOrderCount = moved.length;
    return null;
  },

  // Whether new waves add troops to squad `sq`. At least one squad always takes them.
  squadReinforce(pid, sq, on) {
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    if (!Number.isInteger(sq) || sq < 0 || sq >= C.SQUADS) return 'Invalid squad';
    if (!on && p.squads.filter((s) => s.reinforce).length === 1 && p.squads[sq].reinforce) {
      return 'New troops have to go somewhere: at least one squad takes them';
    }
    p.squads[sq].reinforce = !!on;
    return null;
  },

  // The squad the next new troop joins: the squads taking new troops, in turn.
  pickSquad(p) {
    for (let k = 0; k < C.SQUADS; k++) {
      const i = (p.nextSquad + k) % C.SQUADS;
      if (p.squads[i].reinforce) {
        p.nextSquad = (i + 1) % C.SQUADS;
        return i;
      }
    }
    return 0;
  },

  // Where an order sends troops.
  orderPos(pid, ord) {
    if (ord.type === 'defend') {
      const t = ord.anchor && this.towers.get(ord.anchor);
      const p = this.players.get(pid);
      return t ? { x: t.x + 0.5, y: t.y + 0.5 } : { x: p.core.x + 0.5, y: p.core.y + 0.5 };
    }
    const { k, id } = ord.target;
    if (k === 't') {
      const t = this.towers.get(id);
      return { x: t.x + 0.5, y: t.y + 0.5 };
    }
    if (k === 'c') {
      const p = this.players.get(id);
      return { x: p.core.x + 0.5, y: p.core.y + 0.5 };
    }
    if (k === 'u') return { x: ord.target.lx, y: ord.target.ly };
    if (k === 'p') return { x: (id % this.w) + 0.5, y: Math.floor(id / this.w) + 0.5 };
    const camp = this.camps[id];
    return { x: camp.x + 0.5, y: camp.y + 0.5 };
  },

  applyOrder(u, ord) {
    if (ord.type === 'defend') {
      u.attack = null;
      u.anchor = ord.anchor;
    } else {
      u.attack = { ...ord.target };
    }
    u.path = [];
    u.dest = null;
    u.repathAt = 0;
    u.idleUntil = 0;
  },

  // Is an order still meaningful? Used to sanity-check the standing order for new waves.
  orderValid(pid, ord) {
    if (ord.type === 'defend') return !ord.anchor || this.towers.get(ord.anchor)?.owner === pid;
    const t = ord.target;
    if (t.k === 'c') return !!this.players.get(t.id)?.alive;
    if (t.k === 'j') return !!this.camps[t.id]?.alive;
    if (t.k === 'u') return this.units.has(t.id);
    if (t.k === 'p') return true;
    return !!this.players.get(t.owner)?.alive; // tower orders roll on to that player's next structure
  },

  updateWaves() {
    for (const p of this.players.values()) {
      if (!p.alive || this.time < p.nextWaveAt) continue;
      p.nextWaveAt += C.WAVE_INTERVAL;
      this.spawnWave(p);
    }
  },

  // The core sends BASE_WAVE troops; each barracks sends its BARRACKS_TROOPS from where it stands.
  spawnWave(p) {
    for (const sq of p.squads) if (!this.orderValid(p.id, sq.order)) sq.order = { type: 'defend', anchor: 0 };
    let alive = 0; // in wave slots
    for (const u of this.units.values()) if (u.owner === p.id) alive += C.slotsOf(u.kind);
    const cap = C.unitCap(p.territory, this.waveSize(p));
    const barracks = [...this.towers.values()].filter((t) => t.owner === p.id && t.kind === 'barracks')
      .sort((a, b) => a.id - b.id).slice(0, C.MAX_BARRACKS);
    const list = this.waveList(p);
    let spawned = 0;
    let slotAt = 0;
    for (const kind of list) {
      const n = C.slotsOf(kind);
      if (alive + n > cap) break;
      const slot = slotAt - C.BASE_WAVE;
      const from = slot < 0 ? null : barracks[Math.floor(slot / C.BARRACKS_TROOPS)];
      this.spawnTroop(p, kind, from);
      slotAt += n;
      alive += n;
      spawned++;
    }
    if (spawned) {
      this.fx.push({ k: 'wave', x: p.core.x + 0.5, y: p.core.y + 0.5, o: p.id });
      for (const b of barracks) this.fx.push({ k: 'wave', x: b.x + 0.5, y: b.y + 0.5, o: p.id });
    }
  },

  // Spawn one troop at the core, or at barracks `from`.
  spawnTroop(p, kind, from = null) {
    const id = this.nextId++;
    const level = p.levels[kind];
    const stats = C.towerStats(kind, level);
    const a = this.rand() * Math.PI * 2;
    const ox = from ? from.x : p.core.x;
    const oy = from ? from.y : p.core.y;
    const x = Math.max(0.5, Math.min(this.w - 0.5, ox + 0.5 + Math.cos(a) * (from ? 1 : 1.3)));
    const y = Math.max(0.5, Math.min(this.h - 0.5, oy + 0.5 + Math.sin(a) * (from ? 1 : 1.3)));
    const u = {
      isUnit: true, id, kind, owner: p.id, x, y, level, hp: stats.hp, maxHp: stats.hp, cd: 0,
      anchor: 0, attack: null, path: [], dest: null, repathAt: 0, idleUntil: this.time + 0.5, sq: this.pickSquad(p),
    };
    const ord = p.squads[u.sq].order;
    this.applyOrder(u, ord);
    // Troops from a barracks guard it when their squad's order is "defend the core".
    if (from && ord.type === 'defend' && !ord.anchor) u.anchor = from.id;
    this.units.set(id, u);
    if (this.ucells) this.ucells[this.ucellOf(u.x, u.y)].push(u); // findable before the next grid rebuild
    return u;
  },
};
