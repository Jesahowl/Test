// The ground, drawn under everyone's land: biomes (each hex's ground colour and props come from a
// seeded climate: tundra, taiga, meadow, woods, steppe, desert, swamp, highlands, shading from one
// to the next hex by hex), patches of forest (pines, snowy in the cold, with autumn trees in warm
// woods), iron ore deposits (rust-red rocks), gold veins, and rivers running along hex edges
// (crossed only by their stone bridges).
// Forests don't slow or hide troops; workers chop them for wood (each hex thins to stumps as it's
// chopped, then grows back). Where forests grow comes from the round's map seed.

import { S, C, HEX, ctx, players } from './state.js';
import { hexGridPath } from './render.js';

// What the drawing helpers below draw on: the screen, or (while filling the terrain cache) a cached chunk.
let dc = ctx;

// The palette is lifted a little (brighter, more colourful, a touch more contrast) so biomes, forests
// and resources read at a glance: every terrain colour below goes through lift() once.
const LIFT = { bright: 1.14, sat: 1.28, contrast: 1.06 };
function lift(c) {
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map((v) => Math.max(0, Math.min(255, Math.round(((l + (v - l) * LIFT.sat) * LIFT.bright - 128) * LIFT.contrast + 128))));
}
const liftStr = (str) => str
  .replace(/#([0-9a-f]{6})\b/gi, (_, h) => '#' + lift([0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16))).map((v) => v.toString(16).padStart(2, '0')).join(''))
  .replace(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/g, (m, r, g, b) => m.slice(0, m.indexOf('(') + 1) + lift([+r, +g, +b]).join(', '));
// (lifts every colour in a table of them, in place: strings, and [r, g, b, ...] arrays)
function liftAll(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'string') o[k] = liftStr(v);
    else if (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => typeof n === 'number')) o[k] = [...lift(v.slice(0, 3)), ...v.slice(3)];
    else if (v && typeof v === 'object') liftAll(v);
  }
  return o;
}

const PLAINS = liftStr('#18211d');
// things placed round a hex (trees, rocks, peaks) were laid out for hexes 2.5 tiles across: spread
// them to fit the real size
const HK = C.HEX_R / 2.5;
const TREE_DARK = liftStr('#21482a');
const TREE_LIGHT = liftStr('#336a40');
const TREE_SHADOW = 'rgba(0,0,0,0.35)';
const STUMP = liftStr('#4a3826');
// iron ore deposits: rust-dark ground, red-brown rocks with ore specks (rubble once mined out)
// (rocky outcrops on the biome's own ground: a ragged gravel patch, rust-streaked boulders; rubble once mined out)
const ORE = liftAll({ patch: [74, 68, 62], patchA: 0.5, pebbles: ['rgba(110,104,98,0.85)', 'rgba(150,85,60,0.8)'], rock: '#6a5a50', lit: '#7d6c61', crack: '#3e332c', speck: '#c0704a', rubble: '#4a403a' });

// gold veins: dark rock shot with gold round a timber mine mouth, with a soft glow
// gold veins: a pale gravel patch with gold pebbles, grey boulders flecked with twinkling gold, a soft glow
const VEIN = liftAll({ patch: [96, 92, 84], patchA: 0.5, pebbles: ['rgba(130,124,112,0.85)', 'rgba(150,145,132,0.8)', 'rgba(230,180,70,0.9)'], rock: '#5e564a', lit: '#72695b', crack: '#3a342c', gold: '#ffd76e' });

// One ore rock at (x, y), size s (tile units), as paths.
function oreRock(x, y, s) {
  const r = { x, y, s, shadow: new Path2D(), body: new Path2D(), lit: new Path2D(), crack: new Path2D() };
  r.shadow.ellipse(x + 0.05, y + s * 0.45, s * 1.05, s * 0.32, 0, 0, Math.PI * 2);
  r.body.moveTo(x - s, y + s * 0.4);
  r.body.lineTo(x - s * 0.7, y - s * 0.4);
  r.body.lineTo(x - s * 0.1, y - s * 0.75);
  r.body.lineTo(x + s * 0.75, y - s * 0.35);
  r.body.lineTo(x + s, y + s * 0.4);
  r.body.closePath();
  r.lit.moveTo(x - s * 0.7, y - s * 0.4);
  r.lit.lineTo(x - s * 0.1, y - s * 0.75);
  r.lit.lineTo(x + s * 0.05, y + s * 0.4);
  r.lit.lineTo(x - s, y + s * 0.4);
  r.lit.closePath();
  r.crack.moveTo(x - s * 0.1, y - s * 0.75);
  r.crack.lineTo(x + s * 0.05, y + s * 0.4);
  return r;
}

const { hash, climate, biomeOf, groundColor, mapTerrain } = window.TD_TERRAIN;
// the map's layout (rivers, mountains, forests, iron, gold veins), exactly as the server has it
// The map on show: this round's, or (on the menu, before any round) a random one for the backdrop.
S.menuSeed = Math.floor(Math.random() * 1e9);
const mapSeed = () => (S.round && S.round.seed != null ? S.round.seed : S.menuSeed);
const layoutOf = (seed) => mapTerrain(seed, HEX, C.MAP_W, C.MAP_H, { rivers: !(S.round && S.round.rivers === false) });
// mountains: grey rock hexes with snow-capped peaks; the hexes round them (foothills) lean grey too
const ROCK_RGB = [58, 62, 67];
const PEAK = liftAll({ body: '#4a5058', lit: '#5d646d', snow: '#d8e0e4', shadow: 'rgba(0,0,0,0.35)' });
const FOREST_RGB = [19, 40, 27];
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const SNOW_PINE = liftAll({ dark: '#2d4a40', light: '#cfd9dc' });
const AUTUMN = liftAll(['#5e5030', '#64452c', '#545a30']); // (muted)
// biome props on open hexes (tile units)
const PROP = liftAll({ meadow: 'rgba(79, 110, 58, 0.55)', steppe: 'rgba(138, 122, 69, 0.5)', snow: 'rgba(220, 232, 236, 0.1)', pool: 'rgba(30, 70, 72, 0.45)', reed: 'rgba(92, 125, 72, 0.6)', dune: 'rgba(255, 230, 180, 0.08)', cactus: '#465e36', rock: '#50555b', rockLit: '#60656c' });
const PLAINS_RGB = [24, 33, 29]; // (the old plains colour, which the ground leans toward a little)

// rivers: bank, deep water, the lighter middle (widths in tiles) and the stone of their bridges
const RIVER = liftAll({ bank: '#2b3326', deep: '#1a3440', mid: '#22495a', flow: 'rgba(200, 230, 240, 0.16)', bankW: 1.6, deepW: 1.2, midW: 0.55 });
// the sea (style: cliffs and rocks): water darkening with depth (hexes out from the shore), a rocky
// cliff face where the land drops into it, a line of surf at the cliff's foot, rocks in the shallows
const SEA = liftAll({ depth: ['#24505c', '#1c3d50', '#173248', '#13293f', '#112437'], cliff: '#4a4740', cliffLit: '#57534a', surf: '230, 240, 240', shadow: 'rgba(0, 0, 0, 0.2)', rock: '#5b5e62', rockLit: '#6c7075', cliffH: 0.9, ledge: 0.4 });
const STONE = liftAll({ base: '#6f7378', block: '#7f848a', rail: '#9aa0a6', post: '#b4bac0', shadow: 'rgba(0,0,0,0.4)' });

// ---- the forest, built once per map (in tile units)
let built = null;

// One small pine at (x, y), size s, as three paths (shadow, dark side, lit side).
// A round (broadleaf) tree: an autumn colour canopy on a short trunk.
function roundTree(x, y, s, colour) {
  const t = { x, y, s, round: true, colour, shadow: new Path2D(), trunk: new Path2D(), canopy: new Path2D(), shine: new Path2D() };
  t.shadow.ellipse(x, y + 0.04, s * 0.65, s * 0.2, 0, 0, Math.PI * 2);
  t.trunk.rect(x - s * 0.08, y - s * 0.45, s * 0.16, s * 0.45);
  t.canopy.arc(x, y - s * 0.8, s * 0.55, 0, Math.PI * 2);
  t.shine.arc(x - s * 0.18, y - s * 0.95, s * 0.22, 0, Math.PI * 2);
  return t;
}

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
// A river that reaches the coast ends there: its banks stop at the shore (rivers are drawn kept off
// the sea), and its water pours on down the cliff (or over the ledge) into the sea, with foam where
// it lands (mouths: { x1, y1, x2, y2 }).
function buildRivers(seed, sea, lakes = []) {
  const list = layoutOf(seed).rivers;
  const paths = [];
  const bridges = [];
  const mouths = [];
  for (const r of list) {
    const p = new Path2D();
    r.pts.forEach(([x, y], k) => (k ? p.lineTo(x, y) : p.moveTo(x, y)));
    const end = r.pts[r.pts.length - 1];
    const d = sea && sea.dropAt(end);
    if (d) mouths.push({ x1: end[0], y1: end[1], x2: end[0] + d[0] * 1.15, y2: end[1] + d[1] * 1.15 });
    else {
      // into a lake: on toward the lake hexes at this corner, over the shore into the water
      const near = [];
      for (const lk of lakes) for (const i of lk.cells) { const h = HEX.hexes[i]; if (Math.hypot(h.cx - end[0], h.cy - end[1]) < C.HEX_R + 0.05) near.push(h); }
      if (near.length) {
        const mx = near.reduce((s, h) => s + h.cx, 0) / near.length - end[0];
        const my = near.reduce((s, h) => s + h.cy, 0) / near.length - end[1];
        const len = Math.hypot(mx, my) || 1;
        const lk = lakes.find((l) => l.cells.includes(near[0].i));
        mouths.push({ x1: end[0], y1: end[1], x2: end[0] + (mx / len) * 1.1, y2: end[1] + (my / len) * 1.1, calm: lk.water });
      }
    }
    paths.push({ p, len: r.edges.length * C.HEX_R });
    for (const e of r.edges) if (e.bridge) bridges.push({ x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2, ang: Math.atan2(e.y2 - e.y1, e.x2 - e.x1) });
  }
  return { list, paths, bridges, mouths };
}

