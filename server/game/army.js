'use strict';

// The army: up to MAX_SQUADS lasting squads, each with its own troop mix, stance and order; troop
// levels; orders; and reinforcements (every WAVE_INTERVAL seconds every fallen troop respawns and
// marches out to rejoin its squad).
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, UNIT_KEYS } = require('./common');

const HOME = () => ({ type: 'defend', anchor: 0 });

module.exports = {
  // ---- army size and squad mixes

  armySize(p) {
    return C.armySize(p.territory, this.countOwned(p.id, 'barracks'));
  },

  mixSlots(mix) {
    return UNIT_KEYS.reduce((n, k) => n + (mix[k] || 0) * C.slotsOf(k), 0);
  },

  // Troop slots taken by every squad's mix.
  slotsUsed(p) {
    return p.squads.reduce((n, q) => n + this.mixSlots(q.mix), 0);
  },

  // Player p's lasting squads: numbered 1..MAX_SQUADS, each { id, num, mix, stance, order }.
  // Squad 1 starts with START_SQUAD and soldiers for the rest of the army; the others start empty.
  makeSquads(p) {
    p.squads = [];
    p.squadNum = new Map();
    for (let num = 1; num <= C.MAX_SQUADS; num++) {
      const id = this.nextId++;
      const mix = {};
      for (const k of UNIT_KEYS) mix[k] = num === 1 ? C.START_SQUAD[k] || 0 : 0;
      p.squads.push({ id, num, mix, stance: 'defensive', order: HOME() });
      p.squadNum.set(id, num);
    }
    p.armySeen = 0; // army size the mixes were last fitted to (see fitArmy)
  },

  squadOf(p, id) {
    return p.squads.find((q) => q.id === id) || null;
  },

  // Keep the mixes within the army size. When it grows (more land or barracks) the new slots join
  // squad 1 as soldiers; when it shrinks, troops come off the last squads first (soldiers first).
  fitArmy(p) {
    const size = this.armySize(p);
    if (size > p.armySeen) {
      const add = size - Math.max(p.armySeen, this.slotsUsed(p));
      if (add > 0) p.squads[0].mix.soldier += add;
    }
    let over = this.slotsUsed(p) - size;
    for (let i = p.squads.length - 1; i >= 0 && over > 0; i--) {
      const mix = p.squads[i].mix;
      for (const k of ['soldier', ...UNIT_KEYS.filter((x) => x !== 'soldier')]) {
        while (mix[k] > 0 && over > 0) {
          mix[k]--;
          over -= C.slotsOf(k);
        }
      }
    }
    p.armySeen = size;
  },

  // One more (d = 1) or one fewer (d = -1) troop of `kind` in squad `sq`'s mix. With the army
  // full, adding one moves it over from another squad (the biggest that has one, else a soldier from
  // the biggest), and a living troop of that squad walks over to join straight away.
  squadMix(pid, sq, kind, d) {
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    const q = this.squadOf(p, sq);
    if (!q) return 'Invalid squad';
    if (!C.UNITS[kind] || C.UNITS[kind].caravan) return 'Invalid troop type';
    if (d > 0) {
      if (this.slotsUsed(p) + C.slotsOf(kind) > this.armySize(p)) {
        const others = p.squads.filter((o) => o !== q).sort((a, b) => this.mixSlots(b.mix) - this.mixSlots(a.mix));
        let from = others.find((o) => o.mix[kind] > 0);
        let take = kind;
        if (!from) {
          from = others.find((o) => o.mix.soldier > 0);
          take = 'soldier';
        }
        if (!from || C.slotsOf(take) < C.slotsOf(kind)) return 'Your army is full: claim land or build a barracks for more troops';
        from.mix[take]--;
        if (take === kind) this.transferOne(p, from, q, kind);
      }
      q.mix[kind]++;
    } else {
      if (q.mix[kind] <= 0) return 'None to remove';
      q.mix[kind]--;
    }
    return null;
  },

  // If squad `from` now has more living `kind` troops than its mix, one of them joins squad `to`.
  transferOne(p, from, to, kind) {
    const mine = [...this.units.values()].filter((u) => u.owner === p.id && u.sq === from.id && u.kind === kind);
    if (mine.length <= from.mix[kind]) return;
    const u = mine[mine.length - 1];
    u.sq = to.id;
    u.stance = to.stance;
    const lead = [...this.units.values()].find((o) => o.owner === p.id && o.sq === to.id && o !== u && (o.kind !== 'scout' || o.attack));
    if (lead) this.copyOrder(lead, u);
    else this.applyOrder(u, this.orderValid(p.id, to.order) ? to.order : HOME());
  },

  // A squad's stance: 'aggressive' (fights everything on the way), 'defensive' (marches past
  // fights, fights at its target and at home) or 'hold' (never chases: only fights what's in reach).
  squadStance(pid, sq, stance) {
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    const q = this.squadOf(p, sq);
    if (!q) return 'Invalid squad';
    if (!C.STANCES.includes(stance)) return 'Invalid stance';
    q.stance = stance;
    for (const u of this.units.values()) if (u.owner === pid && u.sq === sq) u.stance = stance;
    return null;
  },

  armyLevel(pid, kind) {
    const p = this.players.get(pid);
    if (!p || !p.alive || !C.UNITS[kind] || C.UNITS[kind].caravan) return 'Invalid troop type';
    const level = p.levels[kind];
    if (level >= C.MAX_LEVEL) return 'Already max level';
    const cost = C.armyLevelCost(kind, level);
    if (p.gold < cost) return 'Not enough gold';
    p.gold -= cost;
    p.levels[kind]++;
    return null;
  },

  // ---- orders

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
      if (id === pid) return HOME();
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

  // Order squads at a target. squads: squad ids (null = every squad). ids: troops, whose squads
  // get the order. The order is remembered by each squad: reinforcements head the same way.
  // Returns null on success or an error string; this.lastOrderCount says how many troops moved.
  order(pid, ids, target, squads = null) {
    this.lastOrderCount = 0;
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    const ord = this.makeOrder(pid, target);
    if (typeof ord === 'string') return ord;
    let which;
    if (Array.isArray(ids) && ids.length) {
      which = new Set(ids.slice(0, C.MAX_UNITS).map((id) => this.units.get(id)).filter((u) => u && u.owner === pid && !u.trade).map((u) => u.sq));
      if (!which.size) return 'No troops selected';
    } else if (squads === null || squads === undefined) {
      which = new Set(p.squads.map((q) => q.id));
    } else {
      if (!Array.isArray(squads) || !squads.length) return 'Invalid squad';
      which = new Set(squads.filter((id) => this.squadOf(p, id)));
      if (!which.size) return 'Invalid squad';
    }
    for (const q of p.squads) if (which.has(q.id)) q.order = ord;
    let n = 0;
    for (const u of this.units.values()) {
      if (u.owner !== pid || u.trade || !which.has(u.sq)) continue;
      this.applyOrder(u, ord);
      n++;
    }
    this.lastOrderCount = n;
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

  // Is an order still meaningful?
  orderValid(pid, ord) {
    if (ord.type === 'defend') return !ord.anchor || this.towers.get(ord.anchor)?.owner === pid;
    const t = ord.target;
    if (t.k === 'c') return !!this.players.get(t.id)?.alive;
    if (t.k === 'j') return !!this.camps[t.id] && (this.camps[t.id].alive || !!t.wait);
    if (t.k === 'u' || t.k === 'e') return this.units.has(t.id);
    if (t.k === 'p') return true;
    return !!this.players.get(t.owner)?.alive; // tower orders roll on to that player's next structure
  },

  // Squads whose remembered order no longer makes sense go back to guarding home.
  tidySquadOrders(p) {
    for (const q of p.squads) if (!this.orderValid(p.id, q.order)) q.order = HOME();
  },

  // ---- reinforcements

  updateWaves() {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      this.fitArmy(p);
      if (this.time < p.nextWaveAt) continue;
      p.nextWaveAt += C.WAVE_INTERVAL;
      this.spawnWave(p);
    }
  },

  // How many of each kind squad q is missing (its mix minus its living troops).
  missingOf(p, q) {
    const alive = {};
    for (const u of this.units.values()) if (u.owner === p.id && u.sq === q.id && !u.trade) alive[u.kind] = (alive[u.kind] || 0) + 1;
    const out = [];
    for (const k of UNIT_KEYS) for (let i = alive[k] || 0; i < (q.mix[k] || 0); i++) out.push(k);
    return out;
  },

  // Every fallen troop respawns, taking turns between the core and each barracks, and heads off to
  // rejoin its squad: it takes on the order of a living squadmate, else the squad's own order.
  // Never more troops alive than the army size (extra troops, e.g. defectors, count too).
  spawnWave(p) {
    this.tidySquadOrders(p);
    let room = this.armySize(p);
    for (const u of this.units.values()) if (u.owner === p.id && !u.trade) room -= C.slotsOf(u.kind);
    const barracks = [...this.towers.values()].filter((t) => t.owner === p.id && t.kind === 'barracks')
      .sort((a, b) => a.id - b.id).slice(0, C.MAX_BARRACKS);
    const spots = [null, ...barracks];
    let spawned = 0;
    for (const q of p.squads) {
      const missing = this.missingOf(p, q);
      if (!missing.length) continue;
      const lead = [...this.units.values()].find((u) => u.owner === p.id && u.sq === q.id && !u.trade && (u.kind !== 'scout' || u.attack));
      for (const kind of missing) {
        if (room < C.slotsOf(kind)) break;
        room -= C.slotsOf(kind);
        const u = this.spawnTroop(p, kind, spots[spawned % spots.length], q.id, q.order);
        if (lead) this.copyOrder(lead, u);
        spawned++;
      }
    }
    if (spawned) {
      this.fx.push({ k: 'wave', x: p.core.x + 0.5, y: p.core.y + 0.5, o: p.id });
      for (const b of barracks.slice(0, spawned - 1)) this.fx.push({ k: 'wave', x: b.x + 0.5, y: b.y + 0.5, o: p.id });
    }
  },

  // The squad with the fewest living troops (where extra troops are put).
  smallestSquad(p) {
    const n = new Map(p.squads.map((q) => [q.id, 0]));
    for (const u of this.units.values()) if (u.owner === p.id && n.has(u.sq)) n.set(u.sq, n.get(u.sq) + 1);
    return p.squads.reduce((a, b) => (n.get(b.id) < n.get(a.id) ? b : a));
  },

  // Spawn one troop at the core, or at barracks `from`, into squad `sq` (default: squad 1).
  spawnTroop(p, kind, from = null, sq = 0, ord = null) {
    const id = this.nextId++;
    const level = p.levels[kind];
    const stats = C.towerStats(kind, level);
    const a = this.rand() * Math.PI * 2;
    const ox = from ? from.x : p.core.x;
    const oy = from ? from.y : p.core.y;
    const x = Math.max(0.5, Math.min(this.w - 0.5, ox + 0.5 + Math.cos(a) * (from ? 1 : 1.3)));
    const y = Math.max(0.5, Math.min(this.h - 0.5, oy + 0.5 + Math.sin(a) * (from ? 1 : 1.3)));
    const squad = (sq && this.squadOf(p, sq)) || p.squads[0];
    const u = {
      isUnit: true, id, kind, owner: p.id, x, y, level, hp: stats.hp, maxHp: stats.hp, cd: 0,
      anchor: 0, attack: null, path: [], dest: null, repathAt: 0, idleUntil: this.time + 0.5, sq: squad.id, stance: squad.stance,
    };
    this.applyOrder(u, ord || HOME());
    this.units.set(id, u);
    if (this.ucells) this.ucells[this.ucellOf(u.x, u.y)].push(u); // findable before the next grid rebuild
    return u;
  },
};
