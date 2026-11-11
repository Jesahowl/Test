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
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function createServer({ port = 3000, botTarget } = {}) {
  const game = new Game({ botTarget });
  const clients = new Set();

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

  const wss = new WebSocketServer({ server, maxPayload: 1024 });

  function send(client, obj) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(obj));
  }

  game.onDeath = (p, info) => {
    for (const client of clients) {
      if (client.pid === p.id) {
        client.pid = null;
        send(client, { t: 'dead', ...info });
      }
    }
  };

  wss.on('connection', (ws) => {
    const client = { ws, pid: null, terrVersion: -1 };
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
          const p = game.addPlayer(msg.name, false);
          if (!p) {
            send(client, { t: 'err', m: 'Server is full, try again soon' });
            return;
          }
          client.pid = p.id;
          send(client, { t: 'welcome', id: p.id });
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
        case 'send': {
          const count = Math.max(1, Math.min(10, msg.count | 0));
          for (let i = 0; i < count; i++) {
            err = game.send(client.pid, msg.kind, msg.target);
            if (err) break;
          }
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
    const snap = game.snapshot();
    const body = JSON.stringify(snap).slice(1, -1);
    let terrJson = null;
    for (const client of clients) {
      if (client.ws.readyState !== client.ws.OPEN) continue;
      let extra = '';
      if (client.terrVersion !== game.terrVersion) {
        if (!terrJson) terrJson = JSON.stringify(game.encodeTerritory());
        extra = `"terr":${terrJson},`;
        client.terrVersion = game.terrVersion;
      }
      const p = client.pid ? game.players.get(client.pid) : null;
      const me = p ? JSON.stringify({ id: p.id, gold: Math.floor(p.gold), nextWave: Math.ceil(p.nextWave - game.time) }) : 'null';
      client.ws.send(`{"t":"s","me":${me},${extra}${body}}`);
    }
  }, 1000 / C.TICK_RATE);

  server.listen(port);

  return {
    server,
    game,
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
  createServer({ port });
  console.log(`Territory Siege running at http://localhost:${port}`);
}

module.exports = { createServer };