// A stone bridge across a river edge: its deck runs across the water (at right angles to the edge).
function drawBridge(b) {
  const L = 2.3; // deck length, across the water
  const Wd = 1.15; // deck width
  dc.save();
  dc.translate(b.x, b.y);
  dc.rotate(b.ang);
  dc.fillStyle = STONE.shadow;
  dc.fillRect(-Wd / 2 + 0.12, -L / 2 + 0.15, Wd, L);
  dc.fillStyle = STONE.base;
  dc.beginPath();
  dc.roundRect(-Wd / 2, -L / 2, Wd, L, 0.15);
  dc.fill();
  dc.fillStyle = STONE.block;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 3; j++) dc.fillRect(-Wd / 2 + 0.2 + j * 0.27 + (i % 2 ? 0.1 : 0), -L / 2 + 0.12 + i * 0.27, 0.2, 0.2);
  }
  dc.fillStyle = STONE.rail;
  dc.fillRect(-Wd / 2 - 0.04, -L / 2, 0.16, L);
  dc.fillRect(Wd / 2 - 0.12, -L / 2, 0.16, L);
  dc.fillStyle = STONE.post;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      dc.beginPath();
      dc.arc(sx * (Wd / 2 + 0.04), sy * (L / 2 - 0.08), 0.14, 0, Math.PI * 2);
      dc.fill();
    }
  }
  dc.restore();
}

// Rivers and bridges (in tile units: the caller has scaled the context). The lighter dashes drift
// along to show the water flowing.
function drawRivers(r, sea) {
  if (!r.paths.length) return;
  dc.lineCap = 'round';
  dc.lineJoin = 'round';
  dc.save();
  // (kept to the land: at the coast the river's banks simply stop)
  const land = new Path2D();
  land.rect(-10, -10, C.MAP_W + 20, C.MAP_H + 20);
  land.addPath(sea.all);
  land.addPath(sea.lakeAll);
  dc.clip(land, 'evenodd');
  for (const [col, w] of [[RIVER.bank, RIVER.bankW], [RIVER.deep, RIVER.deepW], [RIVER.mid, RIVER.midW]]) {
    dc.strokeStyle = col;
    dc.lineWidth = w;
    for (const p of r.paths) dc.stroke(p.p);
  }
  dc.restore();
  // the mouths: the water spills over the edge into the sea (no banks), foaming where it lands
  dc.lineCap = 'butt';
  for (const m of r.mouths) {
    const g = dc.createLinearGradient(m.x1, m.y1, m.x2, m.y2);
    g.addColorStop(0, RIVER.deep);
    g.addColorStop(1, m.calm || 'rgba(36, 80, 92, 0)'); // (into a lake: into its own water colour)
    dc.strokeStyle = g;
    dc.lineWidth = RIVER.deepW;
    dc.beginPath();
    dc.moveTo(m.x1, m.y1);
    dc.lineTo(m.x2, m.y2);
    dc.stroke();
    if (m.calm) continue; // (a lake: calm water, no spray or foam)
    dc.strokeStyle = 'rgba(200, 230, 240, 0.35)';
    dc.lineWidth = RIVER.midW * 0.8;
    dc.beginPath();
    dc.moveTo(m.x1, m.y1);
    dc.lineTo(m.x1 + (m.x2 - m.x1) * 0.85, m.y1 + (m.y2 - m.y1) * 0.85);
    dc.stroke();
    dc.fillStyle = 'rgba(235, 245, 245, 0.4)';
    dc.beginPath();
    dc.ellipse(m.x2, m.y2, 0.7, 0.32, 0, 0, Math.PI * 2);
    dc.fill();
  }
  dc.lineCap = 'butt';
  for (const b of r.bridges) drawBridge(b);
}

// The water flowing down the rivers (lighter dashes drifting along), drawn live over the cached
// terrain, with the bridges back on top.
function drawRiverFlow(r) {
  if (!r.paths.length) return;
  dc.lineCap = 'round';
  dc.strokeStyle = RIVER.flow;
  dc.lineWidth = 0.08;
  dc.setLineDash([0.35, 1.6]);
  dc.lineDashOffset = -(performance.now() / 1000) * 0.6;
  for (const p of r.paths) dc.stroke(p.p);
  dc.setLineDash([]);
  dc.lineCap = 'butt';
  for (const b of r.bridges) drawBridge(b);
}

// The current map's rivers (for the minimap too).
function riverView() {
  const seed = mapSeed();
  if (seed === undefined || seed === null) return null;
  if (!built || built.seed !== seed) built = build(seed);
  return built.rivers;
}

// A small picture of the current map's biomes (one pixel per tile), for the minimap's background.
let groundPic = null;
function groundCanvas() {
  const seed = mapSeed();
  if (seed === undefined || seed === null) return null;
  if (!built || built.seed !== seed) built = build(seed);
  if (groundPic && groundPic.seed === seed) return groundPic.canvas;
  const cv = document.createElement('canvas');
  cv.width = C.MAP_W;
  cv.height = C.MAP_H;
  const g = cv.getContext('2d');
  const img = g.createImageData(C.MAP_W, C.MAP_H);
  for (let k = 0; k < C.MAP_W * C.MAP_H; k++) {
    const c = built.tint.get(HEX.tileHex[k]) || [24, 33, 29];
    img.data[k * 4] = c[0];
    img.data[k * 4 + 1] = c[1];
    img.data[k * 4 + 2] = c[2];
    img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  groundPic = { seed, canvas: cv };
  return cv;
}

// The current map's gold veins (for the minimap).
function veinsView() {
  const seed = mapSeed();
  if (seed === undefined || seed === null) return [];
  if (!built || built.seed !== seed) built = build(seed);
  return built.veins;
}

// Slivers of hexes along the map's edge too thin to hold a tile's centre aren't in the grid, so
// nothing would paint them: these "ghost" hexes fill them in, looking like their neighbours
// ({ cx, cy, n: neighbouring real hex indices }). (Drawing only: no one can stand there.)
let ghostList = null;
function ghostHexes() {
  if (ghostList) return ghostList;
  ghostList = [];
  const r = C.HEX_R;
  const SQ3 = Math.sqrt(3);
  const centre = (q, rr) => [r + r * SQ3 * (q + rr / 2), r + r * 1.5 * rr];
  for (let rr = -2; rr <= Math.ceil(C.MAP_H / (1.5 * r)) + 2; rr++) {
    for (let q = Math.floor(-rr / 2) - 3; q <= Math.ceil(C.MAP_W / (r * SQ3) - rr / 2) + 3; q++) {
      const [cx, cy] = centre(q, rr);
      if (cx < -r || cy < -r || cx > C.MAP_W + r || cy > C.MAP_H + r) continue; // (wholly off the map)
      if (HEX.at(cx, cy) >= 0) continue; // a real hex
      const n = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].map(([dq, dr]) => HEX.at(...centre(q + dq, rr + dr))).filter((j) => j >= 0);
      if (n.length) ghostList.push({ cx, cy, n });
    }
  }
  return ghostList;
}
const hexOutline = (path, h) => {
  const cs = HEX.corners(h);
  path.moveTo(cs[0][0], cs[0][1]);
  for (let k = 1; k < 6; k++) path.lineTo(cs[k][0], cs[k][1]);
  path.closePath();
};
const ghostIsSea = (L, g) => g.n.filter((j) => L.ocean.has(j)).length * 2 >= g.n.length && g.n.some((j) => L.ocean.has(j));

