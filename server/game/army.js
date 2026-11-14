'use strict';

// The army: up to MAX_SQUADS lasting squads, each raised by a barracks (5 troops per barracks level,
// up to 20), with its own troop mix, stance and order; troop levels; orders; and reinforcements
// (every WAVE_INTERVAL seconds every fallen troop respawns and marches out to rejoin its squad).
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, UNIT_KEYS, dist } = require('./common');

const HOME = () => ({ type: 'defend', anchor: 0 });

module.exports = {
  // ---- squads, their barracks and their mixes

  // The barracks that raises squad q (its highest-level finished one), or null.
  barracksOf(p, q) {
    let best = null;
    for (const t of this.towers.values()) {
      if (t.owner === p.id && t.kind === 'barracks' && t.squad === q.num && !(t.progress < 1) && (!best || t.level > best.level)) best = t;
    }
    return best;
  },

  // Troop slots squad q may use: BARRACKS_TROOPS per level of its barracks (none without one).
  squadCap(p, q) {
    const b = this.barracksOf(p, q);
    return b ? C.squadCap(b.level) : 0;
  },

  // Every squad's slots together.
  armySize(p) {
    return p.squads.reduce((n, q) => n + this.squadCap(p, q), 0);
  },

  mixSlots(mix) {
    return UNIT_KEYS.reduce((n, k) => n + (mix[k] || 0) * C.slotsOf(k), 0);
  },

  // Troop slots taken by every squad's mix.
  slotsUsed(p) {
    return p.squads.reduce((n, q) => n + this.mixSlots(q.mix), 0);
  },

  // The squad number a new barracks of pid's raises: the lowest one without a barracks (0: none).
  freeBarracksSquad(pid, except = null) {
    const used = new Set();
    for (const t of this.towers.values()) if (t !== except && t.owner === pid && t.kind === 'barracks' && t.squad) used.add(t.squad);
    for (let n = 1; n <= C.MAX_SQUADS; n++) if (!used.has(n)) return n;
    return 0;
  },

  // Player p's lasting squads: numbered 1..MAX_SQUADS, each { id, num, mix, stance, order }. They
  // all start empty: a squad gets troops when a barracks raises it.
  makeSquads(p) {
    p.squads = [];
    p.squadNum = new Map();
    for (let num = 1; num <= C.MAX_SQUADS; num++) {
      const id = this.nextId++;
      const mix = {};
      for (const k of UNIT_KEYS) mix[k] = 0;
      p.squads.push({ id, num, mix, stance: 'defensive', order: HOME(), capSeen: 0 });
      p.squadNum.set(id, num);
    }
  },

  squadOf(p, id) {
    return p.squads.find((q) => q.id === id) || null;
  },

  // Keep each squad's mix within what its barracks gives it. When that grows (a new or upgraded
  // barracks) the new slots join the squad as soldiers; when it shrinks (barracks lost), troops come
  // off the mix, soldiers first.
  fitArmy(p) {
    for (const q of p.squads) {
      const cap = this.squadCap(p, q);
      if (cap > q.capSeen) {
        const add = cap - Math.max(q.capSeen, this.mixSlots(q.mix));
        if (add > 0) q.mix.soldier += add;
      }
      let over = this.mixSlots(q.mix) - cap;
      for (const k of ['soldier', ...UNIT_KEYS.filter((x) => x !== 'soldier')]) {
        while (q.mix[k] > 0 && over > 0) {
          q.mix[k]--;
          over -= C.slotsOf(k);
        }
      }
      q.capSeen = cap;
    }
  },

  // One more (d = 1) or one fewer (d = -1) troop of `kind` in squad `sq`'s mix. A full squad swaps
  // soldiers for the new troop instead.
  squadMix(pid, sq, kind, d) {
    const p = this.players.get(pid);
    if (!p || !p.alive) return 'Invalid order';
    const q = this.squadOf(p, sq);
    if (!q) return 'Invalid squad';
    if (!C.UNITS[kind] || !UNIT_KEYS.includes(kind)) return 'Invalid troop type';
    if (d > 0) {
      const cap = this.squadCap(p, q);
      if (!cap) return `Squad ${q.num} has no barracks: build one to raise it`;
      const need = this.mixSlots(q.mix) + C.slotsOf(kind) - cap;
      if (need > 0) {
        if (kind === 'soldier' || q.mix.soldier < need) {
          return q.mix.soldier < need && kind !== 'soldier' ? `Squad ${q.num} is full: take a troop out first` : `Squad ${q.num} is full: upgrade its barracks for more troops`;
        }
        q.mix.soldier -= need; // swap soldiers for it
        for (let i = 0; i < need; i++) this.retireOne(p, q, 'soldier');
      }
      q.mix[kind]++;
    } else {
      if (q.mix[kind] <= 0) return 'None to remove';
      q.mix[kind]--;
    }
    return null;
  },

  // A squad now has more living `kind` troops than its mix: one of them is let go (it walks off).
  retireOne(p, q, kind) {
    const mine = [...this.units.values()].filter((u) => u.owner === p.id && u.sq === q.id && u.kind === kind);
    if (mine.length > q.mix[kind]) this.units.delete(mine[mine.length - 1].id);
  },

  // A squad's stance: 'aggressive' (fights everything on the way; at home it goes out after enemy
  // troops within RAID_RANGE of the border), 'defensive' (stays inside your land and defends it;
  // sending it outside makes it aggressive), 'hold' (never chases: only fights what's in reach) or
  // 'pillage' (hunts barbarian camps on its own, nearest first: see updatePillage).
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
    for (const q of p.squads) {
      if (!which.has(q.id)) continue;
      q.order = ord;
      // sending a pillaging squad anywhere but a camp: it stops pillaging and does as it's told
      if (q.stance === 'pillage' && ord.target?.k !== 'j') this.squadStance(pid, q.id, 'defensive');
      // defensive squads stay inside your land: sending one outside it makes it aggressive
      else if (q.stance === 'defensive' && ord.type === 'attack' && !this.orderAtHome(pid, ord)) this.squadStance(pid, q.id, 'aggressive');
    }
    let n = 0;
    for (const u of this.units.values()) {
      if (u.owner !== pid || u.trade || !which.has(u.sq)) continue;
      this.applyOrder(u, ord);
      n++;
    }
    this.lastOrderCount = n;
    return null;
  },

  // Is where an order sends troops inside pid's land?
  orderAtHome(pid, ord) {
    const at = this.orderPos(pid, ord);
    if (!at) return false;
    const x = Math.floor(at.x);
    const y = Math.floor(at.y);
    return this.inBounds(x, y) && this.terr[this.idx(x, y)] === pid;
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

  // Pillaging squads: about once a second, one that isn't already after a live camp heads for the
  // nearest live camp it has discovered (from where the squad is), or if none is up, the nearest
  // discovered one coming back (it waits there). Camps hidden in fog don't count until they've been
  // seen. And when a camp comes back nearer home than the one a squad is heading for, the squad
  // goes there first (unless it's already fighting at its camp).
  updatePillage(p) {
    if (this.time < (p.pillageAt || 0)) return;
    p.pillageAt = this.time + 1;
    const seen = (c) => !!p.explored[this.idx(c.x, c.y)];
    const home = (c) => dist(p.core.x, p.core.y, c.x, c.y);
    for (const q of p.squads) {
      if (q.stance !== 'pillage') continue;
      const o = q.order;
      const cur = o.type === 'attack' && o.target.k === 'j' ? this.camps[o.target.id] : null;
      if (cur && cur.alive && seen(cur)) {
        const fighting = [...this.creeps.values()].some((m) => m.camp === cur.id && m.angry === p.id);
        const back = !fighting && this.camps.find((c) => c !== cur && c.alive && seen(c) && (c.spawnedAt || 0) > (q.pillageSince || 0) && home(c) < home(cur));
        if (!back) continue;
        this.pillageTo(p, q, back);
        continue;
      }
      const mine = [...this.units.values()].filter((u) => u.owner === p.id && u.sq === q.id);
      const fx = mine.length ? mine.reduce((a, u) => a + u.x, 0) / mine.length : p.core.x + 0.5;
      const fy = mine.length ? mine.reduce((a, u) => a + u.y, 0) / mine.length : p.core.y + 0.5;
      let best = null;
      let bestScore = Infinity;
      for (const c of this.camps) {
        if (!seen(c)) continue;
        const score = dist(fx, fy, c.x + 0.5, c.y + 0.5) + (c.alive ? 0 : 1e4);
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (!best) {
        // no camp discovered yet: wait at home
        if (o.type !== 'defend') {
          q.order = { type: 'defend', anchor: 0 };
          for (const u of mine) this.applyOrder(u, q.order);
        }
        continue;
      }
      if (cur === best) continue;
      this.pillageTo(p, q, best);
    }
  },

  // Send pillaging squad q at camp c.
  pillageTo(p, q, c) {
    const ord = this.makeOrder(p.id, { k: 'j', id: c.id });
    if (typeof ord === 'string') return;
    q.order = ord;
    q.pillageSince = this.time;
    for (const u of this.units.values()) if (u.owner === p.id && u.sq === q.id) this.applyOrder(u, ord);
  },

  updateWaves() {
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      this.fitArmy(p);
      this.updatePillage(p);
      if (this.time < p.nextWaveAt) continue;
      p.nextWaveAt += C.WAVE_INTERVAL;
      this.spawnWave(p);
    }
  },

  // How many of each kind squad q is missing (its mix minus its living troops).
  missingOf(p, q) {
    const alive = {};
    for (const u of this.units.values()) if (u.owner === p.id && u.sq === q.id && !u.trade && !u.worker) alive[u.kind] = (alive[u.kind] || 0) + 1;
    const out = [];
    for (const k of UNIT_KEYS) for (let i = alive[k] || 0; i < (q.mix[k] || 0); i++) out.push(k);
    return out;
  },

  // Every fallen troop respawns, taking turns between the core and each barracks, and heads off to
  // rejoin its squad: it takes on the order of a living squadmate, else the squad's own order.
  // Never more troops alive than the army size (extra troops, e.g. defectors, count too).
  spawnWave(p) {
    this.tidySquadOrders(p);
    this.spawnWorkers(p);
    const barracks = [...this.towers.values()].filter((t) => t.owner === p.id && t.kind === 'barracks' && !(t.progress < 1))
      .sort((a, b) => a.id - b.id).slice(0, C.MAX_BARRACKS);
    const spots = [null, ...barracks];
    let spawned = 0;
    for (const q of p.squads) {
      const missing = this.missingOf(p, q);
      if (!missing.length) continue;
      // never more troops in a squad than its barracks gives it (extra ones, e.g. defectors, count)
      let room = this.squadCap(p, q);
      for (const u of this.units.values()) if (u.owner === p.id && u.sq === q.id && !u.trade && !u.worker) room -= C.slotsOf(u.kind);
      const lead = [...this.units.values()].find((u) => u.owner === p.id && u.sq === q.id && !u.trade && !u.worker);
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
