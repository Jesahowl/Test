'use strict';

// Alliances. Two players can ally: their troops, towers and cores stop fighting each other and they
// share vision. One player offers, the other accepts (bots weigh the offer up). Either can break the
// alliance at any time - attacking an ally asks you first (in the browser) and breaks it. Everyone
// can see who is allied with whom. Alliances end when one side is knocked out, and all of them
// dissolve when sudden death starts (only one core can win).
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C } = require('./common');

const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

module.exports = {
  // this.alliances: Set of pair keys; this.allyOffers: Map "from>to" -> time the offer expires.
  initDiplomacy() {
    this.alliances = new Set();
    this.allyOffers = new Map();
  },

  allied(a, b) {
    return !!a && !!b && a !== b && this.alliances.has(pairKey(a, b));
  },

  // Is b someone a fights? (Not themselves, not an ally, not nobody.)
  hostile(a, b) {
    return !!a && !!b && a !== b && !this.alliances.has(pairKey(a, b));
  },

  alliesOf(pid) {
    const out = [];
    for (const q of this.players.values()) if (this.allied(pid, q.id)) out.push(q.id);
    return out;
  },

  // Offers waiting for pid to answer (from whom), and offers pid has made (to whom).
  offersTo(pid) {
    const out = [];
    for (const [k, until] of this.allyOffers) {
      const [from, to] = k.split('>').map(Number);
      if (to === pid && until > this.time) out.push(from);
    }
    return out;
  },

  offersFrom(pid) {
    const out = [];
    for (const [k, until] of this.allyOffers) {
      const [from, to] = k.split('>').map(Number);
      if (from === pid && until > this.time) out.push(to);
    }
    return out;
  },

  // pid offers `to` an alliance (or accepts, if `to` already offered one). Returns null or an error.
  proposeAlliance(pid, to) {
    const p = this.players.get(pid);
    const q = this.players.get(to);
    if (!p || !p.alive || !q || !q.alive || pid === to) return 'No such player';
    if (this.allied(pid, to)) return `You are already allied with ${q.name}`;
    if (this.suddenDeath()) return 'No alliances in sudden death';
    if (this.allyOffers.get(`${to}>${pid}`) > this.time) return this.acceptAlliance(pid, to);
    if (this.alliesOf(pid).length >= C.MAX_ALLIES) return `You can have at most ${C.MAX_ALLIES} allies`;
    if (this.allyOffers.get(`${pid}>${to}`) > this.time) return `Waiting for ${q.name} to answer`;
    this.allyOffers.set(`${pid}>${to}`, this.time + C.ALLY_OFFER_TIME);
    if (q.isBot) {
      // Bots think it over for a moment.
      q.bot.offers = q.bot.offers || [];
      q.bot.offers.push({ from: pid, at: this.time + 1.5 + this.rand() * 2 });
    }
    return null;
  },

  // pid accepts from's offer.
  acceptAlliance(pid, from) {
    const p = this.players.get(pid);
    const q = this.players.get(from);
    if (!p || !p.alive || !q || !q.alive) return 'No such player';
    if (!(this.allyOffers.get(`${from}>${pid}`) > this.time)) return 'That offer has run out';
    this.allyOffers.delete(`${from}>${pid}`);
    this.allyOffers.delete(`${pid}>${from}`);
    if (this.suddenDeath()) return 'No alliances in sudden death';
    if (this.alliesOf(pid).length >= C.MAX_ALLIES || this.alliesOf(from).length >= C.MAX_ALLIES) {
      return `At most ${C.MAX_ALLIES} allies each`;
    }
    this.alliances.add(pairKey(pid, from));
    this.callOffAttacks(pid, from);
    this.callOffAttacks(from, pid);
    this.pushFeed(`🤝 ${q.name} and ${p.name} are now allies`);
    return null;
  },

  declineAlliance(pid, from) {
    const p = this.players.get(pid);
    this.allyOffers.delete(`${from}>${pid}`);
    const q = this.players.get(from);
    if (p && q) this.notice(from, `${p.name} turned down your alliance`);
    return null;
  },

  // pid breaks off their alliance with `other` (silent = no feed line, e.g. sudden death).
  breakAlliance(pid, other, why = '') {
    if (!this.allied(pid, other)) return null;
    this.alliances.delete(pairKey(pid, other));
    const p = this.players.get(pid);
    const q = this.players.get(other);
    if (p && q) {
      this.pushFeed(`⚔ ${p.name} broke the alliance with ${q.name}${why}`);
      // A betrayed bot holds a grudge: it won't ally with them again, and goes after them.
      if (q.isBot && q.bot) {
        q.bot.grudge = q.bot.grudge || new Set();
        q.bot.grudge.add(pid);
      }
    }
    return null;
  },

  // Troops of `pid` stop attacking `ally` (and new squads stop following an order against them).
  callOffAttacks(pid, ally) {
    for (const u of this.units.values()) {
      if (u.owner !== pid || !u.attack) continue;
      if (this.attackOwner(u.attack) === ally) u.attack = null;
    }
    const p = this.players.get(pid);
    if (p && p.lastOrder.type === 'attack' && this.attackOwner(p.lastOrder.target) === ally) p.lastOrder = { type: 'defend', anchor: 0 };
  },

  // Whose is the thing an attack order points at (0: nobody's, e.g. a camp or a spot)?
  attackOwner(a) {
    if (!a) return 0;
    if (a.k === 'c') return a.id;
    if (a.k === 't') {
      const t = this.towers.get(a.id);
      return t ? t.owner : a.owner || 0;
    }
    if (a.k === 'u') {
      const v = this.units.get(a.id);
      return v ? v.owner : a.owner || 0;
    }
    return 0;
  },

  // A private message for one player (shown as a toast).
  notice(pid, text) {
    const p = this.players.get(pid);
    if (!p) return;
    p.notices = p.notices || [];
    p.notices.push(text);
  },

  // Each tick: drop stale offers, let bots answer theirs, and end alliances in sudden death or
  // with knocked-out players.
  updateDiplomacy() {
    for (const [k, until] of this.allyOffers) if (until <= this.time) this.allyOffers.delete(k);
    if (this.alliances.size) {
      const sd = this.suddenDeath();
      if (sd) {
        this.alliances.clear();
        this.pushFeed('⚔ Sudden death: every alliance is over - only one core can win');
      } else {
        for (const k of [...this.alliances]) {
          const [a, b] = k.split(':').map(Number);
          const pa = this.players.get(a);
          const pb = this.players.get(b);
          if (!pa || !pa.alive || !pb || !pb.alive) this.alliances.delete(k);
        }
      }
    }
    if (!this.suddenDeath()) for (const p of this.players.values()) if (p.isBot && p.alive) this.botOffer(p);
    for (const p of this.players.values()) {
      if (!p.isBot || !p.alive || !p.bot.offers || !p.bot.offers.length) continue;
      const due = p.bot.offers.filter((o) => o.at <= this.time);
      if (!due.length) continue;
      p.bot.offers = p.bot.offers.filter((o) => o.at > this.time);
      for (const o of due) {
        if (!(this.allyOffers.get(`${o.from}>${p.id}`) > this.time)) continue;
        if (this.botLikesAlliance(p, o.from)) this.acceptAlliance(p.id, o.from);
        else this.declineAlliance(p.id, o.from);
      }
    }
  },

  // Does bot p want to ally with `pid`? Not with someone who betrayed it, not when it would leave
  // no one to fight, not with someone already attacking it, and not with the runaway leader.
  botLikesAlliance(p, pid) {
    const q = this.players.get(pid);
    if (!q || !q.alive) return false;
    if (p.bot.grudge && p.bot.grudge.has(pid)) return false;
    if (this.alliesOf(p.id).length >= C.MAX_ALLIES) return false;
    const alive = [...this.players.values()].filter((o) => o.alive);
    const rivals = alive.filter((o) => o.id !== p.id && o.id !== pid && !this.allied(p.id, o.id));
    if (!rivals.length) return false;
    for (const u of this.units.values()) {
      if (u.owner === pid && this.attackOwner(u.attack) === p.id) return false;
      if (u.owner === pid && this.terr[this.idx(Math.floor(u.x), Math.floor(u.y))] === p.id) return false;
    }
    const biggest = Math.max(...alive.map((o) => o.territory));
    if (alive.length > 2 && q.territory >= biggest && q.territory > p.territory * 2) return false;
    return this.rand() < 0.75;
  },

  // Now and then a bot offers an alliance to a human player who isn't its nearest rival.
  botOffer(p) {
    if (p.bot.nextOffer === undefined) p.bot.nextOffer = this.time + C.BOT_OFFER_FIRST + this.rand() * 60;
    if (this.time < p.bot.nextOffer) return;
    p.bot.nextOffer = this.time + C.BOT_OFFER_EVERY * (0.7 + this.rand() * 0.6);
    if (this.rand() > 0.5 || this.alliesOf(p.id).length >= C.MAX_ALLIES) return;
    const rival = this.nearestEnemy(p.core.x, p.core.y, p.id, false);
    const humans = [...this.players.values()].filter((q) => q.alive && !q.isBot && q !== rival
      && !this.allied(p.id, q.id) && this.alliesOf(q.id).length < C.MAX_ALLIES
      && !(p.bot.grudge && p.bot.grudge.has(q.id)) && !this.allyOffers.has(`${p.id}>${q.id}`));
    if (!humans.length || [...this.players.values()].filter((q) => q.alive).length < 3) return;
    const q = humans[Math.floor(this.rand() * humans.length)];
    if (this.botLikesAlliance(p, q.id)) this.proposeAlliance(p.id, q.id);
  },
};