// The ground of the whole map, painted once into one picture (GROUND_PX pixels a tile, drawn smoothed):
// each hex's biome colour (from the climate at its centre; forest hexes a darker shade) fading into
// its neighbours' near its edges, a gentle mottling, and ragged rocky ground round the mountains.
// Plus each open hex's props (a few small biome details: grass, flowers, stones, dunes, reeds...).
const GROUND_PX = 4;
const SCREE_RGB = [66, 69, 72];
function buildGround(seed) {
  const L = layoutOf(seed);
  const props = [];
  const tint = new Map(); // hex -> [r, g, b] (the minimap uses these too)
  const R = C.HEX_R;
  const col = new Float32Array(HEX.hexes.length * 3);
  const water = (i) => L.ocean.has(i) || L.lakes.has(i);
  for (const h of HEX.hexes) {
    const cl = climate(seed, h.cx, h.cy, C.MAP_W, C.MAP_H);
    // (a calm ground: the biome colour, drawn a little toward the old plains, barely varying hex to hex)
    const jitter = 0.985 + hash(seed, h.i, 1717) * 0.03;
    let c = mixRgb(groundColor(cl), PLAINS_RGB, 0.18).map((v) => v * jitter);
    const forest = L.forest.has(h.i);
    const mountain = L.mountains.has(h.i);
    if (forest) c = mixRgb(c, FOREST_RGB, 0.45);
    col.set(c, h.i * 3);
    if (L.ocean.has(h.i)) continue; // (the sea: see buildSea)
    tint.set(h.i, lift(mountain ? [88, 93, 100] : L.foothills.has(h.i) ? mixRgb(c, ROCK_RGB, 0.3) : c)); // (the minimap shows ranges a lighter grey)
    if (forest || mountain || L.lakes.has(h.i) || L.iron.has(h.i) || L.veins.has(h.i)) continue;
    // a few small details for the biome, scattered over the hex
    const b = biomeOf(cl);
    const list = [];
    for (let k = 0; k < 4; k++) {
      const x = h.cx + (hash(seed, h.i * 4 + k, 2300) - 0.5) * R * 1.4;
      const y = h.cy + (hash(seed, h.i * 4 + k, 2400) - 0.5) * R * 1.2;
      const r = hash(seed, h.i * 4 + k, 2500);
      let kind = null;
      if (b === 'meadow' || b === 'woods') kind = r < 0.55 ? 'tuft' : r < 0.63 ? 'flower' : null;
      else if (b === 'steppe') kind = r < 0.5 ? 'dry' : r < 0.75 ? 'pebble' : null;
      else if (b === 'desert') kind = r < 0.55 ? 'dune' : r < 0.62 && k === 0 ? 'cactus' : null;
      else if (b === 'swamp') kind = r < 0.45 ? 'reed' : r < 0.8 ? 'tuft' : null;
      else if (b === 'tundra') kind = r < 0.35 ? 'rock' : r < 0.6 ? 'pebble' : r < 0.8 ? 'snow' : null;
      else if (b === 'taiga') kind = r < 0.4 ? 'snow' : r < 0.7 ? 'tuft' : null;
      else kind = r < 0.35 ? 'rock' : r < 0.7 ? 'pebble' : null; // (highlands)
      if (kind) list.push({ kind, x, y, hue: Math.floor(hash(seed, h.i, 2600 + k) * FLOWERS.length) });
    }
    list.sort((a, c2) => a.y - c2.y);
    if (list.length) props.push({ i: h.i, x: h.cx, y: h.cy, list });
  }
  // the picture
  const W = C.MAP_W * GROUND_PX;
  const H = C.MAP_H * GROUND_PX;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  const noise = (x, y, k) => {
    const a = Math.floor(x);
    const b = Math.floor(y);
    let fx = x - a;
    let fy = y - b;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const v00 = hash(seed + k, a, b);
    const v10 = hash(seed + k, a + 1, b);
    const v01 = hash(seed + k, a, b + 1);
    const v11 = hash(seed + k, a + 1, b + 1);
    return v00 + (v10 - v00) * fx + (v01 - v00) * fy + (v00 - v10 - v01 + v11) * fx * fy;
  };
  const { bright, sat, contrast } = LIFT;
  const rockReach = R * 1.05 + 1.6;
  for (let py = 0; py < H; py++) {
    const y = (py + 0.5) / GROUND_PX;
    const row = Math.floor(y) * C.MAP_W;
    for (let px = 0; px < W; px++) {
      const x = (px + 0.5) / GROUND_PX;
      const i = HEX.tileHex[row + Math.floor(x)];
      const h = HEX.hexes[i];
      let r = col[i * 3];
      let gg = col[i * 3 + 1];
      let b = col[i * 3 + 2];
      // fade toward the nearest neighbour (of land) near the edge between them
      const dh = Math.hypot(h.cx - x, h.cy - y);
      let bj = -1;
      let bd = 1e9;
      let dm = L.mountains.has(i) ? Math.hypot(h.cx - x, (h.cy - y) * 1.1) : 1e9;
      for (const j of h.n) {
        const q = HEX.hexes[j];
        if (L.mountains.has(j)) dm = Math.min(dm, Math.hypot(q.cx - x, (q.cy - y) * 1.1));
        if (water(j)) continue;
        const dd = (q.cx - x) * (q.cx - x) + (q.cy - y) * (q.cy - y);
        if (dd < bd) {
          bd = dd;
          bj = j;
        }
      }
      if (bj >= 0) {
        const t = Math.max(0, 1 - (Math.sqrt(bd) - dh) / (R * 0.55));
        const w = 0.5 * t * t;
        r += (col[bj * 3] - r) * w;
        gg += (col[bj * 3 + 1] - gg) * w;
        b += (col[bj * 3 + 2] - b) * w;
      }
      // rocky ground under and round the mountains, with a ragged edge
      if (dm < rockReach) {
        const e = R * 1.05 + (noise(x / 1.4, y / 1.4, 8100) - 0.5) * 1.6;
        const t = Math.min(1, Math.max(0, (e + 0.8 - dm) / 1.4)) * 0.8;
        const rn = (noise(x / 0.5, y / 0.5, 8200) - 0.5) * 10 * t;
        r += (SCREE_RGB[0] + rn - r) * t;
        gg += (SCREE_RGB[1] + rn - gg) * t;
        b += (SCREE_RGB[2] + rn - b) * t;
      }
      // mottling
      const m = (noise(x / 0.7, y / 0.7, 8300) - 0.5) * 11; // (finer grain: grainPattern)
      r += m;
      gg += m;
      b += m;
      // the lifted palette (as lift(), inline: this runs for every pixel)
      const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      const o = (py * W + px) * 4;
      d[o] = ((l + (r - l) * sat) * bright - 128) * contrast + 128;
      d[o + 1] = ((l + (gg - l) * sat) * bright - 128) * contrast + 128;
      d[o + 2] = ((l + (b - l) * sat) * bright - 128) * contrast + 128;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { groundImg: cv, props, tint };
}

// A fine grain over the ground (a tiling picture: periodic value noise), seen close up.
let grain = null;
function grainPattern(g) {
  if (grain) return grain;
  const N = 256;
  const cell = 4;
  const P = N / cell;
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const cg = cv.getContext('2d');
  const img = cg.createImageData(N, N);
  const v = (a, b) => hash(77, ((a % P) + P) % P, ((b % P) + P) % P);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const a = Math.floor(x / cell);
      const b = Math.floor(y / cell);
      let fx = x / cell - a;
      let fy = y / cell - b;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const n = v(a, b) + (v(a + 1, b) - v(a, b)) * fx + (v(a, b + 1) - v(a, b)) * fy + (v(a, b) - v(a + 1, b) - v(a, b + 1) + v(a + 1, b + 1)) * fx * fy;
      const k = n * 0.9 + hash(78, x, y) * 0.1 - 0.5;
      const o = (y * N + x) * 4;
      const c = k > 0 ? 255 : 0;
      img.data[o] = c;
      img.data[o + 1] = c;
      img.data[o + 2] = c;
      img.data[o + 3] = Math.abs(k) * 34;
    }
  }
  cg.putImageData(img, 0, 0);
  grain = g.createPattern(cv, 'repeat');
  grain.setTransform(new DOMMatrix().scale(1 / 20)); // (20 pixels a tile: one repeat is about 13 tiles)
  return grain;
}

