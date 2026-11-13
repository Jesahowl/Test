'use strict';

// Computer-controlled players.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, BOT_NAMES, UNIT_KEYS, BOT_JUNGLE_RANGE, dist } = require('./common');

module.exports = {
  updateBots() {
    let humans = 0;
    let bots = 0;
    for (const p of this.players.values()) {
      if (p.isBot) bots++;
      else humans++;
    }
    const desired = Math.max(0, this.botTarget - humans);
    if (bots < desired && this.time >= this.botSpawnAt && this.canJoin()) {
      const used = new Set([...this.players.values()].map((p) => p.name));
      const free = BOT_NAMES.filter((n) => !used.has(n));
      const name = free.length ? free[Math.floor(this.rand() * free.length)] : 'Bot';
      this.addPlayer(name, true);
      this.botSpawnAt = this.time + 4;
    }

    for (const p of this.players.values()) {
      if (!p.isBot || !p.alive || this.time < p.bot.next) continue;
      p.bot.next = this.time + 0.8 + this.rand() * 0.8;
      this.botThink(p);
    }
  },

  nearestEnemy(x, y, excludeId, skipShielded = false) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.players.values()) {
      if (!p.alive || p.id === excludeId || (skipShielded && this.isShielded(p))) continue;
      const d = dist(x, y, p.core.x, p.core.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  },

  botThink(p) {
    const age = this.time - p.spawnTime;
    const structures = [...this.towers.values()].filter((t) => t.owner === p.id);
    const towers = structures.filter((t) => t.kind === 'tower');
    const barracks = structures.length - towers.length;
    const troops = [...this.units.values()].filter((u) => u.owner === p.id);
    const roll = this.rand();

    // Expand: leapfrog towers outward from the core or an existing tower.
    if (towers.length < Math.min(5, 1 + Math.floor(age / 45)) && p.gold >= C.TOWERS.tower.cost + 40 && roll < 0.4) {
      const bases = [p.core, ...towers];
      const base = bases[Math.floor(this.rand() * bases.length)];
      for (let i = 0; i < 25; i++) {
        const ang = this.rand() * Math.PI * 2;
        const r = 5 + this.rand() * 3;
        const x = Math.round(base.x + Math.cos(ang) * r);
        const y = Math.round(base.y + Math.sin(ang) * r);
        if (this.inBounds(x, y) && this.build(p.id, x, y, 'tower') === null) break;
      }
      return;
    }

    // Bigger waves: build barracks near the core once a couple of towers are up.
    const bCost = C.buildCost('barracks', barracks);
    if (barracks < C.MAX_BARRACKS && towers.length >= Math.min(2, 1 + barracks) && p.gold >= bCost && roll < 0.6) {
      for (let i = 0; i < 25; i++) {
        const ang = this.rand() * Math.PI * 2;
        const r = 2 + this.rand() * 3;
        const x = Math.round(p.core.x + Math.cos(ang) * r);
        const y = Math.round(p.core.y + Math.sin(ang) * r);
        if (this.inBounds(x, y) && this.build(p.id, x, y, 'barracks') === null) break;
      }
      return;
    }

    // Shape the wave: assign free slots to a mix of troop types (free), then buy levels.
    const assigned = this.slotsUsed(p);
    if (assigned < this.waveSize(p)) {
      const r = this.rand();
      const kind = !p.army.scout ? 'scout' : r < 0.5 ? 'soldier' : r < 0.7 ? 'medic' : 'archer';
      this.armyAdd(p.id, kind);
    } else if (p.gold >= 120 && roll < 0.7) {
      const kinds = UNIT_KEYS.filter((k) => p.army[k] > 0 && p.levels[k] < C.MAX_LEVEL);
      if (kinds.length) this.armyLevel(p.id, kinds[Math.floor(this.rand() * kinds.length)]);
    }

    // Upgrade towers when rich.
    if (p.gold > 400 && towers.length && roll < 0.2) {
      this.upgrade(p.id, towers[Math.floor(this.rand() * towers.length)].id);
    }

    // Orders.
    if (this.time < p.bot.nextOrder) return;
    p.bot.nextOrder = this.time + 8 + this.rand() * 6;
    const intruders = [...this.units.values()].filter((u) => u.owner !== p.id
      && this.terr[this.idx(Math.floor(u.x), Math.floor(u.y))] === p.id);
    if (intruders.length >= 3) {
      // Defend whichever of our structures is closest to the intruders.
      const cx = intruders.reduce((sum, u) => sum + u.x, 0) / intruders.length;
      const cy = intruders.reduce((sum, u) => sum + u.y, 0) / intruders.length;
      let anchor = { k: 'c', id: p.id };
      let bestD = dist(cx, cy, p.core.x, p.core.y);
      for (const t of towers) {
        const d = dist(cx, cy, t.x, t.y);
        if (d < bestD) {
          bestD = d;
          anchor = { k: 't', id: t.id };
        }
      }
      this.order(p.id, null, anchor);
      return;
    }
    // Keep a small squad farming the nearest jungle camp (it pays well).
    let home = troops.filter((u) => !u.attack);
    const jungling = troops.some((u) => u.attack && u.attack.k === 'j');
    if (!jungling && home.length >= 4) {
      const campScore = (c) => dist(c.x, c.y, p.core.x, p.core.y) - (C.BUFF_CAMPS.includes(c.type) ? 8 : 0);
      const camp = this.camps
        .filter((c) => c.alive && dist(c.x, c.y, p.core.x, p.core.y) < BOT_JUNGLE_RANGE)
        // The warlord's fort is worth a detour: it gives the jungle buff.
        .sort((c1, c2) => campScore(c1) - campScore(c2))[0];
      if (camp) {
        const squad = home.slice(0, Math.max(3, Math.round(home.length * C.BOT_JUNGLE_SHARE)));
        this.order(p.id, squad.map((u) => u.id), { k: 'j', id: camp.id });
        home = home.filter((u) => !squad.includes(u));
      }
    }

    // Attack with a strike force, keeping new waves at home to defend.
    const enemy = this.nearestEnemy(p.core.x, p.core.y, p.id, true);
    if (enemy && this.suddenDeath()) {
      // Sudden death: everything, including new waves, goes for the nearest rival's core.
      this.order(p.id, null, { k: 'c', id: enemy.id });
      return;
    }
    if (enemy && home.length >= Math.max(8, C.unitCap(p.territory, this.waveSize(p)) * 0.5)) {
      let target = { k: 'c', id: enemy.id };
      let bestD = Infinity;
      for (const t of this.towers.values()) {
        if (t.owner !== enemy.id) continue;
        const d = dist(p.core.x, p.core.y, t.x, t.y);
        if (d < bestD) {
          bestD = d;
          target = { k: 't', id: t.id };
        }
      }
      const strike = home.slice(0, Math.ceil(home.length * C.BOT_STRIKE_SHARE)).map((u) => u.id);
      this.order(p.id, strike, target);
      p.order = { type: 'defend', anchor: 0 };
      return;
    }
  },
};
