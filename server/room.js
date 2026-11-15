'use strict';

// A room is one game and the clients in it. Every room starts as a lobby, where players gather.
//
// - Public lobbies: anyone who presses Play lands in the open one (see index.js). It starts on its
//   own: LOBBY_WAIT_SOLO seconds after the first player arrives, LOBBY_WAIT_GROUP once a second
//   one does, LOBBY_READY_START once everyone has pressed Ready, and at once when it's full (late
//   arrivals always get LOBBY_LATE_MIN to look around). Bots fill the empty seats. Once it starts,
//   the next Play opens a new lobby; the game can be watched from the menu. After its scoreboard,
//   everyone in it moves on to the open public lobby together (`done`).
// - Private rooms are created by a player (the host) and joined with a 5-letter code. The host
//   picks how many bots to add and presses Start. After each round's scoreboard everyone returns
//   to the lobby.
// A round ends early once no humans are left alive in it.

const C = require('../shared/config');
const Game = require('./game');

const SEND_EVERY = Math.max(1, Math.round(C.TICK_RATE / C.SNAPSHOT_RATE));
// Buildings, players and camps are the same for everyone; troops, monsters and effects are
// filtered per player by fog of war (spectators see everything).
const COLLECTIONS = ['players', 'towers', 'walls', 'camps', 'forest', 'ore'];
const PRIVATE = ['units', 'creeps'];

// Remembers the last rows sent for one entity list (rows are arrays whose first item is the id)
// and reports which rows changed or disappeared since then.
class RowTracker {
  constructor() {
    this.prev = new Map();
  }

  diff(rows) {
    const next = new Map();
    const changed = [];
    for (const row of rows) {
      const str = JSON.stringify(row);
      next.set(row[0], str);
      if (this.prev.get(row[0]) !== str) changed.push(str);
    }
    const removed = [];
    for (const id of this.prev.keys()) if (!next.has(id)) removed.push(id);
    this.prev = next;
    return { changed, removed, all: () => [...next.values()] };
  }

  // Same, for pre-serialised entries { id, s }.
  diffEntries(entries) {
    const next = new Map();
    const changed = [];
    for (const e of entries) {
      next.set(e.id, e.s);
      if (this.prev.get(e.id) !== e.s) changed.push(e.s);
    }
    const removed = [];
    for (const id of this.prev.keys()) if (!next.has(id)) removed.push(id);
    this.prev = next;
    return { changed, removed };
  }
}

// Does an effect happen somewhere player p can see (or belong to them)?
function fxVisible(seen, p, f) {
  if (f.o === p.id) return true;
  if (f.x !== undefined) return seen(f.x, f.y);
  return seen(f.x1, f.y1) || seen(f.x2, f.y2);
}

function send(client, obj) {
  if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(obj));
}

class Room {
  constructor({ code = null, isPublic = false, botTarget = C.BOT_TARGET, waits = {}, dev = false } = {}) {
    this.dev = dev; // test mode can be switched on (unless the server runs with TEST_MODE=0)
    this.code = code;
    this.isPublic = isPublic;
    this.botTarget = botTarget; // public: bots fill up to this many players
    // public lobby countdowns (seconds; tests shorten them)
    this.waits = { solo: C.LOBBY_WAIT_SOLO, group: C.LOBBY_WAIT_GROUP, ready: C.LOBBY_READY_START, full: C.LOBBY_FULL_START, late: C.LOBBY_LATE_MIN, ...waits };
    this.ready = new Set(); // public lobby: members who pressed Ready
    this.startAt = 0; // public lobby: when it starts (ms), 0 = nobody here yet
    this.done = false; // public game over: its players move on to the open lobby
    this.startedAt = 0;
    this.bots = C.PRIVATE_DEFAULT_BOTS; // private room: how many bots join each round
    this.rules = { ...C.DEFAULT_RULES }; // private room: the host's choices (public games use the defaults)
    this.clients = new Set();
    this.host = null;
    this.game = null;
    this.roundNo = 0;
    this.phase = 'lobby';
    this.lastWinner = null;
    this.emptySince = Date.now();
    this.tick = 0;
    this.trackers = null;
    this.resetAt = 0; // when the scoreboard of a finished round gives way (ms)
  }