// A small stone (scree round the mountains) at (x, y), size s, onto g.
function screeStone(g, x, y, s) {
  g.fillStyle = TREE_SHADOW;
  g.beginPath();
  g.ellipse(x + 0.04, y + s * 0.5, s * 1.05, s * 0.35, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = PROP.rock;
  g.beginPath();
  g.ellipse(x, y, s, s * 0.7, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = PROP.rockLit;
  g.beginPath();
  g.ellipse(x - s * 0.3, y - s * 0.25, s * 0.5, s * 0.35, 0, 0, Math.PI * 2);
  g.fill();
}

const FLOWERS = ['rgba(200, 170, 190, 0.6)', 'rgba(210, 200, 150, 0.6)', 'rgba(200, 140, 140, 0.6)'].map(liftStr);
function drawProp(p) {
  const { x, y } = p;
  switch (p.kind) {
    case 'flower':
      ctx.fillStyle = FLOWERS[p.hue];
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.arc(x + Math.cos(k * 1.57) * 0.13, y + Math.sin(k * 1.57) * 0.13, 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'pebble':
      screeStone(ctx, x, y, 0.16 + (p.hue % 3) * 0.04);
      break;
    case 'tuft':
    case 'dry':
      ctx.strokeStyle = p.kind === 'tuft' ? PROP.meadow : PROP.steppe;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      for (const k of [-1, 0, 1]) {
        ctx.moveTo(x + k * 0.12, y);
        ctx.lineTo(x + k * 0.2, y - 0.42);
      }
      ctx.stroke();
      break;
    case 'snow':
      ctx.fillStyle = PROP.snow;
      ctx.beginPath();
      ctx.ellipse(x, y, 0.5, 0.2, 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'dune':
      ctx.strokeStyle = PROP.dune;
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.moveTo(x - 0.6, y);
      ctx.quadraticCurveTo(x, y - 0.3, x + 0.6, y);
      ctx.stroke();
      break;
    case 'cactus':
      ctx.fillStyle = TREE_SHADOW;
      ctx.beginPath();
      ctx.ellipse(x, y + 0.05, 0.4, 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PROP.cactus;
      ctx.beginPath();
      ctx.roundRect(x - 0.13, y - 0.85, 0.26, 0.85, 0.13);
      ctx.roundRect(x - 0.42, y - 0.62, 0.18, 0.34, 0.09);
      ctx.roundRect(x + 0.24, y - 0.72, 0.18, 0.32, 0.09);
      ctx.fill();
      break;
    case 'reed':
      ctx.fillStyle = PROP.pool;
      ctx.beginPath();
      ctx.ellipse(x, y, 0.45, 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = PROP.reed;
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      for (const k of [-1, 0, 1]) {
        ctx.moveTo(x + 0.4 + k * 0.1, y - 0.05);
        ctx.lineTo(x + 0.45 + k * 0.17, y - 0.5);
      }
      ctx.stroke();
      break;
    case 'rock':
      ctx.fillStyle = TREE_SHADOW;
      ctx.beginPath();
      ctx.ellipse(x + 0.04, y + 0.14, 0.42, 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PROP.rock;
      ctx.beginPath();
      ctx.moveTo(x - 0.4, y + 0.12);
      ctx.lineTo(x - 0.2, y - 0.2);
      ctx.lineTo(x + 0.16, y - 0.24);
      ctx.lineTo(x + 0.4, y + 0.12);
      ctx.fill();
      ctx.fillStyle = PROP.rockLit;
      ctx.beginPath();
      ctx.moveTo(x - 0.4, y + 0.12);
      ctx.lineTo(x - 0.2, y - 0.2);
      ctx.lineTo(x, y + 0.12);
      ctx.fill();
      break;
    default:
  }
}

// A mountain peak at (x, y), size s (tile units): shadow, rock, its lit face and a snow cap
// (bigger in the cold).
function peak(x, y, s, snow) {
  const p = { x, y, s, shadow: new Path2D(), body: new Path2D(), lit: new Path2D(), cap: new Path2D() };
  p.shadow.ellipse(x + s * 0.2, y + s * 0.48, s * 0.95, s * 0.28, 0, 0, Math.PI * 2);
  p.body.moveTo(x - s, y + s * 0.5);
  p.body.lineTo(x, y - s);
  p.body.lineTo(x + s, y + s * 0.5);
  p.body.closePath();
  p.lit.moveTo(x - s, y + s * 0.5);
  p.lit.lineTo(x, y - s);
  p.lit.lineTo(x + s * 0.1, y + s * 0.5);
  p.lit.closePath();
  const c = snow;
  p.cap.moveTo(x - s * 0.32 * c, y - s + s * 0.48 * c);
  p.cap.lineTo(x, y - s);
  p.cap.lineTo(x + s * 0.32 * c, y - s + s * 0.48 * c);
  p.cap.lineTo(x + s * 0.12 * c, y - s + s * 0.58 * c);
  p.cap.lineTo(x - s * 0.05 * c, y - s + s * 0.45 * c);
  p.cap.lineTo(x - s * 0.18 * c, y - s + s * 0.58 * c);
  p.cap.closePath();
  return p;
}

// The sea of map `seed`, built once: one path per depth band, the coast edges (land-hex edges facing
// the sea) for the cliffs, surf and shadow, and the rocks in the shallows.
function buildSea(seed) {
  const L = layoutOf(seed);
  const depth = new Map();
  let front = [];
  for (const i of L.ocean) if (HEX.hexes[i].n.some((j) => !L.ocean.has(j))) { depth.set(i, 1); front.push(i); }
  for (let d = 2; front.length; d++) {
    const next = [];
    for (const i of front) for (const j of HEX.hexes[i].n) if (L.ocean.has(j) && !depth.has(j)) { depth.set(j, d); next.push(j); }
    front = next;
  }
  const bands = SEA.depth.map(() => new Path2D());
  const tint = new Map();
  for (const i of L.ocean) {
    const d = Math.min(SEA.depth.length, depth.get(i) || SEA.depth.length) - 1;
    const cs = HEX.corners(HEX.hexes[i]);
    bands[d].moveTo(cs[0][0], cs[0][1]);
    for (let k = 1; k < 6; k++) bands[d].lineTo(cs[k][0], cs[k][1]);
    bands[d].closePath();
    const c = SEA.depth[d];
    tint.set(i, [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16) + 8));
  }
  // the edge slivers out at sea take their neighbours' depth
  for (const g of ghostHexes()) {
    if (!ghostIsSea(L, g)) continue;
    const d = Math.min(...g.n.filter((j) => L.ocean.has(j)).map((j) => depth.get(j) || SEA.depth.length));
    hexOutline(bands[Math.min(SEA.depth.length, d) - 1], g);
  }
  const coast = new Path2D(); // the shoreline itself
  const cliffs = new Path2D(); // the rock below the land: a cliff face where the sea lies south of it (we see it from the
  //                              south), a narrow rocky ledge along the water elsewhere
  const foot = new Path2D(); // the foot of the cliffs and ledges, where the surf breaks
  const strata = new Path2D();
  const edges = [];
  const corners = new Map(); // coast corner -> the drops of the edges meeting there
  const ckey = (c) => `${Math.round(c[0] * 100)},${Math.round(c[1] * 100)}`;
  for (const h of HEX.hexes) {
    if (L.ocean.has(h.i)) continue;
    const cs = HEX.corners(h);
    for (let k = 0; k < 6; k++) {
      const j = HEX.across(h, k);
      if (j < 0 || !L.ocean.has(j)) continue;
      const [a, b] = [cs[k], cs[(k + 1) % 6]];
      coast.moveTo(a[0], a[1]);
      coast.lineTo(b[0], b[1]);
      const sh = HEX.hexes[j];
      const len = Math.hypot(sh.cx - h.cx, sh.cy - h.cy) || 1;
      const [nx, ny] = [(sh.cx - h.cx) / len, (sh.cy - h.cy) / len]; // out to sea
      const d = ny > 0.2 ? [0, SEA.cliffH] : [nx * SEA.ledge, ny * SEA.ledge];
      edges.push([a, b]);
      for (const c of [a, b]) {
        const v = corners.get(ckey(c)) || corners.set(ckey(c), { sx: 0, sy: 0, n: 0 }).get(ckey(c));
        v.sx += d[0];
        v.sy += d[1];
        v.n++;
      }
    }
  }
  // each coast corner drops by the average of its edges' drops, so neighbouring stretches of cliff
  // and ledge share their corners exactly: one unbroken face, no overlaps or gaps
  const drop = (c) => {
    const v = corners.get(ckey(c));
    return [v.sx / v.n, v.sy / v.n];
  };
  for (const [a, b] of edges) {
    const [da, db] = [drop(a), drop(b)];
    cliffs.moveTo(a[0], a[1]);
    cliffs.lineTo(b[0], b[1]);
    cliffs.lineTo(b[0] + db[0], b[1] + db[1]);
    cliffs.lineTo(a[0] + da[0], a[1] + da[1]);
    cliffs.closePath();
    foot.moveTo(a[0] + da[0], a[1] + da[1]);
    foot.lineTo(b[0] + db[0], b[1] + db[1]);
    // a band of strata half way down the face
    strata.moveTo(a[0] + da[0] * 0.5, a[1] + da[1] * 0.5);
    strata.lineTo(b[0] + db[0] * 0.5, b[1] + db[1] * 0.5);
  }
  const rocks = [];
  for (const i of L.ocean) {
    if (depth.get(i) !== 1 || hash(seed, i, 5100) > 0.4) continue;
    const h = HEX.hexes[i];
    for (let k = 0; k < 2; k++) rocks.push({ x: h.cx + (hash(seed, i, 5200 + k) - 0.5) * 2.2, y: h.cy + (hash(seed, i, 5300 + k) - 0.5) * 1.6, s: 0.38 + hash(seed, i, 5400 + k) * 0.18 });
  }
  // (all the sea, and all the lakes, for keeping river banks on land)
  const all = new Path2D();
  for (const b of bands) all.addPath(b);
  const lakeAll = new Path2D();
  for (const i of L.lakes) hexOutline(lakeAll, HEX.hexes[i]);
  return { bands, all, lakeAll, coast, cliffs, foot, strata, rocks, tint, dropAt: (c) => (corners.has(ckey(c)) ? drop(c) : null) };
}

// The sea, under the land: water by depth, the shadow the land throws on it, rocks in the shallows,
// then the cliff faces with surf at their foot (the land is drawn over them afterwards, so only the
// faces that drop toward the viewer show).
function drawSea(sea, animate = true) {
  SEA.depth.forEach((c, d) => {
    dc.fillStyle = c;
    dc.fill(sea.bands[d]);
  });
  dc.lineJoin = 'round';
  dc.lineCap = 'round';
  dc.strokeStyle = SEA.shadow;
  for (const w of [3.2, 1.8]) {
    dc.lineWidth = w;
    dc.stroke(sea.coast);
  }
  const t = animate ? performance.now() / 1000 : 0;
  for (const r of sea.rocks) {
    dc.fillStyle = SEA.rock;
    dc.beginPath();
    dc.ellipse(r.x, r.y, r.s, r.s * 0.75, 0, 0, Math.PI * 2);
    dc.fill();
    dc.fillStyle = SEA.rockLit;
    dc.beginPath();
    dc.ellipse(r.x - r.s * 0.25, r.y - r.s * 0.2, r.s * 0.45, r.s * 0.32, 0, 0, Math.PI * 2);
    dc.fill();
    dc.strokeStyle = `rgba(${SEA.surf}, ${0.28 + 0.12 * Math.sin(t * 1.3 + r.x)})`;
    dc.lineWidth = 0.13;
    dc.beginPath();
    dc.ellipse(r.x, r.y + 0.12, r.s * 1.5, r.s * 1.0, 0, 0, Math.PI);
    dc.stroke();
  }
  dc.fillStyle = SEA.cliff;
  dc.fill(sea.cliffs);
  dc.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  dc.lineWidth = 0.07;
  dc.stroke(sea.strata);
  dc.strokeStyle = `rgba(${SEA.surf}, ${0.38 + 0.12 * Math.sin(t * 0.9)})`; // (the surf rises and falls)
  dc.lineWidth = 0.18;
  dc.stroke(sea.foot);
  dc.lineCap = 'butt';
}

// ---- lakes: each painted once into a small picture (PX pixels a tile) with a shore along its hex edges,
// in the style of the biome it lies in, plus a few props round it drawn as shapes.
const LAKE_PX = 12;
const LAKE_STYLE = liftAll({
  // shore: [r, g, b, alpha, width in tiles]; water: shallow, deep, depth (tiles) to go from one to the other
  meadow: { shore: [78, 96, 58, 0.9, 0.3], shallow: '#2f6f78', deep: '#1d4a5e', depth: 3, edge: 0.45, tint: [40, 92, 104] },
  tarn: { shore: [88, 92, 96, 0.95, 0.4], shallow: '#2a4e60', deep: '#0f2235', depth: 1.4, edge: 0, ice: true, tint: [30, 60, 80] },
  marsh: { shore: [58, 52, 38, 0.9, 0.6], shallow: '#2e5552', deep: '#1c3433', depth: 2.5, edge: 0, weed: true, tint: [58, 84, 66] },
  oasis: { shore: [196, 176, 120, 0.95, 0.7], shallow: '#4fb3a8', deep: '#227a83', depth: 2, edge: 0.5, green: true, tint: [70, 160, 150] },
});
// (cold or high: a tarn; warm and dry: an oasis, rare; the very wettest ground: a marsh pond; else a meadow lake)
const lakeStyleOf = ({ temp, wet, high }) => (high > 0.45 || temp < 0.3 ? 'tarn' : temp > 0.5 && wet < 0.55 ? 'oasis' : wet > 0.97 ? 'marsh' : 'meadow');
const rgbOf = (hx) => [1, 3, 5].map((k) => parseInt(hx.slice(k, k + 2), 16));
function buildLakes(seed) {
  const L = layoutOf(seed);
  const out = [];
  const seen = new Set();
  for (const start of L.lakes) {
    if (seen.has(start)) continue;
    // one lake: its hexes
    const cells = [];
    const st = [start];
    seen.add(start);
    while (st.length) {
      const i = st.pop();
      cells.push(i);
      for (const j of HEX.hexes[i].n) if (L.lakes.has(j) && !seen.has(j)) { seen.add(j); st.push(j); }
    }
    // (its style from the climate at its middle)
    const mx = cells.reduce((s, i) => s + HEX.hexes[i].cx, 0) / cells.length;
    const my = cells.reduce((s, i) => s + HEX.hexes[i].cy, 0) / cells.length;
    const kind = lakeStyleOf(climate(seed, mx, my, C.MAP_W, C.MAP_H));
    const sty = LAKE_STYLE[kind];
    // its shore: the edges between its hexes and the land
    const inLake = new Set(cells);
    const shore = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of cells) {
      const h = HEX.hexes[i];
      const cs = HEX.corners(h);
      for (const [x, y] of cs) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      for (let k = 0; k < 6; k++) if (!inLake.has(HEX.across(h, k))) shore.push([...cs[k], ...cs[(k + 1) % 6]]);
    }
    x0 -= 2; y0 -= 2; x1 += 2; y1 += 2;
    const W = Math.ceil((x1 - x0) * LAKE_PX);
    const H = Math.ceil((y1 - y0) * LAKE_PX);
    // signed distance to the shore (tiles; positive in the water), blurred into a soft curve
    let field = new Float32Array(W * H);
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const x = x0 + (px + 0.5) / LAKE_PX;
        const y = y0 + (py + 0.5) / LAKE_PX;
        let d = Infinity;
        for (const [ax, ay, bx, by] of shore) {
          const dx = bx - ax;
          const dy = by - ay;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
          d = Math.min(d, Math.hypot(x - ax - dx * t, y - ay - dy * t));
        }
        field[py * W + px] = Math.max(-4, Math.min(6, inLake.has(HEX.at(x, y)) ? d : -d));
      }
    }
    // (barely blurred: the shore follows the hex edges, like the sea's, with just its corners eased)
    const r = Math.round(0.15 * LAKE_PX);
    for (let pass = 0; pass < 1; pass++) {
      const tmp = new Float32Array(W * H);
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = px + k; if (xx >= 0 && xx < W) { s += field[py * W + xx]; n++; } } tmp[py * W + px] = s / n; }
      const o = new Float32Array(W * H);
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = py + k; if (yy >= 0 && yy < H) { s += tmp[yy * W + px]; n++; } } o[py * W + px] = s / n; }
      field = o;
    }
    const noise = (x, y, s) => { const a = Math.floor(x), b = Math.floor(y), fx = x - a, fy = y - b; const v = (i, j) => hash(seed + s, a + i, b + j); const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return v(0, 0) + (v(1, 0) - v(0, 0)) * sx + (v(0, 1) - v(0, 0)) * sy + (v(0, 0) - v(1, 0) - v(0, 1) + v(1, 1)) * sx * sy; };
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) field[py * W + px] += (noise((x0 + px / LAKE_PX) / 1.8, (y0 + py / LAKE_PX) / 1.8, 4400) - 0.5) * 0.08;
    // paint it
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    const img = g.createImageData(W, H);
    const [sr, sg, sb, sa, sw] = sty.shore;
    const shallow = rgbOf(sty.shallow);
    const deep = rgbOf(sty.deep);
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const d = field[py * W + px];
        const x = x0 + px / LAKE_PX;
        const y = y0 + py / LAKE_PX;
        let c = null;
        let a = 1;
        if (sty.green && d >= -sw - 0.7 && d < -sw) { c = [70, 90, 48]; a = 0.55 * (1 - (-d - sw) / 0.7); }
        else if (d >= -sw && d < 0) { c = [sr, sg, sb]; a = sa; }
        else if (d >= 0) {
          const t = Math.min(1, d / sty.depth);
          const k = t * t * (3 - 2 * t);
          c = shallow.map((v, j) => v + (deep[j] - v) * k);
          if (d < 0.22 && sty.edge) c = c.map((v) => v + (220 - v) * sty.edge);
          if (sty.ice && d < 0.55 && noise(x / 2.2, y / 2.2, 4500) > 0.5) c = c.map((v, j) => v + ([205, 222, 230][j] - v) * 0.75 * (1 - d / 0.55));
          if (sty.weed && noise(x, y, 4600) > 0.62) c = c.map((v, j) => v + ([72, 96, 54][j] - v) * 0.5);
        }
        if (!c) continue;
        const o = (py * W + px) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    // props round it, placed by the field
    const at = (x, y) => field[Math.min(H - 1, Math.max(0, Math.floor((y - y0) * LAKE_PX))) * W + Math.min(W - 1, Math.max(0, Math.floor((x - x0) * LAKE_PX)))];
    const props = [];
    for (let y = y0 + 0.2; y < y1; y += 0.4) {
      for (let x = x0 + 0.2; x < x1; x += 0.4) {
        const d = at(x, y);
        if (L.mountains.has(HEX.at(x, y))) continue; // (no reeds on a mountain beside it)
        const roll = hash(seed + 4700, Math.round(x * 10), Math.round(y * 10));
        if (kind === 'meadow' && d > 0.5 && d < 1.4 && roll < 0.05) props.push({ kind: 'lily', x, y, flower: roll < 0.018 });
        else if ((kind === 'meadow' && d > -0.7 && d < 0.1 && roll < 0.08) || (kind === 'marsh' && d > -0.6 && d < 0.3 && roll < 0.11)) props.push({ kind: 'reed', x, y });
        else if (kind === 'tarn' && d > -0.8 && d < 0.1 && roll < 0.09) props.push({ kind: 'stone', x, y, s: 0.25 + roll * 2 });
        else if (kind === 'oasis' && d > -1.4 && d < -0.5 && roll < 0.035) props.push({ kind: 'palm', x, y });
      }
    }
    props.sort((a, b) => a.y - b.y);
    out.push({ cells, kind, canvas: cv, x: x0, y: y0, w: W / LAKE_PX, h: H / LAKE_PX, props, tint: sty.tint, water: sty.shallow, inLake });
  }
  return out;
}

