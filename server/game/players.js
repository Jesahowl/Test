'use strict';

// Players joining, spawning and leaving; rounds (join window, pacing, standings); gold.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, UNIT_KEYS, dist, round2, sanitizeName } = require('./common');

module.exports = {
  // The colour slot furthest from everyone else's: the first free one in HUE_ORDER (starting at
  // a random place each game), in the normal tone, then paler, then deeper.
  pickColour() {
    // (Math.random, not this.rand: colours shouldn't shift the seeded game sequence)
    if (this.hueStart === undefined) this.hueStart = Math.floor(Math.random() * C.PLAYER_HUES.length);
    const used = new Set();
    for (const q of this.players.values()) if (q.alive) used.add(`${q.hue}:${q.tone}`);
    const n = C.PLAYER_HUES.length;
    for (let tone = 0; tone < 3; tone++) {
      for (const k of C.HUE_ORDER) {
        const hue = C.PLAYER_HUES[(k + this.hueStart) % n];
        if (!used.has(`${hue}:${tone}`)) return { hue, tone };
      }
    }
    return { hue: Math.floor(this.rand() * 360), tone: 0 };
  },

  addPlayer(name, isBot = false) {
    if (this.players.size >= C.MAX_PLAYERS) return null;
    const pos = this.findSpawn();
    if (!pos) return null;
    const id = this.nextId++;
    const levels = {};
    for (const k of UNIT_KEYS) levels[k] = 1;
    const p = {
      isPlayer: true,
      id,
      name: sanitizeName(name),
      isBot,
      alive: true,
      ...this.pickColour(),
      gold: C.START_GOLD,
      core: { x: pos.x, y: pos.y, hp: C.CORE_HP, maxHp: C.CORE_HP, cd: 0 },
      territory: 0,
      peakTerritory: 0,
      kills: 0,
      coresDestroyed: 0,
      towersDestroyed: 0,
      earned: { income: 0, troops: 0, camps: 0, towers: 0, cores: 0, trade: 0 }, // gold by source
      spawnTime: this.time,
      buffUntil: 0, // jungle buff active until this time
      vis: new Uint8Array(this.w * this.h), // fog of war: what this player sees now
      explored: new Uint8Array(this.w * this.h), // ...and everywhere they have seen
      levels,
      nextWaveAt: this.time + C.FIRST_WAVE_DELAY,
      bot: isBot ? { next: this.time + 1, nextOrder: this.time + 10 } : null,
    };
    this.makeSquads(p); // squads 1-4 (see army.js)
    this.players.set(id, p);
    this.roster.set(id, { id, name: p.name, hue: p.hue, tone: p.tone, isBot, place: 0, left: false, survived: 0, peakTerritory: 0,
      kills: 0, towersDestroyed: 0, coresDestroyed: 0, gold: 0 });
    this.grid[this.idx(pos.x, pos.y)] = -id;
    this.claimStart(p);
    this.structVersion++;
    this.pushFeed(`${p.name} joined the siege`);
    return p;
  },

  // Where a new core goes: random, but as far as possible from everyone else. We sample many
  // random open spots, score each by its distance to the nearest core (or other player's building),
  // and pick at random among the best few, so bases spread evenly over the map without the
  // same layout every game.
  findSpawn() {
    const margin = C.SPAWN_MARGIN;
    const others = [];
    for (const p of this.players.values()) if (p.alive) others.push({ x: p.core.x, y: p.core.y, w: 0 });
    for (const t of this.towers.values()) if (t.owner) others.push({ x: t.x, y: t.y, w: C.CORE_CLAIM });
    const cands = [];
    for (let i = 0; i < C.SPAWN_CANDIDATES; i++) {
      // a random spot, moved to the centre of its hex (cores stand at hex centres)
      const hx = this.hex.hexes[this.hexAt(margin + Math.floor(this.rand() * (this.w - margin * 2)), margin + Math.floor(this.rand() * (this.h - margin * 2)))];
      if (hx.centre < 0 || !hx.full) continue;
      const k = hx.centre;
      const x = k % this.w;
      const y = (k - x) / this.w;
      if (this.grid[k] !== 0 || this.hexOwner[hx.i] || hx.n.some((j) => this.hexOwner[j])) continue;
      if (this.camps.some((c) => c.alive && dist(x, y, c.x, c.y) < 7)) continue;
      let score = Infinity; // distance to the nearest base (buildings count as a bit closer than they are)
      for (const o of others) score = Math.min(score, dist(x, y, o.x, o.y) - o.w);
      cands.push({ x, y, score });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score);
    if (cands[0].score < C.CORE_CLAIM * 2) return null; // no room left
    // Any of the top few that are nearly as good as the best.
    const good = cands.filter((c, i) => i < 3 && c.score >= cands[0].score * 0.95);
    const pick = good[Math.floor(this.rand() * good.length)];
    return { x: pick.x, y: pick.y };
  },

  // Whether new players may join right now.
  canJoin() {
    return !this.rounds || (this.phase === 'playing' && this.time < C.ROUND_JOIN_WINDOW);
  },

  humansAlive() {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot && p.alive) n++;
    return n;
  },

  // Pacing (rounds only): cores are fortified early on, so nobody is knocked out in the first
  // minutes, and troops hit buildings gradually harder as the round goes on.
  coreArmor() {
    return this.rounds && this.time < C.CORE_FORTIFY_TIME ? C.CORE_FORTIFY : 0;
  },

  siegeRamp() {
    if (!this.rounds) return 1;
    return 1 + Math.max(0, this.time - C.SIEGE_RAMP_START) / 60 * C.SIEGE_RAMP_PER_MIN;
  },

  suddenDeath() {
    return this.rounds && this.time >= C.ROUND_SUDDEN_DEATH;
  },

  buffed(pid) {
    const p = this.players.get(pid);
    return !!p && p.buffUntil > this.time;
  },

  // Copy a player's numbers into the round standings.
  recordStanding(p, place, left = false) {
    const r = this.roster.get(p.id);
    if (!r) return;
    Object.assign(r, {
      place, left, survived: Math.round(this.time - p.spawnTime), peakTerritory: p.peakTerritory, kills: p.kills,
      towersDestroyed: p.towersDestroyed, coresDestroyed: p.coresDestroyed,
      gold: Math.round(Object.values(p.earned).reduce((a, b) => a + b, 0)),
    });
  },

  // Final standings: winner first, then by how long each player lasted; players who left go last.
  standings() {
    return [...this.roster.values()].sort((a, b) => (a.left - b.left) || ((a.place || 99) - (b.place || 99)));
  },

  // Last core standing: once joining has closed and at most one core is left, the round is over.
  checkRoundOver() {
    if (!this.rounds || this.phase !== 'playing' || this.time < C.ROUND_JOIN_WINDOW) return;
    const alive = [...this.players.values()].filter((p) => p.alive);
    if (alive.length > 1) return;
    this.phase = 'over';
    const w = alive[0];
    if (w) {
      this.recordStanding(w, 1);
      this.winner = { id: w.id, name: w.name, hue: w.hue };
      this.pushFeed(`${w.name} is the last core standing and wins round ${this.round}!`);
    }
  },

  // End the round now (e.g. a private room where no humans are left): the players still standing
  // are ranked by land.
  endRound() {
    if (this.phase !== 'playing') return;
    const alive = [...this.players.values()].filter((p) => p.alive).sort((a, b) => b.territory - a.territory);
    alive.forEach((p, i) => this.recordStanding(p, i + 1));
    this.phase = 'over';
    const w = alive[0];
    this.winner = w ? { id: w.id, name: w.name, hue: w.hue } : null;
    if (w) this.pushFeed(`${w.name} holds the most land and wins round ${this.round}!`);
  },

  // Removes a player (disconnect) - their base turns into ruins like a death.
  removePlayer(id) {
    const p = this.players.get(id);
    if (p) this.killPlayer(p, null, true);
  },

  // A human left mid-round: a bot takes over their base (core, land, gold, buildings and troops)
  // under the same name and plays on, so nobody's empire just vanishes.
  playerLeft(id) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    if (p.isBot) {
      this.removePlayer(id);
      return;
    }
    p.isBot = true;
    p.bot = { next: this.time + 1, nextOrder: this.time + 4 };
    const r = this.roster.get(id);
    if (r) r.isBot = true;
    this.pushFeed(`${p.name} left: a bot takes over their base`);
  },

  // Newly spawned players' cores and towers can't be damaged for SPAWN_SHIELD seconds.
  isShielded(p) {
    return !!p && this.time - p.spawnTime < C.SPAWN_SHIELD;
  },

  // A core has fallen (or its player left). The player is out of the game. If another player
  // destroyed it, they take the spoils: all the victim's gold (plus a bounty), all of their land,
  // towers and barracks, every troop the victim still had standing, and a new tower where the core
  // stood, garrisoned by those troops. Otherwise their land opens up and their towers fall to ruins.
  killPlayer(p, killerId, leftGame = false) {
    if (!p.alive) return;
    this.recordStanding(p, this.players.size, leftGame);
    p.alive = false;
    const coreIdx = this.idx(p.core.x, p.core.y);
    this.grid[coreIdx] = 0;
    this.fx.push({ k: 'coreDown', x: p.core.x + 0.5, y: p.core.y + 0.5 });

    const killer = killerId ? this.players.get(killerId) : null;
    const conquered = !!(killer && killer.alive && killer.id !== p.id);

    // Their towers and barracks: the conqueror's (otherwise they fall to ruins).
    let towersTaken = 0;
    for (const t of this.towers.values()) {
      if (t.owner !== p.id) continue;
      if (conquered) {
        t.owner = killer.id;
        towersTaken++;
        this.fx.push({ k: 'capture', x: t.x + 0.5, y: t.y + 0.5, o: killer.id });
      } else {
        this.ruinTower(t, p.name);
      }
    }
    // Their walls go with their land (to the conqueror), or crumble.
    for (const w of this.walls.values()) if (w.owner === p.id && conquered) w.owner = killer.id;
    // Their land: all of it goes to whoever destroyed the core; otherwise (they left, or nobody
    // in particular brought it down) it opens up, empty, for anyone to buy.
    let landTaken = 0;
    if (conquered) {
      landTaken = this.transferLand(p.id, killer.id);
    } else {
      this.releaseLand(p.id);
    }

    // The core site becomes a tower for the conqueror.
    let site = null;
    if (conquered) {
      const id = this.nextId++;
      const stats = C.towerStats('tower', 1);
      site = {
        isTower: true, id, kind: 'tower', x: p.core.x, y: p.core.y, owner: killer.id, level: 1,
        hp: stats.hp, maxHp: stats.hp, cd: 0, ruin: false,
      };
      this.towers.set(id, site);
      this.grid[coreIdx] = id;
      this.fx.push({ k: 'capture', x: p.core.x + 0.5, y: p.core.y + 0.5, o: killer.id });
      this.grantBlock(killer.id, p.core.x, p.core.y); // the ground the new tower stands on
    }

    // Surviving troops defect to the conqueror and garrison the new tower; otherwise they vanish.
    let troopsTaken = 0;
    const defectors = conquered ? this.smallestSquad(killer) : null; // the squad they join
    for (const u of this.units.values()) {
      if (u.owner !== p.id) continue;
      if (!conquered || u.trade) {
        this.units.delete(u.id);
        continue;
      }
      u.owner = killer.id;
      u.sq = defectors.id;
      u.stance = defectors.stance;
      u.attack = null;
      u.anchor = site.id;
      u.path = [];
      u.dest = null;
      u.repathAt = 0;
      u.idleUntil = 0;
      troopsTaken++;
    }
    for (const c of this.creeps.values()) {
      if (c.angry === p.id) c.angry = 0;
    }

    let goldTaken = 0;
    if (conquered) {
      goldTaken = Math.floor(p.gold);
      const bounty = C.CORE_KILL_BOUNTY + goldTaken;
      this.award(killer, bounty, 'cores', p.core.x + 0.5, p.core.y + 0.5);
      killer.coresDestroyed++;
      p.gold = 0;
      // Waves that were pushing on this player head home instead of wandering off.
      this.tidySquadOrders(killer);
      this.pushFeed(`${killer.name} destroyed ${p.name}'s core: +${bounty}g, all ${landTaken} tiles of their land, ${towersTaken + 1} building${towersTaken ? 's' : ''} and ${troopsTaken} troop${troopsTaken === 1 ? '' : 's'}`);
    } else if (leftGame) {
      this.pushFeed(`${p.name} left - their base lies in ruins`);
    } else {
      this.pushFeed(`${p.name}'s core fell`);
    }

    this.players.delete(p.id);
    this.terrDirty = true;
    this.structVersion++;

    if (this.onDeath && !leftGame) {
      this.onDeath(p, {
        killer: conquered ? killer.name : null,
        killerId: conquered ? killer.id : 0,
        troopsTaken,
        goldTaken,
        landTaken,
        towersTaken,
        survived: Math.round(this.time - p.spawnTime),
        peakTerritory: p.peakTerritory,
        kills: p.kills,
        coresDestroyed: p.coresDestroyed,
        towersDestroyed: p.towersDestroyed,
        earned: Object.fromEntries(Object.entries(p.earned).map(([k, v]) => [k, Math.round(v)])),
      });
    }
  },

  // Give a player gold, remembering where it came from. Kill rewards pop up where they were earned.
  award(p, amount, source, x, y) {
    p.gold += amount;
    p.earned[source] += amount;
    if (x !== undefined) this.fx.push({ k: 'gold', x: round2(x), y: round2(y), n: Math.round(amount), o: p.id });
  },

  pushFeed(text) {
    this.feed.push(text);
  },
};
