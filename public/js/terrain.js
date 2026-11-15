// The ground, drawn under everyone's land: biomes (each hex's ground colour and props come from a
// seeded climate: tundra, taiga, meadow, woods, steppe, desert, swamp, highlands, shading from one
// to the next hex by hex), patches of forest (pines, snowy in the cold, with autumn trees in warm
// woods), iron ore deposits (rust-red rocks), gold veins, and rivers running along hex edges
// (crossed only by their stone bridges).
// Forests don't slow or hide troops; workers chop them for wood (each hex thins to stumps as it's
// chopped, then grows back). Where forests grow comes from the round's map seed.

import { S, C, HEX, ctx, players } from './state.js';

const PLAINS = '#18211d';
const TREE_DARK = '#22422b';
const TREE_LIGHT = '#346343';
const TREE_SHADOW = 'rgba(0,0,0,0.35)';
const STUMP = '#4a3826';
// iron ore deposits: rust-dark ground, red-brown rocks with ore specks (rubble once mined out)
const ORE = { ground: '#2a201c', rock: '#6b3f30', lit: '#8a5440', crack: '#40241a', speck: '#c0704a', rubble: '#3e2a22' };

// gold veins: dark rock shot with gold round a timber mine mouth, with a soft glow
const VEIN = { ground: '#26221b', rock: '#4a4136', lit: '#5e5344', crack: '#2e2820', gold: '#f2c14e', beam: '#7a5a36', mouth: '#120f0b' };

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
const PEAK = { body: '#4a5058', lit: '#5d646d', snow: '#d8e0e4', shadow: 'rgba(0,0,0,0.35)' };
const FOREST_RGB = [19, 40, 27];
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const SNOW_PINE = { dark: '#2d4a40', light: '#cfd9dc' };
const AUTUMN = ['#5e5030', '#64452c', '#545a30']; // (muted)
// biome props on open hexes (tile units)
const PROP = { meadow: 'rgba(79, 110, 58, 0.55)', steppe: 'rgba(138, 122, 69, 0.5)', snow: 'rgba(220, 232, 236, 0.1)', pool: 'rgba(30, 70, 72, 0.45)', reed: 'rgba(92, 125, 72, 0.6)', dune: 'rgba(255, 230, 180, 0.08)', cactus: '#465e36', rock: '#50555b', rockLit: '#60656c' };
const PLAINS_RGB = [24, 33, 29]; // (the old plains colour, which the ground leans toward a little)