function drawLakeProp(p) {
  const { x, y } = p;
  switch (p.kind) {
    case 'lily':
      dc.fillStyle = '#4f7a3e';
      dc.beginPath();
      dc.arc(x, y, 0.32, 0.5, Math.PI * 2 - 0.2);
      dc.lineTo(x, y);
      dc.fill();
      if (p.flower) {
        dc.fillStyle = '#e7d3e4';
        dc.beginPath();
        dc.arc(x + 0.08, y - 0.08, 0.13, 0, Math.PI * 2);
        dc.fill();
      }
      break;
    case 'reed':
      dc.strokeStyle = 'rgba(125, 150, 82, 0.9)';
      dc.lineWidth = 0.07;
      dc.beginPath();
      for (const k of [-0.18, 0, 0.18]) {
        dc.moveTo(x + k, y + 0.12);
        dc.lineTo(x + k * 1.5, y - 0.6);
      }
      dc.stroke();
      dc.fillStyle = '#6b4a2a';
      dc.fillRect(x - 0.05, y - 0.75, 0.1, 0.26);
      break;
    case 'stone':
      dc.fillStyle = TREE_SHADOW;
      dc.beginPath();
      dc.ellipse(x + 0.05, y + 0.12, p.s * 1.1, p.s * 0.35, 0, 0, Math.PI * 2);
      dc.fill();
      dc.fillStyle = PROP.rock;
      dc.beginPath();
      dc.moveTo(x - p.s, y + 0.12);
      dc.lineTo(x - p.s * 0.5, y - p.s * 0.6);
      dc.lineTo(x + p.s * 0.5, y - p.s * 0.7);
      dc.lineTo(x + p.s, y + 0.12);
      dc.fill();
      dc.fillStyle = PROP.rockLit;
      dc.beginPath();
      dc.moveTo(x - p.s, y + 0.12);
      dc.lineTo(x - p.s * 0.5, y - p.s * 0.6);
      dc.lineTo(x, y + 0.12);
      dc.fill();
      break;
    case 'palm':
      dc.fillStyle = TREE_SHADOW;
      dc.beginPath();
      dc.ellipse(x + 0.3, y + 0.1, 0.65, 0.2, 0, 0, Math.PI * 2);
      dc.fill();
      dc.strokeStyle = '#7a5a36';
      dc.lineWidth = 0.16;
      dc.beginPath();
      dc.moveTo(x, y);
      dc.quadraticCurveTo(x - 0.25, y - 0.7, x + 0.15, y - 1.35);
      dc.stroke();
      dc.fillStyle = '#4c7d3a';
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        dc.beginPath();
        dc.ellipse(x + 0.15 + Math.cos(a) * 0.45, y - 1.35 + Math.sin(a) * 0.22, 0.55, 0.17, a, 0, Math.PI * 2);
        dc.fill();
      }
      break;
    default:
  }
}

