// The ground: muted plains with patches of forest (little pine trees) and rivers running along hex
// edges (crossed only by their stone bridges), drawn under everyone's land.
// Forests don't slow or hide troops; workers chop them for wood (each hex thins to stumps as it's
// chopped, then grows back). Where forests grow comes from the round's map seed.

import { S, C, HEX, ctx, players } from './state.js';

const PLAINS = '#18211d';
const FOREST = '#13281b';
const TREE_DARK = '#22422b';
const TREE_LIGHT = '#346343';
const TREE_SHADOW = 'rgba(0,0,0,0.35)';
const STUMP = '#4a3826';

const { hash, isForest, riversOf } = window.TD_TERRAIN; // shared with the server (shared/terrain.js)

// rivers: bank, deep water, the lighter middle (widths in tiles) and the stone of their bridges
const RIVER = { bank: '#2b3326', deep: '#1a3440', mid: '#22495a', flow: 'rgba(200, 230, 240, 0.16)', bankW: 1.6, deepW: 1.2, midW: 0.55 };
const STONE = { base: '#6f7378', block: '#7f848a', rail: '#9aa0a6', post: '#b4bac0', shadow: 'rgba(0,0,0,0.4)' };

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

// The rivers of map `seed`: one path each (along the hex corners they follow), and their bridges
// ({ x, y, ang }: the middle of the bridged edge and the edge's direction).
function buildRivers(seed) {
  const list = S.round && S.round.rivers === false ? [] : riversOf(seed, HEX, C.MAP_W, C.MAP_H);
  const paths = [];
  const bridges = [];
  for (const r of list) {
    const p = new Path2D();
    r.pts.forEach(([x, y], k) => (k ? p.lineTo(x, y) : p.moveTo(x, y)));
    paths.push({ p, len: r.edges.length * C.HEX_R });
    for (const e of r.edges) if (e.bridge) bridges.push({ x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2, ang: Math.atan2(e.y2 - e.y1, e.x2 - e.x1) });
  }
  return { list, paths, bridges };
}

// A stone bridge across a river edge: its deck runs across the water (at right angles to the edge).
function drawBridge(b) {
  const L = 2.3; // deck length, across the water
  const Wd = 1.15; // deck width
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.ang);
  ctx.fillStyle = STONE.shadow;
  ctx.fillRect(-Wd / 2 + 0.12, -L / 2 + 0.15, Wd, L);
  ctx.fillStyle = STONE.base;
  ctx.beginPath();
  ctx.roundRect(-Wd / 2, -L / 2, Wd, L, 0.15);
  ctx.fill();
  ctx.fillStyle = STONE.block;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 3; j++) ctx.fillRect(-Wd / 2 + 0.2 + j * 0.27 + (i % 2 ? 0.1 : 0), -L / 2 + 0.12 + i * 0.27, 0.2, 0.2);
  }
  ctx.fillStyle = STONE.rail;
  ctx.fillRect(-Wd / 2 - 0.04, -L / 2, 0.16, L);
  ctx.fillRect(Wd / 2 - 0.12, -L / 2, 0.16, L);
  ctx.fillStyle = STONE.post;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * (Wd / 2 + 0.04), sy * (L / 2 - 0.08), 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Rivers and bridges (in tile units: the caller has scaled the context). The lighter dashes drift
// along to show the water flowing.
function drawRivers(r) {
  if (!r.paths.length) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [col, w] of [[RIVER.bank, RIVER.bankW], [RIVER.deep, RIVER.deepW], [RIVER.mid, RIVER.midW]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    for (const p of r.paths) ctx.stroke(p.p);
  }
  ctx.strokeStyle = RIVER.flow;
  ctx.lineWidth = 0.08;
  ctx.setLineDash([0.35, 1.6]);
  ctx.lineDashOffset = -(performance.now() / 1000) * 0.6;
  for (const p of r.paths) ctx.stroke(p.p);
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  for (const b of r.bridges) drawBridge(b);
}

// The current map's rivers (for the minimap too).
function riverView() {
  const seed = S.round && S.round.seed;
  if (seed === undefined || seed === null) return null;
  if (!built || built.seed !== seed) built = build(seed);
  return built.rivers;
}

function build(seed) {
  const rivers = buildRivers(seed);
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
  return { seed, fill, forests, rivers };
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
  drawRivers(built.rivers);
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

export { drawTerrain, riverView };