  humans() {
    let n = 0;
    for (const c of this.clients) if (c.name && !c.watching) n++;
    return n;
  }

  // Public lobby: when it starts, from who's here and who's ready (see the top of this file).
  updateCountdown(arrived = false) {
    if (!this.isPublic || this.phase !== 'lobby') return;
    const n = this.humans();
    const now = Date.now();
    if (!n) {
      this.startAt = 0;
      return;
    }
    const s = this.waits;
    if (!this.startAt) this.startAt = now + s.solo * 1000;
    if (n >= 2) this.startAt = Math.min(this.startAt, now + s.group * 1000);
    const players = [...this.clients].filter((c) => c.name && !c.watching);
    if (players.every((c) => this.ready.has(c))) this.startAt = Math.min(this.startAt, now + s.ready * 1000);
    if (n >= C.LOBBY_MAX) this.startAt = Math.min(this.startAt, now + s.full * 1000);
    else if (arrived) this.startAt = Math.max(this.startAt, now + s.late * 1000); // a newcomer gets a moment
  }

  setReady(client, on) {
    if (!this.isPublic || this.phase !== 'lobby') return null;
    if (on) this.ready.add(client);
    else this.ready.delete(client);
    this.updateCountdown();
    this.sendRoom();
    return null;
  }

  // Someone watching a public game in progress (from the menu): they see everything, play nothing.
  watch(client) {
    client.room = this;
    client.watching = true;
    this.clients.add(client);
    this.emptySince = 0;
    client.synced = false;
    send(client, { t: 'watching', round: this.game ? this.game.round : 0, code: this.code });
  }

  // For the menu's list of public games.
  info() {
    const g = this.game;
    return {
      code: this.code,
      phase: this.phase,
      players: this.humans(),
      max: C.LOBBY_MAX,
      startIn: this.phase === 'lobby' && this.startAt ? Math.max(0, (this.startAt - Date.now()) / 1000) : null,
      time: g ? Math.floor(g.time) : 0,
      alive: g ? [...g.players.values()].filter((p) => p.alive).length : 0,
      humansAlive: g ? g.humansAlive() : 0,
    };
  }

  // ---------------------------------------------------------------- membership

  add(client) {
    client.room = this;
    this.clients.add(client);
    this.emptySince = 0;
    client.watching = false;
    if (!this.isPublic && !this.host) this.host = client;
    if (this.phase === 'lobby') {
      this.updateCountdown(true);
      this.sendRoom();
    } else {
      this.sendRoom();
      this.joinGame(client);
    }
  }

  remove(client) {
    this.clients.delete(client);
    if (client.pid && this.game) this.game.playerLeft(client.pid); // a bot takes over their base
    client.pid = null;
    client.room = null;
    client.queued = false;
    client.watching = false;
    this.ready.delete(client);
    if (this.host === client) this.host = this.clients.values().next().value || null;
    if (!this.clients.size) this.emptySince = Date.now();
    else {
      this.updateCountdown();
      this.sendRoom();
    }
  }

  // A member wants to play: join the running round if it's still open, else wait for the next.
  joinGame(client) {
    if (client.pid || !this.game) return;
    if (this.game.canJoin()) this.addToGame(client);
    else if (this.isPublic && this.game.phase === 'playing' && this.game.humansAlive() === 0) this.newRound(); // only bots left
    else {
      client.queued = true;
      send(client, { t: 'wait', round: this.game.round, alive: this.game.players.size, over: this.game.phase === 'over', priv: !this.isPublic });
    }
  }

  addToGame(client) {
    const p = this.game.addPlayer(client.name, false);
    if (!p) {
      send(client, { t: 'err', m: 'This game is full, try again soon' });
      return;
    }
    client.pid = p.id;
    client.queued = false;
    send(client, { t: 'welcome', id: p.id, round: this.game.round, room: this.code });
  }

