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
    ws.send(JSON.stringify({ t: 'build', kind: 'tower', x: -5, y: 0 }));
    await waitFor((m) => m.t === 'err');
    ws.close();
  } finally {
    srv.close();
  }
});

test('rounds: late joiners wait, and everyone joins the next round', async () => {
  const C = require('../shared/config');
  const srv = createServer({ port: 0, botTarget: 0 });
  await new Promise((r) => srv.server.once('listening', r));
  const { port } = srv.server.address();
  const open = async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.msgs = [];
    ws.on('message', (d) => ws.msgs.push(JSON.parse(d)));
    await new Promise((r) => ws.once('open', r));
    return ws;
  };
  const waitFor = async (ws, pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = ws.msgs.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timeout');
  };
  try {
    const a = await open();
    a.send(JSON.stringify({ t: 'join', name: 'A' }));
    const wa = await waitFor(a, (m) => m.t === 'welcome');
    srv.game.time = C.ROUND_JOIN_WINDOW + 1; // joining has closed
    const b = await open();
    b.send(JSON.stringify({ t: 'join', name: 'B' }));
    await waitFor(b, (m) => m.t === 'wait');

    // A's round ends (A is the last core standing).
    srv.game.update(0.05);
    const over = await waitFor(b, (m) => m.t === 'roundover');
    assert.strictEqual(over.winner.id, wa.id);
    srv.newRound();
    const wb = await waitFor(b, (m) => m.t === 'welcome');
    assert.strictEqual(wb.round, 2);
    await waitFor(a, (m) => m.t === 'welcome' && m.round === 2);
    assert.strictEqual(srv.game.players.size, 2);
    a.close();
    b.close();
  } finally {
    srv.close();
  }
});
