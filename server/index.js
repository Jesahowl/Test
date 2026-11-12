'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const C = require('../shared/config');
const Game = require('./game');

const ROOT = path.join(__dirname, '..');
const STATIC = {
  '/': 'public/index.html',
  '/index.html': 'public/index.html',
  '/client.js': 'public/client.js',
  '/style.css': 'public/style.css',
  '/shared/config.js': 'shared/config.js',
  '/shared/pathfinding.js': 'shared/pathfinding.js',
  '/shared/vision.js': 'shared/vision.js',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

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
function fxVisible(game, p, f) {
  if (f.o === p.id) return true;
  if (f.x !== undefined) return game.sees(p, f.x, f.y);
  return game.sees(p, f.x1, f.y1) || game.sees(p, f.x2, f.y2);
}

function createServer({ port = 3000, botTarget } = {}) {
  const clients = new Set();
  let game = null;
  let tick = 0;
  const SEND_EVERY = Math.max(1, Math.round(C.TICK_RATE / C.SNAPSHOT_RATE));
  // Buildings, players and camps are the same for everyone; troops, monsters and effects are
  // filtered per player by fog of war (spectators see everything).
  const COLLECTIONS = ['players', 'towers', 'camps'];
  const PRIVATE = ['units', 'creeps'];
  let trackers = null;
  const resetTrackers = () => {
    trackers = Object.fromEntries(COLLECTIONS.map((k) => [k, new RowTracker()]));
  };
  let resetAt = 0; // when the scoreboard of a finished round gives way to the next round (ms)

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rel = STATIC[url.pathname];
    if (!rel) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Server error');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)], 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });

  // permessage-deflate: state messages are repetitive JSON and shrink about 7x. Level 1 keeps it cheap.
  const wss = new WebSocketServer({
    server,
    maxPayload: 2048,
    perMessageDeflate: { zlibDeflateOptions: { level: 1 }, threshold: 256 },
  });

  function send(client, obj) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(obj));
  }

  function addToGame(client) {
    const p = game.addPlayer(client.name, false);
    if (!p) {
      send(client, { t: 'err', m: 'Server is full, try again soon' });
      return;
    }
    client.pid = p.id;
    client.queued = false;
    send(client, { t: 'welcome', id: p.id, round: game.round });
  }

  // A fresh map. Everyone who is playing, spectating or queued joins it.
  function newRound() {
    game = new Game({ botTarget, rounds: true, round: game ? game.round + 1 : 1 });
    game.onDeath = (p, info) => {
      for (const client of clients) {
        if (client.pid === p.id) {
          client.pid = null;
          send(client, { t: 'dead', ...info, humansAlive: game.humansAlive() });
        }
      }
    };
    resetAt = 0;
    resetTrackers(); // entity ids start over on a new map
    for (const client of clients) {
      client.synced = false;
      client.pid = null;
      client.terrVersion = -1;
      if (client.name) addToGame(client);
    }
  }
  newRound();

  wss.on('connection', (ws) => {
    const client = { ws, pid: null, terrVersion: -1, name: null, queued: false, synced: false };
    clients.add(client);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      let err = null;
      switch (msg.t) {
        case 'join': {
          if (client.pid) return;
          client.name = String(msg.name || '').slice(0, 40) || 'Player';
          if (game.canJoin()) addToGame(client);
          else if (game.phase === 'playing' && game.humansAlive() === 0) newRound(); // only bots left: start over now
          else {
            // Round in progress: watch it and join the next one automatically.
            client.queued = true;
            send(client, { t: 'wait', round: game.round, alive: game.players.size, over: game.phase === 'over' });
          }
          return;
        }
        case 'build':
          err = game.build(client.pid, msg.x, msg.y, msg.kind);
          break;
        case 'upgrade':
          err = game.upgrade(client.pid, msg.id);
          break;
        case 'sell':
          err = game.sell(client.pid, msg.id);
          break;
        case 'capture':
          err = game.capture(client.pid, msg.id);
          break;
        case 'army':
          if (msg.op === 'add') err = game.armyAdd(client.pid, msg.kind);
          else if (msg.op === 'remove') err = game.armyRemove(client.pid, msg.kind);
          else if (msg.op === 'level') err = game.armyLevel(client.pid, msg.kind);
          break;
        case 'order': {
          const target = msg.target && typeof msg.target === 'object' ? { k: String(msg.target.k), id: msg.target.id } : null;
          const share = typeof msg.share === 'number' && msg.share > 0 && msg.share <= 1 ? msg.share : 1;
          const kinds = Array.isArray(msg.kinds) ? msg.kinds.slice(0, 8).map(String) : null;
          const follow = typeof msg.follow === 'boolean' ? msg.follow : null;
          err = game.order(client.pid, Array.isArray(msg.ids) ? msg.ids : null, target, share, kinds, follow);
          if (!err) send(client, { t: 'ordered', n: game.lastOrderCount });
          break;
        }
        default:
          return;
      }
      if (err) send(client, { t: 'err', m: err });
    });

    ws.on('close', () => {
      clients.delete(client);
      if (client.pid) game.removePlayer(client.pid);
    });
  });

  const interval = setInterval(() => {
    game.update(1 / C.TICK_RATE);
    if (game.phase === 'over') {
      if (!resetAt) {
        resetAt = Date.now() + C.ROUND_RESET_DELAY * 1000;
        const msg = { t: 'roundover', round: game.round, winner: game.winner, standings: game.standings(), next: C.ROUND_RESET_DELAY };
        for (const client of clients) send(client, msg);
      } else if (Date.now() >= resetAt) {
        newRound();
      }
    }
    tick++;
    if (tick % SEND_EVERY === 0) broadcast();
  }, 1000 / C.TICK_RATE);

  // Send the state: entity lists go out as changes since the previous broadcast (shared by every
  // client that is in sync); clients that just connected or started a round get everything once.
  function broadcast() {
    const snap = game.snapshot();
    let deltaParts = '';
    const fullParts = [];
    for (const key of COLLECTIONS) {
      const d = trackers[key].diff(snap[key]);
      deltaParts += `"${key}":{"c":[${d.changed.join(',')}],"r":[${d.removed.join(',')}]},`;
      fullParts.push(d.all);
    }
    let fullBody = null;
    const priv = {};
    for (const key of PRIVATE) {
      priv[key] = snap[key].map((r) => ({ id: r[0], s: JSON.stringify(r), x: r[2] / 10, y: r[3] / 10, owner: key === 'units' ? r[4] : 0 }));
    }
    const shared = JSON.stringify({ tk: tick, feed: snap.feed, round: snap.round }).slice(1, -1);
    let allFx = null;
    let terrJson = null;
    for (const client of clients) {
      if (client.ws.readyState !== client.ws.OPEN) continue;
      let body = deltaParts;
      if (!client.synced) {
        if (!fullBody) fullBody = COLLECTIONS.map((key, i) => `"${key}":{"c":[${fullParts[i]().join(',')}],"r":[]},`).join('') + '"full":1,';
        body = fullBody;
        client.synced = true;
        client.priv = Object.fromEntries(PRIVATE.map((k) => [k, new RowTracker()]));
      }
      const p = client.pid ? game.players.get(client.pid) : null;
      const fog = p && p.alive && p.vis ? p : null;
      for (const key of PRIVATE) {
        const rows = fog ? priv[key].filter((e) => e.owner === fog.id || game.sees(fog, e.x, e.y)) : priv[key];
        const d = client.priv[key].diffEntries(rows);
        body += `"${key}":{"c":[${d.changed.join(',')}],"r":[${d.removed.join(',')}]},`;
      }
      let fx;
      if (fog) fx = JSON.stringify(snap.fx.filter((f) => fxVisible(game, fog, f)));
      else fx = allFx || (allFx = JSON.stringify(snap.fx));
      body += `"fx":${fx},`;
      let extra = '';
      if (client.terrVersion !== game.terrVersion) {
        if (!terrJson) terrJson = JSON.stringify(game.encodeTerritory());
        extra = `"terr":${terrJson},`;
        client.terrVersion = game.terrVersion;
      }
      const me = p ? JSON.stringify(game.personal(p)) : 'null';
      client.ws.send(`{"t":"s","me":${me},${extra}${body}${shared}}`);
    }
  }

  server.listen(port);

  return {
    server,
    get game() {
      return game;
    },
    newRound,
    close() {
      clearInterval(interval);
      for (const c of clients) c.ws.terminate();
      wss.close();
      server.close();
    },
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const srv = createServer({ port });
  console.log(`Territory Siege running at http://localhost:${port}`);
  // Hosts like Render send SIGTERM before restarting or redeploying: close cleanly.
  process.on('SIGTERM', () => {
    srv.close();
    process.exit(0);
  });
}

module.exports = { createServer };
