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
    for (const path of ['/', '/js/main.js', '/js/state.js', '/style.css', '/shared/config.js', '/shared/pathfinding.js', '/shared/vision.js']) {
      const res = await fetch(`http://localhost:${port}${path}`);
      assert.strictEqual(res.status, 200, path);
    }
    assert.strictEqual((await fetch(`http://localhost:${port}/../package.json`)).status, 404);
    assert.strictEqual((await fetch(`http://localhost:${port}/js/..%2Fserver%2Findex.js`)).status, 404);
    assert.strictEqual((await fetch(`http://localhost:${port}/js/nope.js`)).status, 404);

    const ws = new WebSocket(`ws://localhost:${port}`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ t: 'join', name: 'Tester' }));
    const waitFor = async (pred, ms = 8000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const m = msgs.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('timeout');
    };
    const welcome = await waitFor((m) => m.t === 'welcome');
    const first = await waitFor((m) => m.t === 's');
    assert.strictEqual(first.full, 1, 'the first state a client gets is complete');
    assert.ok(first.camps.c.length > 0);
    const state = await waitFor((m) => m.t === 's' && m.me && m.players.c.some((p) => p[1] === 'Tester'));
    assert.strictEqual(state.me.id, welcome.id);
    assert.ok(msgs.some((m) => m.t === 's' && m.terr));
    // Later states only carry what changed: the camps never change, so they are left out.
    const later = await waitFor((m) => m.t === 's' && m.tk > state.tk && !m.full);
    assert.strictEqual(later.camps.c.length, 0);
    assert.strictEqual(later.tk - state.tk, 2, 'one state per two simulation ticks');

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
  const waitFor = async (ws, pred, ms = 8000) => {
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

    // A's round ends (A is the last core standing). The server's own tick may end it before B has
    // even connected, so check the scoreboard on A, who is always there for it.
    srv.game.update(0.05);
    const over = await waitFor(a, (m) => m.t === 'roundover');
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

test('private rooms: create, join by code, host starts, back to the lobby after the round', async () => {
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
  const waitFor = async (ws, pred, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = ws.msgs.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timeout');
  };
  try {
    const host = await open();
    host.send(JSON.stringify({ t: 'create', name: 'Host' }));
    const lobby = await waitFor(host, (m) => m.t === 'room');
    assert.match(lobby.code, /^[A-Z2-9]{5}$/);
    assert.strictEqual(lobby.phase, 'lobby');
    assert.strictEqual(lobby.host, true);

    const friend = await open();
    friend.send(JSON.stringify({ t: 'join', name: 'Friend', room: 'ZZZZZ' }));
    await waitFor(friend, (m) => m.t === 'err' && /No room/.test(m.m));
    friend.send(JSON.stringify({ t: 'join', name: 'Friend', room: lobby.code.toLowerCase() }));
    const fl = await waitFor(friend, (m) => m.t === 'room' && m.members.length === 2);
    assert.strictEqual(fl.host, false);
    assert.deepStrictEqual(fl.members.map((m) => m.name), ['Host', 'Friend']);

    // only the host controls the room
    friend.send(JSON.stringify({ t: 'start' }));
    await waitFor(friend, (m) => m.t === 'err' && /host/.test(m.m));
    host.send(JSON.stringify({ t: 'bots', n: 3 }));
    await waitFor(friend, (m) => m.t === 'room' && m.bots === 3);
    host.send(JSON.stringify({ t: 'start' }));
    const w1 = await waitFor(host, (m) => m.t === 'welcome');
    const w2 = await waitFor(friend, (m) => m.t === 'welcome');
    assert.strictEqual(w1.room, lobby.code);
    const room = srv.rooms.get(lobby.code);
    assert.ok(room.game.players.has(w1.id) && room.game.players.has(w2.id));
    assert.ok(!srv.game.players.has(w1.id) || srv.game.players.get(w1.id).name !== 'Host', 'not in the public game');
    // state carries the room code
    const st = await waitFor(host, (m) => m.t === 's' && m.round);
    assert.strictEqual(st.round.code, lobby.code);

    // the round ends -> scoreboard -> lobby
    room.game.endRound();
    await waitFor(friend, (m) => m.t === 'roundover' && m.priv);
    room.resetAt = Date.now() - 1; // skip the scoreboard wait
    await waitFor(friend, (m) => m.t === 'room' && m.phase === 'lobby' && m.round === 1);

    // the host leaves: the friend becomes host
    host.send(JSON.stringify({ t: 'leave' }));
    await waitFor(host, (m) => m.t === 'left');
    await waitFor(friend, (m) => m.t === 'room' && m.host === true && m.members.length === 1);
    host.close();
    friend.close();
  } finally {
    srv.close();
  }
});
