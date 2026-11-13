// Territory layer: tracing, smoothing and drawing land borders.

import { S, C, colorOf, ctx, SMOOTH_PASSES, SMOOTH_WINDOW, tctx, terrCanvas, TPX } from './state.js';

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
  S.terrStamp++;
  const byOwner = new Map();
  for (const loop of traceOutlines()) {
    let path = byOwner.get(loop.owner);
    if (!path) byOwner.set(loop.owner, (path = new Path2D()));
    const pts = chaikin(relax(loop.pts, SMOOTH_WINDOW, SMOOTH_PASSES), 1);
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
    path.closePath();
  }
  S.terrShapes = [...byOwner].map(([owner, path]) => ({ owner, path }));

  // Low-res copy for the minimap.
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, terrCanvas.width, terrCanvas.height);
  tctx.setTransform(TPX, 0, 0, TPX, 0, 0);
  for (const { owner, path } of S.terrShapes) {
    tctx.fillStyle = colorOf(owner, 50, 0.35);
    tctx.fill(path);
    tctx.strokeStyle = colorOf(owner, 62, 0.9);
    tctx.lineWidth = 0.6;
    tctx.stroke(path);
  }
}

// Territory fills and borders in world space. Borders are stroked inside each region
// (clip + double width) so neighbouring territories show two clean, non-overlapping bands.
// Territory style: diagonal stripes in the owner's colour inside a dashed border, like a map of
// claims. Stripes come from a small cached pattern per colour: they keep the same on-screen
// spacing at any zoom and are pinned to the map, so they don't slide when the camera pans.
const STRIPE_GAP = 10; // px between stripes on screen
const stripeCache = new Map();
function stripePattern(color) {
  let pat = stripeCache.get(color);
  if (pat) return pat;
  const c = document.createElement('canvas');
  c.width = c.height = STRIPE_GAP;
  const g = c.getContext('2d');
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  for (const o of [-STRIPE_GAP, 0, STRIPE_GAP]) {
    g.moveTo(o - 1, STRIPE_GAP + 1);
    g.lineTo(o + STRIPE_GAP + 1, -1);
  }
  g.stroke();
  pat = ctx.createPattern(c, 'repeat');
  stripeCache.set(color, pat);
  return pat;
}

function drawTerritoryShapes(ox, oy, s) {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  const unscale = new DOMMatrix().scale(1 / s); // pattern pixels = screen pixels
  for (const { owner, path } of S.terrShapes) {
    const mine = owner === S.myId;
    ctx.fillStyle = colorOf(owner, 50, mine ? 0.07 : 0.04); // faint tint so land reads at a glance
    ctx.fill(path);
    const pat = stripePattern(colorOf(owner, 55, mine ? 0.42 : 0.3));
    pat.setTransform(unscale);
    ctx.fillStyle = pat;
    ctx.fill(path);
  }
  for (const { owner, path } of S.terrShapes) {
    const mine = owner === S.myId;
    ctx.setLineDash([8 / s, 6 / s]);
    ctx.strokeStyle = colorOf(owner, 65, mine ? 1 : 0.85);
    ctx.lineWidth = (mine ? 3 : 2.5) / s;
    ctx.stroke(path);
  }
  ctx.setLineDash([]);
  ctx.restore();
}

export { drawTerritory, drawTerritoryShapes };