  // Lobby state for every member (watchers of a public game don't need it).
  sendRoom() {
    const people = [...this.clients].filter((c) => c.name && !c.watching);
    const members = people.map((c) => ({ name: c.name, host: c === this.host, ready: this.ready.has(c) }));
    const startIn = this.isPublic && this.phase === 'lobby' && this.startAt ? Math.max(0, (this.startAt - Date.now()) / 1000) : null;
    for (const c of people) {
      send(c, {
        t: 'room', code: this.code, pub: this.isPublic, phase: this.phase, host: c === this.host, members,
        bots: this.isPublic ? Math.max(0, this.botTarget - people.length) : this.bots, maxBots: C.PRIVATE_MAX_BOTS,
        round: this.roundNo, lastWinner: this.lastWinner, me: people.indexOf(c),
        startIn, max: C.LOBBY_MAX, ready: this.ready.has(c), rules: this.isPublic ? C.DEFAULT_RULES : this.rules, dev: this.dev,
      });
    }
  }

  // ---------------------------------------------------------------- host controls

  // The host changes one of the rules (difficulty, starting gold...): only to one of RULE_CHOICES.
  setRule(client, key, value) {
    if (this.isPublic || client !== this.host || this.phase !== 'lobby') return 'Only the host can change that';
    const choices = C.RULE_CHOICES[key];
    if (!choices || !choices.includes(value)) return 'Invalid setting';
    if (key === 'testMode' && value && !this.dev) return 'Test mode is turned off on this server (TEST_MODE=0)';
    this.rules[key] = value;
    this.sendRoom();
    return null;
  }

  setBots(client, n) {
    if (client !== this.host || this.phase !== 'lobby') return 'Only the host can change that';
    this.bots = Math.max(0, Math.min(C.PRIVATE_MAX_BOTS, Math.round(Number(n) || 0)));
    this.sendRoom();
    return null;
  }

  // A public lobby's countdown ran out: play.
  startPublic() {
    this.phase = 'playing';
    this.startedAt = Date.now();
    this.ready.clear();
    this.newRound();
    this.sendRoom();
  }

  start(client) {
    if (this.isPublic || this.phase !== 'lobby') return 'Nothing to start';
    if (client !== this.host) return 'Only the host can start the round';
    if (this.clients.size + this.bots < 2) return 'Add a bot or invite a friend first';
    this.phase = 'playing';
    this.newRound();
    this.sendRoom();
    return null;
  }

  // A fresh map. Every member (playing, spectating or waiting) joins it.
  newRound() {
    const humans = [...this.clients].filter((c) => c.name).length;
    this.roundNo++;
    this.game = new Game({ botTarget: this.isPublic ? this.botTarget : humans + this.bots, rounds: true, round: this.roundNo, rules: this.isPublic ? null : this.rules });
    this.game.onDeath = (p, info) => {
      for (const client of this.clients) {
        if (client.pid === p.id) {
          client.pid = null;
          send(client, { t: 'dead', ...info, humansAlive: this.game.humansAlive(), priv: !this.isPublic, pub: this.isPublic });
        }
      }
    };
    this.resetAt = 0;
    this.trackers = Object.fromEntries(COLLECTIONS.map((k) => [k, new RowTracker()])); // ids start over on a new map
    for (const client of this.clients) {
      client.synced = false;
      client.expSent = -1;
      client.expView = null;
      client.pid = null;
      client.terrVersion = -1;
      if (client.name && !client.watching) this.addToGame(client);
    }
  }

  // ---------------------------------------------------------------- game messages

