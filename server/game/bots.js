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
      if (!p.alive || !this.hostile(excludeId, p.id) || (skipShielded && this.isShielded(p))) continue;
      // a bot goes after whoever betrayed it first
      const grudge = this.players.get(excludeId)?.bot?.grudge?.has(p.id) ? 0.5 : 1;
      const d = dist(x, y, p.core.x, p.core.y) * grudge;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  },

  // Buy up to n border tiles, nearest the core first (so the land grows round), with a little
  // randomness so bots don't all grow the same way.
  botBuyLand(p, n) {
    const cands = [];
    for (const h of this.hex.hexes) {
      if (!this.canBuyHex(p.id, h.i)) continue;
      cands.push([h.i, Math.hypot(h.cx - p.core.x, h.cy - p.core.y) + this.rand() * 4]);
    }
    cands.sort((a, b) => a[1] - b[1]);
    if (cands.length) this.buyLand(p.id, cands.slice(0, n).map((c) => c[0]));
  },

  botThink(p) {
    const age = this.time - p.spawnTime;
    const structures = [...this.towers.values()].filter((t) => t.owner === p.id);
    const towers = structures.filter((t) => t.kind === 'tower');
    const barracks = structures.filter((t) => t.kind === 'barracks').length;
    const troops = [...this.units.values()].filter((u) => u.owner === p.id && !u.trade);
    const roll = this.rand();

    // Grow: buy land at the border, keeping some gold back for buildings and troops.
    const hexCost = C.landCost(p.territory) * 16; // about one hex
    const keep = 60 + (towers.length < 2 ? C.TOWERS.tower.cost : 0);
    if (p.gold >= keep + hexCost && roll < 0.75) {
      const n = Math.min(2, Math.floor((p.gold - keep) / hexCost));
      this.botBuyLand(p, n);
    }

    // Defend: towers inside the land, towards the border.
    if (towers.length < Math.min(5, 1 + Math.floor(age / 60)) && p.gold >= C.TOWERS.tower.cost + 40 && roll < 0.4) {
      const bases = [p.core, ...towers];
      const base = bases[Math.floor(this.rand() * bases.length)];
      for (let i = 0; i < 30; i++) {
        const ang = this.rand() * Math.PI * 2;
        const r = 3 + this.rand() * 4;
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

    // Trade: with an ally, put up a trade post near the core (the route opens by itself).
    const posts = structures.filter((t) => t.kind === 'trade').length;
    if (posts < 1 && this.alliesOf(p.id).length && p.gold >= C.TOWERS.trade.cost + 60 && roll < 0.5) {
      for (let i = 0; i < 25; i++) {
        const ang = this.rand() * Math.PI * 2;
        const r = 3 + this.rand() * 3;
        const x = Math.round(p.core.x + Math.cos(ang) * r);
        const y = Math.round(p.core.y + Math.sin(ang) * r);
        if (this.inBounds(x, y) && this.build(p.id, x, y, 'trade') === null) break;
      }
      return;
    }

    // One scout per wave until two are out exploring; then those slots go to fighters.
    const scouts = troops.filter((u) => u.kind === 'scout').length;
    if (scouts >= 2 && p.army.scout) this.armyRemove(p.id, 'scout');
    else if (scouts < 2 && !p.army.scout && this.slotsUsed(p) < this.waveSize(p)) this.armyAdd(p.id, 'scout');

    // Shape the wave: assign free slots to a mix of troop types (free), then buy levels.
    const assigned = this.slotsUsed(p);
    if (assigned < this.waveSize(p)) {
      const r = this.rand();
      const kind = r < 0.5 ? 'soldier' : r < 0.7 ? 'medic' : 'archer';
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
    const intruders = [...this.units.values()].filter((u) => this.hostile(p.id, u.owner)
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
      this.order(p.id, strike, target); // picked troops only: squads keep defending home
      return;
    }
  },
};
