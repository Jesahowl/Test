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
      if (this.allied(pid, t.owner)) return 'That is your ally: break the alliance first';
      return { type: 'attack', target: { k: 't', id: t.id, owner: t.owner } };
    }
    if (k === 'c') {
      if (id === pid) return { type: 'defend', anchor: 0 };
      const enemy = this.players.get(id);
      if (!enemy || !enemy.alive) return 'No such core';
      if (this.allied(pid, id)) return 'That is your ally: break the alliance first';
      return { type: 'attack', target: { k: 'c', id } };
    }
    if (k === 'j') {
      const camp = this.camps[id];
      if (!camp) return 'No such camp';
      // A camp waiting to come back: go there and wait, then attack when it's back (wait).
      return { type: 'attack', target: camp.alive ? { k: 'j', id } : { k: 'j', id, wait: 1 } };
    }
    if (k === 'p') {
      // Move to a spot on the map and hold it (id = tile index).
      if (!Number.isInteger(id) || id < 0 || id >= this.w * this.h) return 'Invalid spot';
      return { type: 'attack', target: { k: 'p', id } };
    }
    if (k === 'e') {
      // Escort one of my caravans.
      const v = this.units.get(id);
      if (!v || !v.trade || v.owner !== pid) return 'That caravan is gone';
      return { type: 'attack', target: { k: 'e', id } };
    }
    if (k === 'u') {
      // Hunt an enemy troop: chase it down, then go after its nearby squadmates.
      const v = this.units.get(id);
      if (!v) return 'That troop is gone';
      if (v.owner === pid) return v.trade ? { type: 'attack', target: { k: 'e', id } } : 'That is your own troop';
      if (this.allied(pid, v.owner)) return 'That is your ally: break the alliance first';
      return { type: 'attack', target: { k: 'u', id, owner: v.owner, lx: v.x, ly: v.y } };
    }
    return 'Invalid target';
  },

  // ---- squads: every wave is a squad of its own; its troops carry the squad id (u.sq).

  // A new, empty squad for player p: a fresh id, numbered with the lowest number not in use.
  newSquad(p) {
    const used = new Set(p.squadNum.values());
    let num = 1;
    while (used.has(num)) num++;
    const id = this.nextId++;
    p.squadNum.set(id, num);
    return id;
  },

  // Forget squads that have no troops left (their numbers become free again).
  pruneSquads() {
    const live = new Set();
    for (const u of this.units.values()) live.add(u.sq);
    for (const p of this.players.values()) {
      for (const id of p.squadNum.keys()) if (!live.has(id)) p.squadNum.delete(id);
    }
  },

  // Order troops at a target.
  // - squads: squad ids to send (null = every squad). Each squad goes as a group.
  // - ids: exactly those troops. Picked troops that aren't whole squads split off into a new squad
  //   of their own, so a squad's troops always share one order.
  // Unless it's a hunt, the order is remembered: with newWaves 'follow', new squads take it.
  // Returns null on success or an error string; this.lastOrderCount says how many troops moved.
  order(pid, ids, target, squads = null) {
    this.lastOrderCount = 0;
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    const ord = this.makeOrder(pid, target);
    if (typeof ord === 'string') return ord;
    let chosen;
    if (Array.isArray(ids) && ids.length) {
      chosen = ids.slice(0, C.MAX_UNITS).map((id) => this.units.get(id)).filter((u) => u && u.owner === pid && !u.trade);
      if (!chosen.length) return 'No troops selected';
      this.splitOff(p, chosen);
    } else if (squads === null || squads === undefined) {
      chosen = [...this.units.values()].filter((u) => u.owner === pid && !u.trade);
      if (!chosen.length && ord.target?.k === 'u') return 'No troops available';
    } else {
      if (!Array.isArray(squads) || !squads.length) return 'Invalid squad';
      const which = new Set(squads.filter((id) => p.squadNum.has(id)));
      chosen = [...this.units.values()].filter((u) => u.owner === pid && which.has(u.sq));
      if (!chosen.length) return 'That squad has no troops left';
    }
    if (ord.target?.k !== 'u' && ord.target?.k !== 'e') p.lastOrder = ord;
    for (const u of chosen) this.applyOrder(u, ord);
    this.lastOrderCount = chosen.length;
    return null;
  },

  // Troops picked out of their squads become a squad of their own (unless they're whole squads).
  splitOff(p, list) {
    const picked = new Set(list.map((u) => u.id));
    const whole = new Set(list.map((u) => u.sq));
    for (const u of this.units.values()) {
      if (u.owner === p.id && whole.has(u.sq) && !picked.has(u.id)) whole.delete(u.sq);
    }
    if (whole.size === 1 && list.every((u) => whole.has(u.sq))) return; // exactly one whole squad
    const sq = this.newSquad(p);
    for (const u of list) u.sq = sq;
    this.pruneSquads();
  },

  // Move troops into squad `sq` (an id, or 'new' for a squad of their own). They take on its order.
  squadAssign(pid, ids, sq) {
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    if (!Array.isArray(ids) || !ids.length) return 'No troops selected';
    const moved = ids.slice(0, C.MAX_UNITS).map((id) => this.units.get(id)).filter((u) => u && u.owner === pid && !u.trade);
    if (!moved.length) return 'No troops selected';
    if (sq === 'new') {
      const id = this.newSquad(p);
      for (const u of moved) u.sq = id;
    } else {
      if (!p.squadNum.has(sq)) return 'Invalid squad';
      const lead = [...this.units.values()].find((u) => u.sq === sq && !moved.includes(u));
      for (const u of moved) {
        u.sq = sq;
        if (lead) this.copyOrder(lead, u);
      }
    }
    this.pruneSquads();
    this.lastOrderCount = moved.length;
    return null;
  },

  // Merge squads into the first one listed; they take on its order.
  squadMerge(pid, squads) {
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    if (!Array.isArray(squads)) return 'Invalid squad';
    const list = squads.filter((id) => p.squadNum.has(id));
    if (list.length < 2) return 'Pick two or more squads to merge';
    const [into, ...rest] = list;
    const from = new Set(rest);
    const lead = [...this.units.values()].find((u) => u.sq === into);
    let n = 0;
    for (const u of this.units.values()) {
      if (u.owner !== pid || !from.has(u.sq)) continue;
      u.sq = into;
      if (lead) this.copyOrder(lead, u);
      n++;
    }
    this.pruneSquads();
    this.lastOrderCount = n;
    return null;
  },

  // What new squads do: 'home' (guard the core) or 'follow' (take your last order).
  setNewWaves(pid, mode) {
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    if (mode !== 'home' && mode !== 'follow') return 'Invalid setting';
    p.newWaves = mode;
    return null;
  },

  copyOrder(from, u) {
    u.attack = from.attack ? { ...from.attack } : null;
    u.anchor = from.anchor;
    u.path = [];
    u.dest = null;
    u.repathAt = 0;
    u.idleUntil = 0;
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
    if (k === 'e') {
      const v = this.units.get(id);
      return v ? { x: v.x, y: v.y } : null;
    }
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
    if (t.k === 'j') return !!this.camps[t.id] && (this.camps[t.id].alive || !!t.wait);
    if (t.k === 'u' || t.k === 'e') return this.units.has(t.id);
    if (t.k === 'p') return true;
    return !!this.players.get(t.owner)?.alive; // tower orders roll on to that player's next structure
  },

  updateWaves() {
    if (this.time >= (this.squadPruneAt || 0)) {
      this.squadPruneAt = this.time + 1;
      this.pruneSquads();
    }
    for (const p of this.players.values()) {
      if (!p.alive || this.time < p.nextWaveAt) continue;
      p.nextWaveAt += C.WAVE_INTERVAL;
      this.spawnWave(p);
    }
  },

  // The core sends BASE_WAVE troops; each barracks sends its BARRACKS_TROOPS from where it stands.
  spawnWave(p) {
    if (!this.orderValid(p.id, p.lastOrder)) p.lastOrder = { type: 'defend', anchor: 0 };
    const ord = p.newWaves === 'follow' ? p.lastOrder : { type: 'defend', anchor: 0 };
    const sq = this.newSquad(p); // this wave marches out as a squad of its own
    let alive = 0; // in wave slots
    for (const u of this.units.values()) if (u.owner === p.id && !u.trade) alive += C.slotsOf(u.kind);
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
      this.spawnTroop(p, kind, from, sq, ord);
      slotAt += n;
      alive += n;
      spawned++;
    }
    if (!spawned) p.squadNum.delete(sq);
    if (spawned) {
      this.fx.push({ k: 'wave', x: p.core.x + 0.5, y: p.core.y + 0.5, o: p.id });
      for (const b of barracks) this.fx.push({ k: 'wave', x: b.x + 0.5, y: b.y + 0.5, o: p.id });
    }
  },

  // Spawn one troop at the core, or at barracks `from`, into squad `sq` (default: a new one).
  spawnTroop(p, kind, from = null, sq = 0, ord = null) {
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
      anchor: 0, attack: null, path: [], dest: null, repathAt: 0, idleUntil: this.time + 0.5, sq: sq || this.newSquad(p),
    };
    this.applyOrder(u, ord || { type: 'defend', anchor: 0 });
    this.units.set(id, u);
    if (this.ucells) this.ucells[this.ucellOf(u.x, u.y)].push(u); // findable before the next grid rebuild
    return u;
  },
};