// The gravel patch of an ore deposit or gold vein (hex h): painted once into a small picture with a
// ragged, rounded edge (no hexagon) and pebbles, on top of the biome's ground.
const PATCH_PX = 12;
function buildPatch(seed, h, style) {
  const r = C.HEX_R;
  const x0 = h.cx - r - 0.5;
  const y0 = h.cy - r - 0.5;
  const W = Math.ceil((2 * r + 1) * PATCH_PX);
  const H = W;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  const noise = (x, y, s) => { const a = Math.floor(x), b = Math.floor(y), fx = x - a, fy = y - b; const v = (i, j) => hash(seed + s, a + i + h.i * 31, b + j); const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return v(0, 0) + (v(1, 0) - v(0, 0)) * sx + (v(0, 1) - v(0, 0)) * sy + (v(0, 0) - v(1, 0) - v(0, 1) + v(1, 1)) * sx * sy; };
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x = x0 + px / PATCH_PX;
      const y = y0 + py / PATCH_PX;
      const d = Math.hypot(x - h.cx, (y - h.cy) * 1.15) / r; // (a little wider than tall)
      const n = noise(x / 0.75, y / 0.75, 7100) * 0.6 + noise(x / 0.3, y / 0.3, 7200) * 0.4;
      const edge = 0.62 + n * 0.35;
      if (d > edge) continue;
      const t = Math.min(1, (edge - d) / 0.15);
      const o = (py * W + px) * 4;
      img.data[o] = style.patch[0];
      img.data[o + 1] = style.patch[1];
      img.data[o + 2] = style.patch[2];
      img.data[o + 3] = Math.round(255 * style.patchA * t);
    }
  }
  g.putImageData(img, 0, 0);
  g.scale(PATCH_PX, PATCH_PX);
  g.translate(-x0, -y0);
  for (let k = 0; k < 64; k++) {
    const a = hash(seed, h.i * 64 + k, 7300) * Math.PI * 2;
    const rr = Math.sqrt(hash(seed, h.i * 64 + k, 7400)) * r * 0.6;
    g.fillStyle = style.pebbles[Math.floor(hash(seed, h.i * 64 + k, 7500) * style.pebbles.length)];
    g.beginPath();
    g.ellipse(h.cx + Math.cos(a) * rr, h.cy + Math.sin(a) * rr * 0.8, 0.06 + hash(seed, k, 7600 + h.i) * 0.07, 0.045 + hash(seed, k, 7700 + h.i) * 0.04, hash(seed, k, 7800) * 3, 0, Math.PI * 2);
    g.fill();
  }
  return { canvas: cv, x: x0, y: y0, w: W / PATCH_PX, h: H / PATCH_PX };
}

