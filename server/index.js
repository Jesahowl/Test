'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const C = require('../shared/config');
const { Room } = require('./room');

const ROOT = path.join(__dirname, '..');
const STATIC = {
  '/': 'public/index.html',
  '/index.html': 'public/index.html',
  '/hex': 'public/hex-preview.html',
  '/hex-preview.html': 'public/hex-preview.html',
  '/style.css': 'public/style.css',
  '/shared/config.js': 'shared/config.js',
  '/shared/pathfinding.js': 'shared/pathfinding.js',
  '/shared/vision.js': 'shared/vision.js',
  '/shared/hex.js': 'shared/hex.js',
  '/shared/terrain.js': 'shared/terrain.js',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const crypto = require('crypto');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I mix-ups
const ROOM_IDLE_MS = 60000; // an empty private room is closed after this long
const RESUME_MS = 45000; // a player whose connection drops mid-game keeps their place this long
const HEARTBEAT_MS = 15000; // connections that don't answer a ping within this are dropped
const MAX_BUFFERED = 4 * 1024 * 1024; // a client this far behind gets a fresh full state instead of more deltas

// Log a problem without letting it take the server down (at most once a minute per kind).
const lastLog = new Map();
function logError(where, e) {
  const key = `${where}:${e && e.message}`;
  const now = Date.now();
  if (now - (lastLog.get(key) || 0) < 60000) return;
  lastLog.set(key, now);
  console.error(`[${new Date().toISOString()}] ${where}:`, e && e.stack ? e.stack : e);
}

// waits: lobby countdowns in seconds (see Room), shortened by tests.
// dev: test mode is on offer (the menu's Test game: infinite gold and wood in your own private room).
function createServer({ port = 3000, botTarget, waits = {}, dev = false } = {}) {
  const clients = new Set();
  const rooms = new Map(); // code -> Room (public and private)
  let lastPublic = null; // the public game that started most recently (tests and tools)

  function newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(code)) return code;
    }
  }

  // The public lobby players gather in (a new one once the last has started or filled up).
  function openLobby() {
    for (const r of rooms.values()) if (r.isPublic && r.phase === 'lobby' && r.humans() < C.LOBBY_MAX) return r;
    const r = new Room({ code: newCode(), isPublic: true, botTarget: botTarget ?? C.BOT_TARGET, waits });
    rooms.set(r.code, r);
    return r;
  }

  // Public lobbies and games, for the menu's list.
  function publicList() {
    const lobbies = [];
    const games = [];
    for (const r of rooms.values()) {
      if (!r.isPublic) continue;
      if (r.phase === 'lobby') {
        if (r.humans()) lobbies.push(r.info());
      } else if (!r.done && r.game && r.game.phase === 'playing') games.push(r.info());
    }
    games.sort((a, b) => b.players - a.players);
    return { t: 'list', lobbies, games };
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // client modules: /js/<name>.js (letters, digits, dashes only - no path tricks)
    const mod = /^\/js\/([a-z0-9-]+)\.js$/.exec(url.pathname);
    const rel = STATIC[url.pathname] || (mod ? `public/js/${mod[1]}.js` : null);
    if (!rel) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err) {
        res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
        res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)], 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });

  // permessage-deflate: state messages are repetitive JSON and shrink about 7x. Level 1 keeps it cheap.
  const wss = new WebSocketServer({
    server,
    maxPayload: 64 * 1024, // (a long wall drag or a big land purchase is a few KB)
    perMessageDeflate: { zlibDeflateOptions: { level: 1 }, threshold: 256 },
  });

  function send(client, obj) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(obj));
  }

  const nameOf = (msg) => String(msg.name || '').slice(0, 40) || 'Player';

  wss.on('error', (e) => logError('websocket server', e));
  const tokens = new Map(); // resume token -> client (for getting back into a game after a dropped connection)

  wss.on('connection', (ws) => {
    let client = { ws, room: null, pid: null, terrVersion: -1, name: null, queued: false, synced: false, token: crypto.randomBytes(12).toString('hex') };
    clients.add(client);
    tokens.set(client.token, client);
    // (the token lets this browser get back into its game if the connection drops; dev: the test game button)
    send(client, { t: 'hello', dev, token: client.token });
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    // A bad frame, an oversized message or a network error on one connection only closes that
    // connection (unhandled, it would take the whole server down).
    ws.on('error', (e) => {
      logError('connection', e);
      try {
        ws.terminate();
      } catch { /* already gone */ }
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      try {
        handleMessage(msg);
      } catch (e) {
        logError(`message ${String(msg.t).slice(0, 20)}`, e);
        send(client, { t: 'err', m: 'Something went wrong with that: please try again' });
      }
    });

    // Back into a game after a dropped connection: this connection takes over the old one's place.
    function resume(token) {
      const old = tokens.get(String(token || ''));
      if (!old || old === client || !old.dropped || !old.room || !rooms.has(old.room.code)) {
        send(client, { t: 'resume-fail' });
        return;
      }
      clearTimeout(old.dropTimer);
      old.dropped = 0;
      old.ws = ws;
      old.synced = false; // a full state next
      old.expSent = -1;
      old.expView = null;
      old.terrVersion = -1;
      tokens.delete(client.token);
      clients.delete(client);
      client = old;
      clients.add(client);
      const game = client.room.game;
      if (client.pid && game && game.players.has(client.pid)) {
        send(client, { t: 'welcome', id: client.pid, round: game.round, room: client.room.code, resumed: 1, token: client.token });
        client.room.sendRoom();
      } else {
        // their core fell while they were away
        client.room.remove(client);
        send(client, { t: 'resume-fail', fell: 1 });
      }
    }

    function handleMessage(msg) {
      let err = null;
      switch (msg.t) {
        case 'resume':
          resume(msg.token);
          return;
        case 'join': {
          // Play: the open public lobby, or a room by code. Again while in a game: a public game's
          // players go on to the open lobby (the game goes on without them); in a private room,
          // join its next round.
          if (client.room) {
            const r = client.room;
            if (!r.isPublic) {
              r.joinGame(client);
              return;
            }
            if (r.phase === 'lobby') return; // already gathering
            r.remove(client);
          }
          client.name = nameOf(msg);
          if (msg.room) {
            const room = rooms.get(String(msg.room).toUpperCase().trim());
            if (!room) err = 'No room with that code. Check it, or create a new one.';
            else if (room.isPublic && room.phase !== 'lobby') err = 'That game has already started: watch it from the menu, or press Play for the next one';
            else if (room.clients.size >= (room.isPublic ? C.LOBBY_MAX : C.MAX_PLAYERS)) err = 'That room is full';
            else room.add(client);
          } else {
            openLobby().add(client);
          }
          break;
        }
        case 'ready':
          err = client.room ? client.room.setReady(client, !!msg.on) : null;
          break;
        case 'list':
          send(client, publicList());
          return;
        case 'watch': {
          // watch a public game in progress (from the menu's list)
          const room = rooms.get(String(msg.room || '').toUpperCase().trim());
          if (!room || !room.isPublic || room.phase === 'lobby' || room.done) err = 'That game has ended';
          else {
            if (client.room) client.room.remove(client);
            client.name = nameOf(msg);
            room.watch(client);
          }
          break;
        }
        case 'create': {
          if (client.room) client.room.remove(client);
          if (rooms.size >= C.MAX_ROOMS) {
            err = 'Too many rooms right now, try again soon';
            break;
          }
          client.name = nameOf(msg);
          const room = new Room({ code: newCode() });
          rooms.set(room.code, room);
          room.add(client);
          break;
        }
        case 'test': {
          // a private room in test mode, started straight away (with a couple of bots)
          if (!dev) {
            err = 'Test mode is turned off on this server (TEST_MODE=0)';
            break;
          }
          if (client.room) client.room.remove(client);
          client.name = nameOf(msg);
          const room = new Room({ code: newCode() });
          room.rules.testMode = true;
          rooms.set(room.code, room);
          room.add(client);
          room.start(client);
          break;
        }
        case 'rule':
          err = client.room ? client.room.setRule(client, String(msg.key), msg.value) : null;
          break;
        case 'bots':
          err = client.room ? client.room.setBots(client, msg.n) : null;
          break;
        case 'start':
          err = client.room ? client.room.start(client) : null;
          break;
        case 'leave':
          if (client.room) client.room.remove(client);
          send(client, { t: 'left' });
          return;
        default:
          err = client.room ? client.room.handle(client, msg) : null;
      }
      if (err) send(client, { t: 'err', m: err });
    }

    ws.on('close', () => {
      if (client.ws !== ws) return; // (this connection was replaced by a resumed one)
      const r = client.room;
      if (r && client.pid && r.phase !== 'lobby' && !client.watching && r.game && r.game.phase === 'playing') {
        // mid-game: keep their place for a while, in case they reconnect
        const c = client;
        c.dropped = Date.now();
        c.dropTimer = setTimeout(() => {
          if (!c.dropped) return;
          tokens.delete(c.token);
          clients.delete(c);
          if (c.room) c.room.remove(c);
        }, RESUME_MS);
        return;
      }
      tokens.delete(client.token);
      clients.delete(client);
      if (r) r.remove(client);
    });
  });

  // Heartbeat: connections that stop answering (a closed laptop, a lost network) are dropped, so
  // their place is held for a resume and then handed on, instead of hanging on for ever.
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      const ws = c.ws;
      if (!ws || c.dropped || ws.readyState !== ws.OPEN) continue;
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch { /* closing */ }
    }
  }, HEARTBEAT_MS);

  // A public game that's over: its players go on together to the open lobby; its watchers back to
  // the menu.
  function finishPublic(room) {
    rooms.delete(room.code);
    const people = [...room.clients];
    const watchers = new Set(people.filter((c) => c.watching));
    for (const c of people) room.remove(c);
    for (const c of people) {
      if (c.ws.readyState !== c.ws.OPEN) continue;
      if (watchers.has(c)) send(c, { t: 'left' });
      else openLobby().add(c);
    }
  }

  const interval = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const wasLobby = room.phase === 'lobby';
      if (room.done) finishPublic(room);
      else if (!room.clients.size && (now - room.emptySince > ROOM_IDLE_MS || (room.isPublic && room.phase !== 'lobby'))) rooms.delete(code); // (a public game everyone has left ends)
      else {
        // (a bug in one game is logged; it doesn't stop the server or the other games)
        try {
          room.step();
        } catch (e) {
          logError(`room ${code}`, e);
        }
        if (wasLobby && room.isPublic && room.phase === 'playing') lastPublic = room;
      }
    }
  }, 1000 / C.TICK_RATE);

  server.listen(port);

  return {
    server,
    rooms,
    openLobby,
    // the public game that started most recently
    get game() {
      return lastPublic && lastPublic.game;
    },
    get publicRoom() {
      return lastPublic;
    },
    close() {
      clearInterval(interval);
      clearInterval(heartbeat);
      for (const c of clients) c.ws.terminate();
      wss.close();
      server.close();
    },
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  // Test mode (the menu's Test game button) is on unless TEST_MODE=0. It only ever affects the
  // private test rooms people make for themselves, never public games.
  const dev = process.env.TEST_MODE !== '0';
  const srv = createServer({ port, dev });
  console.log(`Territory Siege running at http://localhost:${port}${dev ? ' (test mode available)' : ''}`);
  // Hosts like Render send SIGTERM before restarting or redeploying: close cleanly.
  // a last resort: log anything unexpected rather than dropping every player at once
  process.on('uncaughtException', (e) => logError('uncaught', e));
  process.on('unhandledRejection', (e) => logError('unhandled rejection', e));
  process.on('SIGTERM', () => {
    srv.close();
    process.exit(0);
  });
}

module.exports = { createServer };
