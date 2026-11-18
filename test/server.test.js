'use strict';

const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { createServer } = require('../server/index');

test('client can load the page, join and receive state', async () => {
  const srv = createServer({ port: 0, botTarget: 2, waits: { solo: 0.2, late: 0 } }); // (the lobby starts at once)
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

test('public lobbies: players gather, the countdown starts the game, newcomers get the next lobby, and everyone moves on after', async () => {
  const C = require('../shared/config');
  const srv = createServer({ port: 0, botTarget: 4, waits: { solo: 30, group: 20, ready: 0.3, late: 0 } });
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
  const last = (ws, pred) => [...ws.msgs].reverse().find(pred);
  try {
    // A arrives alone: a public lobby with the long solo countdown
    const a = await open();
    a.send(JSON.stringify({ t: 'join', name: 'A' }));
    const la = await waitFor(a, (m) => m.t === 'room' && m.pub);
    assert.strictEqual(la.phase, 'lobby');
    assert.strictEqual(la.members.length, 1);
    assert.ok(la.startIn > 25 && la.startIn <= 30, `solo wait (${la.startIn})`);
    assert.strictEqual(la.max, C.LOBBY_MAX);
    // B joins: the countdown shortens to the group wait
    const b = await open();
    b.send(JSON.stringify({ t: 'join', name: 'B' }));
    const lb = await waitFor(b, (m) => m.t === 'room' && m.members.length === 2);
    assert.strictEqual(lb.code, la.code, 'same lobby');
    assert.ok(lb.startIn <= 20, `group wait (${lb.startIn})`);
    // one ready isn't enough; both ready starts it soon
    a.send(JSON.stringify({ t: 'ready', on: true }));
    await waitFor(b, (m) => m.t === 'room' && m.members.some((x) => x.name === 'A' && x.ready));
    assert.ok(last(b, (m) => m.t === 'room').startIn > 5, 'not everyone is ready yet');
    b.send(JSON.stringify({ t: 'ready', on: true }));
    const wa = await waitFor(a, (m) => m.t === 'welcome');
    const wb = await waitFor(b, (m) => m.t === 'welcome');
    const room = srv.rooms.get(la.code);
    assert.strictEqual(room.phase, 'playing');
    assert.ok(room.game.players.has(wa.id) && room.game.players.has(wb.id));
    assert.strictEqual(room.game.botTarget, 4, 'bots fill the empty seats (they arrive over the first minute)');

    // C presses Play now: a new lobby, not the running game
    const c = await open();
    c.send(JSON.stringify({ t: 'join', name: 'C' }));
    const lc = await waitFor(c, (m) => m.t === 'room' && m.pub);
    assert.notStrictEqual(lc.code, la.code);
    assert.ok(!room.game.roster || ![...room.game.players.values()].some((p) => p.name === 'C'));
    // nor can it join the running game by its code
    const d = await open();
    d.send(JSON.stringify({ t: 'join', name: 'D', room: la.code }));
    await waitFor(d, (m) => m.t === 'err' && /started/.test(m.m));
    // the menu's list: one lobby gathering (C), one game in progress; D watches it
    d.send(JSON.stringify({ t: 'list' }));
    const list = await waitFor(d, (m) => m.t === 'list');
    assert.deepStrictEqual(list.lobbies.map((l) => [l.code, l.players]), [[lc.code, 1]]);
    assert.deepStrictEqual(list.games.map((g) => [g.code, g.players]), [[la.code, 2]]);
    d.send(JSON.stringify({ t: 'watch', name: 'D', room: la.code }));
    await waitFor(d, (m) => m.t === 'watching');
    const seen = await waitFor(d, (m) => m.t === 's' && m.full);
    assert.strictEqual(seen.me, null, 'a watcher plays nothing');
    assert.ok(![...room.game.players.values()].some((p) => p.name === 'D'));

    // the game ends: scoreboard, then its players move on to the open lobby together (with C); D goes back to the menu
    room.game.endRound();
    await waitFor(a, (m) => m.t === 'roundover' && m.pub);
    room.resetAt = Date.now() - 1;
    const back = await waitFor(a, (m) => m.t === 'room' && m.pub && m.phase === 'lobby' && m.code === lc.code && m.members.length === 3);
    assert.deepStrictEqual(back.members.map((m) => m.name).sort(), ['A', 'B', 'C']);
    await waitFor(d, (m) => m.t === 'left');
    assert.ok(!srv.rooms.has(la.code), 'the finished game is gone');
    for (const ws of [a, b, c, d]) ws.close();
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
    // game settings: host only, valid choices only
    assert.deepStrictEqual(lobby.rules, require('../shared/config').DEFAULT_RULES);
    friend.send(JSON.stringify({ t: 'rule', key: 'difficulty', value: 'hard' }));
    await waitFor(friend, (m) => m.t === 'err' && /host/.test(m.m));
    host.send(JSON.stringify({ t: 'rule', key: 'startGold', value: 12345 }));
    await waitFor(host, (m) => m.t === 'err' && /Invalid/.test(m.m));
    for (const [key, value] of [['difficulty', 'hard'], ['startGold', 800], ['fog', false], ['suddenDeath', 780]]) host.send(JSON.stringify({ t: 'rule', key, value }));
    await waitFor(friend, (m) => m.t === 'room' && m.rules.difficulty === 'hard' && m.rules.startGold === 800 && m.rules.fog === false && m.rules.suddenDeath === 780);
    host.send(JSON.stringify({ t: 'start' }));
    const w1 = await waitFor(host, (m) => m.t === 'welcome');
    const w2 = await waitFor(friend, (m) => m.t === 'welcome');
    assert.strictEqual(w1.room, lobby.code);
    const room = srv.rooms.get(lobby.code);
    assert.ok(room.game.players.has(w1.id) && room.game.players.has(w2.id));
    assert.strictEqual(room.game.rules.difficulty, 'hard', 'the game plays by the room\'s settings');
    assert.ok(room.game.players.get(w1.id).gold >= 800);
    const sd = await waitFor(host, (m) => m.t === 's' && m.round && m.round.fog === false);
    assert.ok(sd.round.sd <= 780);
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

test('test mode: refused when the server turns it off; gold and wood never run out', async () => {
  const C = require('../shared/config');
  const open = async (port) => {
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
  // a normal server: no test mode
  const prod = createServer({ port: 0, botTarget: 0 });
  await new Promise((r) => prod.server.once('listening', r));
  try {
    const ws = await open(prod.server.address().port);
    ws.send(JSON.stringify({ t: 'test', name: 'Dev' }));
    await waitFor(ws, (m) => m.t === 'err' && /turned off/.test(m.m));
    ws.send(JSON.stringify({ t: 'create', name: 'Dev' }));
    await waitFor(ws, (m) => m.t === 'room');
    assert.ok(!ws.msgs.some((m) => m.t === 'hello' && m.dev), 'no test mode offered');
    ws.close();
  } finally {
    prod.close();
  }
  // test mode on: the test game starts at once, with gold and wood that never run out
  const dev = createServer({ port: 0, botTarget: 0, dev: true });
  await new Promise((r) => dev.server.once('listening', r));
  try {
    const ws = await open(dev.server.address().port);
    await waitFor(ws, (m) => m.t === 'hello' && m.dev);
    ws.send(JSON.stringify({ t: 'test', name: 'Dev' }));
    const w = await waitFor(ws, (m) => m.t === 'welcome');
    const st = await waitFor(ws, (m) => m.t === 's' && m.round && m.round.test);
    assert.strictEqual(st.round.test, true);
    const room = dev.rooms.get(w.room);
    const p = room.game.players.get(w.id);
    assert.strictEqual(p.gold, C.TEST_FUNDS);
    assert.strictEqual(p.wood, C.TEST_FUNDS);
    // spend: it's topped straight back up
    const h = room.game.hex.hexes[room.game.hex.hexes[room.game.hexAt(p.core.x, p.core.y)].n[0]];
    assert.strictEqual(room.game.build(p.id, h.centre % room.game.w, Math.floor(h.centre / room.game.w), 'tower'), null);
    assert.ok(p.gold < C.TEST_FUNDS);
    room.game.update(0.05);
    assert.strictEqual(p.gold, C.TEST_FUNDS);
    assert.strictEqual(p.wood, C.TEST_FUNDS);
    ws.close();
    // a normal private room on the same server: test mode can't be switched on there
    const ws2 = await open(dev.server.address().port);
    ws2.send(JSON.stringify({ t: 'create', name: 'Friend' }));
    const r2 = await waitFor(ws2, (m) => m.t === 'room');
    ws2.send(JSON.stringify({ t: 'rule', key: 'testMode', value: true }));
    await waitFor(ws2, (m) => m.t === 'err' && /Invalid/.test(m.m));
    assert.strictEqual(dev.rooms.get(r2.code).rules.testMode, false);
    ws2.close();
  } finally {
    dev.close();
  }
});

test('test mode: switching your own fog off shows you the whole map', async () => {
  const srv = createServer({ port: 0, botTarget: 0, dev: true });
  await new Promise((r) => srv.server.once('listening', r));
  const ws = new WebSocket(`ws://localhost:${srv.server.address().port}`);
  ws.msgs = [];
  ws.on('message', (d) => ws.msgs.push(JSON.parse(d)));
  await new Promise((r) => ws.once('open', r));
  const waitFor = async (pred, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = ws.msgs.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timeout');
  };
  try {
    ws.send(JSON.stringify({ t: 'test', name: 'Dev' }));
    const w = await waitFor((m) => m.t === 'welcome');
    const room = srv.rooms.get(w.room);
    const g = room.game;
    // an enemy troop far away, in my fog
    const foe = g.addPlayer('Far', true);
    const me = g.players.get(w.id);
    const u = g.spawnTroop(foe, 'soldier');
    u.x = me.core.x > g.w / 2 ? 3 : g.w - 4;
    u.y = me.core.y > g.h / 2 ? 3 : g.h - 4;
    u.hp = u.maxHp = 1e6;
    const seesIt = () => ws.msgs.some((m) => m.t === 's' && m.units && m.units.c.some((r) => r[0] === u.id));
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(!seesIt(), 'hidden in the fog');
    ws.send(JSON.stringify({ t: 'fog', on: false }));
    await waitFor((m) => m.t === 's' && m.me && m.me.noFog);
    await waitFor(() => seesIt());
    assert.ok(seesIt(), 'fog off: I see it');
    ws.close();
  } finally {
    srv.close();
  }
});

test('pings: your allies see them (and you do), others don\'t; rate-limited', async () => {
  const srv = createServer({ port: 0, botTarget: 0 });
  await new Promise((r) => srv.server.once('listening', r));
  const port = srv.server.address().port;
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
    const [a, b, c] = [await open(), await open(), await open()];
    a.send(JSON.stringify({ t: 'create', name: 'A' }));
    const room = await waitFor(a, (m) => m.t === 'room');
    for (const [ws, n] of [[b, 'B'], [c, 'C']]) ws.send(JSON.stringify({ t: 'join', name: n, room: room.code }));
    await waitFor(a, (m) => m.t === 'room' && m.members.length === 3);
    a.send(JSON.stringify({ t: 'bots', n: 0 }));
    a.send(JSON.stringify({ t: 'start' }));
    const [wa, wb] = [await waitFor(a, (m) => m.t === 'welcome'), await waitFor(b, (m) => m.t === 'welcome')];
    await waitFor(c, (m) => m.t === 'welcome');
    const g = srv.rooms.get(room.code).game;
    g.proposeAlliance(wa.id, wb.id);
    g.acceptAlliance(wb.id, wa.id);
    assert.ok(g.allied(wa.id, wb.id));
    a.send(JSON.stringify({ t: 'ping', kind: 'attack', x: 40.5, y: 30.25 }));
    const pb = await waitFor(b, (m) => m.t === 'ping');
    assert.deepStrictEqual([pb.kind, pb.x, pb.y, pb.from, pb.name], ['attack', 40.5, 30.3, wa.id, 'A'], 'the ally sees it');
    await waitFor(a, (m) => m.t === 'ping'); // and the pinger
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!c.msgs.some((m) => m.t === 'ping'), 'a non-ally does not');
    a.send(JSON.stringify({ t: 'ping', kind: 'dance', x: 1, y: 1 }));
    await waitFor(a, (m) => m.t === 'err' && /Invalid ping/.test(m.m));
    for (let i = 0; i < 3; i++) a.send(JSON.stringify({ t: 'ping', kind: 'look', x: 5, y: 5 }));
    await waitFor(a, (m) => m.t === 'err' && /Too many/.test(m.m));
    for (const ws of [a, b, c]) ws.close();
  } finally {
    srv.close();
  }
});

test('a bad message from one player never takes the server down; a dropped player can resume', async () => {
  const srv = createServer({ port: 0, botTarget: 0 });
  await new Promise((r) => srv.server.once('listening', r));
  const port = srv.server.address().port;
  const open = async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.msgs = [];
    ws.on('message', (d) => ws.msgs.push(JSON.parse(d)));
    ws.on('error', () => {});
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
    // a broken frame and an oversized message: only that connection suffers
    const bad = await open();
    bad._socket.write(Buffer.from([0x8f, 0x80, 0, 0, 0, 0]));
    const big = await open();
    const edges = [];
    for (let i = 0; i < 250; i++) edges.push([1000 + i, 1100 + i]);
    big.send(JSON.stringify({ t: 'walls', edges })); // (a long wall drag: bigger than the old 2 KB limit)
    await new Promise((r) => setTimeout(r, 300));
    // the server is still up: a new player gets in and plays
    const a = await open();
    const hello = await waitFor(a, (m) => m.t === 'hello');
    assert.ok(hello.token, 'a resume token');
    a.send(JSON.stringify({ t: 'create', name: 'A' }));
    await waitFor(a, (m) => m.t === 'room');
    a.send(JSON.stringify({ t: 'start' }));
    const w = await waitFor(a, (m) => m.t === 'welcome');
    const room = srv.rooms.get(w.room);
    // A's connection drops mid-game: their place is held...
    a.terminate();
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(room.game.players.has(w.id), 'still in the game');
    assert.ok(!room.game.players.get(w.id).isBot, 'not handed to a bot yet');
    // ...and a new connection resumes it
    const a2 = await open();
    a2.send(JSON.stringify({ t: 'resume', token: hello.token }));
    const back = await waitFor(a2, (m) => m.t === 'welcome' && m.resumed);
    assert.strictEqual(back.id, w.id, 'the same player');
    const st = await waitFor(a2, (m) => m.t === 's' && m.full && m.me);
    assert.strictEqual(st.me.id, w.id, 'and full state again');
    // a stale or unknown token doesn't
    const z = await open();
    z.send(JSON.stringify({ t: 'resume', token: 'nope' }));
    await waitFor(z, (m) => m.t === 'resume-fail');
    for (const ws of [bad, big, a2, z]) ws.terminate();
  } finally {
    srv.close();
  }
});