function build(seed) {
  const L = layoutOf(seed);
  const sea = buildSea(seed);
  const lakes = buildLakes(seed);
  const rivers = buildRivers(seed, sea, lakes);
  // mountain peaks, two or three a hex, drawn back to front
  const peaks = [];
  for (const i of L.mountains) {
    const h = HEX.hexes[i];
    const cold = climate(seed, h.cx, h.cy, C.MAP_W, C.MAP_H).temp < 0.35;
    const spots = [[-0.75, -0.35, 1.25], [0.8, -0.15, 1.1], [0.05, 0.7, 1.35], [-0.2, -1.05, 1.0]].map(([x, y, z]) => [x * HK, y * HK, z * (1 + (HK - 1) * 0.6)]);
    spots.forEach(([dx, dy, sz], k) => {
      if (k === 1 && hash(seed, i, 3100) < 0.3) return;
      if (k === 3 && hash(seed, i, 3150) < 0.5) return;
      const pk = peak(h.cx + dx + (hash(seed, i * 3 + k, 3200) - 0.5) * 0.4, h.cy + dy + (hash(seed, i * 3 + k, 3300) - 0.5) * 0.3, sz * (0.85 + hash(seed, i, 3400 + k) * 0.3), cold ? 1.25 : 0.9);
      pk.i = i;
      peaks.push(pk);
    });
  }
  peaks.sort((a, b) => a.y - b.y);
  // loose stones scattered round each mountain (on land, not in the water)
  const scree = [];
  for (const i of L.mountains) {
    const h = HEX.hexes[i];
    for (let k = 0; k < 5; k++) {
      const x = h.cx + (hash(seed, i * 5 + k, 3500) - 0.5) * C.HEX_R * 2.3;
      const y = h.cy + (hash(seed, i * 5 + k, 3600) - 0.5) * C.HEX_R * 2;
      const j = HEX.at(x, y);
      if (j < 0 || L.ocean.has(j) || L.lakes.has(j)) continue;
      scree.push([x, y, 0.2 + hash(seed, i * 5 + k, 3700) * 0.25]);
    }
  }
  scree.sort((a, b) => a[1] - b[1]);
  const groundInfo = buildGround(seed);
  const fill = new Path2D();
  const forests = [];
  const patches = []; // the gravel patches (in the cached terrain)
  const ores = [];
  // (boulder spots round a deposit's middle, in tiles: [dx, dy, size])
  const SPOTS = [[-1.05, -0.5, 0.47], [0.83, -0.83, 0.41], [0.06, 0.61, 0.52], [1.21, 0.72, 0.36], [-1.27, 0.83, 0.33]];
  for (const h of HEX.hexes) {
    if (!L.iron.has(h.i)) continue;
    patches.push(buildPatch(seed, h, ORE));
    // five boulders; `rank` is the order they're mined away in
    const rocks = SPOTS.map(([dx, dy, sz], k) => {
      const r = oreRock(h.cx + dx + (hash(seed, h.i * 5 + k, 31) - 0.5) * 0.3, h.cy + dy + (hash(seed, h.i, 131 + k) - 0.5) * 0.25, sz * (0.9 + hash(seed, k + 9, h.i) * 0.2));
      r.cut = hash(seed, h.i, 600 + k);
      r.specks = [0, 1, 2].map((j) => [r.x + (hash(seed, h.i * 3 + k, 700 + j) - 0.5) * r.s, r.y + (hash(seed, h.i * 3 + k, 800 + j) - 0.6) * r.s * 0.6]);
      return r;
    });
    [...rocks].sort((a, b) => a.cut - b.cut).forEach((r, n) => { r.rank = n; });
    rocks.sort((a, b) => a.y - b.y);
    ores.push({ i: h.i, x: h.cx, y: h.cy, rocks });
  }
  const veins = [];
  for (const h of HEX.hexes) {
    if (!L.veins.has(h.i)) continue;
    patches.push(buildPatch(seed, h, VEIN));
    // five boulders flecked with gold (each fleck twinkles in its own time)
    const rocks = SPOTS.map(([dx, dy, sz], k) => {
      const r = oreRock(h.cx + dx, h.cy + dy, sz);
      r.flecks = [0, 1, 2].map((j) => [r.x + (hash(seed, h.i * 4 + j + k * 7, 950) - 0.5) * r.s * 1.2, r.y - hash(seed, h.i * 4 + j + k * 7, 960) * r.s * 0.5, 0.07 + hash(seed, j + k * 3, 970 + h.i) * 0.07, hash(seed, j, 980 + h.i + k) * 6.28]);
      return r;
    });
    veins.push({ i: h.i, x: h.cx, y: h.cy, rocks });
  }
  for (const h of HEX.hexes) {
    if (!L.forest.has(h.i)) continue;
    const cs = HEX.corners(h);
    fill.moveTo(cs[0][0], cs[0][1]);
    for (let k = 1; k < 6; k++) fill.lineTo(cs[k][0], cs[k][1]);
    fill.closePath();
    // five small trees, each in its own slice of the hex, nudged a little at random; `cut` is the
    // order they fall in as the hex is chopped
    const cl = climate(seed, h.cx, h.cy, C.MAP_W, C.MAP_H);
    const snowy = cl.temp < 0.3;
    const autumn = !snowy && cl.temp > 0.45 && biomeOf(cl) !== 'taiga';
    // fifteen trees, three to each of the five steps the hex is chopped down in (a full stand)
    const trees = [[0, 0], [-1.05, -0.65], [1.05, -0.6], [-0.95, 0.8], [1.0, 0.85], [0.05, -1.25], [-0.05, 1.3], [-1.75, 0.05], [1.75, 0.1], [-0.5, -0.05],
      [0.55, 0.35], [-0.6, -1.2], [0.65, -1.15], [-0.55, 1.25], [0.6, 1.3]]
      .map(([dx, dy]) => [dx * HK, dy * HK]).map(([dx, dy], k) => {
      const tx = h.cx + dx + (hash(seed, h.i * 7 + k, 11) - 0.5) * 0.6;
      const ty = h.cy + dy + (hash(seed, h.i, 91 + k) - 0.5) * 0.5 + 0.2;
      const ts = 0.42 + hash(seed, k, h.i) * 0.16;
      // (warm woods mix in round autumn trees; the cold has snowy pines)
      const t = autumn && hash(seed, h.i, 1900 + k) < 0.25 ? roundTree(tx, ty, ts * 1.15, AUTUMN[Math.floor(hash(seed, h.i, 1950 + k) * AUTUMN.length)]) : pine(tx, ty, ts);
      t.snowy = snowy;
      t.cut = hash(seed, h.i, 400 + k);
      return t;
    });
    const order = [...trees].sort((a, b) => a.cut - b.cut);
    order.forEach((t, n) => { t.rank = Math.floor((n * 5) / order.length); }); // trees with rank >= wood left are gone
    trees.sort((a, b) => a.y - b.y);
    forests.push({ i: h.i, x: h.cx, y: h.cy, trees });
  }
  for (const [i, c] of sea.tint) groundInfo.tint.set(i, c);
  for (const lk of lakes) for (const i of lk.cells) groundInfo.tint.set(i, lk.tint);
  return { seed, fill, forests, rivers, patches, ores, veins, peaks, scree, sea, lakes, ...groundInfo };
}

// ---- the terrain cache: everything about the ground that never changes (biome colours, the sea
// and its cliffs, lakes, mountain peaks, river banks and bridges, the hex grid) is painted once
// into chunks of CHUNK x CHUNK tiles at a few fixed zoom levels and copied to the screen each
// frame; only what moves or changes (river flow, trees, ore, veins, props) is drawn live on top.
const CHUNK = 16;
const BUCKETS = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48]; // pixels a tile the chunks are painted at
const CHUNK_PIXELS = 24e6; // chunks kept, in pixels (the least recently used go; never ones in view)
const chunks = new Map(); // `${bucket}:${cx}:${cy}` -> { canvas, used }
let chunkSeed = null;
let chunkPixels = 0;
let frameNo = 0;
// Drop the least recently used chunks (not ones drawn this frame) while over the budget.
function trimChunks() {
  for (const [key, c] of chunks) {
    if (chunkPixels <= CHUNK_PIXELS) break;
    if (c.frame === frameNo) continue;
    chunkPixels -= c.canvas.width * c.canvas.height;
    chunks.delete(key);
  }
}

