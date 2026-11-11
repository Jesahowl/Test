/* global TD_CONFIG */
(() => {
  'use strict';

  const C = TD_CONFIG;
  const KIND_KEYS = Object.keys(C.TOWERS);
  const UNIT_KEYS = Object.keys(C.UNITS);
  const CREEP_KEYS = Object.keys(C.CREEPS);
  const CAMP_KEYS = Object.keys(C.CAMP_TYPES);
  const TPX = 2; // minimap territory canvas pixels per tile
  const SMOOTH_WINDOW = 2; // outline points averaged on each side when smoothing territory
  const SMOOTH_PASSES = 2;

  // ------------------------------------------------------------------ DOM
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const mini = $('minimap');
  const mctx = mini.getContext('2d');

  // ------------------------------------------------------------------ state
  let ws = null;
  let myId = null;
  let me = null; // { id, gold, nextWave, army, levels, order }
  let lastName = '';
  let round = null; // { n, phase, t, join, sd }
  let queued = false; // waiting to join the next round
  const players = new Map(); // id -> { id, name, hue, x, y, hp, maxHp, territory, kills, isBot, shield }
  let towers = new Map(); // id -> tower / ruin
  let units = new Map(); // id -> troop (with rx/ry render positions)
  let creeps = new Map(); // id -> jungle monster (with rx/ry render positions)
  let camps = [];
  let effects = [];
  const feed = [];
  const terr = new Int32Array(C.MAP_W * C.MAP_H);
  const terrCanvas = document.createElement('canvas');
  terrCanvas.width = C.MAP_W * TPX;
  terrCanvas.height = C.MAP_H * TPX;
  const tctx = terrCanvas.getContext('2d');
  const grid = new Map(); // "x,y" -> tower id
  let terrShapes = []; // [{ owner, path: Path2D in tile units }]
  let terrStamp = 0; // bumps whenever territory changes

  const cam = { x: C.MAP_W / 2, y: C.MAP_H / 2, zoom: 1 };
  const BASE_SCALE = 28;
  let buildKind = null; // 'tower' while placing
  let selectedId = null; // selected tower / ruin
  const selUnits = new Set(); // selected troop ids
  let centerOnMe = false;
  // Spectating after your core falls: free camera that can follow a player.
  let spectating = false;
  let specTarget = 0;
  let specFollow = true;
  const SHARES = [0.25, 0.5, 0.75, 1]; // presets on Z X C V
  const SHARE_KEYS = ['z', 'x', 'c', 'v'];
  const SHARE_STEP = 0.05; // the send slider moves in 5% steps
  let sendShare = 1; // share of troops a right-click order sends (when no troops are selected)
  try {
    const saved = Number(localStorage.getItem('ts-share'));
    if (saved >= SHARE_STEP && saved <= 1) sendShare = saved;
  } catch { /* ignore */ }
  let pendingOrder = null; // toast text waiting for the server to say how many troops moved
  const keys = new Set();
  const mouse = { sx: 0, sy: 0, wx: 0, wy: 0, rightDown: false, dragged: false, lastX: 0, lastY: 0 };

  const scale = () => BASE_SCALE * cam.zoom;
  const toScreen = (wx, wy) => [(wx - cam.x) * scale() + canvas.width / 2, (wy - cam.y) * scale() + canvas.height / 2];
  const toWorld = (sx, sy) => [(sx - canvas.width / 2) / scale() + cam.x, (sy - canvas.height / 2) / scale() + cam.y];
  const hueOf = (pid) => (players.get(pid) || { hue: 0 }).hue;
  const colorOf = (pid, l = 55, a = 1) => (pid ? `hsla(${hueOf(pid)}, 75%, ${l}%, ${a})` : `rgba(140, 120, 90, ${a})`);

  // ------------------------------------------------------------------ network
  function connect() {
    $('conn').textContent = 'Connecting…';
    $('play').disabled = true;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    ws.onopen = () => {
      $('conn').textContent = '';
      $('play').disabled = false;
    };
    ws.onclose = () => {
      $('conn').textContent = 'Disconnected - retrying…';
      $('play').disabled = true;
      myId = null;
      showMenu();
      setTimeout(connect, 1500);
    };
    ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  }

  function sendMsg(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function handle(msg) {
    switch (msg.t) {
      case 's':
        applyState(msg);
        break;
      case 'welcome':
        stopSpectating();
        queued = false;
        if (round && msg.round !== round.n) {
          // a new round on a fresh map
          effects = [];
          feed.length = 0;
          towers = new Map();
          units = new Map();
          lastKiller = 0;
        }
        $('roundover').classList.add('hidden');
        myId = msg.id;
        centerOnMe = true;
        clearSelection();
        buildKind = null;
        $('menu').classList.add('hidden');
        $('death').classList.add('hidden');
        $('hud').classList.remove('hidden');
        break;
      case 'dead':
        myId = null;
        me = null;
        showDeath(msg);
        break;
      case 'wait':
        // Round in progress: watch it, and join the next one automatically.
        queued = true;
        if (!spectating) startSpectating();
        toast(msg.over ? 'Next round starts in a few seconds' : `Round ${msg.round} is under way: you'll join the next one`, true);
        break;
      case 'roundover':
        showRoundOver(msg);
        break;
      case 'err':
        toast(msg.m);
        pendingOrder = null;
        break;
      case 'ordered':
        if (pendingOrder) toast(pendingOrder(msg.n), true);
        pendingOrder = null;
        break;
    }
  }

  // ---- smooth movement
  // Troops and monsters are drawn INTERP_DELAY ms in the past, interpolating between the last
  // server snapshots, so they glide at a steady speed however unevenly packets arrive.
  const TICK_MS = 1000 / C.TICK_RATE;
  const INTERP_DELAY = TICK_MS * 2;
  let snapClock = 0; // server time (ms) of the latest snapshot, from its tick number
  let clockOffset = null; // estimated server time minus local time
  function stampSnapshot(now, tk) {
    snapClock = tk * TICK_MS;
    const target = snapClock - now;
    // follow arrival times loosely (absorbs network jitter); resync after a stall or a burst
    if (clockOffset === null || Math.abs(target - clockOffset) > 250) clockOffset = target;
    else clockOffset += (target - clockOffset) * 0.05;
  }
  const renderTime = () => performance.now() + (clockOffset || 0) - INTERP_DELAY;
  function addSample(old, x, y) {
    const smp = old && old.samples ? old.samples : [];
    if (smp.length >= 6) smp.shift();
    smp.push({ t: snapClock, x, y });
    return smp;
  }
  // Render position at time rt: interpolate between snapshots, extrapolate briefly past the last one.
  function interpPos(o, rt) {
    const smp = o.samples;
    if (!smp || !smp.length) return [o.x, o.y];
    if (rt <= smp[0].t || smp.length === 1) return [smp[0].x, smp[0].y];
    for (let i = smp.length - 1; i > 0; i--) {
      const a = smp[i - 1];
      const b = smp[i];
      if (rt >= a.t) {
        const span = b.t - a.t || 1;
        // past the newest snapshot: keep moving for up to one tick, then hold
        const f = Math.min((rt - a.t) / span, i === smp.length - 1 ? 1 + TICK_MS / span : 1);
        return [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f];
      }
    }
    return [smp[0].x, smp[0].y];
  }

  function applyState(msg) {
    me = msg.me;
    const now = performance.now();
    stampSnapshot(now, msg.tk);
    if (msg.round) round = msg.round;

    if (msg.terr) {
      let i = 0;
      for (let j = 0; j < msg.terr.length; j += 2) {
        terr.fill(msg.terr[j], i, i + msg.terr[j + 1]);
        i += msg.terr[j + 1];
      }
    }

    const oldPlayers = new Map(players);
    players.clear();
    for (const a of msg.players) {
      const old = oldPlayers.get(a[0]);
      const p = { id: a[0], name: a[1], hue: a[2], x: a[3], y: a[4], hp: a[5], maxHp: a[6], territory: a[7], kills: a[8], isBot: !!a[9],
        shield: a[10] || 0, buff: a[11] || 0, hitAt: old ? old.hitAt : 0, trail: old ? old.trail : undefined, shotAt: old ? old.shotAt : 0 };
      if (old && p.hp < old.hp) p.hitAt = now;
      players.set(p.id, p);
    }
    if (msg.terr) drawTerritory();

    const nt = new Map();
    grid.clear();
    for (const a of msg.towers) {
      const t = { id: a[0], kind: KIND_KEYS[a[1]], x: a[2], y: a[3], owner: a[4], level: a[5], hp: a[6], maxHp: a[7], ruinOf: a[8], capBy: a[9], cap: a[10] };
      t.ruin = !t.owner;
      const old = towers.get(t.id);
      if (old) {
        // remember render state: when it was last hit, when it changed hands, where its turret points
        for (const k of ['hitAt', 'flipAt', 'prevOwner', 'aim', 'shotAt', 'trail']) t[k] = old[k];
        if (t.hp < old.hp && t.owner === old.owner) t.hitAt = now;
        if (t.owner && old.owner !== t.owner) {
          t.flipAt = now;
          t.prevOwner = old.owner;
          t.trail = t.hp;
        }
      }
      nt.set(t.id, t);
      grid.set(`${t.x},${t.y}`, t.id);
    }
    towers = nt;
    if (selectedId && !towers.has(selectedId)) selectedId = null;

    const nu = new Map();
    for (const a of msg.units) {
      const old = units.get(a[0]);
      nu.set(a[0], { id: a[0], kind: UNIT_KEYS[a[1]], x: a[2], y: a[3], owner: a[4], level: a[5], hp: a[6], maxHp: a[7], anchor: a[8], attack: a[9],
        rx: old ? old.rx : a[2], ry: old ? old.ry : a[3], samples: addSample(old, a[2], a[3]) });
    }
    units = nu;
    for (const id of selUnits) if (!units.has(id)) selUnits.delete(id);

    const nc = new Map();
    for (const a of msg.creeps) {
      const old = creeps.get(a[0]);
      nc.set(a[0], { id: a[0], kind: CREEP_KEYS[a[1]], x: a[2], y: a[3], angry: a[4], hp: a[5], camp: a[6], rx: old ? old.rx : a[2], ry: old ? old.ry : a[3],
        samples: addSample(old, a[2], a[3]) });
    }
    creeps = nc;
    camps = msg.camps.map((a) => ({ id: a[0], x: a[1], y: a[2], type: CAMP_KEYS[a[3]], alive: !!a[4], respawn: a[5] }));

    for (const f of msg.fx) {
      effects.push({ ...f, born: now + INTERP_DELAY }); // shown in step with the delayed troops
      if (f.k === 'tshot') {
        // turn the shooting tower's turret (or flare the core) toward its target
        const tx = Math.floor(f.x1);
        const ty = Math.floor(f.y1);
        const t = towers.get(grid.get(`${tx},${ty}`));
        const p = t ? null : [...players.values()].find((q) => q.x === tx && q.y === ty);
        const o = t || p;
        if (o) {
          o.aim = Math.atan2(f.y2 - f.y1, f.x2 - f.x1);
          o.shotAt = now;
        }
      }
    }
    for (const text of msg.feed) feed.push({ text, born: now });
    while (feed.length > 6) feed.shift();

    if (centerOnMe && myId && players.has(myId)) {
      const p = players.get(myId);
      cam.x = p.x + 0.5;
      cam.y = p.y + 0.5;
      centerOnMe = false;
    }
  }

  // ------------------------------------------------------------------ targets
  // Targets are encoded like the server does: 't:<tower id>', 'c:<player id>', 'j:<camp id>'.
  function targetPos(key) {
    if (!key) return null;
    const [k, raw] = key.split(':');
    const id = Number(raw);
    if (k === 't') {
      const t = towers.get(id);
      return t ? { x: t.x + 0.5, y: t.y + 0.5 } : null;
    }
    if (k === 'c') {
      const p = players.get(id);
      return p ? { x: p.x + 0.5, y: p.y + 0.5 } : null;
    }
    const camp = camps[id];
    return camp ? { x: camp.x + 0.5, y: camp.y + 0.5 } : null;
  }

  function targetName(key) {
    if (!key) return '';
    const [k, raw] = key.split(':');
    const id = Number(raw);
    if (k === 'c') return id === myId ? 'your core' : `${(players.get(id) || { name: '?' }).name}'s core`;
    if (k === 'j') return 'a jungle camp';
    const t = towers.get(id);
    if (!t) return 'a tower';
    return t.owner === myId ? 'your tower' : `${(players.get(t.owner) || { name: '?' }).name}'s tower`;
  }

  // What's under world point (wx, wy) that troops can be ordered at?
  function orderTargetAt(wx, wy) {
    for (const p of players.values()) {
      if (Math.hypot(p.x + 0.5 - wx, p.y + 0.5 - wy) < 1.1) return { k: 'c', id: p.id };
    }
    const tid = grid.get(`${Math.floor(wx)},${Math.floor(wy)}`);
    const t = tid && towers.get(tid);
    if (t && t.owner) return { k: 't', id: t.id };
    for (const c of camps) {
      if (c.alive && Math.hypot(c.x + 0.5 - wx, c.y + 0.5 - wy) < 1.8) return { k: 'j', id: c.id };
    }
    return null;
  }

  function isMineTarget(tg) {
    return (tg.k === 'c' && tg.id === myId) || (tg.k === 't' && towers.get(tg.id)?.owner === myId);
  }

  // ------------------------------------------------------------------ territory layer
  // Territory is a tile grid, but drawing it tile by tile looks like a staircase. Instead we trace
  // each region's outline along tile edges, smooth it (moving average, then Chaikin corner
  // cutting), and keep the result as a vector Path2D (in tile units) so borders stay crisp.

  // Trace closed outlines of every owned region. Edges run clockwise (interior on the right).
  function traceOutlines() {
    const W = C.MAP_W;
    const H = C.MAP_H;
    const VW = W + 1;
    const x0 = [];
    const y0 = [];
    const x1 = [];
    const y1 = [];
    const own = [];
    const out = new Map(); // vertex key -> outgoing edge indices
    const add = (ax, ay, bx, by, o) => {
      const i = own.length;
      x0.push(ax); y0.push(ay); x1.push(bx); y1.push(by); own.push(o);
      const k = ay * VW + ax;
      const list = out.get(k);
      if (list) list.push(i);
      else out.set(k, [i]);
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = terr[y * W + x];
        if (!o) continue;
        if (y === 0 || terr[(y - 1) * W + x] !== o) add(x, y, x + 1, y, o);
        if (x === W - 1 || terr[y * W + x + 1] !== o) add(x + 1, y, x + 1, y + 1, o);
        if (y === H - 1 || terr[(y + 1) * W + x] !== o) add(x + 1, y + 1, x, y + 1, o);
        if (x === 0 || terr[y * W + x - 1] !== o) add(x, y + 1, x, y, o);
      }
    }
    const used = new Uint8Array(own.length);
    const loops = [];
    for (let start = 0; start < own.length; start++) {
      if (used[start]) continue;
      const o = own[start];
      const pts = [];
      let e = start;
      for (;;) {
        used[e] = 1;
        pts.push([x0[e], y0[e]]);
        const cands = (out.get(y1[e] * VW + x1[e]) || []).filter((j) => !used[j] && own[j] === o);
        if (!cands.length) break;
        let next = cands[0];
        if (cands.length > 1) {
          // Saddle point (two tiles touching diagonally): turn right to hug the current tile.
          const rx = -(y1[e] - y0[e]);
          const ry = x1[e] - x0[e];
          next = cands.find((j) => x1[j] - x0[j] === rx && y1[j] - y0[j] === ry) ?? next;
        }
        e = next;
      }
      loops.push({ owner: o, pts });
    }
    return loops;
  }

  // Moving average along the loop: turns tile staircases into straight diagonals and curves.
  function relax(pts, window, passes) {
    const n = pts.length;
    if (n < 12) return pts;
    for (let k = 0; k < passes; k++) {
      const next = new Array(n);
      for (let i = 0; i < n; i++) {
        let sx = 0;
        let sy = 0;
        for (let j = -window; j <= window; j++) {
          const p = pts[(i + j + n) % n];
          sx += p[0];
          sy += p[1];
        }
        next[i] = [sx / (2 * window + 1), sy / (2 * window + 1)];
      }
      pts = next;
    }
    return pts;
  }

  function chaikin(pts, iters) {
    for (let k = 0; k < iters; k++) {
      const n = pts.length;
      const next = new Array(n * 2);
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % n];
        next[2 * i] = [p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25];
        next[2 * i + 1] = [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75];
      }
      pts = next;
    }
    return pts;
  }

  function drawTerritory() {
    terrStamp++;
    const byOwner = new Map();
    for (const loop of traceOutlines()) {
      let path = byOwner.get(loop.owner);
      if (!path) byOwner.set(loop.owner, (path = new Path2D()));
      const pts = chaikin(relax(loop.pts, SMOOTH_WINDOW, SMOOTH_PASSES), 2);
      path.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
      path.closePath();
    }
    terrShapes = [...byOwner].map(([owner, path]) => ({ owner, path }));

    // Low-res copy for the minimap.
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, terrCanvas.width, terrCanvas.height);
    tctx.setTransform(TPX, 0, 0, TPX, 0, 0);
    for (const { owner, path } of terrShapes) {
      tctx.fillStyle = colorOf(owner, 50, 0.35);
      tctx.fill(path);
      tctx.strokeStyle = colorOf(owner, 62, 0.9);
      tctx.lineWidth = 0.6;
      tctx.stroke(path);
    }
  }

  // Territory fills and borders in world space. Borders are stroked inside each region
  // (clip + double width) so neighbouring territories show two clean, non-overlapping bands.
  function drawTerritoryShapes(ox, oy, s) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.lineJoin = 'round';
    for (const { owner, path } of terrShapes) {
      ctx.fillStyle = colorOf(owner, 50, owner === myId ? 0.2 : 0.12);
      ctx.fill(path);
    }
    for (const { owner, path } of terrShapes) {
      const mine = owner === myId;
      ctx.save();
      ctx.clip(path);
      ctx.strokeStyle = colorOf(owner, 60, mine ? 0.22 : 0.14);
      ctx.lineWidth = 16 / s;
      ctx.stroke(path);
      ctx.strokeStyle = colorOf(owner, 62, mine ? 1 : 0.8);
      ctx.lineWidth = (mine ? 6 : 4) / s;
      ctx.stroke(path);
      ctx.restore();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ rendering
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  const onScreen = (x, y, pad) => x > -pad && y > -pad && x < canvas.width + pad && y < canvas.height + pad;

  function drawBackground() {
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const s = scale();
    const [ox, oy] = toScreen(0, 0);
    ctx.fillStyle = '#121820';
    ctx.fillRect(ox, oy, C.MAP_W * s, C.MAP_H * s);

    if (s >= 14) {
      const [x0, y0] = toWorld(0, 0);
      const [x1, y1] = toWorld(canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(C.MAP_W, Math.ceil(x1)); x++) {
        const sx = Math.round(ox + x * s) + 0.5;
        ctx.moveTo(sx, Math.max(oy, 0));
        ctx.lineTo(sx, Math.min(oy + C.MAP_H * s, canvas.height));
      }
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(C.MAP_H, Math.ceil(y1)); y++) {
        const sy = Math.round(oy + y * s) + 0.5;
        ctx.moveTo(Math.max(ox, 0), sy);
        ctx.lineTo(Math.min(ox + C.MAP_W * s, canvas.width), sy);
      }
      ctx.stroke();
    }

    drawTerritoryShapes(ox, oy, s);

    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 3;
    ctx.strokeRect(ox, oy, C.MAP_W * s, C.MAP_H * s);
  }

  function hpBar(x, y, w, frac) {
    if (frac >= 0.999) return;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - w / 2, y, w, 4);
    ctx.fillStyle = frac > 0.5 ? '#3fb950' : frac > 0.25 ? '#d29922' : '#f85149';
    ctx.fillRect(x - w / 2, y, w * Math.max(0, frac), 4);
  }

  function label(text, x, y, size, color) {
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawShape(kind, x, y, r, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    switch (kind) {
      case 'archer':
        ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.85);
        ctx.lineTo(x + r * 0.35, y - r * 0.2);
        ctx.lineTo(x - r * 0.35, y - r * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(x - r * 0.09, y - r * 0.25, r * 0.18, r * 0.75);
        break;
      case 'guard':
        ctx.moveTo(x - r * 0.8, y - r * 0.75);
        ctx.lineTo(x + r * 0.8, y - r * 0.75);
        ctx.lineTo(x + r * 0.8, y);
        ctx.quadraticCurveTo(x + r * 0.7, y + r * 0.7, x, y + r * 0.95);
        ctx.quadraticCurveTo(x - r * 0.7, y + r * 0.7, x - r * 0.8, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = Math.max(1, r * 0.12);
        ctx.stroke();
        break;
      case 'medic':
        ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(x - r * 0.14, y - r * 0.5, r * 0.28, r);
        ctx.fillRect(x - r * 0.5, y - r * 0.14, r, r * 0.28);
        break;
      case 'frost':
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          ctx.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85);
        }
        ctx.closePath();
        ctx.fill();
        break;
      case 'mortar':
        ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'tower':
        // battlemented turret
        ctx.moveTo(x - r * 0.8, y + r * 0.8);
        ctx.lineTo(x - r * 0.8, y - r * 0.55);
        for (let i = 0; i < 4; i++) {
          const bx = x - r * 0.8 + (i * r * 1.6) / 3.5;
          ctx.lineTo(bx, y - r * 0.9);
          ctx.lineTo(bx + r * 0.25, y - r * 0.9);
          ctx.lineTo(bx + r * 0.25, y - r * 0.55);
          ctx.lineTo(bx + r * 0.46, y - r * 0.55);
        }
        ctx.lineTo(x + r * 0.8, y - r * 0.9);
        ctx.lineTo(x + r * 0.8, y + r * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(x - r * 0.18, y + r * 0.1, r * 0.36, r * 0.7);
        break;
      default:
        ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
    }
  }

  // ---- structures
  // Health bars only appear once a structure has been hit, then fade out. They stay up while it is
  // selected, hovered or badly damaged. A pale "trail" shows the damage just taken.
  const BAR_HOLD = 3000;
  const BAR_FADE = 1000;
  function structBarAlpha(o, now, forced) {
    if (forced || o.hp / o.maxHp < 0.35) return 1;
    const since = now - (o.hitAt || -1e9);
    return since < BAR_HOLD ? 1 : Math.max(0, 1 - (since - BAR_HOLD) / BAR_FADE);
  }
  function structBar(o, x, y, w, now, forced, dt) {
    o.trail = o.trail === undefined ? o.hp : Math.max(o.hp, o.trail - (o.maxHp * 0.35 + (o.trail - o.hp) * 2) * dt);
    const a = structBarAlpha(o, now, forced);
    if (a <= 0) return;
    const h = Math.max(4, Math.round(w * 0.09));
    const frac = Math.max(0, o.hp / o.maxHp);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    roundRect(x - w / 2 - 1, y - 1, w + 2, h + 2, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(x - w / 2, y, w * Math.min(1, o.trail / o.maxHp), h);
    ctx.fillStyle = frac > 0.5 ? '#3fb950' : frac > 0.25 ? '#d29922' : '#f85149';
    ctx.fillRect(x - w / 2, y, w * frac, h);
    ctx.globalAlpha = 1;
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function polygon(x, y, r, n, rot) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (Math.PI * 2 * i) / n;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }
  // Small deterministic random numbers per structure, for rubble and cracks.
  function hashRand(seed) {
    let h = seed * 2654435761 >>> 0;
    return () => {
      h ^= h << 13; h >>>= 0;
      h ^= h >>> 17;
      h ^= h << 5; h >>>= 0;
      return h / 4294967296;
    };
  }
  function drawCracks(x, y, r, damage, seed) {
    if (damage < 0.4) return;
    const rnd = hashRand(seed);
    const n = damage > 0.7 ? 4 : 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      let a = rnd() * Math.PI * 2;
      let d = r * (0.25 + rnd() * 0.2);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
      for (let j = 0; j < 3; j++) {
        a += (rnd() - 0.5) * 0.9;
        d += r * 0.22;
        ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  function drawSmoke(x, y, r, now, seed) {
    for (let i = 0; i < 3; i++) {
      const p = ((now / 1600 + i / 3 + seed * 0.13) % 1);
      ctx.fillStyle = `rgba(60, 60, 60, ${0.45 * (1 - p)})`;
      ctx.beginPath();
      ctx.arc(x + Math.sin(seed + i * 2 + p * 3) * r * 0.3, y - r * 0.2 - p * r * 1.6, r * (0.2 + p * 0.35), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // A defensive tower: stone platform in the owner's colours, a turret that turns toward its
  // last shot and recoils, and extra stonework, a banner and a gold crown as it levels up.
  function drawTowerSprite(t, x, y, s, now) {
    const lvl = t.level;
    const r = s * 0.5 * (1 + 0.1 * (lvl - 1));
    const flip = t.flipAt ? (now - t.flipAt) / 900 : 1;
    const bounce = flip < 1 ? 1 + 0.3 * Math.sin(flip * Math.PI * 3) * (1 - flip) : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(bounce, bounce);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(r * 0.12, r * 0.3, r * 1.2, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();

    // level 5: radiant aura in the owner's colour
    if (lvl >= 5) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 400 + t.id);
      const ag = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2);
      ag.addColorStop(0, colorOf(t.owner, 65, 0.45 + 0.2 * pulse));
      ag.addColorStop(1, colorOf(t.owner, 65, 0));
      ctx.fillStyle = ag;
      ctx.beginPath();
      ctx.arc(0, 0, r * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // level 4+: a ring of gold runes turning around the base
    if (lvl >= 4) {
      ctx.save();
      ctx.rotate(-now / 2500);
      ctx.strokeStyle = 'rgba(255, 213, 79, 0.75)';
      ctx.lineWidth = Math.max(1.5, s * 0.05);
      ctx.setLineDash([s * 0.12, s * 0.1]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI * 2 * i) / 3;
        ctx.fillStyle = '#ffd54f';
        polygon(Math.cos(a) * r * 1.45, Math.sin(a) * r * 1.45, Math.max(2, s * 0.08), 4, a);
        ctx.fill();
      }
      ctx.restore();
    }

    // buttresses (level 2+)
    if (lvl >= 2) {
      ctx.fillStyle = '#6e6658';
      ctx.strokeStyle = colorOf(t.owner, 60);
      ctx.lineWidth = Math.max(1, s * 0.04);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (Math.PI / 2) * i;
        const bx = Math.cos(a) * r * 0.95;
        const by = Math.sin(a) * r * 0.95;
        polygon(bx, by, r * 0.32, 4, a);
        ctx.fill();
        ctx.stroke();
      }
    }

    // platform
    polygon(0, 0, r * 1.1, 8, Math.PI / 8);
    ctx.fillStyle = colorOf(t.owner, 26);
    ctx.fill();
    ctx.strokeStyle = colorOf(t.owner, 62);
    ctx.lineWidth = Math.max(1.5, s * 0.08);
    ctx.stroke();
    polygon(0, 0, r * 0.82, 8, Math.PI / 8);
    ctx.fillStyle = '#8a8070';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.stroke();
    // stone joints
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
      ctx.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
    }
    ctx.stroke();
    drawCracks(0, 0, r * 0.8, 1 - t.hp / t.maxHp, t.id);

    // gold crown ring (level 3)
    if (lvl >= 3) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + now / 3000;
        ctx.fillStyle = '#ffe082';
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, Math.max(1.2, s * 0.045), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // turret: barrel toward the last target, kicking back when it fires
    const recoil = t.shotAt ? Math.max(0, 1 - (now - t.shotAt) / 180) : 0;
    ctx.rotate(t.aim ?? -Math.PI / 2);
    ctx.fillStyle = '#2b2722';
    ctx.strokeStyle = colorOf(t.owner, 62);
    ctx.lineWidth = Math.max(1, s * 0.03);
    const bl = r * (0.95 + 0.1 * (lvl - 1));
    roundRect(r * (0.1 - 0.2 * recoil), -r * 0.15, bl, r * 0.3, r * 0.08);
    ctx.fill();
    ctx.stroke();
    if (lvl >= 3) {
      // twin barrels
      roundRect(r * (0.1 - 0.2 * recoil), -r * 0.38, bl * 0.8, r * 0.16, r * 0.05);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#c9bca3';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.stroke();
    ctx.rotate(-(t.aim ?? -Math.PI / 2));
    // gem in the owner's colour, flaring on each shot
    ctx.fillStyle = recoil > 0 || lvl >= 5 ? '#fff' : colorOf(t.owner, 62);
    polygon(0, 0, r * (0.17 + 0.06 * recoil), 4, 0);
    ctx.fill();
    if (lvl >= 3) {
      ctx.shadowColor = colorOf(t.owner, 60);
      ctx.shadowBlur = s * 0.4 * (0.7 + 0.3 * Math.sin(now / 300));
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // banner (level 2+)
    if (lvl >= 2) {
      const px = -r * 0.85;
      const py = -r * 0.85;
      ctx.strokeStyle = '#3b3630';
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath();
      ctx.moveTo(px, py + r * 0.5);
      ctx.lineTo(px, py - r * 0.55);
      ctx.stroke();
      const wave = Math.sin(now / 220 + t.id) * r * 0.08;
      ctx.fillStyle = colorOf(t.owner, 55);
      ctx.beginPath();
      ctx.moveTo(px, py - r * 0.55);
      ctx.quadraticCurveTo(px + r * 0.3, py - r * 0.55 + wave, px + r * 0.55, py - r * 0.42 + wave);
      ctx.lineTo(px, py - r * 0.2);
      ctx.closePath();
      ctx.fill();
    }

    // capture / claim flash
    if (flip < 1) {
      ctx.globalAlpha = (1 - flip) * 0.8;
      ctx.fillStyle = '#fff';
      polygon(0, 0, r * 1.1, 8, Math.PI / 8);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (flip < 1) {
      // burst of shards in the new owner's colour, plus the old colour fading out
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI * 2 * i) / 10 + t.id;
        const d = s * (0.6 + flip * 2.2);
        ctx.fillStyle = colorOf(i % 3 === 0 && t.prevOwner ? t.prevOwner : t.owner, 60, 1 - flip);
        polygon(x + Math.cos(a) * d, y + Math.sin(a) * d, s * 0.12 * (1 - flip * 0.5), 3, a + flip * 6);
        ctx.fill();
      }
    }
    if (t.hp / t.maxHp < 0.3) drawSmoke(x, y, r, now, t.id);

    // level pips
    for (let i = 0; i < lvl; i++) {
      ctx.fillStyle = '#ffd54f';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      polygon(x - (lvl - 1) * r * 0.22 + i * r * 0.44, y + r * 1.3, Math.max(2, s * 0.07), 4, 0);
      ctx.fill();
      ctx.stroke();
    }
  }

  // A ruin: scattered rubble and a broken stub.
  function drawRuin(t, x, y, s) {
    const r = s * 0.5;
    const rnd = hashRand(t.id + 7);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.2, r * 1.1, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2;
      const d = r * (0.3 + rnd() * 0.75);
      ctx.fillStyle = i % 2 ? '#5d574d' : '#6e675b';
      polygon(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.14 + rnd() * 0.16), 5, rnd() * 6);
      ctx.fill();
    }
    ctx.fillStyle = '#4a453d';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.4, y + r * 0.3);
    ctx.lineTo(x - r * 0.4, y - r * 0.2);
    ctx.lineTo(x - r * 0.15, y - r * 0.45);
    ctx.lineTo(x + r * 0.05, y - r * 0.15);
    ctx.lineTo(x + r * 0.25, y - r * 0.35);
    ctx.lineTo(x + r * 0.4, y - r * 0.05);
    ctx.lineTo(x + r * 0.4, y + r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawTowers(dt) {
    const s = scale();
    const now = performance.now();
    const hover = grid.get(`${Math.floor(mouse.wx)},${Math.floor(mouse.wy)}`);
    for (const t of towers.values()) {
      const [x, y] = toScreen(t.x + 0.5, t.y + 0.5);
      if (!onScreen(x, y, s * 3)) continue;
      if (t.ruin || !t.owner) {
        drawRuin(t, x, y, s);
        if (t.id === selectedId) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.strokeRect(x - s / 2, y - s / 2, s, s);
        }
        continue;
      }
      const r = s * 0.5 * (1 + 0.1 * (t.level - 1));
      if (t.id === selectedId) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -now / 60;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      drawTowerSprite(t, x, y, s, now);
      const sieged = t.cap > 0 && t.capBy;
      structBar(t, x, y - r * (sieged ? 2.6 : 1.75), s * 1.0, now, t.id === selectedId || t.id === hover, dt);
      if (t.cap > 0 && t.capBy) {
        // Capture in progress: a ring filling in the attacker's colour.
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = Math.max(3, s * 0.14);
        ctx.beginPath();
        ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = colorOf(t.capBy, 60);
        ctx.beginPath();
        ctx.arc(x, y, r * 1.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t.cap);
        ctx.stroke();
        const txt = t.owner === myId ? `Under siege ${Math.round(t.cap * 100)}%` : `Capturing ${Math.round(t.cap * 100)}%`;
        label(txt, x, y - r * 2.85, Math.max(10, Math.round(s * 0.4)), t.owner === myId ? '#ff7b72' : '#fff');
      }
    }
  }

  function drawUnits(dt) {
    const s = scale();
    const r = s * 0.34;
    const rt = renderTime();
    for (const u of units.values()) {
      [u.rx, u.ry] = interpPos(u, rt);
      const [x, y] = toScreen(u.rx, u.ry);
      if (!onScreen(x, y, s)) continue;
      if (selUnits.has(u.id)) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
        ctx.stroke();
      }
      const op = players.get(u.owner);
      if (op && op.buff) {
        // jungle buff: flickering ember aura
        const fl = 0.5 + 0.3 * Math.sin(performance.now() / 90 + u.id);
        ctx.fillStyle = `rgba(255, 120, 40, ${0.35 * fl})`;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 170, 60, ${fl})`;
        ctx.lineWidth = Math.max(1.5, s * 0.05);
        ctx.stroke();
      }
      ctx.fillStyle = colorOf(u.owner, 30, 0.9);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colorOf(u.owner, 60);
      ctx.lineWidth = Math.max(1.5, s * 0.07);
      ctx.stroke();
      drawShape(u.kind, x, y, r, C.UNITS[u.kind].color);
      for (let i = 0; i < u.level; i++) {
        ctx.fillStyle = '#ffd54f';
        ctx.beginPath();
        ctx.arc(x + (i - (u.level - 1) / 2) * r * 0.42, y + r * 1.1, Math.max(1.5, s * 0.055), 0, Math.PI * 2);
        ctx.fill();
      }
      hpBar(x, y - r * 1.6, s * 0.7, u.hp / u.maxHp);
    }
  }

  function drawCamps() {
    const s = scale();
    for (const c of camps) {
      const [x, y] = toScreen(c.x + 0.5, c.y + 0.5);
      if (!onScreen(x, y, s * 3)) continue;
      ctx.save();
      ctx.strokeStyle = c.alive ? 'rgba(214, 180, 120, 0.45)' : 'rgba(139, 148, 158, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, s * 1.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (!c.alive) label(`${c.respawn}s`, x, y + 4, Math.max(10, Math.round(s * 0.4)), '#8b949e');
      else if (C.BUFF_CAMPS.includes(c.type) && s >= 12) {
        // golem camps grant the jungle buff
        drawFlame(x + s * 1.2, y - s * 1.2, s * 0.32);
        label('buff', x + s * 1.2, y - s * 0.55, Math.max(9, Math.round(s * 0.3)), '#ffab40');
      }
    }
  }

  function drawFlame(x, y, r) {
    const flick = 1 + 0.08 * Math.sin(performance.now() / 90);
    ctx.fillStyle = '#ff7043';
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.3 * flick);
    ctx.quadraticCurveTo(x + r, y - r * 0.2, x + r * 0.6, y + r * 0.6);
    ctx.quadraticCurveTo(x, y + r * 1.1, x - r * 0.6, y + r * 0.6);
    ctx.quadraticCurveTo(x - r, y - r * 0.2, x, y - r * 1.3 * flick);
    ctx.fill();
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.4 * flick);
    ctx.quadraticCurveTo(x + r * 0.45, y + r * 0.2, x, y + r * 0.7);
    ctx.quadraticCurveTo(x - r * 0.45, y + r * 0.2, x, y - r * 0.4 * flick);
    ctx.fill();
  }

  function drawCreeps(dt) {
    const s = scale();
    const rt = renderTime();
    for (const c of creeps.values()) {
      [c.rx, c.ry] = interpPos(c, rt);
      const [x, y] = toScreen(c.rx, c.ry);
      if (!onScreen(x, y, s)) continue;
      const r = C.CREEPS[c.kind].size * s;
      ctx.fillStyle = c.kind === 'golem' ? '#8d7b68' : '#c9a66b';
      ctx.strokeStyle = c.angry ? '#f85149' : 'rgba(0,0,0,0.7)';
      ctx.lineWidth = c.angry ? 2.5 : 1.5;
      ctx.beginPath();
      if (c.kind === 'golem') {
        for (let i = 0; i < 5; i++) {
          const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
          ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath();
      } else {
        ctx.moveTo(x, y - r * 1.1);
        ctx.lineTo(x + r, y + r * 0.8);
        ctx.lineTo(x - r, y + r * 0.8);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
      hpBar(x, y - r - 6, s * 0.6, c.hp);
    }
  }

  // A core: a stone platform with a turning rune ring and a floating crystal in the player's colour.
  // It cracks and smokes as it takes damage, and flashes when hit.
  function drawCores(dt) {
    const s = scale();
    const now = performance.now();
    for (const p of players.values()) {
      const [x, y] = toScreen(p.x + 0.5, p.y + 0.5);
      if (!onScreen(x, y, s * 3)) continue;
      const r = s * 0.75;
      const frac = p.hp / p.maxHp;
      const hit = p.hitAt ? Math.max(0, 1 - (now - p.hitAt) / 160) : 0;

      // glow
      const grd = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2);
      grd.addColorStop(0, colorOf(p.id, 60, 0.55));
      grd.addColorStop(1, colorOf(p.id, 60, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, r * 2, 0, Math.PI * 2);
      ctx.fill();

      // shadow and platform
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(x + r * 0.1, y + r * 0.25, r * 1.15, r * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      polygon(x, y, r * 1.08, 8, Math.PI / 8);
      ctx.fillStyle = '#4d4a44';
      ctx.fill();
      ctx.strokeStyle = colorOf(p.id, 62);
      ctx.lineWidth = Math.max(2, s * 0.09);
      ctx.stroke();
      polygon(x, y, r * 0.86, 8, Math.PI / 8);
      ctx.fillStyle = colorOf(p.id, 22);
      ctx.fill();
      // corner studs
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (Math.PI / 4) * i;
        ctx.fillStyle = '#c9bca3';
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * r * 1.08, y + Math.sin(a) * r * 1.08, Math.max(1.5, s * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }

      // turning rune ring
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(now / 4000);
      ctx.strokeStyle = colorOf(p.id, 70, 0.8);
      ctx.lineWidth = Math.max(1.5, s * 0.05);
      ctx.setLineDash([s * 0.18, s * 0.12]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i;
        ctx.fillStyle = colorOf(p.id, 75);
        polygon(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, Math.max(2, s * 0.08), 4, a);
        ctx.fill();
      }
      ctx.restore();
      drawCracks(x, y, r * 0.9, 1 - frac, p.id * 31);

      // floating crystal
      const bob = Math.sin(now / 500 + p.id) * r * 0.07;
      const cy = y - r * 0.12 + bob;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.18, r * 0.3, r * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      const cg = ctx.createLinearGradient(x - r * 0.3, cy - r * 0.5, x + r * 0.3, cy + r * 0.4);
      cg.addColorStop(0, colorOf(p.id, 85));
      cg.addColorStop(0.5, colorOf(p.id, 58));
      cg.addColorStop(1, colorOf(p.id, 32));
      ctx.fillStyle = cg;
      ctx.shadowColor = colorOf(p.id, 60);
      ctx.shadowBlur = s * (0.3 + 0.15 * Math.sin(now / 350 + p.id) + (p.shotAt && now - p.shotAt < 200 ? 0.5 : 0));
      ctx.beginPath();
      ctx.moveTo(x, cy - r * 0.62);
      ctx.lineTo(x + r * 0.3, cy - r * 0.05);
      ctx.lineTo(x, cy + r * 0.38);
      ctx.lineTo(x - r * 0.3, cy - r * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.moveTo(x, cy - r * 0.62);
      ctx.lineTo(x + r * 0.3, cy - r * 0.05);
      ctx.lineTo(x, cy - r * 0.1);
      ctx.closePath();
      ctx.fill();

      if (hit > 0) {
        ctx.globalAlpha = hit * 0.6;
        ctx.fillStyle = '#fff';
        polygon(x, y, r * 1.08, 8, Math.PI / 8);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (frac < 0.35) drawSmoke(x, y, r, now, p.id);

      // jungle buff: a flickering ember ring
      if (p.buff) {
        ctx.strokeStyle = `rgba(255, 140, 50, ${0.55 + 0.25 * Math.sin(now / 120)})`;
        ctx.lineWidth = Math.max(2, s * 0.07);
        ctx.beginPath();
        ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
        ctx.stroke();
      }

      structBar(p, x, y - r * 1.55, s * 1.6, now, Math.hypot(mouse.wx - p.x - 0.5, mouse.wy - p.y - 0.5) < 1.2, dt);
      label(p.id === myId ? `${p.name} (you)` : p.name, x, y - r * 1.75, Math.max(11, Math.round(s * 0.5)), '#fff');

      if (p.shield) {
        // spawn shield: a shimmering hex bubble
        const a = 0.35 + 0.2 * Math.sin(now / 250);
        ctx.strokeStyle = `rgba(121, 192, 255, ${a + 0.2})`;
        ctx.fillStyle = `rgba(121, 192, 255, ${a * 0.25})`;
        ctx.lineWidth = 2;
        polygon(x, y, r * 1.75, 6, now / 5000);
        ctx.fill();
        ctx.stroke();
        label(`protected ${p.shield}s`, x, y + r * 2.4, Math.max(10, Math.round(s * 0.38)), '#79c0ff');
      }
    }
  }

  function drawEffects(now) {
    const s = scale();
    effects = effects.filter((f) => now - f.born < (f.k === 'coreDown' || f.k === 'buff' ? 1200 : f.k === 'wave' ? 700 : f.k === 'gold' ? 1100 : 450));
    for (const f of effects) {
      const age = (now - f.born) / 1000;
      if (age < 0) continue; // not due yet (effects are delayed to match troop interpolation)
      switch (f.k) {
        case 'bolt':
        case 'tshot': {
          const life = f.k === 'tshot' ? 0.16 : 0.12;
          if (age > life) break;
          const [x1, y1] = toScreen(f.x1, f.y1);
          const [x2, y2] = toScreen(f.x2, f.y2);
          ctx.strokeStyle = f.k === 'tshot' ? colorOf(f.o, 70, 1 - age / life) : `rgba(160, 230, 255, ${1 - age / life})`;
          ctx.lineWidth = f.k === 'tshot' ? 3.5 : 2;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          break;
        }
        case 'slash': {
          if (age > 0.18) break;
          const [x, y] = toScreen(f.x, f.y);
          ctx.strokeStyle = `rgba(255, 255, 255, ${1 - age / 0.18})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(x, y, s * 0.4, -2.4 + age * 8, -0.8 + age * 8);
          ctx.stroke();
          break;
        }
        case 'heal': {
          if (age > 0.5) break;
          const [x, y] = toScreen(f.x, f.y);
          const p = age / 0.5;
          ctx.strokeStyle = `rgba(126, 231, 135, ${0.6 * (1 - p)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, f.r * s * (0.3 + 0.7 * p), 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = `rgba(126, 231, 135, ${1 - p})`;
          ctx.font = `bold ${Math.round(s * 0.5)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('+', x, y - s * (0.5 + p * 0.6));
          break;
        }
        case 'frost': {
          if (age > 0.35) break;
          const [x, y] = toScreen(f.x, f.y);
          ctx.strokeStyle = `rgba(179, 229, 252, ${0.8 * (1 - age / 0.35)})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, f.r * s * (0.3 + age / 0.5), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'shell': {
          if (age > 0.45) break;
          const [x1, y1] = toScreen(f.x1, f.y1);
          const [x2, y2] = toScreen(f.x2, f.y2);
          if (age < 0.15) {
            const p = age / 0.15;
            const arc = Math.sin(p * Math.PI) * s * 1.5;
            ctx.fillStyle = '#ffccbc';
            ctx.beginPath();
            ctx.arc(x1 + (x2 - x1) * p, y1 + (y2 - y1) * p - arc, s * 0.12, 0, Math.PI * 2);
            ctx.fill();
          } else {
            const p = (age - 0.15) / 0.3;
            ctx.fillStyle = `rgba(255, 138, 101, ${0.6 * (1 - p)})`;
            ctx.beginPath();
            ctx.arc(x2, y2, f.r * s * (0.4 + p * 0.6), 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case 'boom': {
          const [x, y] = toScreen(f.x, f.y);
          const p = age / 0.45;
          ctx.fillStyle = `rgba(255, 171, 64, ${0.7 * (1 - p)})`;
          ctx.beginPath();
          ctx.arc(x, y, f.r * s * (0.5 + p), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'hit': {
          if (age > 0.2) break;
          const [x, y] = toScreen(f.x, f.y);
          ctx.fillStyle = `rgba(248, 81, 73, ${0.6 * (1 - age / 0.2)})`;
          ctx.beginPath();
          ctx.arc(x, y, s * 0.35, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'gold': {
          // Bounty popup - only for the player who earned it.
          if (f.o !== myId) break;
          const [x, y] = toScreen(f.x, f.y);
          const p = age / 1.1;
          const big = f.n >= 100;
          ctx.globalAlpha = Math.max(0, 1 - p * p);
          label(`+${f.n}g`, x, y - s * (0.6 + p * 1.4), Math.round((big ? 18 : 13) + (big ? 4 : 0) * (1 - p)), '#ffd54f');
          ctx.globalAlpha = 1;
          break;
        }
        case 'buff': {
          const [x, y] = toScreen(f.x, f.y);
          const p = age / 1.2;
          ctx.strokeStyle = `rgba(255, 140, 50, ${1 - p})`;
          ctx.lineWidth = 5 * (1 - p) + 1;
          ctx.beginPath();
          ctx.arc(x, y, s * (0.8 + p * 4), 0, Math.PI * 2);
          ctx.stroke();
          drawFlame(x, y - s * p * 1.5, s * 0.6 * (1 - p * 0.5));
          if (f.o === myId) label('EMPOWERED!', x, y - s * (1.6 + p * 1.5), Math.max(13, Math.round(s * 0.6)), '#ffab40');
          break;
        }
        case 'wave': {
          const [x, y] = toScreen(f.x, f.y);
          const p = age / 0.7;
          ctx.strokeStyle = colorOf(f.o, 70, 0.8 * (1 - p));
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, s * (0.8 + p * 2.2), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'capture': {
          const [x, y] = toScreen(f.x, f.y);
          const p = Math.min(1, age / 0.45);
          ctx.strokeStyle = colorOf(f.o, 60, 1 - p);
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(x, y, s * (0.5 + p * 4), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'coreDown': {
          const [x, y] = toScreen(f.x, f.y);
          const p = age / 1.2;
          ctx.strokeStyle = `rgba(255, 213, 79, ${1 - p})`;
          ctx.lineWidth = 6 * (1 - p) + 1;
          ctx.beginPath();
          ctx.arc(x, y, s * (1 + p * 7), 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = `rgba(255, 112, 67, ${0.5 * (1 - p)})`;
          ctx.beginPath();
          ctx.arc(x, y, s * (0.5 + p * 3), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }
  }

  // ---- leapfrogging: unclaimed tiles within TOWER_LEAP of my land accept towers
  let leapZone = new Uint8Array(C.MAP_W * C.MAP_H);
  let leapKey = '';

  function getLeapZone() {
    const key = `${myId}:${terrStamp}`;
    if (key === leapKey) return leapZone;
    leapKey = key;
    leapZone = new Uint8Array(C.MAP_W * C.MAP_H);
    if (!myId) return leapZone;
    const R = C.TOWER_LEAP;
    for (let y = 0; y < C.MAP_H; y++) {
      for (let x = 0; x < C.MAP_W; x++) {
        if (terr[y * C.MAP_W + x] !== myId) continue;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= C.MAP_W || ny >= C.MAP_H || Math.hypot(dx, dy) > R + 0.01) continue;
            const k = ny * C.MAP_W + nx;
            if (terr[k] === 0) leapZone[k] = 1;
          }
        }
      }
    }
    return leapZone;
  }

  function canBuildAt(x, y) {
    if (!me || x < 0 || y < 0 || x >= C.MAP_W || y >= C.MAP_H) return false;
    const k = y * C.MAP_W + x;
    if (terr[k] !== myId && !getLeapZone()[k]) return false;
    if (grid.has(`${x},${y}`)) return false;
    for (const p of players.values()) if (p.x === x && p.y === y) return false;
    return true;
  }

  // Land a new tower at (bx, by) would win: mirrors the server's nearest-claim rule
  // (cores hold land at half distance, towers at full distance).
  function claimPreview(bx, by) {
    const r = C.towerStats('tower', 1).claim + 0.25;
    const R = Math.ceil(r);
    const gained = [];
    const stolen = new Map();
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = bx + dx;
        const y = by + dy;
        const d = Math.hypot(dx, dy);
        if (d > r || x < 0 || y < 0 || x >= C.MAP_W || y >= C.MAP_H) continue;
        const o = terr[y * C.MAP_W + x];
        if (o === myId) continue;
        if (o) {
          const core = players.get(o);
          let eff = core ? Math.hypot(core.x - x, core.y - y) * 0.5 : Infinity;
          for (const t of towers.values()) {
            if (t.owner !== o) continue;
            const td = Math.hypot(t.x - x, t.y - y);
            if (td <= C.towerStats('tower', t.level).claim + 0.25) eff = Math.min(eff, td);
          }
          if (!(d < eff)) continue;
          stolen.set(o, (stolen.get(o) || 0) + 1);
        }
        gained.push([x, y, o]);
      }
    }
    return { gained, stolen };
  }

  function drawRange(wx, wy, range, color) {
    if (!range) return;
    const [x, y] = toScreen(wx, wy);
    ctx.fillStyle = color.replace('A', '0.08');
    ctx.strokeStyle = color.replace('A', '0.6');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, range * scale(), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function clearSelection() {
    selectedId = null;
    selUnits.clear();
  }

  // An animated marker on an order target: red crosshair for attack, green shield ring for defend.
  function drawTargetMarker(pos, attack, strong) {
    const s = scale();
    const [x, y] = toScreen(pos.x, pos.y);
    const t = performance.now() / 300;
    ctx.save();
    ctx.strokeStyle = attack ? `rgba(255, 82, 82, ${strong ? 0.95 : 0.6})` : `rgba(126, 231, 135, ${strong ? 0.95 : 0.6})`;
    ctx.lineWidth = strong ? 2.5 : 1.5;
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -t * 4;
    ctx.beginPath();
    ctx.arc(x, y, s * 1.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (attack) {
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * s * 1.2, y + Math.sin(a) * s * 1.2);
        ctx.lineTo(x + Math.cos(a) * s * 2, y + Math.sin(a) * s * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawOverlay() {
    const s = scale();
    if (selectedId) {
      const t = towers.get(selectedId);
      if (t && t.owner) {
        const st = C.towerStats(t.kind, t.level);
        drawRange(t.x + 0.5, t.y + 0.5, st.range, 'rgba(255,255,255,A)');
      }
    }

    // Standing order for my waves.
    if (myId && me && me.order) {
      const pos = targetPos(me.order.target);
      if (pos) drawTargetMarker(pos, me.order.type === 'attack', !selUnits.size);
    }

    // Selected troops: range and a line to where they're headed.
    const shown = new Set();
    for (const id of selUnits) {
      const u = units.get(id);
      if (!u) continue;
      if (selUnits.size <= 4) drawRange(u.rx, u.ry, C.towerStats(u.kind, u.level).range, 'rgba(255,255,255,A)');
      const key = u.attack || (u.anchor ? `t:${u.anchor}` : `c:${u.owner}`);
      const pos = targetPos(key);
      if (!pos) continue;
      const [ux, uy] = toScreen(u.rx, u.ry);
      const [ax, ay] = toScreen(pos.x, pos.y);
      ctx.strokeStyle = u.attack ? 'rgba(255,123,114,0.6)' : 'rgba(126,231,135,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ux, uy);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      if (!shown.has(key)) {
        shown.add(key);
        drawTargetMarker(pos, !!u.attack, true);
      }
    }

    // Hover feedback for right-click orders.
    if (myId && !buildKind) {
      const tg = orderTargetAt(mouse.wx, mouse.wy);
      if (tg) {
        const pos = targetPos(`${tg.k}:${tg.id}`);
        const mine = isMineTarget(tg);
        const n = shareCount(sendShare);
        const who = selUnits.size ? `${selUnits.size} selected` : sendShare < 1 ? `${n} troop${n === 1 ? '' : 's'} (${Math.round(sendShare * 100)}%)` : 'all troops';
        const verb = mine ? 'defend' : tg.k === 'j' ? 'clear' : 'attack';
        const [hx, hy] = toScreen(pos.x, pos.y);
        label(`Right-click: ${who} ${verb}`, hx, hy - s * 2.4, 12, mine ? '#7ee787' : '#ffa198');
      }
    }

    if (buildKind && myId) {
      const tx = Math.floor(mouse.wx);
      const ty = Math.floor(mouse.wy);
      const ok = canBuildAt(tx, ty);
      // Leap zone: unclaimed ground a tower can jump to.
      const zone = getLeapZone();
      const [x0, y0] = toWorld(0, 0);
      const [x1, y1] = toWorld(canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(255,213,79,0.10)';
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(C.MAP_H - 1, Math.ceil(y1)); y++) {
        for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(C.MAP_W - 1, Math.ceil(x1)); x++) {
          if (!zone[y * C.MAP_W + x]) continue;
          const [sx, sy] = toScreen(x, y);
          ctx.fillRect(sx + 1, sy + 1, s - 2, s - 2);
        }
      }
      if (ok) {
        const { gained, stolen } = claimPreview(tx, ty);
        for (const [gx, gy, o] of gained) {
          const [sx, sy] = toScreen(gx, gy);
          ctx.fillStyle = o ? 'rgba(255,123,114,0.35)' : 'rgba(126,231,135,0.28)';
          ctx.fillRect(sx + 2, sy + 2, s - 4, s - 4);
        }
        const taken = [...stolen].map(([o, n]) => `${n} from ${(players.get(o) || { name: '?' }).name}`).join(', ');
        const text = `+${gained.length} land${taken ? ` (taking ${taken})` : ''}`;
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(text, mouse.sx + 16, mouse.sy + 24);
        ctx.fillStyle = taken ? '#ffa198' : '#7ee787';
        ctx.fillText(text, mouse.sx + 16, mouse.sy + 24);
      }
      const st = C.towerStats(buildKind, 1);
      drawRange(tx + 0.5, ty + 0.5, st.range, ok ? 'rgba(88,166,255,A)' : 'rgba(248,81,73,A)');
      const [x, y] = toScreen(tx + 0.5, ty + 0.5);
      ctx.globalAlpha = 0.6;
      drawShape(buildKind, x, y, s * 0.45, ok ? C.TOWERS[buildKind].color : '#f85149');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ok ? '#58a6ff' : '#f85149';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    }
  }

  function drawMinimap() {
    const W = mini.width;
    const H = mini.height;
    const sx = W / C.MAP_W;
    const sy = H / C.MAP_H;
    mctx.clearRect(0, 0, W, H);
    mctx.drawImage(terrCanvas, 0, 0, W, H);
    for (const c of camps) {
      if (!c.alive) continue;
      mctx.fillStyle = '#c9a66b';
      mctx.fillRect((c.x + 0.5) * sx - 1.5, (c.y + 0.5) * sy - 1.5, 3, 3);
    }
    for (const u of units.values()) {
      mctx.fillStyle = u.owner === myId ? '#ffffff' : colorOf(u.owner, 70);
      mctx.fillRect(u.x * sx - 0.75, u.y * sy - 0.75, 1.5, 1.5);
    }
    for (const p of players.values()) {
      mctx.fillStyle = p.id === myId ? '#fff' : colorOf(p.id, 60);
      mctx.beginPath();
      mctx.arc((p.x + 0.5) * sx, (p.y + 0.5) * sy, p.id === myId ? 4 : 3, 0, Math.PI * 2);
      mctx.fill();
    }
    if (me && me.order && me.order.type === 'attack') {
      const pos = targetPos(me.order.target);
      if (pos) {
        mctx.strokeStyle = '#ff5252';
        mctx.lineWidth = 1.5;
        mctx.beginPath();
        mctx.arc(pos.x * sx, pos.y * sy, 6, 0, Math.PI * 2);
        mctx.stroke();
      }
    }
    const [x0, y0] = toWorld(0, 0);
    const [x1, y1] = toWorld(canvas.width, canvas.height);
    mctx.strokeStyle = 'rgba(255,255,255,0.7)';
    mctx.lineWidth = 1;
    mctx.strokeRect(x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy);
  }

  // ------------------------------------------------------------------ HUD
  function buildBar() {
    const tb = $('tower-button');
    const d = C.TOWERS.tower;
    tb.title = `${d.name} - ${d.desc}. Can leap ${C.TOWER_LEAP} tiles past your border.`;
    tb.innerHTML = `<span class="key">${d.key}</span><span class="icon" style="background:${d.color};border-radius:3px"></span>${d.name}<span class="cost">${d.cost}g</span>`;
    tb.onclick = () => toggleBuild('tower');

    const army = $('army');
    for (const kind of UNIT_KEYS) {
      const u = C.UNITS[kind];
      const card = document.createElement('div');
      card.className = 'troop';
      card.dataset.kind = kind;
      card.title = `${u.name}: ${u.desc}`;
      card.innerHTML = `
        <div class="head"><span class="icon" style="background:${u.color}"></span><b>${u.name}</b><span class="lvl"></span></div>
        <div class="count"></div>
        <div class="btns">
          <button class="rem" title="One fewer per wave (no refund)">−</button>
          <button class="add" title="One more ${u.name} in every wave"></button>
          <button class="up" title="Level up: applies to ${u.name}s from the next wave"></button>
        </div>`;
      card.querySelector('.add').onclick = () => sendMsg({ t: 'army', op: 'add', kind });
      card.querySelector('.rem').onclick = () => sendMsg({ t: 'army', op: 'remove', kind });
      card.querySelector('.up').onclick = () => sendMsg({ t: 'army', op: 'level', kind });
      army.appendChild(card);
    }
    $('defend-home').onclick = () => orderAt({ k: 'c', id: myId }, 1);

    // Send slider: what share of your troops a right-click order sends.
    const slider = $('share-slider');
    slider.min = SHARE_STEP * 100;
    slider.max = 100;
    slider.step = SHARE_STEP * 100;
    slider.oninput = () => setShare(Number(slider.value) / 100);
    slider.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setShare(sendShare + (e.deltaY < 0 ? SHARE_STEP : -SHARE_STEP));
    }, { passive: false });
    // Keep keyboard focus off the slider so game keys (A/D pan, numbers) still work.
    slider.addEventListener('change', () => slider.blur());
    slider.addEventListener('pointerup', () => slider.blur());
    setShare(sendShare);
  }

  // How many troops a share-order would send right now (the server picks the same number).
  function myTroopCount() {
    let n = 0;
    for (const u of units.values()) if (u.owner === myId) n++;
    return n;
  }
  function shareCount(sh) {
    const total = myTroopCount();
    return total ? (sh >= 1 ? total : Math.max(1, Math.round(total * sh))) : 0;
  }

  function setShare(sh) {
    sendShare = Math.min(1, Math.max(SHARE_STEP, Math.round(sh / SHARE_STEP) * SHARE_STEP));
    try { localStorage.setItem('ts-share', String(sendShare)); } catch { /* ignore */ }
    updateShareUi();
  }

  function updateShareUi() {
    const slider = $('share-slider');
    const pct = Math.round(sendShare * 100);
    if (Number(slider.value) !== pct) slider.value = pct;
    slider.style.setProperty('--fill', `${((pct - SHARE_STEP * 100) / (100 - SHARE_STEP * 100)) * 100}%`);
    slider.classList.toggle('all', sendShare >= 1);
    const total = myTroopCount();
    const n = shareCount(sendShare);
    $('share-pct').textContent = `${pct}%`;
    $('share-count').innerHTML = sendShare >= 1
      ? `<b>All ${total}</b> troop${total === 1 ? '' : 's'} + new waves`
      : `<b>${n}</b> of ${total} troop${total === 1 ? '' : 's'}`;
    slider.title = sendShare >= 1
      ? 'Right-click orders send every troop, and new waves follow too (Z/X/C/V = 25/50/75/100%, wheel to adjust)'
      : `Right-click orders send ${pct}% of your troops; new waves keep their orders (Z/X/C/V = 25/50/75/100%, wheel to adjust)`;
  }

  function toggleBuild(kind) {
    buildKind = buildKind === kind ? null : kind;
    clearSelection();
  }

  // Order troops at a target: the selected troops, else `share` of all troops (100% = everyone + new waves).
  function orderAt(tg, share = sendShare) {
    if (!myId || !tg) return;
    const ids = selUnits.size ? [...selUnits] : null;
    sendMsg({ t: 'order', ids, target: tg, share: ids ? 1 : share });
    const verb = isMineTarget(tg) ? 'defending' : tg.k === 'j' ? 'clearing' : 'attacking';
    const what = targetName(`${tg.k}:${tg.id}`);
    pendingOrder = (n) => {
      const troopsTxt = `${n} troop${n === 1 ? '' : 's'}`;
      if (ids) return `${troopsTxt}: ${verb} ${what}`;
      if (share < 1) return `${troopsTxt} (${Math.round(share * 100)}%): ${verb} ${what}`;
      return `All ${troopsTxt} and new waves: ${verb} ${what}`;
    };
  }

  let hudTimer = 0;
  function updateHud() {
    if (spectating) {
      updateBoards();
      const t = players.get(specTarget);
      const bar = $('spec-bar');
      const humans = [...players.values()].some((q) => !q.isBot);
      const btn = queued ? '✓ Joining next round' : humans ? 'Join next round' : 'New round';
      const key = `${t ? t.name : ''}:${specFollow}:${btn}`;
      if (bar.dataset.key !== key) {
        bar.dataset.key = key;
        bar.innerHTML = `<span>👁 Spectating${t ? ` <b>${escapeHtml(t.name)}</b>` : ''}${t && !specFollow ? ' <span class="muted">(free camera)</span>' : ''}</span>
          <span class="muted">Tab: next player · Space: follow · WASD: move</span>
          <button id="spec-new"${queued ? ' disabled' : ''}>${btn}</button>`;
        $('spec-new').onclick = () => sendMsg({ t: 'join', name: lastName });
      }
      updateRound();
      return;
    }
    if (!myId) return;
    const p = players.get(myId);
    if (!p || !me) return;
    const gold = me.gold;
    const sorted = [...players.values()].sort((a, b) => b.territory - a.territory);
    const rank = sorted.findIndex((q) => q.id === myId) + 1;
    const myTroops = [...units.values()].filter((u) => u.owner === myId).length;
    const perWave = UNIT_KEYS.reduce((n, k) => n + me.army[k], 0);
    updateRound();
    $('stats').innerHTML = `
      <div class="gold">${gold}g</div>
      <div>+${C.income(p.territory).toFixed(1)}g/s <span class="muted">· land ${p.territory}</span></div>
      <div class="muted">Rank #${rank} of ${players.size} · kills ${p.kills}</div>
      ${p.shield ? `<div style="color:#79c0ff">Spawn protection: ${p.shield}s</div>` : ''}
      ${p.buff ? `<div class="buff">🔥 Empowered ${p.buff}s: +${Math.round(C.JUNGLE_BUFF_DAMAGE * 100)}% dmg, −${Math.round(C.JUNGLE_BUFF_ARMOR * 100)}% taken</div>` : ''}
      <div>Core ${p.hp}/${p.maxHp}</div>
      <div class="hpbar"><div style="width:${(100 * p.hp) / p.maxHp}%"></div></div>`;

    $('wave-info').innerHTML = `<b>Next wave ${me.nextWave}s</b><br>${perWave} troops per wave<br>Alive ${myTroops}/${C.unitCap(p.territory)} <span class="muted">(cap grows with land)</span>`;

    const o = me.order;
    $('order-info').innerHTML = o.type === 'attack'
      ? `<span class="atk">⚔ Waves attacking ${escapeHtml(targetName(o.target))}</span>`
      : `<span class="def">🛡 Waves defending ${escapeHtml(targetName(o.target))}</span>`;

    updateBoards();
    updateTowerAndArmy(gold, perWave);
    updateSelectionPanel(gold);
  }

  // Leaderboard and kill feed (shown to players and spectators).
  function updateBoards() {
    const sorted = [...players.values()].sort((a, b) => b.territory - a.territory);
    const focus = spectating ? specTarget : myId;
    $('leaderboard').innerHTML = '<h3>Leaderboard · land</h3>' + sorted.slice(0, 10).map((q, i) =>
      `<div class="row${q.id === focus ? ' me' : ''}"><span>${i + 1}.</span><span class="dot" style="background:${colorOf(q.id, 55)}"></span><span class="n">${escapeHtml(q.name)}${q.isBot ? ' 🤖' : ''}${q.buff ? ' 🔥' : ''}</span><span>${q.territory}</span></div>`).join('');
    const now = performance.now();
    $('feed').innerHTML = feed.filter((f) => now - f.born < 9000).map((f) =>
      `<div style="opacity:${Math.min(1, (9000 - (now - f.born)) / 1500)}">${escapeHtml(f.text)}</div>`).join('');
  }

  // Tower button, send-% buttons and the army panel.
  function updateTowerAndArmy(gold, perWave) {
    updateShareUi();
    const tb = $('tower-button');
    tb.classList.toggle('active', buildKind === 'tower');
    tb.classList.toggle('poor', gold < C.TOWERS.tower.cost);
    const full = perWave >= C.ARMY_MAX_PER_WAVE;
    for (const card of document.querySelectorAll('#army .troop')) {
      const kind = card.dataset.kind;
      const n = me.army[kind];
      const lvl = me.levels[kind];
      const addCost = C.armyAddCost(kind, n);
      const upCost = lvl < C.MAX_LEVEL ? C.armyLevelCost(kind, lvl) : 0;
      card.classList.toggle('off', n === 0);
      card.querySelector('.lvl').textContent = `Lv${lvl}`;
      card.querySelector('.count').textContent = n ? `×${n} per wave` : 'not in waves';
      const add = card.querySelector('.add');
      add.textContent = `+ ${addCost}g`;
      add.disabled = full || gold < addCost;
      const up = card.querySelector('.up');
      up.textContent = lvl < C.MAX_LEVEL ? `▲ ${upCost}g` : 'MAX';
      up.disabled = lvl >= C.MAX_LEVEL || gold < upCost;
      card.querySelector('.rem').disabled = n === 0 || perWave <= 1;
    }
  }

  function updateSelectionPanel(gold) {
    const panel = $('selection');
    if (selUnits.size) {
      panel.classList.remove('hidden');
      const list = [...selUnits].map((id) => units.get(id)).filter(Boolean);
      const key = `u:${list.map((u) => u.id).join(',')}`;
      if (panel.dataset.key !== key) {
        panel.dataset.key = key;
        const counts = {};
        for (const u of list) counts[C.UNITS[u.kind].name] = (counts[C.UNITS[u.kind].name] || 0) + 1;
        panel.innerHTML = `<h4>${list.length} troop${list.length === 1 ? '' : 's'} selected</h4>
          <div>${Object.entries(counts).map(([n, c]) => `${c}× ${n}`).join(' · ')}</div>
          <div id="sel-info" class="muted"></div>
          <div class="muted">Right-click a target to command just these troops. Esc to deselect.</div>`;
      }
      if (list.length === 1) {
        const u = list[0];
        const st = C.towerStats(u.kind, u.level);
        const d = C.UNITS[u.kind];
        $('sel-info').textContent = `Lv${u.level} · HP ${u.hp}/${u.maxHp} · ${d.heal ? `heals ${st.heal.toFixed(0)}/s` : `${st.damage.toFixed(0)} dmg, range ${st.range}`} · ${u.attack ? `attacking ${targetName(u.attack)}` : `defending ${targetName(u.anchor ? `t:${u.anchor}` : `c:${u.owner}`)}`}`;
      } else {
        $('sel-info').textContent = '';
      }
      return;
    }
    const t = selectedId && towers.get(selectedId);
    if (!t) {
      panel.classList.add('hidden');
      panel.dataset.key = '';
      return;
    }
    panel.classList.remove('hidden');
    const d = C.TOWERS[t.kind];
    const ruined = t.ruin || !t.owner;
    const key = `${t.id}:${t.level}:${t.owner}`;
    if (panel.dataset.key !== key) {
      panel.dataset.key = key;
      if (ruined) {
        panel.innerHTML = `<h4>Ruined ${d.name} (lvl ${t.level})</h4>
          <div class="muted">Once owned by ${escapeHtml(t.ruinOf || 'someone')}</div>
          <div id="sel-info"></div>
          <div class="btns"><button id="sel-capture">Rebuild (${C.RUIN_CAPTURE_COST}g)</button></div>`;
        $('sel-capture').onclick = () => sendMsg({ t: 'capture', id: t.id });
      } else if (t.owner === myId) {
        const st = C.towerStats(t.kind, t.level);
        const maxed = t.level >= C.MAX_LEVEL;
        panel.innerHTML = `<h4>${d.name} · level ${t.level}</h4><div id="sel-info"></div>
          <div>Damage ${st.damage.toFixed(0)}/s · range ${st.range} · claims ${st.claim}</div>
          <div class="btns">
            <button id="sel-up">${maxed ? 'Max level' : `Upgrade (${C.upgradeCost(t.kind, t.level)}g) [U]`}</button>
            <button id="sel-sell">Sell +${C.sellValue(t.kind, t.level)}g</button>
          </div>
          <div class="btns"><button id="sel-defend">Defend here</button></div>`;
        $('sel-up').onclick = () => sendMsg({ t: 'upgrade', id: t.id });
        $('sel-sell').onclick = () => sendMsg({ t: 'sell', id: t.id });
        $('sel-defend').onclick = () => orderAt({ k: 't', id: t.id });
      } else {
        panel.innerHTML = `<h4>${escapeHtml((players.get(t.owner) || { name: '?' }).name)}'s ${d.name} · level ${t.level}</h4>
          <div id="sel-info"></div><div class="muted">Right-click it to send your troops.</div>`;
      }
    }
    if (ruined) {
      const inLand = terr[t.y * C.MAP_W + t.x] === myId;
      $('sel-info').textContent = inLand ? 'Inside your land - rebuild it!' : 'Grow your land over it to rebuild it.';
      $('sel-capture').disabled = !inLand || gold < C.RUIN_CAPTURE_COST;
    } else {
      const garrison = [...units.values()].filter((u) => u.owner === t.owner && u.anchor === t.id && !u.attack).length;
      $('sel-info').textContent = `HP ${t.hp}/${t.maxHp} · garrison ${garrison}`;
      if (t.owner === myId) $('sel-up').disabled = t.level >= C.MAX_LEVEL || gold < C.upgradeCost(t.kind, t.level);
    }
  }

  let toastTimer = null;
  function toast(text, good = false) {
    const el = $('toast');
    el.textContent = text;
    el.classList.toggle('good', good);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showMenu() {
    $('hud').classList.add('hidden');
    $('death').classList.add('hidden');
    $('menu').classList.remove('hidden');
  }

  function showDeath(info) {
    $('hud').classList.add('hidden');
    $('death').classList.remove('hidden');
    lastKiller = info.killerId || 0;
    // With no other people left in the round, a new one starts straight away.
    $('again').textContent = info.humansAlive ? 'Join next round' : 'New round';
    $('death-by').textContent = info.killer ? `Destroyed by ${info.killer}` : 'Your core fell';
    $('death-spoils').textContent = info.killer
      ? `${info.killer} took your ${info.goldTaken}g, ${info.troopsTaken} surviving troop${info.troopsTaken === 1 ? '' : 's'}, and turned your core into a tower.`
      : '';
    const mins = Math.floor(info.survived / 60);
    const secs = String(info.survived % 60).padStart(2, '0');
    $('death-stats').innerHTML = `
      <div><b>${mins}:${secs}</b><span>survived</span></div>
      <div><b>${info.peakTerritory}</b><span>peak land</span></div>
      <div><b>${info.kills}</b><span>kills</span></div>
      <div><b>${info.towersDestroyed || 0} / ${info.coresDestroyed}</b><span>towers / cores destroyed</span></div>`;
    const e = info.earned || {};
    const total = Object.values(e).reduce((a, b) => a + b, 0);
    $('death-gold').innerHTML = total ? `<b>${total}g earned</b>: ${[['troops', 'troop kills'], ['camps', 'jungle'], ['towers', 'towers'], ['cores', 'cores'], ['income', 'land']]
      .filter(([k]) => e[k]).map(([k, name]) => `${name} ${Math.round((100 * e[k]) / total)}%`).join(' · ')}` : '';
  }

  let lastKiller = 0;

  const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`;

  // Round banner: cores left, round clock, join window / sudden death.
  function updateRound() {
    const el = $('round');
    if (!round) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    let sub = '';
    if (round.join > 0) sub = `<div class="sub">Joining open for ${fmtTime(round.join)} · last core standing wins</div>`;
    else if (round.sd <= 0) sub = '<div class="sd">☠ Sudden death: cores crumble · troops hit buildings ×2 · no home turf</div>';
    else if (round.sd <= 120) sub = `<div class="sd">Sudden death in ${fmtTime(round.sd)}</div>`;
    el.innerHTML = `Round <b>${round.n}</b> · <b>${players.size}</b> core${players.size === 1 ? '' : 's'} left · ${fmtTime(round.t)}${sub}`;
  }

  let roundTimer = null;
  function showRoundOver(msg) {
    if (!myId && !spectating && !queued && $('death').classList.contains('hidden')) return; // still on the menu
    $('death').classList.add('hidden');
    const w = msg.winner;
    $('ro-title').textContent = !w ? `Round ${msg.round} is over` : w.id === myId ? 'Victory! You are the last core standing' : `${w.name} wins round ${msg.round}`;
    $('ro-sub').textContent = w ? 'Last core standing' : 'No cores survived';
    const rows = msg.standings.map((r) => `<tr class="${r.id === myId ? 'me' : ''}${r.place === 1 ? ' win' : ''}">
      <td>${r.left ? '–' : r.place === 1 ? '🏆' : `#${r.place}`}</td>
      <td class="n"><span class="dot" style="background:hsl(${r.hue},75%,55%)"></span>${escapeHtml(r.name)}${r.isBot ? ' 🤖' : ''}${r.left ? ' <span style="color:#8b949e">(left)</span>' : ''}</td>
      <td>${fmtTime(r.survived)}</td><td>${r.coresDestroyed}</td><td>${r.towersDestroyed}</td><td>${r.kills}</td><td>${r.gold}g</td></tr>`).join('');
    $('ro-table').innerHTML = `<tr><th></th><th class="n">Player</th><th>Lasted</th><th>Cores</th><th>Towers</th><th>Kills</th><th>Gold</th></tr>${rows}`;
    $('roundover').classList.remove('hidden');
    let left = msg.next;
    const tick = () => {
      $('ro-next').textContent = left > 0 ? `Next round starts in ${left}s on a fresh map…` : 'Starting…';
      left--;
    };
    tick();
    clearInterval(roundTimer);
    roundTimer = setInterval(() => {
      if ($('roundover').classList.contains('hidden')) clearInterval(roundTimer);
      else tick();
    }, 1000);
  }

  function startSpectating() {
    spectating = true;
    $('menu').classList.add('hidden');
    clearSelection();
    buildKind = null;
    specTarget = players.has(lastKiller) ? lastKiller : 0;
    specFollow = true;
    $('death').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('hud').classList.add('spectating');
  }

  function stopSpectating() {
    spectating = false;
    $('hud').classList.remove('spectating');
  }

  // Follow the next player on the leaderboard (Tab).
  function specNext() {
    const list = [...players.values()].sort((a, b) => b.territory - a.territory);
    if (!list.length) return;
    const i = list.findIndex((p) => p.id === specTarget);
    specTarget = list[(i + 1) % list.length].id;
    specFollow = true;
  }

  function join() {
    lastName = $('name').value.trim() || 'Player';
    try { localStorage.setItem('ts-name', lastName); } catch { /* ignore */ }
    sendMsg({ t: 'join', name: lastName });
  }

  // ------------------------------------------------------------------ input
  function updateMouseWorld() {
    [mouse.wx, mouse.wy] = toWorld(mouse.sx, mouse.sy);
  }

  canvas.addEventListener('mousemove', (e) => {
    mouse.sx = e.clientX;
    mouse.sy = e.clientY;
    if (mouse.rightDown) {
      const dx = e.clientX - mouse.lastX;
      const dy = e.clientY - mouse.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) mouse.dragged = true;
      if (mouse.dragged) {
        cam.x -= dx / scale();
        cam.y -= dy / scale();
      }
      mouse.lastX = e.clientX;
      mouse.lastY = e.clientY;
    }
    updateMouseWorld();
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2 || e.button === 1) {
      mouse.rightDown = true;
      mouse.dragged = false;
      mouse.lastX = e.clientX;
      mouse.lastY = e.clientY;
      return;
    }
    if (e.button !== 0 || !myId) return;
    updateMouseWorld();
    const tx = Math.floor(mouse.wx);
    const ty = Math.floor(mouse.wy);

    if (buildKind) {
      sendMsg({ t: 'build', kind: buildKind, x: tx, y: ty });
      return;
    }

    // Left-click selects: my troops (Shift adds), else a tower or ruin.
    let hit = null;
    let hitD = 0.6;
    for (const u of units.values()) {
      if (u.owner !== myId) continue;
      const d = Math.hypot(u.rx - mouse.wx, u.ry - mouse.wy);
      if (d < hitD) {
        hitD = d;
        hit = u;
      }
    }
    if (hit) {
      selectedId = null;
      if (e.shiftKey) {
        if (selUnits.has(hit.id)) selUnits.delete(hit.id);
        else selUnits.add(hit.id);
      } else {
        selUnits.clear();
        selUnits.add(hit.id);
      }
      return;
    }
    const tid = grid.get(`${tx},${ty}`);
    clearSelection();
    selectedId = tid && towers.has(tid) ? tid : null;
  });

  window.addEventListener('mouseup', (e) => {
    if ((e.button === 2 || e.button === 1) && mouse.rightDown) {
      mouse.rightDown = false;
      if (mouse.dragged || !myId) return;
      // A right-click (not a drag): order troops at whatever is under the cursor, or cancel.
      if (buildKind) {
        buildKind = null;
        return;
      }
      updateMouseWorld();
      const tg = orderTargetAt(mouse.wx, mouse.wy);
      if (tg) orderAt(tg);
      else clearSelection();
    }
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [bx, by] = toWorld(e.clientX, e.clientY);
    cam.zoom = Math.min(2.5, Math.max(0.35, cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    const [ax, ay] = toWorld(e.clientX, e.clientY);
    cam.x += bx - ax;
    cam.y += by - ay;
    updateMouseWorld();
  }, { passive: false });

  function moveCamFromMinimap(e) {
    specFollow = false;
    const rect = mini.getBoundingClientRect();
    cam.x = ((e.clientX - rect.left) / rect.width) * C.MAP_W;
    cam.y = ((e.clientY - rect.top) / rect.height) * C.MAP_H;
  }
  mini.addEventListener('mousedown', (e) => {
    moveCamFromMinimap(e);
    const move = (ev) => moveCamFromMinimap(ev);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), { once: true });
  });

  window.addEventListener('keydown', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      if (e.key === 'Enter') join();
      return;
    }
    const k = e.key.toLowerCase();
    keys.add(k);
    if (spectating) {
      if (k === 'tab') {
        e.preventDefault();
        specNext();
      }
      if (k === ' ') {
        e.preventDefault();
        specFollow = true;
      }
      return;
    }
    if (!myId) return;
    if (k === 'b') toggleBuild('tower');
    if (k === 'escape') {
      buildKind = null;
      clearSelection();
    }
    if (k === 'q') {
      buildKind = null;
      selectedId = null;
      selUnits.clear();
      for (const u of units.values()) if (u.owner === myId) selUnits.add(u.id);
    }
    if (k === 'h') orderAt({ k: 'c', id: myId }, 1);
    const si = SHARE_KEYS.indexOf(k);
    if (si >= 0) setShare(SHARES[si]);
    if (k === ' ') {
      e.preventDefault();
      const p = players.get(myId);
      if (p) {
        cam.x = p.x + 0.5;
        cam.y = p.y + 0.5;
      }
    }
    // 1-5: add one of that troop type to every wave (Shift: level it up).
    const idx = Number(e.key) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < UNIT_KEYS.length) {
      sendMsg({ t: 'army', op: e.shiftKey ? 'level' : 'add', kind: UNIT_KEYS[idx] });
    }
    if (k === 'u' && selectedId) sendMsg({ t: 'upgrade', id: selectedId });
    if ((k === 'delete' || k === 'backspace') && selectedId) {
      const t = towers.get(selectedId);
      if (t && t.owner === myId) sendMsg({ t: 'sell', id: selectedId });
    }
  });
  // Shift+digit gives e.key '!' etc. on some layouts: map by code instead.
  window.addEventListener('keydown', (e) => {
    if (!myId || !e.shiftKey || document.activeElement?.tagName === 'INPUT') return;
    const m = /^Digit([1-5])$/.exec(e.code);
    if (m && Number.isNaN(Number(e.key))) sendMsg({ t: 'army', op: 'level', kind: UNIT_KEYS[Number(m[1]) - 1] });
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('resize', resize);

  // Controls help: closable, remembered per browser, ? toggles it.
  function setHelp(show) {
    $('help').classList.toggle('hidden', !show);
    $('help-toggle').classList.toggle('hidden', show);
    try { localStorage.setItem('ts-help', show ? '1' : '0'); } catch { /* ignore */ }
  }
  $('help').querySelector('.close').onclick = () => setHelp(false);
  $('help-toggle').onclick = () => setHelp(true);
  window.addEventListener('keydown', (e) => {
    if (e.key === '?' && document.activeElement?.tagName !== 'INPUT') setHelp($('help').classList.contains('hidden'));
  });
  try { if (localStorage.getItem('ts-help') === '0') setHelp(false); } catch { /* ignore */ }

  $('play').onclick = join;
  $('again').onclick = () => sendMsg({ t: 'join', name: lastName });
  $('spectate').onclick = startSpectating;

  // ------------------------------------------------------------------ main loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    const pan = (18 / cam.zoom) * dt;
    if (myId || spectating) {
      const before = cam.x + cam.y;
      if (keys.has('w') || keys.has('arrowup')) cam.y -= pan;
      if (keys.has('s') || keys.has('arrowdown')) cam.y += pan;
      if (keys.has('a') || keys.has('arrowleft')) cam.x -= pan;
      if (keys.has('d') || keys.has('arrowright')) cam.x += pan;
      if (spectating) {
        if (cam.x + cam.y !== before || (mouse.rightDown && mouse.dragged)) specFollow = false;
        if (!players.has(specTarget)) specNext(); // followed player is gone: pick the leader
        const t = players.get(specTarget);
        if (t && specFollow) {
          const k = Math.min(1, dt * 4);
          cam.x += (t.x + 0.5 - cam.x) * k;
          cam.y += (t.y + 0.5 - cam.y) * k;
        }
      }
    } else {
      // Slow drift across the live map behind the menu.
      cam.x = C.MAP_W / 2 + Math.cos(now / 20000) * C.MAP_W * 0.25;
      cam.y = C.MAP_H / 2 + Math.sin(now / 20000) * C.MAP_H * 0.25;
    }
    cam.x = Math.max(0, Math.min(C.MAP_W, cam.x));
    cam.y = Math.max(0, Math.min(C.MAP_H, cam.y));
    updateMouseWorld();

    drawBackground();
    drawCamps();
    drawOverlay();
    drawTowers(dt);
    drawCreeps(dt);
    drawUnits(dt);
    drawCores(dt);
    drawEffects(now);
    if (myId || spectating) drawMinimap();

    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.15;
      updateHud();
    }
    requestAnimationFrame(frame);
  }

  try { $('name').value = localStorage.getItem('ts-name') || ''; } catch { /* ignore */ }
  resize();
  buildBar();
  connect();
  requestAnimationFrame(frame);
})();