// rivers: bank, deep water, the lighter middle (widths in tiles) and the stone of their bridges
const RIVER = { bank: '#2b3326', deep: '#1a3440', mid: '#22495a', flow: 'rgba(200, 230, 240, 0.16)', bankW: 1.6, deepW: 1.2, midW: 0.55 };
// the sea (style: cliffs and rocks): water darkening with depth (hexes out from the shore), a rocky
// cliff face where the land drops into it, a line of surf at the cliff's foot, rocks in the shallows
const SEA = { depth: ['#24505c', '#1c3d50', '#173248', '#13293f', '#112437'], cliff: '#4a4740', cliffLit: '#57534a', surf: '230, 240, 240', shadow: 'rgba(0, 0, 0, 0.2)', rock: '#5b5e62', rockLit: '#6c7075', cliffH: 0.9, ledge: 0.4 };
const STONE = { base: '#6f7378', block: '#7f848a', rail: '#9aa0a6', post: '#b4bac0', shadow: 'rgba(0,0,0,0.4)' };

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
function buildRivers(seed) {
  const list = layoutOf(seed).rivers;
  const paths = [];
  const bridges = [];
  const L = layoutOf(seed);
  for (const r of list) {
    const p = new Path2D();
    r.pts.forEach(([x, y], k) => (k ? p.lineTo(x, y) : p.moveTo(x, y)));
    // a river that reaches the coast pours on over the cliff into the sea
    const [ex, ey] = r.pts[r.pts.length - 1];
    let sea = null;
    for (const i of L.ocean) {
      const h = HEX.hexes[i];
      if (Math.hypot(h.cx - ex, h.cy - ey) < C.HEX_R + 0.05 && (!sea || Math.hypot(h.cx - ex, h.cy - ey) < Math.hypot(sea.cx - ex, sea.cy - ey))) sea = h;
    }
    if (sea) {
      const d = Math.hypot(sea.cx - ex, sea.cy - ey) || 1;
      p.lineTo(ex + ((sea.cx - ex) / d) * 1.3, ey + ((sea.cy - ey) / d) * 1.3);
    }
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

// The ground colour of every hex (stepped: one colour per hex, from the climate at its centre),
// gathered into one path per colour so a frame fills each colour once; and each open hex's props.
function buildGround(seed) {
  const L = layoutOf(seed);
  const byColour = new Map();
  const props = [];
  const tint = new Map(); // hex -> [r, g, b] (the minimap uses these too)
  for (const h of HEX.hexes) {
    const cl = climate(seed, h.cx, h.cy, C.MAP_W, C.MAP_H);
    // (a calm ground: the biome colour, drawn a little toward the old plains, barely varying hex to hex)
    const jitter = 0.985 + hash(seed, h.i, 1717) * 0.03;
    let c = mixRgb(groundColor(cl), PLAINS_RGB, 0.18).map((v) => v * jitter);
    if (L.ocean.has(h.i)) continue; // (the sea: see buildSea)
    const forest = L.forest.has(h.i);
    const mountain = L.mountains.has(h.i);
    if (forest) c = mixRgb(c, FOREST_RGB, 0.45);
    if (mountain) c = mixRgb(c, ROCK_RGB, 0.8);
    else if (L.foothills.has(h.i)) c = mixRgb(c, ROCK_RGB, 0.3); // (foothills: the range fades into the land)
    c = c.map((v) => Math.round(v / 3) * 3);
    tint.set(h.i, mountain ? [88, 93, 100] : c); // (the minimap shows ranges a lighter grey)
    const key = `rgb(${c[0]},${c[1]},${c[2]})`;
    if (!byColour.has(key)) byColour.set(key, new Path2D());
    const path = byColour.get(key);
    const cs = HEX.corners(h);
    path.moveTo(cs[0][0], cs[0][1]);
    for (let k = 1; k < 6; k++) path.lineTo(cs[k][0], cs[k][1]);
    path.closePath();
    if (forest || mountain || L.iron.has(h.i) || L.veins.has(h.i)) continue;
    // now and then a single small prop for the biome (most open hexes stay plain)
    const b = biomeOf(cl);
    if (hash(seed, h.i, 2100) > 0.25) continue;
    const spots = [[0, 0.3], [-1.05, -0.6], [1.05, -0.5], [-0.85, 0.95], [0.95, 1.0]];
    const n = 1;
    const list = [];
    for (let k = 0; k < n; k++) {
      const [dx, dy] = spots[k];
      const x = h.cx + dx + (hash(seed, h.i, 2300 + k) - 0.5) * 0.6;
      const y = h.cy + dy + (hash(seed, h.i, 2400 + k) - 0.5) * 0.4;
      const kind = b === 'meadow' || b === 'woods' ? 'tuft' : b === 'steppe' ? 'dry' : b === 'tundra' ? (k === 0 ? 'rock' : 'snow')
        : b === 'taiga' ? 'snow' : b === 'desert' ? (k === 0 && hash(seed, h.i, 2500) < 0.5 ? 'cactus' : 'dune') : b === 'swamp' ? 'reed' : 'rock';
      list.push({ kind, x, y });
    }
    if (list.length) props.push({ i: h.i, x: h.cx, y: h.cy, list });
  }
  return { ground: [...byColour], props, tint };
}

function drawProp(p) {
  const { x, y } = p;
  switch (p.kind) {
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
  const coast = new Path2D(); // the shoreline itself
  const cliffs = new Path2D(); // the rock below the land: a cliff face where the sea lies south of it (we see it from the
  //                              south), a narrow rocky ledge along the water elsewhere
  const foot = new Path2D(); // the foot of the cliffs and ledges, where the surf breaks
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
      const [dx, dy] = ny > 0.2 ? [0, SEA.cliffH] : [nx * SEA.ledge, ny * SEA.ledge];
      cliffs.moveTo(a[0], a[1]);
      cliffs.lineTo(b[0], b[1]);
      cliffs.lineTo(b[0] + dx, b[1] + dy);
      cliffs.lineTo(a[0] + dx, a[1] + dy);
      cliffs.closePath();
      foot.moveTo(a[0] + dx, a[1] + dy);
      foot.lineTo(b[0] + dx, b[1] + dy);
    }
  }
  const rocks = [];
  for (const i of L.ocean) {
    if (depth.get(i) !== 1 || hash(seed, i, 5100) > 0.4) continue;
    const h = HEX.hexes[i];
    for (let k = 0; k < 2; k++) rocks.push({ x: h.cx + (hash(seed, i, 5200 + k) - 0.5) * 2.2, y: h.cy + (hash(seed, i, 5300 + k) - 0.5) * 1.6, s: 0.38 + hash(seed, i, 5400 + k) * 0.18 });
  }
  return { bands, coast, cliffs, foot, rocks, tint };
}

// The sea, under the land: water by depth, the shadow the land throws on it, rocks in the shallows,
// then the cliff faces with surf at their foot (the land is drawn over them afterwards, so only the
// faces that drop toward the viewer show).
function drawSea(sea) {
  SEA.depth.forEach((c, d) => {
    ctx.fillStyle = c;
    ctx.fill(sea.bands[d]);
  });
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = SEA.shadow;
  for (const w of [3.2, 1.8]) {
    ctx.lineWidth = w;
    ctx.stroke(sea.coast);
  }
  const t = performance.now() / 1000;
  for (const r of sea.rocks) {
    ctx.fillStyle = SEA.rock;
    ctx.beginPath();
    ctx.ellipse(r.x, r.y, r.s, r.s * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = SEA.rockLit;
    ctx.beginPath();
    ctx.ellipse(r.x - r.s * 0.25, r.y - r.s * 0.2, r.s * 0.45, r.s * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(${SEA.surf}, ${0.28 + 0.12 * Math.sin(t * 1.3 + r.x)})`;
    ctx.lineWidth = 0.13;
    ctx.beginPath();
    ctx.ellipse(r.x, r.y + 0.12, r.s * 1.5, r.s * 1.0, 0, 0, Math.PI);
    ctx.stroke();
  }
  ctx.fillStyle = SEA.cliff;
  ctx.fill(sea.cliffs);
  ctx.strokeStyle = `rgba(${SEA.surf}, ${0.38 + 0.12 * Math.sin(t * 0.9)})`; // (the surf rises and falls)
  ctx.lineWidth = 0.18;
  ctx.stroke(sea.foot);
  ctx.lineCap = 'butt';
}

function build(seed) {
  const L = layoutOf(seed);
  const rivers = buildRivers(seed);
  // mountain peaks, two or three a hex, drawn back to front
  const peaks = [];
  for (const i of L.mountains) {
    const h = HEX.hexes[i];
    const cold = climate(seed, h.cx, h.cy, C.MAP_W, C.MAP_H).temp < 0.35;
    const spots = [[-0.75, -0.35, 1.25], [0.8, -0.15, 1.1], [0.05, 0.7, 1.35]];
    spots.forEach(([dx, dy, sz], k) => {
      if (k === 1 && hash(seed, i, 3100) < 0.3) return;
      const pk = peak(h.cx + dx + (hash(seed, i * 3 + k, 3200) - 0.5) * 0.4, h.cy + dy + (hash(seed, i * 3 + k, 3300) - 0.5) * 0.3, sz * (0.85 + hash(seed, i, 3400 + k) * 0.3), cold ? 1.25 : 0.9);
      pk.i = i;
      peaks.push(pk);
    });
  }
  peaks.sort((a, b) => a.y - b.y);
  // ore and veins in the foothills blend toward the rock
  const hillOverlay = new Path2D();
  for (const i of [...L.iron, ...L.veins]) {
    if (!L.foothills.has(i)) continue;
    const cs = HEX.corners(HEX.hexes[i]);
    hillOverlay.moveTo(cs[0][0], cs[0][1]);
    for (let k = 1; k < 6; k++) hillOverlay.lineTo(cs[k][0], cs[k][1]);
    hillOverlay.closePath();
  }
  const groundInfo = buildGround(seed);
  const fill = new Path2D();
  const forests = [];
  const oreFill = new Path2D();
  const ores = [];
  for (const h of HEX.hexes) {
    if (!L.iron.has(h.i)) continue;
    const cs = HEX.corners(h);
    oreFill.moveTo(cs[0][0], cs[0][1]);
    for (let k = 1; k < 6; k++) oreFill.lineTo(cs[k][0], cs[k][1]);
    oreFill.closePath();
    // five rocks; `rank` is the order they're mined away in
    const rocks = [[0, 0.05], [-1.0, -0.6], [0.95, -0.7], [-0.9, 0.75], [1.0, 0.7]].map(([dx, dy], k) => {
      const r = oreRock(h.cx + dx + (hash(seed, h.i * 5 + k, 31) - 0.5) * 0.5, h.cy + dy + (hash(seed, h.i, 131 + k) - 0.5) * 0.4, 0.42 + hash(seed, k + 9, h.i) * 0.18);
      r.cut = hash(seed, h.i, 600 + k);
      r.specks = [0, 1].map((j) => [r.x + (hash(seed, h.i * 3 + k, 700 + j) - 0.5) * r.s, r.y + (hash(seed, h.i * 3 + k, 800 + j) - 0.6) * r.s * 0.6]);
      return r;
    });
    [...rocks].sort((a, b) => a.cut - b.cut).forEach((r, n) => { r.rank = n; });
    rocks.sort((a, b) => a.y - b.y);
    ores.push({ i: h.i, x: h.cx, y: h.cy, rocks });
  }
  const veinFill = new Path2D();
  const veins = [];
  for (const h of HEX.hexes) {
    if (!L.veins.has(h.i)) continue;
    const cs = HEX.corners(h);
    veinFill.moveTo(cs[0][0], cs[0][1]);
    for (let k = 1; k < 6; k++) veinFill.lineTo(cs[k][0], cs[k][1]);
    veinFill.closePath();
    const rocks = [[-1.05, -0.75, 0.55], [1.0, -0.6, 0.48], [0.95, 0.85, 0.52], [-0.95, 0.9, 0.42]].map(([dx, dy, s]) => {
      const r = oreRock(h.cx + dx, h.cy + dy, s);
      r.flecks = [0, 1, 2].map((j) => [r.x + (hash(seed, h.i * 4 + j, 950) - 0.5) * r.s * 1.2, r.y + (hash(seed, h.i * 4 + j, 960) - 0.65) * r.s * 0.7]);
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
    const trees = [[0, 0], [-1.05, -0.65], [1.05, -0.6], [-0.95, 0.8], [1.0, 0.85]].map(([dx, dy], k) => {
      const tx = h.cx + dx + (hash(seed, h.i * 7 + k, 11) - 0.5) * 0.6;
      const ty = h.cy + dy + (hash(seed, h.i, 91 + k) - 0.5) * 0.5 + 0.2;
      const ts = 0.38 + hash(seed, k, h.i) * 0.14;
      // (warm woods mix in round autumn trees; the cold has snowy pines)
      const t = autumn && hash(seed, h.i, 1900 + k) < 0.25 ? roundTree(tx, ty, ts * 1.15, AUTUMN[Math.floor(hash(seed, h.i, 1950 + k) * AUTUMN.length)]) : pine(tx, ty, ts);
      t.snowy = snowy;
      t.cut = hash(seed, h.i, 400 + k);
      return t;
    });
    const order = [...trees].sort((a, b) => a.cut - b.cut);
    order.forEach((t, n) => { t.rank = n; }); // trees with rank >= wood left are gone
    trees.sort((a, b) => a.y - b.y);
    forests.push({ i: h.i, x: h.cx, y: h.cy, trees });
  }
  const sea = buildSea(seed);
  for (const [i, c] of sea.tint) groundInfo.tint.set(i, c);
  return { seed, fill, forests, rivers, oreFill, ores, veinFill, veins, peaks, hillOverlay, sea, ...groundInfo };
}

// Draw the ground under the map rectangle at screen (ox, oy), s pixels per tile.
function drawTerrain(ox, oy, s) {
  ctx.fillStyle = PLAINS;
  ctx.fillRect(ox, oy, C.MAP_W * s, C.MAP_H * s);
  const seed = mapSeed();
  if (seed === undefined || seed === null) return;
  if (!built || built.seed !== seed) built = build(seed);
  ctx.save();
  // nothing past the map's edge (the hexes along it are cut off)
  ctx.beginPath();
  ctx.rect(ox, oy, C.MAP_W * s, C.MAP_H * s);
  ctx.clip();
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  drawSea(built.sea);
  // each hex's biome ground (forest hexes a darker shade of theirs)
  for (const [colour, path] of built.ground) {
    ctx.fillStyle = colour;
    ctx.fill(path);
  }
  ctx.fillStyle = ORE.ground;
  ctx.fill(built.oreFill);
  ctx.fillStyle = VEIN.ground;
  ctx.fill(built.veinFill);
  ctx.fillStyle = 'rgba(58, 62, 67, 0.4)';
  ctx.fill(built.hillOverlay);
  // the dark lip of the land along the coast
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 0.26;
  ctx.stroke(built.sea.coast);
  drawRivers(built.rivers);
  // mountain peaks (at every zoom: they matter for where troops can go)
  {
    const px0 = -ox / s - 4;
    const py0 = -oy / s - 4;
    const px1 = px0 + ctx.canvas.width / s + 8;
    const py1 = py0 + ctx.canvas.height / s + 8;
    for (const p of built.peaks) {
      if (p.x < px0 || p.x > px1 || p.y < py0 || p.y > py1) continue;
      ctx.fillStyle = PEAK.shadow;
      ctx.fill(p.shadow);
      ctx.fillStyle = PEAK.body;
      ctx.fill(p.body);
      ctx.fillStyle = PEAK.lit;
      ctx.fill(p.lit);
      ctx.fillStyle = PEAK.snow;
      ctx.fill(p.cap);
    }
  }
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
    // gold veins: glowing rocks with gold flecks round a mine mouth
    const glint = 0.75 + 0.25 * Math.sin(performance.now() / 600);
    for (const v of built.veins) {
      if (v.x < x0 || v.x > x1 || v.y < y0 || v.y > y1 || taken.has(v.i)) continue;
      const glow = ctx.createRadialGradient(v.x, v.y, 0.2, v.x, v.y, 1.9);
      glow.addColorStop(0, `rgba(242, 193, 78, ${0.28 * glint})`);
      glow.addColorStop(1, 'rgba(242, 193, 78, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(v.x, v.y, 1.9, 0, Math.PI * 2);
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
        ctx.fillStyle = VEIN.gold;
        for (const [fx, fy] of r.flecks) {
          ctx.beginPath();
          ctx.moveTo(fx, fy - 0.12);
          ctx.lineTo(fx + 0.06, fy);
          ctx.lineTo(fx, fy + 0.12);
          ctx.lineTo(fx - 0.06, fy);
          ctx.closePath();
          ctx.fill();
        }
      }
      // the mine mouth in its timber frame
      ctx.fillStyle = VEIN.mouth;
      ctx.beginPath();
      ctx.arc(v.x, v.y + 0.12, 0.42, Math.PI, 0);
      ctx.lineTo(v.x + 0.42, v.y + 0.38);
      ctx.lineTo(v.x - 0.42, v.y + 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = VEIN.beam;
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.moveTo(v.x - 0.5, v.y + 0.4);
      ctx.lineTo(v.x - 0.5, v.y - 0.38);
      ctx.lineTo(v.x + 0.5, v.y - 0.38);
      ctx.lineTo(v.x + 0.5, v.y + 0.4);
      ctx.stroke();
      ctx.fillStyle = VEIN.gold;
      ctx.beginPath();
      ctx.arc(v.x, v.y + 0.2, 0.08 * glint + 0.04, 0, Math.PI * 2);
      ctx.fill();
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

export { drawTerrain, groundCanvas, riverView, veinsView };
