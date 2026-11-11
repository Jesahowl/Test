/* global TD_CONFIG */
(() => {
  'use strict';

  const C = TD_CONFIG;
  const KIND_KEYS = Object.keys(C.TOWERS);
  const UNIT_KEYS = Object.keys(C.UNITS);
  const BUY_KEYS = [...UNIT_KEYS, ...KIND_KEYS]; // build-bar order
  const CREEP_KEYS = Object.keys(C.CREEPS);
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
  let me = null; // { id, gold, nextWave }
  let lastName = '';
  const players = new Map(); // id -> { id, name, hue, x, y, hp, maxHp, territory, kills, isBot }
  let towers = new Map(); // id -> structure (beacon / ruin)
  let units = new Map(); // id -> unit (with rx/ry render positions)
  let creeps = new Map(); // id -> creep (with rx/ry render positions)
  let effects = [];
  const feed = [];
  let terr = new Int32Array(C.MAP_W * C.MAP_H);
  const terrCanvas = document.createElement('canvas');
  terrCanvas.width = C.MAP_W * TPX;
  terrCanvas.height = C.MAP_H * TPX;
  const tctx = terrCanvas.getContext('2d');
  const grid = new Map(); // "x,y" -> tower id
  let terrShapes = []; // [{ owner, path: Path2D in tile units }]

  const cam = { x: C.MAP_W / 2, y: C.MAP_H / 2, zoom: 1 };
  const BASE_SCALE = 28;
  let buildKind = null;
  let selectedId = null; // selected structure
  const selUnits = new Set(); // selected unit ids
  let attackTarget = null;
  let centerOnMe = false;
  const keys = new Set();
  const mouse = { sx: 0, sy: 0, wx: 0, wy: 0, rightDown: false, dragged: false, lastX: 0, lastY: 0 };

  const scale = () => BASE_SCALE * cam.zoom;
  const toScreen = (wx, wy) => [(wx - cam.x) * scale() + canvas.width / 2, (wy - cam.y) * scale() + canvas.height / 2];
  const toWorld = (sx, sy) => [(sx - canvas.width / 2) / scale() + cam.x, (sy - canvas.height / 2) / scale() + cam.y];
  const hueOf = (pid) => (players.get(pid) || { hue: 0 }).hue;
  const colorOf = (pid, l = 55, a = 1) => (pid ? `hsla(${hueOf(pid)}, 75%, ${l}%, ${a})` : `rgba(198, 40, 40, ${a})`);

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
        myId = msg.id;
        centerOnMe = true;
        attackTarget = null;
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
      case 'err':
        toast(msg.m);
        break;
    }
  }

  function applyState(msg) {
    me = msg.me;

    if (msg.terr) {
      let i = 0;
      for (let j = 0; j < msg.terr.length; j += 2) {
        terr.fill(msg.terr[j], i, i + msg.terr[j + 1]);
        i += msg.terr[j + 1];
      }
    }

    players.clear();
    for (const a of msg.players) {
      players.set(a[0], { id: a[0], name: a[1], hue: a[2], x: a[3], y: a[4], hp: a[5], maxHp: a[6], territory: a[7], kills: a[8], isBot: !!a[9] });
    }
    if (msg.terr) drawTerritory();

    const nt = new Map();
    grid.clear();
    for (const a of msg.towers) {
      const t = { id: a[0], kind: KIND_KEYS[a[1]], x: a[2], y: a[3], owner: a[4], level: a[5], hp: a[6], maxHp: a[7], ruinOf: a[8] };
      nt.set(t.id, t);
      grid.set(`${t.x},${t.y}`, t.id);
    }
    towers = nt;
    if (selectedId && !towers.has(selectedId)) selectedId = null;

    const nu = new Map();
    for (const a of msg.units) {
      const old = units.get(a[0]);
      nu.set(a[0], { id: a[0], kind: UNIT_KEYS[a[1]], x: a[2], y: a[3], owner: a[4], level: a[5], hp: a[6], maxHp: a[7], anchor: a[8],
        rx: old ? old.rx : a[2], ry: old ? old.ry : a[3] });
    }
    units = nu;
    for (const id of selUnits) if (!units.has(id)) selUnits.delete(id);

    const nc = new Map();
    for (const a of msg.creeps) {
      const old = creeps.get(a[0]);
      nc.set(a[0], { id: a[0], kind: CREEP_KEYS[a[1]], x: a[2], y: a[3], owner: a[4], hp: a[5], rx: old ? old.rx : a[2], ry: old ? old.ry : a[3] });
    }
    creeps = nc;

    const now = performance.now();
    for (const f of msg.fx) effects.push({ ...f, born: now });
    for (const text of msg.feed) feed.push({ text, born: now });
    while (feed.length > 6) feed.shift();

    if (attackTarget && !players.has(attackTarget)) attackTarget = null;

    if (centerOnMe && myId && players.has(myId)) {
      const p = players.get(myId);
      cam.x = p.x + 0.5;
      cam.y = p.y + 0.5;
      centerOnMe = false;
    }
  }

  // ------------------------------------------------------------------ territory layer
  // Territory is a tile grid, but drawing it tile by tile looks like a staircase. Instead we trace
  // each region's outline along tile edges, smooth it (moving average, then Chaikin corner
  // cutting), and keep the
  // result as a vector Path2D (in tile units) so borders stay crisp at every zoom level.

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
    const loops = []; // [{ owner, pts: [[x, y], ...] }]
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
          // Saddle point (two tiles touching diagonally): turn right to hug the current tile,
          // keeping diagonal neighbours as separate loops.
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
  // Outline points are one tile apart, so a window of ±2 tiles moves the border by well under
  // half a tile. Tiny regions are left alone so they don't shrink away.
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

  // Draw territory fills and borders in world space. Borders are stroked inside each region
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
      // soft inner glow
      ctx.strokeStyle = colorOf(owner, 60, mine ? 0.22 : 0.14);
      ctx.lineWidth = 16 / s;
      ctx.stroke(path);
      // crisp border line
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

  function drawTowerShape(kind, x, y, r, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    switch (kind) {
      case 'bolt':
        ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x - r * 0.18, y - r * 0.95, r * 0.36, r * 0.9);
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
      case 'beacon':
        ctx.moveTo(x, y - r * 0.95);
        ctx.lineTo(x + r * 0.8, y + r * 0.7);
        ctx.lineTo(x - r * 0.8, y + r * 0.7);
        ctx.closePath();
        ctx.fill();
        break;
      default: // generic block
        ctx.fillRect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
    }
  }

  function drawTowers() {
    const s = scale();
    const r = s * 0.45;
    for (const t of towers.values()) {
      const [x, y] = toScreen(t.x + 0.5, t.y + 0.5);
      if (x < -s || y < -s || x > canvas.width + s || y > canvas.height + s) continue;
      const def = C.TOWERS[t.kind];
      if (t.ruin || !t.owner) {
        ctx.globalAlpha = 0.45;
        drawTowerShape(t.kind, x, y, r, '#5a6370');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#2b3036';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.5, y - r * 0.6);
        ctx.lineTo(x, y);
        ctx.lineTo(x - r * 0.2, y + r * 0.6);
        ctx.stroke();
        continue;
      }
      // owner ring
      ctx.fillStyle = colorOf(t.owner, 30, 0.9);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colorOf(t.owner, 60);
      ctx.lineWidth = Math.max(1.5, s * 0.08);
      ctx.stroke();
      drawTowerShape(t.kind, x, y, r, def.color);
      // level pips
      for (let i = 0; i < t.level; i++) {
        ctx.fillStyle = '#ffd54f';
        ctx.beginPath();
        ctx.arc(x - r * 0.5 + i * r * 0.5, y + r * 1.05, Math.max(1.5, s * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }
      hpBar(x, y - r * 1.5, s * 0.8, t.hp / t.maxHp);
      if (t.id === selectedId) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - s / 2, y - s / 2, s, s);
      }
    }
  }

  function drawUnits(dt) {
    const s = scale();
    const r = s * 0.36;
    const k = Math.min(1, dt * 14);
    for (const u of units.values()) {
      u.rx += (u.x - u.rx) * k;
      u.ry += (u.y - u.ry) * k;
      const [x, y] = toScreen(u.rx, u.ry);
      if (x < -s || y < -s || x > canvas.width + s || y > canvas.height + s) continue;
      if (selUnits.has(u.id)) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = colorOf(u.owner, 30, 0.9);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colorOf(u.owner, 60);
      ctx.lineWidth = Math.max(1.5, s * 0.07);
      ctx.stroke();
      drawTowerShape(u.kind, x, y, r, C.UNITS[u.kind].color);
      for (let i = 0; i < u.level; i++) {
        ctx.fillStyle = '#ffd54f';
        ctx.beginPath();
        ctx.arc(x - r * 0.5 + i * r * 0.5, y + r * 1.1, Math.max(1.5, s * 0.055), 0, Math.PI * 2);
        ctx.fill();
      }
      hpBar(x, y - r * 1.6, s * 0.7, u.hp / u.maxHp);
    }
  }

  function drawCores() {
    const s = scale();
    for (const p of players.values()) {
      const [x, y] = toScreen(p.x + 0.5, p.y + 0.5);
      if (x < -s * 3 || y < -s * 3 || x > canvas.width + s * 3 || y > canvas.height + s * 3) continue;
      const r = s * 0.75;
      const grd = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.8);
      grd.addColorStop(0, colorOf(p.id, 60, 0.6));
      grd.addColorStop(1, colorOf(p.id, 60, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = colorOf(p.id, 45);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i + Math.PI / 8;
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // HP ring
      const frac = p.hp / p.maxHp;
      ctx.strokeStyle = frac > 0.5 ? '#3fb950' : frac > 0.25 ? '#d29922' : '#f85149';
      ctx.lineWidth = Math.max(2, s * 0.12);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.25, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();

      ctx.font = `bold ${Math.max(11, Math.round(s * 0.5))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      const label = p.id === myId ? `${p.name} (you)` : p.name;
      ctx.strokeText(label, x, y - r * 1.6);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x, y - r * 1.6);

      if (p.id === attackTarget) {
        const t = performance.now() / 300;
        ctx.strokeStyle = '#ff5252';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -t * 4;
        ctx.beginPath();
        ctx.arc(x, y, r * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function drawCreeps(dt) {
    const s = scale();
    const k = Math.min(1, dt * 14);
    for (const c of creeps.values()) {
      c.rx += (c.x - c.rx) * k;
      c.ry += (c.y - c.ry) * k;
      const [x, y] = toScreen(c.rx, c.ry);
      if (x < -s || y < -s || x > canvas.width + s || y > canvas.height + s) continue;
      const r = C.CREEPS[c.kind].size * s;
      ctx.fillStyle = colorOf(c.owner, 55);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (c.kind === 'runner') {
        ctx.moveTo(x, y - r * 1.2);
        ctx.lineTo(x + r, y + r);
        ctx.lineTo(x - r, y + r);
        ctx.closePath();
      } else if (c.kind === 'brute') {
        ctx.rect(x - r, y - r, r * 2, r * 2);
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      hpBar(x, y - r - 6, s * 0.6, c.hp);
    }
  }

  function drawEffects(now) {
    const s = scale();
    effects = effects.filter((f) => now - f.born < (f.k === 'coreDown' ? 1200 : 450));
    for (const f of effects) {
      const age = (now - f.born) / 1000;
      switch (f.k) {
        case 'bolt': {
          if (age > 0.12) break;
          const [x1, y1] = toScreen(f.x1, f.y1);
          const [x2, y2] = toScreen(f.x2, f.y2);
          ctx.strokeStyle = `rgba(160, 230, 255, ${1 - age / 0.12})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
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

  function canBuildAt(x, y) {
    if (!me || x < 0 || y < 0 || x >= C.MAP_W || y >= C.MAP_H) return false;
    if (terr[y * C.MAP_W + x] !== myId) return false;
    if (grid.has(`${x},${y}`)) return false;
    for (const p of players.values()) if (p.x === x && p.y === y) return false;
    return true;
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

  // Where a unit guards: { x, y, leash } for anchor id (beacon) or 0 (core) of player pid.
  function anchorPos(pid, anchorId) {
    const t = anchorId && towers.get(anchorId);
    if (t && t.owner === pid) return { x: t.x + 0.5, y: t.y + 0.5, leash: C.UNIT_LEASH_BEACON };
    const p = players.get(pid);
    return p ? { x: p.x + 0.5, y: p.y + 0.5, leash: C.UNIT_LEASH_CORE } : null;
  }

  function myAnchors() {
    const list = [{ id: 0, ...anchorPos(myId, 0) }];
    for (const t of towers.values()) {
      if (t.owner === myId) list.push({ id: t.id, ...anchorPos(myId, t.id) });
    }
    return list;
  }

  // Which of my anchors (core = 0, or a beacon id) is under world point (wx, wy), or null.
  function anchorAt(wx, wy) {
    const me2 = players.get(myId);
    if (me2 && Math.hypot(me2.x + 0.5 - wx, me2.y + 0.5 - wy) < 1.1) return 0;
    const tid = grid.get(`${Math.floor(wx)},${Math.floor(wy)}`);
    const t = tid && towers.get(tid);
    return t && t.owner === myId ? t.id : null;
  }

  function drawLeash(a, color, dashed) {
    const [x, y] = toScreen(a.x, a.y);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    if (dashed) ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(x, y, a.leash * scale(), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function clearSelection() {
    selectedId = null;
    selUnits.clear();
  }

  function drawOverlay() {
    const s = scale();
    if (selectedId) {
      const t = towers.get(selectedId);
      if (t && t.owner) {
        const st = C.towerStats(t.kind, t.level);
        drawRange(t.x + 0.5, t.y + 0.5, st.claim, 'rgba(255,255,255,A)');
        if (t.owner === myId) drawLeash(anchorPos(myId, t.id), 'rgba(126,231,135,0.8)', true);
      }
    }
    // Selected units: their range, the patch they guard, and a tether back to it.
    const shownAnchors = new Set();
    for (const id of selUnits) {
      const u = units.get(id);
      if (!u) continue;
      const a = anchorPos(u.owner, u.anchor);
      if (!a) continue;
      if (selUnits.size <= 4) drawRange(u.rx, u.ry, C.towerStats(u.kind, u.level).range, 'rgba(255,255,255,A)');
      if (!shownAnchors.has(u.anchor)) {
        shownAnchors.add(u.anchor);
        drawLeash(a, 'rgba(126,231,135,0.85)', true);
      }
      const [ux, uy] = toScreen(u.rx, u.ry);
      const [ax, ay] = toScreen(a.x, a.y);
      ctx.strokeStyle = 'rgba(126,231,135,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ux, uy);
      ctx.lineTo(ax, ay);
      ctx.stroke();
    }
    // Hovering an anchor with units selected: preview the reassignment.
    if (selUnits.size && !buildKind && myId) {
      const hover = anchorAt(mouse.wx, mouse.wy);
      if (hover !== null) {
        const a = anchorPos(myId, hover);
        drawLeash(a, 'rgba(255,213,79,0.95)', false);
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd54f';
        const [hx, hy] = toScreen(a.x, a.y - a.leash);
        ctx.fillText(`Click to guard this ${hover ? 'beacon' : 'core'}`, hx, hy - 6);
      }
    }
    if (buildKind && myId) {
      const tx = Math.floor(mouse.wx);
      const ty = Math.floor(mouse.wy);
      const ok = canBuildAt(tx, ty);
      const st = C.towerStats(buildKind, 1);
      const isUnit = !!C.UNITS[buildKind];
      if (isUnit) {
        // Show every patch a unit can guard, and which one this unit would join.
        const anchors = myAnchors();
        let near = anchors[0];
        for (const a of anchors) {
          if (Math.hypot(a.x - tx - 0.5, a.y - ty - 0.5) < Math.hypot(near.x - tx - 0.5, near.y - ty - 0.5)) near = a;
        }
        for (const a of anchors) drawLeash(a, a === near && ok ? 'rgba(126,231,135,0.9)' : 'rgba(255,255,255,0.25)', true);
        if (ok) {
          const [gx, gy] = toScreen(tx + 0.5, ty + 0.5);
          const [ax, ay] = toScreen(near.x, near.y);
          ctx.strokeStyle = 'rgba(126,231,135,0.6)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.lineTo(ax, ay);
          ctx.stroke();
        }
      }
      drawRange(tx + 0.5, ty + 0.5, st.range || st.claim, ok ? 'rgba(88,166,255,A)' : 'rgba(248,81,73,A)');
      const [x, y] = toScreen(tx + 0.5, ty + 0.5);
      ctx.globalAlpha = 0.6;
      drawTowerShape(buildKind, x, y, s * (isUnit ? 0.36 : 0.45), ok ? C.defOf(buildKind).color : '#f85149');
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
    for (const c of creeps.values()) {
      mctx.fillStyle = colorOf(c.owner, 60);
      mctx.fillRect(c.x * sx - 0.5, c.y * sy - 0.5, 1.5, 1.5);
    }
    for (const u of units.values()) {
      mctx.fillStyle = u.owner === myId ? '#ffffff' : colorOf(u.owner, 75);
      mctx.fillRect(u.x * sx - 0.75, u.y * sy - 0.75, 1.5, 1.5);
    }
    for (const p of players.values()) {
      mctx.fillStyle = p.id === myId ? '#fff' : colorOf(p.id, 60);
      mctx.beginPath();
      mctx.arc((p.x + 0.5) * sx, (p.y + 0.5) * sy, p.id === myId ? 4 : 3, 0, Math.PI * 2);
      mctx.fill();
      if (p.id === attackTarget) {
        mctx.strokeStyle = '#ff5252';
        mctx.lineWidth = 1.5;
        mctx.beginPath();
        mctx.arc((p.x + 0.5) * sx, (p.y + 0.5) * sy, 6, 0, Math.PI * 2);
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
    const bb = $('build-buttons');
    for (const kind of BUY_KEYS) {
      const d = C.defOf(kind);
      const b = document.createElement('button');
      b.dataset.kind = kind;
      b.title = `${d.name} - ${d.desc}`;
      b.innerHTML = `<span class="key">${d.key}</span><span class="icon" style="background:${d.color}"></span>${d.name}<span class="cost">${d.cost}g</span>`;
      b.onclick = () => toggleBuild(kind);
      bb.appendChild(b);
    }
    const sb = $('send-buttons');
    for (const kind of CREEP_KEYS) {
      const d = C.CREEPS[kind];
      const b = document.createElement('button');
      b.className = 'creep';
      b.dataset.creep = kind;
      b.title = `Send ${d.name} - ${d.desc} (Shift-click sends 5)`;
      b.innerHTML = `<span class="key">${d.key}</span><span class="icon" style="width:${Math.round(d.size * 40)}px;height:${Math.round(d.size * 40)}px"></span>${d.name}<span class="cost">${d.cost}g</span>`;
      b.onclick = (e) => sendCreeps(kind, e.shiftKey ? 5 : 1);
      sb.appendChild(b);
    }
  }

  function toggleBuild(kind) {
    buildKind = buildKind === kind ? null : kind;
    clearSelection();
  }

  function sendCreeps(kind, count) {
    if (!myId) return;
    sendMsg({ t: 'send', kind, count, target: attackTarget || 0 });
  }

  let hudTimer = 0;
  function updateHud() {
    if (!myId) return;
    const p = players.get(myId);
    if (!p || !me) return;
    const gold = me.gold;
    const sorted = [...players.values()].sort((a, b) => b.territory - a.territory);
    const rank = sorted.findIndex((q) => q.id === myId) + 1;
    $('stats').innerHTML = `
      <div class="gold">${gold}g</div>
      <div>+${C.income(p.territory).toFixed(1)}g/s <span class="muted">· land ${p.territory}</span></div>
      <div class="muted">Units ${[...units.values()].filter((u) => u.owner === myId).length}/${C.MAX_UNITS}</div>
      <div class="muted">Rank #${rank} of ${players.size} · kills ${p.kills}</div>
      <div class="muted">Next neutral wave in ${Math.max(0, me.nextWave)}s</div>
      <div>Core ${p.hp}/${p.maxHp}</div>
      <div class="hpbar"><div style="width:${(100 * p.hp) / p.maxHp}%"></div></div>`;

    $('leaderboard').innerHTML = '<h3>Leaderboard · land</h3>' + sorted.slice(0, 10).map((q, i) =>
      `<div class="row${q.id === myId ? ' me' : ''}"><span>${i + 1}.</span><span class="dot" style="background:${colorOf(q.id, 55)}"></span><span class="n">${escapeHtml(q.name)}${q.isBot ? ' 🤖' : ''}</span><span>${q.territory}</span></div>`).join('');

    for (const b of document.querySelectorAll('#build-buttons button')) {
      b.classList.toggle('active', b.dataset.kind === buildKind);
      b.classList.toggle('poor', gold < C.defOf(b.dataset.kind).cost);
    }
    for (const b of document.querySelectorAll('#send-buttons button')) {
      b.classList.toggle('poor', gold < C.CREEPS[b.dataset.creep].cost);
    }
    const tgt = attackTarget && players.get(attackTarget);
    $('target-label').innerHTML = tgt ? `Target:<br><b>${escapeHtml(tgt.name)}</b>` : 'Target:<br><b>nearest</b><br>(click a core)';

    const now = performance.now();
    $('feed').innerHTML = feed.filter((f) => now - f.born < 9000).map((f) =>
      `<div style="opacity:${Math.min(1, (9000 - (now - f.born)) / 1500)}">${escapeHtml(f.text)}</div>`).join('');

    updateSelectionPanel(gold);
  }

  function guardName(anchorId) {
    if (!anchorId) return 'your core';
    const t = towers.get(anchorId);
    return t ? `beacon (lvl ${t.level})` : 'your core';
  }

  function updateUnitPanel(panel, gold) {
    const list = [...selUnits].map((id) => units.get(id)).filter(Boolean);
    const key = `u:${list.map((u) => `${u.id}.${u.level}`).join(',')}`;
    if (panel.dataset.key !== key) {
      panel.dataset.key = key;
      if (list.length === 1) {
        const u = list[0];
        const d = C.UNITS[u.kind];
        const st = C.towerStats(u.kind, u.level);
        const maxed = u.level >= C.MAX_LEVEL;
        panel.innerHTML = `<h4>${d.name} · level ${u.level}</h4><div id="sel-info"></div>
          <div>Damage ${st.damage.toFixed(0)} · Range ${st.range} · ${st.rate}/s</div>
          <div>Guarding <b id="sel-guard"></b></div>
          <div class="muted">Click one of your beacons or your core to reassign</div>
          <div class="btns">
            <button id="sel-up">${maxed ? 'Max level' : `Upgrade (${C.upgradeCost(u.kind, u.level)}g) [U]`}</button>
            <button id="sel-sell">Sell +${C.sellValue(u.kind, u.level)}g</button>
          </div>`;
        $('sel-up').onclick = () => sendMsg({ t: 'upgrade', id: u.id });
        $('sel-sell').onclick = () => sendMsg({ t: 'sell', id: u.id });
      } else {
        const counts = {};
        for (const u of list) counts[C.UNITS[u.kind].name] = (counts[C.UNITS[u.kind].name] || 0) + 1;
        panel.innerHTML = `<h4>${list.length} units selected</h4>
          <div>${Object.entries(counts).map(([n, c]) => `${c}× ${n}`).join(' · ')}</div>
          <div class="muted">Click one of your beacons or your core to send them all to guard it</div>`;
      }
    }
    if (list.length === 1) {
      const u = list[0];
      $('sel-info').textContent = `HP ${u.hp}/${u.maxHp}`;
      $('sel-guard').textContent = guardName(u.anchor);
      $('sel-up').disabled = u.level >= C.MAX_LEVEL || gold < C.upgradeCost(u.kind, u.level);
    }
  }

  function updateSelectionPanel(gold) {
    const panel = $('selection');
    if (selUnits.size) {
      panel.classList.remove('hidden');
      updateUnitPanel(panel, gold);
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
    // Rebuild markup only when the tower itself changes, so clicks on buttons are not lost.
    const key = `${t.id}:${t.level}:${t.owner}`;
    if (panel.dataset.key !== key) {
      panel.dataset.key = key;
      if (ruined) {
        panel.innerHTML = `<h4>Ruined ${d.name} (lvl ${t.level})</h4>
          <div class="muted">Once owned by ${escapeHtml(t.ruinOf || 'someone')}</div>
          <div id="sel-info"></div>
          <div class="btns"><button id="sel-capture">Capture (${C.RUIN_CAPTURE_COST}g)</button></div>`;
        $('sel-capture').onclick = () => sendMsg({ t: 'capture', id: t.id });
      } else {
        const st = C.towerStats(t.kind, t.level);
        const lines = [];
        if (st.damage) lines.push(`Damage ${st.damage.toFixed(0)} · Range ${st.range} · ${st.rate}/s`);
        if (st.claim) lines.push(`Claims radius ${st.claim}`);
        const guards = [...units.values()].filter((u) => u.owner === myId && u.anchor === t.id).length;
        lines.push(`Guarded by ${guards} unit${guards === 1 ? '' : 's'}`);
        const maxed = t.level >= C.MAX_LEVEL;
        panel.innerHTML = `<h4>${d.name} · level ${t.level}</h4><div id="sel-info"></div><div>${lines.join('<br>')}</div>
          <div class="btns">
            <button id="sel-up">${maxed ? 'Max level' : `Upgrade (${C.upgradeCost(t.kind, t.level)}g) [U]`}</button>
            <button id="sel-sell">Sell +${C.sellValue(t.kind, t.level)}g</button>
          </div>`;
        $('sel-up').onclick = () => sendMsg({ t: 'upgrade', id: t.id });
        $('sel-sell').onclick = () => sendMsg({ t: 'sell', id: t.id });
      }
    }
    if (ruined) {
      const inLand = terr[t.y * C.MAP_W + t.x] === myId;
      $('sel-info').textContent = inLand ? 'Inside your land - capture it!' : 'Expand your land over it to capture.';
      $('sel-capture').disabled = !inLand || gold < C.RUIN_CAPTURE_COST;
    } else {
      $('sel-info').textContent = `HP ${t.hp}/${t.maxHp}`;
      $('sel-up').disabled = t.level >= C.MAX_LEVEL || gold < C.upgradeCost(t.kind, t.level);
    }
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
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
    $('death-by').textContent = info.killer ? `Destroyed by ${info.killer}` : 'Overrun by the neutral horde';
    const mins = Math.floor(info.survived / 60);
    const secs = String(info.survived % 60).padStart(2, '0');
    $('death-stats').innerHTML = `
      <div><b>${mins}:${secs}</b><span>survived</span></div>
      <div><b>${info.peakTerritory}</b><span>peak land</span></div>
      <div><b>${info.kills}</b><span>creeps killed</span></div>
      <div><b>${info.coresDestroyed}</b><span>cores destroyed</span></div>`;
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
      if (Math.abs(dx) + Math.abs(dy) > 2) mouse.dragged = true;
      cam.x -= dx / scale();
      cam.y -= dy / scale();
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

    // Units selected + clicked one of my anchors: send them to guard it.
    if (selUnits.size) {
      const anchor = anchorAt(mouse.wx, mouse.wy);
      if (anchor !== null) {
        sendMsg({ t: 'assign', ids: [...selUnits], anchor });
        toast(`${selUnits.size} unit${selUnits.size === 1 ? '' : 's'} now guarding ${guardName(anchor)}`);
        return;
      }
    }

    // Clicked one of my units?
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

    // Clicked a core?
    for (const p of players.values()) {
      if (Math.hypot(p.x + 0.5 - mouse.wx, p.y + 0.5 - mouse.wy) < 1.1) {
        if (p.id !== myId) attackTarget = attackTarget === p.id ? null : p.id;
        clearSelection();
        return;
      }
    }
    const tid = grid.get(`${tx},${ty}`);
    const t = tid && towers.get(tid);
    clearSelection();
    selectedId = t && (t.owner === myId || !t.owner) ? t.id : null;
  });

  window.addEventListener('mouseup', (e) => {
    if ((e.button === 2 || e.button === 1) && mouse.rightDown) {
      mouse.rightDown = false;
      if (!mouse.dragged) {
        buildKind = null;
        clearSelection();
      }
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
    if (!myId) return;
    for (const kind of BUY_KEYS) {
      if (e.key === C.defOf(kind).key) toggleBuild(kind);
    }
    for (const kind of CREEP_KEYS) {
      if (k === C.CREEPS[kind].key.toLowerCase()) sendCreeps(kind, e.shiftKey ? 5 : 1);
    }
    if (k === 'escape') {
      buildKind = null;
      clearSelection();
    }
    if (k === 'q') {
      // Select all my units.
      buildKind = null;
      selectedId = null;
      selUnits.clear();
      for (const u of units.values()) if (u.owner === myId) selUnits.add(u.id);
    }
    if (k === ' ') {
      e.preventDefault();
      const p = players.get(myId);
      if (p) {
        cam.x = p.x + 0.5;
        cam.y = p.y + 0.5;
      }
    }
    const single = selUnits.size === 1 ? [...selUnits][0] : selectedId;
    if (k === 'u' && single) sendMsg({ t: 'upgrade', id: single });
    if ((k === 'delete' || k === 'backspace') && single) {
      const t = towers.get(single) || units.get(single);
      if (t && t.owner === myId) sendMsg({ t: 'sell', id: single });
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('resize', resize);

  $('play').onclick = join;
  $('again').onclick = () => sendMsg({ t: 'join', name: lastName });

  // ------------------------------------------------------------------ main loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    const pan = (18 / cam.zoom) * dt;
    if (myId) {
      if (keys.has('w') || keys.has('arrowup')) cam.y -= pan;
      if (keys.has('s') || keys.has('arrowdown')) cam.y += pan;
      if (keys.has('a') || keys.has('arrowleft')) cam.x -= pan;
      if (keys.has('d') || keys.has('arrowright')) cam.x += pan;
    } else {
      // Slow drift across the live map behind the menu.
      cam.x = C.MAP_W / 2 + Math.cos(now / 20000) * C.MAP_W * 0.25;
      cam.y = C.MAP_H / 2 + Math.sin(now / 20000) * C.MAP_H * 0.25;
    }
    cam.x = Math.max(0, Math.min(C.MAP_W, cam.x));
    cam.y = Math.max(0, Math.min(C.MAP_H, cam.y));
    updateMouseWorld();

    drawBackground();
    drawOverlay();
    drawTowers();
    drawCreeps(dt);
    drawUnits(dt);
    drawCores();
    drawEffects(now);
    if (myId) drawMinimap();

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
