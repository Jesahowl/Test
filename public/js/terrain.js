// The ground: muted plains with patches of forest (little pine trees), drawn under everyone's land.
// Purely a look for now (forests don't slow or hide troops). Where forests grow comes from the
// round's map seed, so every player sees the same map.

import { S, C, HEX, ctx, players } from './state.js';

const PLAINS = '#18211d';
const FOREST = '#13281b';
const TREE_DARK = '#22422b';
const TREE_LIGHT = '#346343';
const TREE_SHADOW = 'rgba(0,0,0,0.35)';
const FOREST_AT = 0.64; // noise above this is forest (about one hex in six)

// ---- seeded value noise
function hash(seed, x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
function vnoise(seed, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash(seed, xi, yi);
  const b = hash(seed, xi + 1, yi);
  const c = hash(seed, xi, yi + 1);
  const d = hash(seed, xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
const fbm = (seed, x, y) => 0.6 * vnoise(seed, x, y) + 0.3 * vnoise(seed + 1, x * 2.1, y * 2.1) + 0.1 * vnoise(seed + 2, x * 4.3, y * 4.3);

// ---- the forest, built once per map (in tile units)
let built = null;

function pine(paths, x, y, s) {
  paths.shadow.moveTo(x + s * 0.7, y + 0.04);
  paths.shadow.ellipse(x, y + 0.04, s * 0.7, s * 0.22, 0, 0, Math.PI * 2);
  for (const [dy, w] of [[-s * 0.2, s * 0.75], [-s * 0.75, s * 0.55]]) {
    const top = y + dy - s * 0.9;
    paths.dark.moveTo(x, top);
    paths.dark.lineTo(x + w, y + dy);
    paths.dark.lineTo(x - w, y + dy);
    paths.dark.closePath();
    paths.light.moveTo(x, top);
    paths.light.lineTo(x - w, y + dy);
    paths.light.lineTo(x - w * 0.15, y + dy);
    paths.light.closePath();
  }
}

function build(seed) {
  const fill = new Path2D();
  const trees = [];
  for (const h of HEX.hexes) {
    if (fbm(seed, h.cx / 10, h.cy / 10) <= FOREST_AT) continue;
    const cs = HEX.corners(h);
    fill.moveTo(cs[0][0], cs[0][1]);
    for (let k = 1; k < 6; k++) fill.lineTo(cs[k][0], cs[k][1]);
    fill.closePath();
    const paths = { i: h.i, x: h.cx, y: h.cy, shadow: new Path2D(), dark: new Path2D(), light: new Path2D() };
    // five small trees, each in its own slice of the hex, nudged a little at random
    const spots = [[0, 0], [-1.05, -0.65], [1.05, -0.6], [-0.95, 0.8], [1.0, 0.85]].map(([dx, dy], k) => [
      h.cx + dx + (hash(seed, h.i * 7 + k, 11) - 0.5) * 0.6,
      h.cy + dy + (hash(seed, h.i, 91 + k) - 0.5) * 0.5 + 0.2,
      0.38 + hash(seed, k, h.i) * 0.14]);
    spots.sort((a, b) => a[1] - b[1]);
    for (const [x, y, s] of spots) pine(paths, x, y, s);
    trees.push(paths);
  }
  return { seed, fill, trees };
}

// Draw the ground under the map rectangle at screen (ox, oy), s pixels per tile.
function drawTerrain(ox, oy, s) {
  ctx.fillStyle = PLAINS;
  ctx.fillRect(ox, oy, C.MAP_W * s, C.MAP_H * s);
  const seed = S.round && S.round.seed;
  if (seed === undefined || seed === null) return;
  if (!built || built.seed !== seed) built = build(seed);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  ctx.fillStyle = FOREST;
  ctx.fill(built.fill);
  if (s >= 5) {
    // trees on the forest hexes in view, except where a building, core or camp stands
    const taken = new Set();
    const hexAt = (x, y) => HEX.tileHex[Math.floor(y) * C.MAP_W + Math.floor(x)];
    for (const t of S.towers.values()) taken.add(hexAt(t.x, t.y));
    for (const p of players.values()) taken.add(hexAt(p.x, p.y));
    for (const c of S.camps || []) taken.add(hexAt(c.x, c.y));
    const x0 = -ox / s - 3;
    const y0 = -oy / s - 3;
    const x1 = x0 + ctx.canvas.width / s + 6;
    const y1 = y0 + ctx.canvas.height / s + 6;
    for (const t of built.trees) {
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1 || taken.has(t.i)) continue;
      ctx.fillStyle = TREE_SHADOW;
      ctx.fill(t.shadow);
      ctx.fillStyle = TREE_DARK;
      ctx.fill(t.dark);
      ctx.fillStyle = TREE_LIGHT;
      ctx.fill(t.light);
    }
  }
  ctx.restore();
}

export { drawTerrain };