  handle(client, msg) {
    const game = this.game;
    if (!game) return null;
    switch (msg.t) {
      case 'build':
        return game.build(client.pid, msg.x, msg.y, msg.kind);
      case 'upgrade':
        return game.upgrade(client.pid, msg.id);
      case 'sell':
        return game.sell(client.pid, msg.id);
      case 'capture':
        return game.capture(client.pid, msg.id);
      case 'land': {
        const hexes = Array.isArray(msg.hexes) ? msg.hexes.slice(0, C.LAND_BUY_MAX).map(Number) : null;
        const err = game.buyLand(client.pid, hexes);
        if (game.lastBuy && game.lastBuy.n) send(client, { t: 'bought', n: game.lastBuy.n, gold: game.lastBuy.gold });
        return game.lastBuy && game.lastBuy.n ? null : err;
      }
      case 'army':
        if (msg.op === 'level') return game.armyLevel(client.pid, msg.kind);
        return null;
      case 'order': {
        const target = msg.target && typeof msg.target === 'object' ? { k: String(msg.target.k), id: msg.target.id } : null;
        const squads = Array.isArray(msg.squads) ? msg.squads.slice(0, 64).map(Number) : null;
        const err = game.order(client.pid, Array.isArray(msg.ids) ? msg.ids : null, target, squads);
        if (!err) send(client, { t: 'ordered', n: game.lastOrderCount });
        return err;
      }
      case 'ally': {
        const other = Number(msg.id);
        if (msg.op === 'propose') {
          const err = game.proposeAlliance(client.pid, other);
          const q = game.players.get(other);
          if (!err && q && !game.allied(client.pid, other)) send(client, { t: 'info', m: `Alliance offered to ${q.name}` });
          return err;
        }
        if (msg.op === 'accept') return game.acceptAlliance(client.pid, other);
        if (msg.op === 'decline') return game.declineAlliance(client.pid, other);
        if (msg.op === 'break') return game.breakAlliance(client.pid, other);
        return null;
      }
      case 'jobs':
        return game.setJobPriority(client.pid, String(msg.job), Number(msg.level));
      case 'work': {
        const target = msg.target && typeof msg.target === 'object' ? { k: String(msg.target.k), id: Number(msg.target.id) } : null;
        return game.sendWorker(client.pid, Number(msg.id), target);
      }
      case 'trade':
        return game.setTradePartner(client.pid, Number(msg.id), Number(msg.partner));
      case 'walls': {
        const edges = Array.isArray(msg.edges) ? msg.edges.slice(0, C.WALL_BUILD_MAX) : null;
        const err = game.buildWalls(client.pid, edges);
        if (game.lastWalls) send(client, { t: 'walled', n: game.lastWalls, gold: game.lastWalls * C.WALL_COST });
        return game.lastWalls ? null : err;
      }
      case 'wall':
        if (msg.op === 'gate') return game.toggleGate(client.pid, Number(msg.id));
        if (msg.op === 'down') return game.demolishWall(client.pid, Number(msg.id));
        return null;
      case 'fog': {
        // test mode: switch fog of war off (or back on) for yourself
        const p = game.players.get(client.pid);
        if (!game.rules.testMode) return 'Only in test mode';
        if (!p) return null;
        p.noFog = !msg.on;
        return null;
      }
      case 'squad':
        if (msg.op === 'mix') return game.squadMix(client.pid, Number(msg.sq), String(msg.kind), msg.d === -1 ? -1 : 1);
        if (msg.op === 'stance') return game.squadStance(client.pid, Number(msg.sq), String(msg.stance));
        if (msg.op === 'formation') return game.squadFormation(client.pid, Number(msg.sq), String(msg.formation));
        return null;
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------- tick

  step() {
    if (this.phase === 'lobby' && this.isPublic && this.startAt && Date.now() >= this.startAt) this.startPublic();
    const game = this.game;
    if (!game || this.phase === 'lobby' || this.done) return;
    game.update(1 / C.TICK_RATE);
    // A round with no humans left alive ends now (once joining has closed).
    if (game.phase === 'playing' && game.time >= C.ROUND_JOIN_WINDOW && game.humansAlive() === 0) game.endRound();
    if (game.phase === 'over') {
      if (!this.resetAt) {
        this.resetAt = Date.now() + C.ROUND_RESET_DELAY * 1000;
        const msg = { t: 'roundover', round: game.round, winner: game.winner, standings: game.standings(), next: C.ROUND_RESET_DELAY, priv: !this.isPublic, pub: this.isPublic };
        for (const client of this.clients) send(client, msg);
      } else if (Date.now() >= this.resetAt) {
        if (this.isPublic) this.done = true; // its players move on to the open lobby (index.js)
        else this.backToLobby();
      }
    }
    this.tick++;
    if (this.tick % SEND_EVERY === 0 && this.game) this.broadcast();
  }

  backToLobby() {
    this.lastWinner = this.game.winner ? this.game.winner.name : null;
    this.game = null;
    this.phase = 'lobby';
    for (const c of this.clients) {
      c.pid = null;
      c.queued = false;
    }
    this.sendRoom();
  }

  // Send the state: entity lists go out as changes since the previous broadcast (shared by every
  // client that is in sync); clients that just connected or started a round get everything once.
  broadcast() {
    const game = this.game;
    const snap = game.snapshot();
    let deltaParts = '';
    const fullParts = [];
    for (const key of COLLECTIONS) {
      const d = this.trackers[key].diff(snap[key]);
      deltaParts += `"${key}":{"c":[${d.changed.join(',')}],"r":[${d.removed.join(',')}]},`;
      fullParts.push(d.all);
    }
    let fullBody = null;
    const priv = {};
    for (const key of PRIVATE) {
      priv[key] = snap[key].map((r) => ({ id: r[0], s: JSON.stringify(r), x: r[2] / 10, y: r[3] / 10, owner: key === 'units' ? r[4] : 0 }));
    }
    const round = snap.round ? { ...snap.round, code: this.isPublic ? null : this.code, pub: this.isPublic } : undefined;
    const shared = JSON.stringify({ tk: this.tick, feed: snap.feed, round }).slice(1, -1);
    let allFx = null;
    let terrJson = null;
    for (const client of this.clients) {
      if (client.ws.readyState !== client.ws.OPEN) continue;
      let body = deltaParts;
      if (!client.synced) {
        if (!fullBody) fullBody = COLLECTIONS.map((key, i) => `"${key}":{"c":[${fullParts[i]().join(',')}],"r":[]},`).join('') + '"full":1,';
        body = fullBody;
        client.synced = true;
        client.priv = Object.fromEntries(PRIVATE.map((k) => [k, new RowTracker()]));
        client.expSent = -1;
        client.expView = null;
      }
      const p = client.pid ? game.players.get(client.pid) : null;
      const fog = p && p.alive && p.vis && game.rules.fog && !p.noFog ? p : null; // (fog of war can be turned off in a private room, or for yourself in test mode)
      let expPart = '';
      // Where this player has explored (run lengths, starting with unexplored): the client draws its
      // fog from exactly this, so it always matches what the server sends them.
      if (p && p.explored && client.expSent !== p.exploredCount && (client.expSent === -1 || this.tick >= (client.expAt || 0))) {
        client.expAt = this.tick + C.TICK_RATE / 2; // at most twice a second
        const runs = [];
        let cur = 0;
        let n = 0;
        for (let k = 0; k < p.explored.length; k++) {
          if (p.explored[k] === cur) n++;
          else {
            runs.push(n);
            cur = p.explored[k];
            n = 1;
          }
        }
        runs.push(n);
        expPart = `"exp":[${runs.join(',')}],`;
        client.expView = Uint8Array.from(p.explored);
        client.expSent = p.exploredCount;
      }
      // Only what the client has been told is explored (its fog matches this exactly).
      const seen = (x, y) => {
        const tx = Math.floor(x);
        const ty = Math.floor(y);
        return !!client.expView && game.inBounds(tx, ty) && client.expView[game.idx(tx, ty)] === 1;
      };
      for (const key of PRIVATE) {
        const rows = fog ? priv[key].filter((e) => e.owner === fog.id || seen(e.x, e.y)) : priv[key];
        const d = client.priv[key].diffEntries(rows);
        body += `"${key}":{"c":[${d.changed.join(',')}],"r":[${d.removed.join(',')}]},`;
      }
      let fx;
      if (fog) fx = JSON.stringify(snap.fx.filter((f) => fxVisible(seen, fog, f)));
      else fx = allFx || (allFx = JSON.stringify(snap.fx));
      body += `"fx":${fx},`;
      let extra = expPart;
      if (client.terrVersion !== game.terrVersion) {
        if (!terrJson) terrJson = JSON.stringify(game.encodeTerritory());
        extra += `"terr":${terrJson},`;
        client.terrVersion = game.terrVersion;
      }
      const me = p ? JSON.stringify(game.personal(p)) : 'null';
      if (p && p.notices && p.notices.length) {
        for (const m of p.notices) send(client, { t: 'info', m });
        p.notices = [];
      }
      client.ws.send(`{"t":"s","me":${me},${extra}${body}${shared}}`);
    }
  }
}

module.exports = { Room };
