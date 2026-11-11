'use strict';

const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { createServer } = require('../server/index');

test('client can load the page, join and receive state', async () => {
  const srv = createServer({ port: 0, botTarget: 2 });
  await new Promise((r) => srv.server.once('listening', r));
  const { port } = srv.server.address();
  try {
    for (const path of ['/', '/client.js', '/style.css', '/shared/config.js', '/shared/pathfinding.js']) {
      const res = await fetch(`http://localhost:${port}${path}`);
      assert.strictEqual(res.status, 200, path);
    }
    assert.strictEqual((await fetch(`http://localhost:${port}/../package.json`)).status, 404);

    const ws = new WebSocket(`ws://localhost:${port}`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ t: 'join', name: 'Tester' }));
    const waitFor = async (pred, ms = 3000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const m = msgs.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('timeout');
    };
    const welcome = await waitFor((m) => m.t === 'welcome');
    const state = await waitFor((m) => m.t === 's' && m.me && m.terr);
    assert.strictEqual(state.me.id, welcome.id);
    assert.ok(state.players.some((p) => p[1] === 'Tester'));

    ws.send('not json');
    ws.send(JSON.stringify({ t: 'build', kind: 'bolt', x: -5, y: 0 }));
    await waitFor((m) => m.t === 'err');
    ws.close();
  } finally {
    srv.close();
  }
});
