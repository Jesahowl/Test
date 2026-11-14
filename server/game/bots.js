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

    // With an ally and a tower up, a trade post comes next (saved up for).
    const wantTrade = towers.length >= 1 && this.alliesOf(p.id).length > 0 && !structures.some((t) => t.kind === 'trade');

    // A barracks raises a squad, and there are no troops without one: the first comes before anything.
    const placeBarracks = () => {
      for (let i = 0; i < 25; i++) {
        const ang = this.rand() * Math.PI * 2;
        const r = 2 + this.rand() * 3;
        const x = Math.round(p.core.x + Math.cos(ang) * r);
        const y = Math.round(p.core.y + Math.sin(ang) * r);
        if (this.inBounds(x, y) && this.build(p.id, x, y, 'barracks') === null) return true;
      }
      return false;
    };
    if (!barracks) {
      if (p.gold >= C.buildCost('barracks', 0) && p.wood >= C.TOWERS.barracks.wood) placeBarracks();
      return;
    }

    // The army comes first: more squads (another barracks near the core once a tower or two is up)...
    const bCost = C.buildCost('barracks', barracks);
    if (barracks < C.MAX_BARRACKS && towers.length >= Math.min(2, barracks) && p.gold >= bCost && p.wood >= C.TOWERS.barracks.wood && roll < 0.7) {
      placeBarracks();
      return;
    }
    // ...and bigger squads: upgrade the lowest-level barracks.
    const low = structures.filter((t) => t.kind === 'barracks' && !(t.progress < 1) && t.level < C.maxLevel('barracks')).sort((a, b) => a.level - b.level)[0];
    if (low && p.gold >= C.upgradeCost('barracks', low.level) && roll < 0.7) {
      this.upgrade(p.id, low.id);
      return;
    }
    // (land and towers only get gold beyond what the army's next step needs)
    const armyStep = Math.min(low ? C.upgradeCost('barracks', low.level) : Infinity, barracks < C.MAX_BARRACKS ? bCost : Infinity);

    // Grow: buy land at the border, keeping some gold back for buildings and troops.
    const hexCost = C.landCost(p.territory) * 16; // about one hex
    const keep = 60 + (towers.length < 2 ? C.TOWERS.tower.cost : 0) + (wantTrade ? C.TOWERS.trade.cost : 0) + (Number.isFinite(armyStep) ? armyStep : 0);
    if (p.gold >= keep + hexCost && roll < 0.75) {
      const n = Math.min(2, Math.floor((p.gold - keep) / hexCost));
      this.botBuyLand(p, n);
    }

    // Workers: chop wood first when short of it, and put up a workshop or two for more workers.
    // (short of wood: chopping comes first; plenty of it: farming gold does)
    const gather = p.wood < 90 ? 2 : p.wood > 300 ? 0 : 1;
    const farm = p.wood > 300 ? 2 : 1;
    if (p.jobs.gather !== gather) this.setJobPriority(p.id, 'gather', gather);
    if (p.jobs.farm !== farm) this.setJobPriority(p.id, 'farm', farm);
    const shops = structures.filter((t) => t.kind === 'workshop').length;
    if (towers.length >= 1 && shops < Math.min(C.MAX_WORKSHOPS, 1 + Math.floor(age / 300)) && p.gold >= C.TOWERS.workshop.cost + 60
      && p.wood >= C.TOWERS.workshop.wood && roll < 0.5) {
      for (let i = 0; i < 25; i++) {
        const ang = this.rand() * Math.PI * 2;
        const r = 2 + this.rand() * 3;
        const x = Math.round(p.core.x + Math.cos(ang) * r);
        const y = Math.round(p.core.y + Math.sin(ang) * r);
        if (this.inBounds(x, y) && this.build(p.id, x, y, 'workshop') === null) break;
      }
      return;
    }

    // Trade: with an ally, put up a trade post near the core (the route opens by itself).
    if (wantTrade && p.gold >= C.TOWERS.trade.cost && p.wood >= C.TOWERS.trade.wood && roll < 0.7) {
      for (let i = 0; i < 25; i++) {
        const ang = this.rand() * Math.PI * 2;
        const r = 3 + this.rand() * 3;
        const x = Math.round(p.core.x + Math.cos(ang) * r);
        const y = Math.round(p.core.y + Math.sin(ang) * r);
        if (this.inBounds(x, y) && this.build(p.id, x, y, 'trade') === null) break;
      }
      return;
    }

    // Defend: towers inside the land, towards the border.
    if (!this.suddenDeath() && towers.length < Math.min(5, 1 + Math.floor(age / 60)) && p.gold >= C.TOWERS.tower.cost + 40 + (wantTrade ? C.TOWERS.trade.cost : 0) && p.wood >= C.TOWERS.tower.wood && roll < 0.4) {
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


    // Squads: shape the army (free), then buy levels.
    this.botArmy(p);
    if (p.gold >= 120 && roll < 0.7 && !wantTrade) {
      const kinds = UNIT_KEYS.filter((k) => p.squads.some((q) => q.mix[k] > 0) && p.levels[k] < C.MAX_LEVEL);
      if (kinds.length) this.armyLevel(p.id, kinds[Math.floor(this.rand() * kinds.length)]);
    }

    // Walls on the side facing the nearest enemy, with a gate toward them.
    if (towers.length >= 2 && p.gold >= 150 && p.wood >= 40 && roll < 0.35 && !this.suddenDeath()) this.botWalls(p);

    // Upgrade towers when rich.
    if (p.gold > 400 && towers.length && roll < 0.2) {
      this.upgrade(p.id, towers[Math.floor(this.rand() * towers.length)].id);
    }

    // Orders.
    if (this.time < p.bot.nextOrder) return;
    p.bot.nextOrder = this.time + 8 + this.rand() * 6;
    const [strike, guard, jungle, second] = p.squads;
    const alive = (q) => troops.filter((u) => u.sq === q.id).length;
    const size = (q) => this.mixSlots(q.mix);
    const send = (q, target) => this.order(p.id, null, target, [q.id]);
    // Sudden death: everything goes for the nearest rival's core, even with intruders at home
    // (cores are crumbling: waiting it out only stalls the round).
    if (this.suddenDeath()) {
      const rival = this.nearestEnemy(p.core.x, p.core.y, p.id, true);
      if (rival) {
        this.order(p.id, null, { k: 'c', id: rival.id });
        return;
      }
    }
    const intruders = [...this.units.values()].filter((u) => this.hostile(p.id, u.owner)
      && this.terr[this.idx(Math.floor(u.x), Math.floor(u.y))] === p.id);
    if (intruders.length >= 3) {
      // Strike force and home guard defend whichever of our structures is closest to the intruders.
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
      this.order(p.id, null, anchor, [strike.id, guard.id]);
      return;
    }
    // The home guard stays home.
    if (guard.order.type !== 'defend') send(guard, { k: 'c', id: p.id });
    // The jungle squad farms the nearest camp (it pays well; the warlord's fort is worth a detour).
    if (size(jungle) && (jungle.order.type !== 'attack' || jungle.order.target.k !== 'j' || !this.camps[jungle.order.target.id]?.alive)) {
      const campScore = (c) => dist(c.x, c.y, p.core.x, p.core.y) - (C.BUFF_CAMPS.includes(c.type) ? 8 : 0);
      const camp = this.camps
        .filter((c) => c.alive && dist(c.x, c.y, p.core.x, p.core.y) < BOT_JUNGLE_RANGE)
        .sort((c1, c2) => campScore(c1) - campScore(c2))[0];
      if (camp && alive(jungle) >= Math.min(3, size(jungle))) send(jungle, { k: 'j', id: camp.id });
    }
    // The strike force attacks once it's mostly up to strength, and falls back to regroup when
    // it has been worn down.
    const enemy = this.nearestEnemy(p.core.x, p.core.y, p.id, true);
    if (strike.order.type === 'attack' && alive(strike) < size(strike) * 0.35) {
      this.order(p.id, null, { k: 'c', id: p.id }, [strike.id, second.id]);
    } else if (enemy && strike.order.type === 'defend' && size(strike) && alive(strike) >= size(strike) * 0.75) {
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
      this.order(p.id, null, target, [strike.id, second.id]); // the second strike force goes too
    }
  },

  // A bot's squads: 1 and 4 strike forces (with a siege ram or two once they're big enough), 2 a
  // home guard and 3 a jungle party. Each is mostly soldiers, with archers and a medic or two, and
  // fills whatever its barracks gives it.
  botArmy(p) {
    const mixOf = (n, rams = 0) => {
      const left = n - rams * C.slotsOf('siege');
      const medic = left >= 5 ? Math.max(1, Math.round(left * 0.15)) : 0;
      const archer = Math.round(left * 0.3);
      return { soldier: left - medic - archer, medic, archer, siege: rams };
    };
    p.squads.forEach((q, i) => {
      const n = this.squadCap(p, q);
      const strike = i === 0 || i === 3;
      Object.assign(q.mix, mixOf(n, strike ? (n >= 15 ? 2 : n >= 10 ? 1 : 0) : 0));
    });
    if (!p.bot.stances) {
      p.bot.stances = true;
      this.squadStance(p.id, p.squads[2].id, 'aggressive');
    }
  },

  // Wall the stretch of border facing the nearest enemy (a few segments at a time), and make sure
  // one of those walls, the one straight toward them, is a gate.
  botWalls(p) {
    const enemy = this.nearestEnemy(p.core.x, p.core.y, p.id, false);
    if (!enemy) return;
    const ex = enemy.core.x - p.core.x;
    const ey = enemy.core.y - p.core.y;
    const el = Math.hypot(ex, ey) || 1;
    const facing = (h) => {
      const dx = h.cx - p.core.x;
      const dy = h.cy - p.core.y;
      return (dx * ex + dy * ey) / ((Math.hypot(dx, dy) || 1) * el);
    };
    const cands = [];
    for (const h of this.hex.hexes) {
      if (this.hexOwner[h.i] !== p.id) continue;
      for (const j of h.n) {
        if (!this.canWallEdge(p.id, h.i, j)) continue;
        const f = facing(this.hex.hexes[j]);
        if (f > 0.55) cands.push([h.i, j, f]);
      }
    }
    let mine = [...this.walls.values()].filter((w) => w.owner === p.id);
    const room = C.BOT_MAX_WALLS - mine.length;
    if (cands.length && room > 0) {
      cands.sort((x, y) => y[2] - x[2]);
      this.buildWalls(p.id, cands.slice(0, Math.min(6, room)).map(([i, j]) => [i, j]));
      mine = [...this.walls.values()].filter((w) => w.owner === p.id);
    }
    // gates: the walls most straight toward the enemy, so its own waves get out
    const gates = mine.filter((w) => w.gate).length;
    if (mine.length >= 3 && gates < C.BOT_GATES && p.gold >= C.WALL_GATE_COST) {
      const shut = mine.filter((w) => !w.gate);
      const best = shut.reduce((x, y) => (facing(x) > facing(y) ? x : y));
      this.toggleGate(p.id, best.id);
    }
  },
};
