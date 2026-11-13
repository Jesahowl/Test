// Territory layer: tracing, smoothing and drawing land borders.

import { S, C, colorOf, ctx, players, tctx, terrCanvas, TPX } from './state.js';

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
      const o = S.terrView[y * W + x];
      if (!o) continue;
      if (y === 0 || S.terrView[(y - 1) * W + x] !== o) add(x, y, x + 1, y, o);
      if (x === W - 1 || S.terrView[y * W + x + 1] !== o) add(x + 1, y, x + 1, y + 1, o);
      if (y === H - 1 || S.terrView[(y + 1) * W + x] !== o) add(x + 1, y + 1, x, y + 1, o);
      if (x === 0 || S.terrView[y * W + x - 1] !== o) add(x, y + 1, x, y, o);
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
  // The border network: every tile corner on a border, linked to the corners next to it along any
  // border. Smoothing works on this network rather than on each outline separately, so a corner
  // two territories share moves the same way for both: they always meet with no gap or overlap,
  // and an outline barely changes when a neighbour's land arrives next to it.
  const nbrs = new Map();
  const link = (a, b) => {
    let s1 = nbrs.get(a);
    if (!s1) nbrs.set(a, (s1 = new Set()));
    s1.add(b);
  };
  for (let i = 0; i < own.length; i++) {
    const a = y0[i] * VW + x0[i];
    const b = y1[i] * VW + x1[i];
    link(a, b);
    link(b, a);
  }
  // One averaging pass: each corner moves to the mean of itself and its neighbours along borders
  // (corners on the map's edge stay put). Junctions (3+ borders) are kept as corners afterwards.
  const pos = new Map();
  const deg = new Map();
  for (const [k, set] of nbrs) {
    const x = k % VW;
    const y = (k - x) / VW;
    deg.set(k, set.size);
    if (x === 0 || y === 0 || x === W || y === H) {
      pos.set(k, [x, y]);
      continue;
    }
    let sx = x;
    let sy = y;
    for (const n of set) {
      const nx = n % VW;
      sx += nx;
      sy += (n - nx) / VW;
    }
    pos.set(k, [sx / (set.size + 1), sy / (set.size + 1)]);
  }
  for (const loop of loops) {
    const keys = loop.pts.map(([x, y]) => y * VW + x);
    loop.pts = keys.map((k) => pos.get(k));
    loop.pins = keys.map((k) => deg.get(k) > 2);
  }
  return loops;
}

// Chaikin corner cutting. Pinned corners (junctions) are kept as-is (the curve passes through them),
// so where three territories meet their borders still touch exactly.
function chaikin(pts, iters, pins) {
  for (let k = 0; k < iters; k++) {
    const n = pts.length;
    const next = [];
    const nextPins = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      if (pins && pins[i]) {
        next.push(p);
        nextPins.push(true);
      }
      next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      next.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
      nextPins.push(false, false);
    }
    pts = next;
    pins = nextPins;
  }
  return pts;
}

function drawTerritory() {
  S.terrStamp++;
  const byOwner = new Map();
  for (const loop of traceOutlines()) {
    let path = byOwner.get(loop.owner);
    if (!path) byOwner.set(loop.owner, (path = new Path2D()));
    const pts = chaikin(loop.pts, 1, loop.pins);
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
    path.closePath();
  }
  S.terrShapes = [...byOwner].map(([owner, path]) => ({ owner, path }));
  S.terrLabels = findLabelSpots();

  // Low-res copy for the minimap.
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, terrCanvas.width, terrCanvas.height);
  tctx.setTransform(TPX, 0, 0, TPX, 0, 0);
  for (const { owner, path } of S.terrShapes) {
    tctx.fillStyle = colorOf(owner, 52, owner === S.myId ? 0.6 : 0.48);
    tctx.fill(path);
    tctx.strokeStyle = colorOf(owner, 68, 1);
    tctx.lineWidth = 0.8;
    tctx.stroke(path);
  }
}

