// Territory layer: hex land outlines, fills and owner names.

import { S, C, colorOf, ctx, HEX, players, tctx, terrCanvas, TPX } from './state.js';

// ------------------------------------------------------------------ territory layer
// Land is owned hex by hex. Each player's land is outlined along the hex edges where it meets
// someone else's land (or empty ground): those edges are chained into closed loops and kept as a
// vector Path2D (in tile units), so borders stay crisp at any zoom.

// Who owns hex i (every tile in a hex has the same owner; read its first tile).
const hexOwnerOf = (i) => S.terrView[HEX.hexes[i].tiles[0]];

// Closed outlines of every owner's land, as loops of hex corners.
function traceOutlines() {
  const key = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const edges = []; // { owner, a: [x, y], b: [x, y] } running round each region
  const from = new Map(); // owner|corner key -> edge indices starting there
  for (const h of HEX.hexes) {
    const o = hexOwnerOf(h.i);
    if (!o) continue;
    const cs = HEX.corners(h);
    for (let k = 0; k < 6; k++) {
      const j = HEX.across(h, k);
      if (j >= 0 && hexOwnerOf(j) === o) continue;
      const e = edges.length;
      edges.push({ owner: o, a: cs[k], b: cs[(k + 1) % 6] });
      const fk = `${o}|${key(...cs[k])}`;
      if (!from.has(fk)) from.set(fk, []);
      from.get(fk).push(e);
    }
  }
  const used = new Uint8Array(edges.length);
  const loops = [];
  for (let s0 = 0; s0 < edges.length; s0++) {
    if (used[s0]) continue;
    const o = edges[s0].owner;
    const pts = [];
    let e = s0;
    while (e !== undefined && !used[e]) {
      used[e] = 1;
      pts.push(edges[e].a);
      const next = (from.get(`${o}|${key(...edges[e].b)}`) || []).find((j) => !used[j]);
      e = next;
    }
    if (pts.length > 2) loops.push({ owner: o, pts });
  }
  return loops;
}

function drawTerritory() {
  S.terrStamp++;
  const byOwner = new Map();
  for (const loop of traceOutlines()) {
    let path = byOwner.get(loop.owner);
    if (!path) byOwner.set(loop.owner, (path = new Path2D()));
    const pts = loop.pts;
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
// The whole map with a thin band cut out along each gate (world units), for an even-odd clip; null
// when there are no gates.
function gateCutout() {
  let cut = null;
  for (const w of S.walls ? S.walls.values() : []) {
    if (!w.gate || !w.ends) continue;
    if (!cut) {
      cut = new Path2D();
      cut.rect(-1, -1, C.MAP_W + 2, C.MAP_H + 2);
    }
    const [[ax, ay], [bx, by]] = w.ends;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const t = 0.4; // half the band's width, in tiles
    cut.moveTo(ax - uy * t, ay + ux * t);
    cut.lineTo(bx - uy * t, by + ux * t);
    cut.lineTo(bx + uy * t, by - ux * t);
    cut.lineTo(ax + uy * t, ay - ux * t);
    cut.closePath();
  }
  return cut;
}

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
  // Gates leave their doorway clear: no border line runs under one.
  const doors = gateCutout();
  for (const { owner, path } of S.terrShapes) {
    const mine = owner === S.myId;
    ctx.save();
    if (doors) ctx.clip(doors, 'evenodd');
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