// Paint the unchanging ground of tiles [x0, x1) x [y0, y1) onto g (set to tile units), s pixels a tile.
function paintStatic(g, x0, y0, x1, y1, s) {
  dc = g;
  g.fillStyle = PLAINS;
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  drawSea(built.sea, false);
  // the ground picture (all but the sea), with a fine grain over it close up
  if (!built.noSea) {
    built.noSea = new Path2D();
    built.noSea.rect(-10, -10, C.MAP_W + 20, C.MAP_H + 20);
    built.noSea.addPath(built.sea.all);
  }
  g.save();
  g.clip(built.noSea, 'evenodd');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(built.groundImg, 0, 0, C.MAP_W, C.MAP_H);
  if (s >= 6) {
    g.fillStyle = grainPattern(g);
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  g.restore();
  // the gravel patches of ore deposits and gold veins
  for (const pt of built.patches) {
    if (pt.x > x1 || pt.y > y1 || pt.x + pt.w < x0 || pt.y + pt.h < y0) continue;
    g.drawImage(pt.canvas, pt.x, pt.y, pt.w, pt.h);
  }
  // lakes, with their reeds, lily pads, stones or palms
  for (const lk of built.lakes) {
    if (lk.x > x1 || lk.y > y1 || lk.x + lk.w < x0 || lk.y + lk.h < y0) continue;
    g.drawImage(lk.canvas, lk.x, lk.y, lk.w, lk.h);
    if (s >= 4) for (const p of lk.props) drawLakeProp(p);
  }
  // the dark lip of the land along the coast
  g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  g.lineWidth = 0.26;
  g.stroke(built.sea.coast);
  drawRivers(built.rivers, built.sea);
  // the hex grid: a faint outline round every hex of land (none over the sea or lakes)
  if (s >= 6) {
    g.save();
    g.clip(landOnly(), 'evenodd');
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1 / s;
    g.stroke(hexGridPath());
    g.restore();
  }
  // loose stones round the mountains
  if (s >= 4) {
    for (const [x, y, z] of built.scree) {
      if (x < x0 - 1 || x > x1 + 1 || y < y0 - 1 || y > y1 + 1) continue;
      screeStone(g, x, y, z);
    }
  }
  // mountain peaks (at every zoom: they matter for where troops can go)
  for (const p of built.peaks) {
    if (p.x < x0 - 3 || p.x > x1 + 3 || p.y < y0 - 3 || p.y > y1 + 3) continue;
    g.fillStyle = PEAK.shadow;
    g.fill(p.shadow);
    g.fillStyle = PEAK.body;
    g.fill(p.body);
    g.fillStyle = PEAK.lit;
    g.fill(p.lit);
    g.fillStyle = PEAK.snow;
    g.fill(p.cap);
  }
  dc = ctx;
}

// Chunk (cx, cy) of the map painted at `bucket` pixels a tile (painted now if it isn't cached).
function chunkAt(bucket, cx, cy) {
  const key = `${bucket}:${cx}:${cy}`;
  let c = chunks.get(key);
  if (!c) {
    const cv = document.createElement('canvas');
    const w = Math.min(CHUNK, C.MAP_W - cx * CHUNK);
    const h = Math.min(CHUNK, C.MAP_H - cy * CHUNK);
    cv.width = Math.ceil(w * bucket);
    cv.height = Math.ceil(h * bucket);
    const g = cv.getContext('2d');
    g.scale(bucket, bucket);
    g.translate(-cx * CHUNK, -cy * CHUNK);
    g.beginPath();
    g.rect(cx * CHUNK, cy * CHUNK, w, h);
    g.clip();
    paintStatic(g, cx * CHUNK, cy * CHUNK, cx * CHUNK + w, cy * CHUNK + h, bucket);
    c = { canvas: cv, w, h };
    chunks.set(key, c);
    chunkPixels += cv.width * cv.height;
  } else {
    // (most recently used last)
    chunks.delete(key);
    chunks.set(key, c);
  }
  return c;
}

// Draw the ground under the map rectangle at screen (ox, oy), s pixels per tile.
function drawTerrain(ox, oy, s) {
  ctx.fillStyle = PLAINS;
  ctx.fillRect(ox, oy, C.MAP_W * s, C.MAP_H * s);
  const seed = mapSeed();
  if (seed === undefined || seed === null) return;
  if (!built || built.seed !== seed) built = build(seed);
  if (chunkSeed !== seed) {
    chunks.clear();
    chunkPixels = 0;
    chunkSeed = seed;
  }
  frameNo++;
  if (S.noTerrainCache) {
    // (for comparison: paint it all straight onto the screen, every frame)
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, C.MAP_W * s, C.MAP_H * s);
    ctx.clip();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    paintStatic(ctx, 0, 0, C.MAP_W, C.MAP_H, s);
    ctx.restore();
  } else {
  // the cached ground: the chunks in view, at the zoom level just above (or at) this one
  const bucket = BUCKETS.find((b) => b >= s) || BUCKETS[BUCKETS.length - 1];
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const cx0 = Math.max(0, Math.floor(-ox / s / CHUNK));
  const cy0 = Math.max(0, Math.floor(-oy / s / CHUNK));
  const cx1 = Math.min(Math.ceil(C.MAP_W / CHUNK) - 1, Math.floor((W - ox) / s / CHUNK));
  const cy1 = Math.min(Math.ceil(C.MAP_H / CHUNK) - 1, Math.floor((H - oy) / s / CHUNK));
  let painted = 0;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      let b = bucket;
      // (painting is spread over frames when zooming: meanwhile a nearby zoom level stands in)
      if (!chunks.has(`${b}:${cx}:${cy}`) && painted >= 6) {
        const alt = BUCKETS.find((x) => chunks.has(`${x}:${cx}:${cy}`));
        if (alt) b = alt;
      }
      if (!chunks.has(`${b}:${cx}:${cy}`)) painted++;
      const c = chunkAt(b, cx, cy);
      c.frame = frameNo;
      // (whole pixels, so chunks meet without seams)
      const dx = Math.floor(ox + cx * CHUNK * s);
      const dy = Math.floor(oy + cy * CHUNK * s);
      const dw = Math.floor(ox + (cx * CHUNK + c.w) * s) - dx;
      const dh = Math.floor(oy + (cy * CHUNK + c.h) * s) - dy;
      ctx.drawImage(c.canvas, dx, dy, dw, dh);
    }
  }
  trimChunks();
  }
  ctx.save();
  // nothing past the map's edge (the hexes along it are cut off)
  ctx.beginPath();
  ctx.rect(ox, oy, C.MAP_W * s, C.MAP_H * s);
  ctx.clip();
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  if (s >= 4) drawRiverFlow(built.rivers); // (live: the water flows)
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
    // biome props on open hexes
    for (const pr of built.props) {
      if (pr.x < x0 || pr.x > x1 || pr.y < y0 || pr.y > y1 || taken.has(pr.i)) continue;
      for (const p of pr.list) drawProp(p);
    }
    // gold veins: a soft glow, and grey boulders with gold flecks that twinkle
    const now = performance.now() / 1000;
    const glint = 0.75 + 0.25 * Math.sin(now * 1.7);
    for (const v of built.veins) {
      if (v.x < x0 || v.x > x1 || v.y < y0 || v.y > y1 || taken.has(v.i)) continue;
      const R = C.HEX_R * 0.83;
      const glow = ctx.createRadialGradient(v.x, v.y, 0.2, v.x, v.y, R);
      glow.addColorStop(0, `rgba(242, 193, 78, ${0.22 * glint})`);
      glow.addColorStop(1, 'rgba(242, 193, 78, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(v.x, v.y, R, 0, Math.PI * 2);
      ctx.fill();
      for (const r of v.rocks) {
        ctx.fillStyle = TREE_SHADOW;
        ctx.fill(r.shadow);
        ctx.fillStyle = VEIN.rock;
        ctx.fill(r.body);
        ctx.fillStyle = VEIN.lit;
        ctx.fill(r.lit);
        ctx.strokeStyle = VEIN.crack;
        ctx.lineWidth = 0.04;
        ctx.stroke(r.crack);
        for (const [fx, fy, fs, ph] of r.flecks) {
          // a four-pointed star, catching the light now and then
          const tw = 0.55 + 0.45 * Math.max(0, Math.sin(now * 2.2 + ph));
          const k = fs * (0.7 + 0.5 * tw);
          ctx.fillStyle = `rgba(255, 215, 110, ${0.5 + 0.5 * tw})`;
          ctx.beginPath();
          ctx.moveTo(fx, fy - k);
          ctx.lineTo(fx + k * 0.25, fy - k * 0.25);
          ctx.lineTo(fx + k, fy);
          ctx.lineTo(fx + k * 0.25, fy + k * 0.25);
          ctx.lineTo(fx, fy + k);
          ctx.lineTo(fx - k * 0.25, fy + k * 0.25);
          ctx.lineTo(fx - k, fy);
          ctx.lineTo(fx - k * 0.25, fy - k * 0.25);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    // iron ore deposits: their rocks (mined-out ones as rubble)
    for (const o of built.ores) {
      if (o.x < x0 || o.x > x1 || o.y < y0 || o.y > y1 || taken.has(o.i)) continue;
      const left = S.oreLeft.has(o.i) ? S.oreLeft.get(o.i) : 5;
      for (const r of o.rocks) {
        if (r.rank >= left) {
          ctx.fillStyle = ORE.rubble;
          ctx.beginPath();
          ctx.ellipse(r.x, r.y + r.s * 0.3, r.s * 0.5, r.s * 0.18, 0, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.fillStyle = TREE_SHADOW;
        ctx.fill(r.shadow);
        ctx.fillStyle = ORE.rock;
        ctx.fill(r.body);
        ctx.fillStyle = ORE.lit;
        ctx.fill(r.lit);
        ctx.strokeStyle = ORE.crack;
        ctx.lineWidth = 0.04;
        ctx.stroke(r.crack);
        ctx.fillStyle = ORE.speck;
        for (const [sx, sy] of r.specks) {
          ctx.beginPath();
          ctx.arc(sx, sy, 0.07, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
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
        if (t.round) {
          ctx.fillStyle = STUMP;
          ctx.fill(t.trunk);
          ctx.fillStyle = t.colour;
          ctx.fill(t.canopy);
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fill(t.shine);
          continue;
        }
        ctx.fillStyle = t.snowy ? SNOW_PINE.dark : TREE_DARK;
        ctx.fill(t.dark);
        ctx.fillStyle = t.snowy ? SNOW_PINE.light : TREE_LIGHT;
        ctx.fill(t.light);
      }
    }
  }
  ctx.restore();
}

// The land (a path to clip to with 'evenodd': the map without the sea and lakes), in tile units.
function landOnly() {
  if (built && built.land) return built.land;
  const land = new Path2D();
  land.rect(-10, -10, C.MAP_W + 20, C.MAP_H + 20);
  if (!built) return land;
  land.addPath(built.sea.all);
  land.addPath(built.sea.lakeAll);
  built.land = land; // (once per map)
  return land;
}

export { drawTerrain, groundCanvas, landOnly, riverView, veinsView };
