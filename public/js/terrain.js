// The ground: muted plains with patches of forest (little pine trees), drawn under everyone's land.
// Forests don't slow or hide troops; workers chop them for wood (each hex thins to stumps as it's
// chopped, then grows back). Where forests grow comes from the round's map seed.

import { S, C, HEX, ctx, players } from './state.js';

const PLAINS = '#18211d';
const FOREST = '#13281b';
const TREE_DARK = '#22422b';
const TREE_LIGHT = '#346343';
const TREE_SHADOW = 'rgba(0,0,0,0.35)';
const STUMP = '#4a3826';

const { hash, isForest } = window.TD_TERRAIN; // shared with the server (shared/terrain.js)

// ---- the forest, built once per map (in tile units)
let built = null;

// One small pine at (x, y), size s, as three paths (shadow, dark side, lit side).
function pine(x, y, s) {
  const t = { x, y, s, shadow: new Path2D(), dark: new Path2D(), light: new Path2D() };
  t.shadow.ellipse(x, y + 0.04, s * 0.7, s * 0.22, 0, 0, Math.PI * 2);
  for (const [dy, w] of [[-s * 0.2, s * 0.75], [-s * 0.75, s * 0.55]]) {
    const top = y + dy - s * 0.9;
    t.dark.moveTo(x, top);
    t.dark.lineTo(x + w, y + dy);
    t.dark.lineTo(x - w, y + dy);
    t.dark.closePath();
    t.light.moveTo(x, top);
    t.light.lineTo(x - w, y + dy);
    t.light.lineTo(x - w * 0.15, y + dy);
    t.light.closePath();
  }
  return t;
}

function build(seed) {
  const fill = new Path2D();
  const forests = [];
  for (const h of HEX.hexes) {
    if (!isForest(seed, h)) continue;
    const cs = HEX.corners(h);
    fill.moveTo(cs[0][0], cs[0][1]);
    for (let k = 1; k < 6; k++) fill.lineTo(cs[k][0], cs[k][1]);
    fill.closePath();
    // five small trees, each in its own slice of the hex, nudged a little at random; `cut` is the
    // order they fall in as the hex is chopped
    const trees = [[0, 0], [-1.05, -0.65], [1.05, -0.6], [-0.95, 0.8], [1.0, 0.85]].map(([dx, dy], k) => {
      const t = pine(h.cx + dx + (hash(seed, h.i * 7 + k, 11) - 0.5) * 0.6, h.cy + dy + (hash(seed, h.i, 91 + k) - 0.5) * 0.5 + 0.2, 0.38 + hash(seed, k, h.i) * 0.14);
      t.cut = hash(seed, h.i, 400 + k);
      return t;
    });
    const order = [...trees].sort((a, b) => a.cut - b.cut);
    order.forEach((t, n) => { t.rank = n; }); // trees with rank >= wood left are gone
    trees.sort((a, b) => a.y - b.y);
    forests.push({ i: h.i, x: h.cx, y: h.cy, trees });
  }
  return { seed, fill, forests };
}

// Draw the ground under the map rectangle at screen (ox, oy), s pixels per tile.
function drawTerrain(ox, oy, s) {
  ctx.fillStyle = PLAINS;
  ctx.fillRect(ox, oy, C.MAP_W * s, C.MAP_H * s);
  const seed = S.round && S.round.seed;
  if (seed === undefined || seed === null) return;
  if (!built || built.seed !== seed) built = build(seed);
  ctx.save();
  // nothing past the map's edge (the hexes along it are cut off)
  ctx.beginPath();
  ctx.rect(ox, oy, C.MAP_W * s, C.MAP_H * s);
  ctx.clip();
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
    for (const f of built.forests) {
      if (f.x < x0 || f.x > x1 || f.y < y0 || f.y > y1 || taken.has(f.i)) continue;
      const left = S.forestLeft.has(f.i) ? S.forestLeft.get(f.i) : 5; // trees still standing
      for (const t of f.trees) {
        if (t.rank >= left) {
          // chopped: a stump
          ctx.fillStyle = STUMP;
          ctx.beginPath();
          ctx.ellipse(t.x, t.y - 0.05, t.s * 0.22, t.s * 0.12, 0, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.fillStyle = TREE_SHADOW;
        ctx.fill(t.shadow);
        ctx.fillStyle = TREE_DARK;
        ctx.fill(t.dark);
        ctx.fillStyle = TREE_LIGHT;
        ctx.fill(t.light);
      }
    }
  }
  ctx.restore();
}

export { drawTerrain };