// Territory fills and borders in world space: a see-through fill in the owner's colour inside a
// solid border drawn on the inside of its own edge. Neighbours share exactly the same edge (see the
// smoothing above), so their two border bands sit side by side.
function drawTerritoryShapes(ox, oy, s) {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  for (const { owner, path } of S.terrShapes) {
    ctx.fillStyle = colorOf(owner, 50, owner === S.myId ? 0.16 : 0.12);
    ctx.fill(path);
  }
  // Each border is drawn just inside its own land (clipped to it, at double width), so where two
  // players meet you see both colours side by side and neither paints over the other's land.
  for (const { owner, path } of S.terrShapes) {
    const mine = owner === S.myId;
    ctx.save();
    ctx.clip(path);
    ctx.strokeStyle = colorOf(owner, 65, mine ? 1 : 0.9);
    ctx.lineWidth = (mine ? 5 : 4.5) / s;
    ctx.stroke(path);
    ctx.restore();
  }
  ctx.restore();
  drawTerritoryLabels(ox, oy, s);
}

// ---- owner names written across their land
const LABEL_MIN_TILES = 25; // regions smaller than this get no label

// For every connected region of land, the spot deepest inside it (furthest from its edge) that is
// not right next to a core or tower, so the name sits in open land rather than on a building.
function findLabelSpots() {
  const W = C.MAP_W;
  const H = C.MAP_H;
  const N = W * H;
  const terr = S.terrView;
  // distance (in tiles) from each owned tile to the edge of its region
  const depth = new Int16Array(N).fill(-1);
  const queue = new Int32Array(N);
  let qh = 0;
  let qt = 0;
  for (let k = 0; k < N; k++) {
    const o = terr[k];
    if (!o) continue;
    const x = k % W;
    const y = (k - x) / W;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || terr[k - 1] !== o || terr[k + 1] !== o || terr[k - W] !== o || terr[k + W] !== o) {
      depth[k] = 0;
      queue[qt++] = k;
    }
  }
  while (qh < qt) {
    const k = queue[qh++];
    for (const n of [k - 1, k + 1, k - W, k + W]) {
      if (n < 0 || n >= N || depth[n] !== -1 || terr[n] !== terr[k]) continue;
      depth[n] = depth[k] + 1;
      queue[qt++] = n;
    }
  }
  // keep labels off buildings: block a small disc around every core and tower
  const blocked = new Uint8Array(N);
  const block = (cx, cy) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && dx * dx + dy * dy <= 6) blocked[y * W + x] = 1;
    }
  };
  for (const p of players.values()) block(p.x, p.y);
  for (const t of S.towers.values()) block(t.x, t.y);
  // flood-fill regions, remembering each one's best spot
  const region = new Int32Array(N);
  const labels = [];
  let id = 0;
  for (let start = 0; start < N; start++) {
    const o = terr[start];
    if (!o || region[start]) continue;
    id++;
    let size = 0;
    let best = -1;
    let bestScore = -Infinity;
    qh = 0;
    qt = 0;
    queue[qt++] = start;
    region[start] = id;
    while (qh < qt) {
      const k = queue[qh++];
      size++;
      const score = depth[k] - (blocked[k] ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
      const x = k % W;
      for (const n of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, k - W, k + W]) {
        if (n < 0 || n >= N || region[n] || terr[n] !== o) continue;
        region[n] = id;
        queue[qt++] = n;
      }
    }
    if (size < LABEL_MIN_TILES || best < 0) continue;
    const bx = best % W;
    labels.push({ owner: o, x: bx + 0.5, y: (best - bx) / W + 0.5, depth: Math.max(1, depth[best]) });
  }
  return labels;
}

function drawTerritoryLabels(ox, oy, s) {
  if (!S.terrLabels) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of S.terrLabels) {
    const p = players.get(l.owner);
    if (!p || l.owner === S.myId) continue; // your own land doesn't need your name on it
    // size: grows with how much room the region has, within limits, and with zoom
    const px = Math.min(Math.max(0.55, Math.min(l.depth * 0.45, 1.3)) * s, 46);
    if (px < 9) continue;
    const text = p.name.toUpperCase();
    ctx.font = `800 ${Math.round(px)}px system-ui, sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(px * 0.12)}px`;
    const x = ox + l.x * s;
    const y = oy + l.y * s;
    ctx.lineWidth = Math.max(2, px * 0.12);
    ctx.strokeStyle = 'rgba(8, 11, 15, 0.55)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = colorOf(l.owner, 72, l.owner === S.myId ? 0.5 : 0.42);
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

export { drawTerritory, drawTerritoryShapes };
