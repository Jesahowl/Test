'use strict';

// Army plan (wave mix, levels), orders, and the waves themselves.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, UNIT_KEYS, dist } = require('./common');

module.exports = {
  // Wave slots: BASE_WAVE from the core plus BARRACKS_TROOPS per barracks.
  waveSize(p) {
    return C.waveSize(this.countOwned(p.id, 'barracks'));
  },

  // The troops of the next wave, in order: assigned slots first (a giant takes 3), the rest soldiers.
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

  // Order troops.
  // - ids: exactly those troops.
  // - otherwise, share (0..1] of your troops: 1 (default) means every troop plus all future waves;
  //   less than 1 sends that fraction of your current troops (keeping the army's mix of types, nearest
  //   to the target first) and leaves the standing order for new waves alone.
  // Returns null on success or an error string; this.lastOrderCount says how many troops moved.
  // ids: specific troops (else `share` of all troops); kinds: only troops of these types;
  // follow: whether new waves take this order too (default: only for an unfiltered 100% order).
  // Hunting a single troop never becomes the waves' order.
  order(pid, ids, target, share = 1, kinds = null, follow = null) {
    this.lastOrderCount = 0;
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    const ord = this.makeOrder(pid, target);
    if (typeof ord === 'string') return ord;
    const filter = Array.isArray(kinds) && kinds.length && UNIT_KEYS.some((k) => !kinds.includes(k))
      ? new Set(kinds.filter((k) => C.UNITS[k]))
      : null;
    const ok = (u) => !filter || filter.has(u.kind);
    const selected = Array.isArray(ids) && ids.length;
    const waves = ord.target?.k !== 'u' && (follow === null || follow === undefined ? !selected && !(share < 1) && !filter : !!follow);
    let chosen;
    if (selected) {
      chosen = ids.slice(0, C.MAX_UNITS).map((id) => this.units.get(id)).filter((u) => u && u.owner === pid);
      if (!chosen.length) return 'No troops selected';
      chosen = chosen.filter(ok);
      if (!chosen.length) return 'None of the selected troops are of the chosen types';
    } else if (!(share < 1)) {
      chosen = [...this.units.values()].filter((u) => u.owner === pid && ok(u));
    } else {
      chosen = this.pickShare(pid, ord, Math.max(0.01, share), ok);
    }
    if (!chosen.length && !waves) return filter ? 'You have no troops of the chosen types' : 'No troops available to send';
    if (waves) p.order = ord;
    for (const u of chosen) this.applyOrder(u, ord);
    this.lastOrderCount = chosen.length;
    return null;
  },

  // Pick `share` of pid's troops for an order: troops not already following it, each type taken in
  // proportion so the group keeps the army's mix, nearest to the order's destination first.
  pickShare(pid, ord, share, ok = () => true) {
    const mine = [...this.units.values()].filter((u) => u.owner === pid && ok(u));
    const want = Math.max(1, Math.round(mine.length * share));
    const dest = this.orderPos(pid, ord);
    const already = (u) => (ord.type === 'defend'
      ? !u.attack && u.anchor === ord.anchor
      : u.attack && u.attack.k === ord.target.k && u.attack.id === ord.target.id);
    const free = mine.filter((u) => !already(u));
    const byDist = (u1, u2) => dist(u1.x, u1.y, dest.x, dest.y) - dist(u2.x, u2.y, dest.x, dest.y);
    const picked = [];
    const leftovers = [];
    for (const kind of UNIT_KEYS) {
      const ofKind = free.filter((u) => u.kind === kind).sort(byDist);
      const take = Math.round(ofKind.length * share);
      picked.push(...ofKind.slice(0, take));
      leftovers.push(...ofKind.slice(take));
    }
    // Rounding per type can miss the total: top up (or trim) with the nearest remaining troops.
    leftovers.sort(byDist);
    while (picked.length < want && leftovers.length) picked.push(leftovers.shift());
    picked.sort(byDist);
    return picked.slice(0, want);
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
    if (!this.orderValid(p.id, p.order)) p.order = { type: 'defend', anchor: 0 };
    let alive = 0; // in wave slots: a giant counts as 3
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
      anchor: 0, attack: null, path: [], dest: null, repathAt: 0, idleUntil: this.time + 0.5,
    };
    this.applyOrder(u, p.order);
    // Troops from a barracks guard it when the standing order is "defend the core".
    if (from && p.order.type === 'defend' && !p.order.anchor) u.anchor = from.id;
    this.units.set(id, u);
    if (this.ucells) this.ucells[this.ucellOf(u.x, u.y)].push(u); // findable before the next grid rebuild
    return u;
  },
};
