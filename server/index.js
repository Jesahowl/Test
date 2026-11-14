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

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I mix-ups
const ROOM_IDLE_MS = 60000; // an empty private room is closed after this long

function createServer({ port = 3000, botTarget } = {}) {
  const clients = new Set();
  const publicRoom = new Room({ isPublic: true, botTarget: botTarget ?? C.BOT_TARGET });
  const rooms = new Map(); // code -> private Room

  function newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(code)) return code;
    }
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
    maxPayload: 2048,
    perMessageDeflate: { zlibDeflateOptions: { level: 1 }, threshold: 256 },
  });

  function send(client, obj) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(obj));
  }

  const nameOf = (msg) => String(msg.name || '').slice(0, 40) || 'Player';

  wss.on('connection', (ws) => {
    const client = { ws, room: null, pid: null, terrVersion: -1, name: null, queued: false, synced: false };
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
          // Play: the public game, or a private room by code. Again while in a room: join its next round.
          if (client.room) {
            client.room.joinGame(client);
            return;
          }
          client.name = nameOf(msg);
          if (msg.room) {
            const room = rooms.get(String(msg.room).toUpperCase().trim());
            if (!room) err = 'No room with that code. Check it, or create a new one.';
            else if (room.clients.size >= C.MAX_PLAYERS) err = 'That room is full';
            else room.add(client);
          } else {
            publicRoom.add(client);
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
    });

    ws.on('close', () => {
      clients.delete(client);
      if (client.room) client.room.remove(client);
    });
  });

  const interval = setInterval(() => {
    publicRoom.step();
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (!room.clients.size && now - room.emptySince > ROOM_IDLE_MS) rooms.delete(code);
      else room.step();
    }
  }, 1000 / C.TICK_RATE);

  server.listen(port);

  return {
    server,
    rooms,
    publicRoom,
    get game() {
      return publicRoom.game;
    },
    newRound: () => publicRoom.newRound(),
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
