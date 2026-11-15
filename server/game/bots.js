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
      const [base, spread] = this.botLevel.think;
      p.bot.next = this.time + base + this.rand() * spread;
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
      const n = Math.min(p.gold > keep + hexCost * 4 ? 3 : 2, Math.floor((p.gold - keep) / hexCost));
      this.botBuyLand(p, n);
    }

    // Workers: chop wood first when short of it, and put up a workshop or two for more workers.
    // (short of wood: chopping comes first; plenty of it: farming gold does)
    const gather = p.wood < 90 ? 3 : p.wood > 300 ? 0 : 2;
    const farm = p.wood > 300 ? 2 : 1;
    if (p.jobs.gather !== gather) this.setJobPriority(p.id, 'gather', gather);
    if (p.jobs.farm !== farm) this.setJobPriority(p.id, 'farm', farm);
    // iron for troop levels: mine it while short
    const mine = (p.iron || 0) < 60 ? 2 : (p.iron || 0) > 200 ? 0 : 1;
    if (p.jobs.mine !== mine) this.setJobPriority(p.id, 'mine', mine);
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

    // Defend: towers on the side facing the enemies, spread out along the border.
    const maxTowers = p.gold > 700 ? 7 : 5; // (a surplus buys a couple more)
    if (!this.suddenDeath() && towers.length < Math.min(maxTowers, 1 + Math.floor(age / 60)) && p.gold >= C.TOWERS.tower.cost + 40 + (wantTrade ? C.TOWERS.trade.cost : 0) && p.wood >= C.TOWERS.tower.wood && roll < 0.4) {
      this.botPlaceTower(p, towers);
      return;
    }


    // Squads: shape the army (free), then buy levels.
    this.botArmy(p);
    if (p.gold >= 120 && (roll < 0.7 || p.gold > 350) && !wantTrade) {
      // the troop kinds the army has most of (by slots), weighted
      const use = {};
      for (const q of p.squads) for (const k of UNIT_KEYS) use[k] = (use[k] || 0) + (q.mix[k] || 0) * C.slotsOf(k);
      const kinds = UNIT_KEYS.filter((k) => use[k] > 0 && p.levels[k] < C.MAX_LEVEL && (p.iron || 0) >= C.armyLevelIron(k, p.levels[k]));
      const total = kinds.reduce((t, k) => t + use[k] / (1 + p.levels[k]), 0);
      let pick = this.rand() * total;
      for (const k of kinds) {
        pick -= use[k] / (1 + p.levels[k]);
        if (pick <= 0) {
          this.armyLevel(p.id, k);
          break;
        }
      }
    }

    // Walls on the side facing the nearest enemy, with a gate toward them.
    if (towers.length >= 2 && p.gold >= 150 && p.wood >= 40 && roll < 0.35 && !this.suddenDeath()) this.botWalls(p);

    // Upgrade towers when rich: the one nearest the enemy first.
    if (p.gold > 300 && towers.length && (roll < 0.25 || p.gold > 600)) {
      const enemy = this.nearestEnemy(p.core.x, p.core.y, p.id, false);
      const front = towers.filter((t) => !(t.progress < 1) && t.level < C.maxLevel('tower'))
        .sort((a, b) => (enemy ? dist(a.x, a.y, enemy.core.x, enemy.core.y) - dist(b.x, b.y, enemy.core.x, enemy.core.y) : a.level - b.level))[0];
      if (front) this.upgrade(p.id, front.id);
    }

    // Orders.
    if (this.time < p.bot.nextOrder) return;
    p.bot.nextOrder = this.time + this.botLevel.orders[0] + this.rand() * this.botLevel.orders[1];
    const [strike, guard, jungle, second] = p.squads;
    const alive = (q) => troops.filter((u) => u.sq === q.id).length;
    const size = (q) => this.mixSlots(q.mix);
    const send = (q, target) => this.order(p.id, null, target, [q.id]);
    // Sudden death: everything goes for the nearest rival's core, even with intruders at home
    // (cores are crumbling: waiting it out only stalls the round).
    if (this.suddenDeath()) {
      // (the weakest reachable rival: finish someone off)
      const rival = this.botPickEnemy(p, troops.reduce((t, u) => t + (u.worker ? 0 : this.botUnitPower(u)), 0)) || this.nearestEnemy(p.core.x, p.core.y, p.id, true);
      if (rival) {
        this.order(p.id, null, { k: 'c', id: rival.id });
        return;
      }
    }
    this.botOrders(p, troops, towers);
  },

  // ---- judging fights: a troop's or building's strength is about sqrt(HP x damage per second)
  // (Lanchester: armies scale with numbers squared), summed over a group.
  botUnitPower(u) {
    const st = C.towerStats(u.kind, u.level || 1);
    return Math.sqrt(Math.max(1, u.hp) * (st.damage * st.rate + st.heal * 0.6 + 2));
  },

  botStructPower(t) {
    const st = C.towerStats(t.kind, t.level);
    return st.damage ? 1.4 * Math.sqrt(t.hp * st.damage * st.rate) : 0; // (they don't move, but they hit hard)
  },

  // Strength of pid's troops within r of (x, y), and of their towers (and core) covering it.
  botDefence(pid, x, y, r) {
    let troops = 0;
    for (const u of this.nearUnits(x, y, r)) if (u.owner === pid && !u.worker && !u.trade && dist(u.x, u.y, x, y) <= r) troops += this.botUnitPower(u);
    let guns = 0;
    for (const t of this.towers.values()) {
      if (t.owner !== pid || t.progress < 1) continue;
      if (dist(t.x, t.y, x, y) <= C.towerStats(t.kind, t.level).range + 3) guns += this.botStructPower(t);
    }
    const q = this.players.get(pid);
    if (q && q.alive && dist(q.core.x, q.core.y, x, y) <= C.CORE_RANGE + 3) guns += 1.4 * Math.sqrt(q.core.hp * C.CORE_DAMAGE * C.CORE_RATE) * 0.5;
    return { troops, guns, total: troops + guns };
  },

  // Which rival to go after: near, weakly defended (compared with my strike force), with its army
  // away or its core worn down. Sticks with its pick unless another is clearly better.
  botPickEnemy(p, power) {
    let best = null;
    let bestScore = Infinity;
    let cur = null;
    let curScore = Infinity;
    for (const q of this.players.values()) {
      if (!q.alive || !this.hostile(p.id, q.id) || this.isShielded(q)) continue;
      const d = dist(p.core.x, p.core.y, q.core.x, q.core.y);
      const def = this.botDefence(q.id, q.core.x, q.core.y, 16).total;
      let score = d + 35 * (def / (power + 50)) - 20 * (1 - q.core.hp / q.core.maxHp);
      if (p.bot.grudge && p.bot.grudge.has(q.id)) score *= 0.6; // whoever betrayed it
      // gang up: an enemy an ally's strike force is already attacking
      for (const aid of this.alliesOf(p.id)) {
        const ally = this.players.get(aid);
        const o = ally && ally.squads && ally.squads[0] && ally.squads[0].order;
        if (o && o.type === 'attack' && o.target && ((o.target.k === 'c' && o.target.id === q.id) || (o.target.k === 't' && this.towers.get(o.target.id)?.owner === q.id))) score *= 0.7;
      }
      if (score < bestScore) {
        bestScore = score;
        best = q;
      }
      if (q.id === p.bot.target) {
        cur = q;
        curScore = score;
      }
    }
    if (cur && curScore <= bestScore * 1.3) return cur;
    if (best) p.bot.target = best.id;
    return best;
  },

  // What to hit in that rival's base: its core when it's lightly held, else the building on our
  // side of it with the least cover.
  botPickObjective(p, enemy, power) {
    const coreDef = this.botDefence(enemy.id, enemy.core.x, enemy.core.y, 10).total;
    if (power > coreDef * 1.3) return { k: 'c', id: enemy.id };
    let best = null;
    let bestScore = Infinity;
    for (const t of this.towers.values()) {
      if (t.owner !== enemy.id) continue;
      const cover = this.botDefence(enemy.id, t.x, t.y, 8).total;
      const score = dist(p.core.x, p.core.y, t.x, t.y) * 0.5 + cover / (power + 50) * 40;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best ? { k: 't', id: best.id } : { k: 'c', id: enemy.id };
  },

  botOrders(p, troops, towers) {
    const [strike, guard, jungle, second] = p.squads;
    const alive = (q) => troops.filter((u) => u.sq === q.id).length;
    const size = (q) => this.mixSlots(q.mix);
    const send = (q, target) => this.order(p.id, null, target, [q.id]);
    const powerOf = (list) => list.reduce((t, u) => t + this.botUnitPower(u), 0);
    const strikeTroops = troops.filter((u) => u.sq === strike.id || u.sq === second.id);
    const strikePower = powerOf(strikeTroops);
    const L = this.botLevel;

    // Intruders on my land: the home guard deals with raids; the strike force comes back only
    // when the guard and my towers can't hold them (and they're near something that matters).
    const intruders = [...this.units.values()].filter((u) => this.hostile(p.id, u.owner) && !u.trade && !u.worker
      && this.terr[this.idx(Math.floor(u.x), Math.floor(u.y))] === p.id);
    if (intruders.length) {
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
      const threat = powerOf(intruders);
      const guardPower = powerOf(troops.filter((u) => u.sq === guard.id));
      const mine = this.botDefence(p.id, cx, cy, 6).guns;
      const key = (o) => (o.type === 'defend' ? `d${o.anchor || 0}` : 'a');
      if (key(guard.order) !== `d${anchor.k === 't' ? anchor.id : 0}`) send(guard, anchor);
      if (threat > (guardPower + mine) * 0.8 || (bestD < 10 && threat > guardPower * 0.6)) {
        this.order(p.id, null, anchor, [strike.id, second.id]);
        p.bot.attackSince = 0;
        return;
      }
    } else if (guard.order.type !== 'defend' || guard.order.anchor) send(guard, { k: 'c', id: p.id }); // the home guard stays home

    // The jungle squad farms the nearest camp (it pays well; the warlord's fort is worth a detour),
    // unless it's pillaging (then it picks camps itself).
    if (size(jungle) && jungle.stance !== 'pillage' && (jungle.order.type !== 'attack' || jungle.order.target.k !== 'j' || !this.camps[jungle.order.target.id]?.alive)) {
      const campScore = (c) => dist(c.x, c.y, p.core.x, p.core.y) - (C.BUFF_CAMPS.includes(c.type) ? 8 : 0);
      const camp = this.camps
        .filter((c) => c.alive && dist(c.x, c.y, p.core.x, p.core.y) < BOT_JUNGLE_RANGE)
        .sort((c1, c2) => campScore(c1) - campScore(c2))[0];
      if (camp && alive(jungle) >= Math.min(3, size(jungle))) send(jungle, { k: 'j', id: camp.id });
    }

    // The strike forces (squads 1 and 4).
    const full = size(strike) + size(second);
    const up = alive(strike) + alive(second);
    if (!full) return;
    if (strike.order.type === 'attack') {
      // At the front: fall back if worn down, or if what it's fighting there is clearly stronger.
      const fx = strikeTroops.reduce((t, u) => t + u.x, 0) / (strikeTroops.length || 1);
      const fy = strikeTroops.reduce((t, u) => t + u.y, 0) / (strikeTroops.length || 1);
      let against = 0;
      for (const q of this.players.values()) if (q.alive && this.hostile(p.id, q.id)) against += this.botDefence(q.id, fx, fy, 9).total;
      // (outmatched there and already worn down: pull back and regroup)
      const losing = strikeTroops.length && against > strikePower * 1.6 && up < full * 0.65;
      if (up < full * L.retreatAt || losing) {
        this.order(p.id, null, { k: 'c', id: p.id }, [strike.id, second.id]);
        p.bot.attackSince = 0;
        return;
      }
      // still going: point at the best thing to hit there (the base itself once it's weak)
      const enemy = this.players.get(p.bot.target);
      if (enemy && enemy.alive && strike.order.target && strike.order.target.k === 't' && !this.towers.has(strike.order.target.id)) {
        this.order(p.id, null, this.botPickObjective(p, enemy, strikePower), [strike.id, second.id]);
      }
      return;
    }
    // At home: attack once strong enough to win (or it has waited long enough at full strength).
    if (up < full * L.attackAt) {
      p.bot.readySince = 0;
      return;
    }
    if (!p.bot.readySince) p.bot.readySince = this.time;
    const enemy = this.botPickEnemy(p, strikePower);
    if (!enemy) return;
    const def = this.botDefence(enemy.id, enemy.core.x, enemy.core.y, 16).total;
    const waited = this.time - p.bot.readySince > 60;
    if (strikePower >= def * (L.attackAt < 0.7 ? 0.75 : 0.95) || waited) {
      this.order(p.id, null, this.botPickObjective(p, enemy, strikePower), [strike.id, second.id]);
      p.bot.readySince = 0;
    }
  },

  // Put a tower up on the border facing the nearest enemy, away from my other towers.
  botPlaceTower(p, towers) {
    const enemy = this.nearestEnemy(p.core.x, p.core.y, p.id, false);
    const ex = enemy ? enemy.core.x - p.core.x : 0;
    const ey = enemy ? enemy.core.y - p.core.y : 0;
    const el = Math.hypot(ex, ey) || 1;
    const bh = this.buildingHexes();
    const spots = [];
    for (const h of this.hex.hexes) {
      if (this.hexOwner[h.i] !== p.id || bh[h.i] || h.centre < 0 || !h.full) continue;
      const dx = h.cx - p.core.x;
      const dy = h.cy - p.core.y;
      const d = Math.hypot(dx, dy) || 1;
      const facing = enemy ? (dx * ex + dy * ey) / (d * el) : 0;
      const border = h.n.some((j) => this.hexOwner[j] !== p.id) ? 1 : 0;
      let crowd = 0;
      for (const t of towers) if (dist(t.x, t.y, h.cx, h.cy) < 6) crowd++;
      spots.push([h, facing * 6 + border * 2 - Math.abs(d - 8) * 0.4 - crowd * 4 + this.rand() * 2]);
    }
    spots.sort((x, y) => y[1] - x[1]);
    for (const [h] of spots.slice(0, 5)) {
      if (this.build(p.id, h.centre % this.w, Math.floor(h.centre / this.w), 'tower') === null) return true;
    }
    return false;
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
      this.squadStance(p.id, p.squads[2].id, 'pillage'); // squad 3 farms the camps on its own
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
