// Chibi troop figures: big-headed little people, drawn upright and facing right (flip to face left).
// Units in a "unit space" where the head is about 1 wide; the caller scales it. Each figure is drawn
// in its owner's colours: T = { c: main, d: dark, l: light }.
//   soldier: Knight (round helmet, crest, sword, round shield)
//   scout:   Ranger (pointed hood, short cape, dagger)
//   medic:   Field nurse (white cap and tunic with crosses, healing staff)
//   archer:  Hunter (felt hat with a feather, short bow)
//   caravan: Ox wagon (an open wagon of barrels behind a horned ox)
//   worker:  hard hat and apron, with a hammer / wrench / axe / hoe for its job
// Troops are drawn from a cache of little pre-drawn images (one per type, colour and zoom).

import { colorOf } from './state.js';

const OUT = 'rgba(5,8,12,0.9)';
const SKIN = '#e0b48f';
const METAL = '#b9c2cc';
const METAL_D = '#7d8793';
const WOOD = '#7a5535';
const WOOD_D = '#4a3322';
const LEATHER = '#5c3f27';
const CLOTH = '#e9e4da';
const DARK = '#2a2f3a';
const OX = '#6e5a48';
const BARREL = '#8a5a32';

let g = null; // the context being drawn on
let LW = 0.09; // outline width, in unit space

const begin = () => g.beginPath();
const fillOut = (fill) => {
  g.fillStyle = fill;
  g.fill();
  g.stroke();
};
const rr = (x, y, w, h, r) => {
  begin();
  g.roundRect(x, y, w, h, r);
};
const circ = (x, y, r) => {
  begin();
  g.arc(x, y, r, 0, Math.PI * 2);
};
const ell = (x, y, rx, ry) => {
  begin();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
};
function stroke(pts, col, w) {
  begin();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.strokeStyle = col;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.stroke();
  g.strokeStyle = OUT;
  g.lineWidth = LW;
}
const outlined = (pts, col, w) => {
  stroke(pts, OUT, w + LW * 1.4);
  stroke(pts, col, w);
};

// the shared body; the hooks draw gear behind it, on the head, and in front
function body(T, { torso = T.c, back, head, front }) {
  g.lineWidth = LW;
  g.strokeStyle = OUT;
  g.lineJoin = 'round';
  ell(0, 0.86, 0.7, 0.18);
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fill();
  if (back) back();
  rr(-0.38, 0.62, 0.3, 0.22, 0.08);
  fillOut(DARK);
  rr(0.08, 0.62, 0.3, 0.22, 0.08);
  fillOut(DARK);
  rr(-0.45, -0.1, 0.9, 0.8, 0.28);
  fillOut(torso);
  g.fillStyle = T.d; // a belt in the team's colour, so every troop shows whose it is
  g.fillRect(-0.43, 0.4, 0.86, 0.13);
  circ(0, -0.55, 0.52);
  fillOut(SKIN);
  circ(0.2, -0.5, 0.065);
  g.fillStyle = '#1b1f27';
  g.fill();
  circ(0.38, -0.5, 0.065);
  g.fill();
  ell(0.1, -0.33, 0.07, 0.04);
  g.fillStyle = 'rgba(220,110,110,0.45)';
  g.fill();
  if (head) head();
  if (front) front();
}

const FIGURES = {
  soldier: (T) => body(T, {
    head() {
      begin();
      g.arc(0, -0.6, 0.56, Math.PI, 0);
      g.lineTo(0.56, -0.68);
      g.lineTo(-0.56, -0.68);
      g.closePath();
      fillOut(METAL);
      rr(-0.08, -1.34, 0.16, 0.3, 0.06);
      fillOut(T.c);
    },
    front() {
      rr(0.55, -0.6, 0.14, 1.0, 0.05);
      fillOut(METAL);
      rr(0.42, 0.25, 0.4, 0.1, 0.03);
      fillOut(METAL_D);
      circ(-0.42, 0.25, 0.42);
      g.fillStyle = T.c;
      g.fill();
      g.strokeStyle = METAL;
      g.lineWidth = LW * 1.15;
      g.stroke();
      g.strokeStyle = OUT;
      g.lineWidth = LW;
      circ(-0.42, 0.25, 0.1);
      g.fillStyle = METAL;
      g.fill();
    },
  }),
  scout: (T) => body(T, {
    torso: LEATHER,
    back() {
      begin();
      g.moveTo(-0.5, -0.1);
      g.quadraticCurveTo(-0.75, 0.6, -0.55, 0.75);
      g.lineTo(0.2, 0.7);
      g.closePath();
      fillOut(T.d);
    },
    head() {
      begin();
      g.moveTo(-0.6, -0.45);
      g.quadraticCurveTo(-0.55, -1.2, 0.1, -1.4);
      g.quadraticCurveTo(0.55, -1.1, 0.6, -0.45);
      g.quadraticCurveTo(0.3, -0.9, -0.2, -0.85);
      g.closePath();
      fillOut(T.c);
      rr(-0.42, -0.12, 0.84, 0.2, 0.1);
      fillOut(T.c);
    },
    front() {
      g.save();
      g.translate(0.55, 0.3);
      g.rotate(0.5);
      rr(-0.05, -0.38, 0.1, 0.42, 0.03);
      fillOut(METAL);
      g.restore();
    },
  }),
  medic: (T) => body(T, {
    torso: CLOTH,
    head() {
      rr(-0.45, -1.12, 0.9, 0.36, 0.12);
      fillOut(CLOTH);
      g.fillStyle = T.c;
      g.fillRect(-0.05, -1.06, 0.1, 0.25);
      g.fillRect(-0.12, -0.99, 0.24, 0.1);
    },
    front() {
      g.fillStyle = T.c;
      g.fillRect(-0.07, 0.04, 0.14, 0.34);
      g.fillRect(-0.18, 0.15, 0.36, 0.12);
      outlined([[0.62, 0.8], [0.62, -0.75]], WOOD, 0.09);
      circ(0.62, -0.88, 0.16);
      fillOut(T.l);
    },
  }),
  archer: (T) => body(T, {
    head() {
      ell(0, -0.85, 0.72, 0.15);
      fillOut(LEATHER);
      begin();
      g.moveTo(-0.32, -0.9);
      g.lineTo(0.05, -1.45);
      g.lineTo(0.32, -0.9);
      g.closePath();
      fillOut(LEATHER);
      stroke([[0.15, -1.1], [-0.35, -1.45]], T.c, 0.09);
    },
    front() {
      const a = Math.PI * 0.42;
      begin();
      g.arc(0.25, 0.25, 0.65, -a, a);
      g.strokeStyle = OUT;
      g.lineWidth = 0.11 + LW * 1.4;
      g.stroke();
      g.strokeStyle = WOOD;
      g.lineWidth = 0.11;
      g.stroke();
      stroke([[0.25 + Math.cos(-a) * 0.65, 0.25 + Math.sin(-a) * 0.65], [0.25 + Math.cos(a) * 0.65, 0.25 + Math.sin(a) * 0.65]], '#e6edf3', 0.035);
    },
  }),
};

// Workers: a hard hat (a straw hat when farming), an apron, and the tool for the job: a hammer to
// build, a wrench to repair, an axe to chop (with logs on the back when carrying wood), a hoe to farm.
function workerFigure(T, job, carry) {
  const farming = job === 4;
  body(T, {
    back: carry ? () => {
      for (const [y, l] of [[-0.18, 0.95], [0.02, 0.85]]) {
        g.save();
        g.translate(-0.42, y);
        g.rotate(-0.35);
        rr(-l / 2, -0.1, l, 0.2, 0.1);
        fillOut('#8a5a32');
        circ(l / 2 - 0.04, 0, 0.07);
        fillOut('#c49a6c');
        g.restore();
      }
    } : null,
    head() {
      if (farming) {
        ell(0, -0.86, 0.78, 0.15);
        fillOut('#d9b25f');
        begin();
        g.arc(0, -0.9, 0.38, Math.PI, 0);
        g.closePath();
        fillOut('#d9b25f');
        g.fillStyle = T.c;
        g.fillRect(-0.38, -0.97, 0.76, 0.08);
      } else {
        begin();
        g.arc(0, -0.62, 0.55, Math.PI, 0);
        g.closePath();
        fillOut('#f2c14e');
        rr(-0.62, -0.68, 1.24, 0.1, 0.05);
        fillOut('#f2c14e');
        g.fillStyle = T.c;
        g.fillRect(-0.53, -0.82, 1.06, 0.1);
      }
    },
    front() {
      // apron
      rr(-0.3, 0.05, 0.6, 0.6, 0.12);
      fillOut('#8a6a48');
      if (job === 1) {
        // hammer
        outlined([[0.6, 0.45], [0.6, -0.35]], WOOD, 0.08);
        rr(0.42, -0.5, 0.36, 0.18, 0.04);
        fillOut(METAL_D);
      } else if (job === 2) {
        // wrench
        outlined([[0.6, 0.45], [0.6, -0.25]], METAL, 0.09);
        circ(0.6, -0.35, 0.14);
        fillOut(METAL);
        circ(0.6, -0.42, 0.06);
        g.fillStyle = '#1b1f27';
        g.fill();
      } else if (job === 3) {
        // axe
        outlined([[0.58, 0.5], [0.58, -0.45]], WOOD, 0.08);
        begin();
        g.moveTo(0.58, -0.45);
        g.quadraticCurveTo(0.95, -0.42, 0.9, -0.12);
        g.lineTo(0.58, -0.18);
        g.closePath();
        fillOut(METAL);
      } else if (job === 4) {
        // hoe
        outlined([[0.62, 0.8], [0.62, -0.8]], WOOD, 0.08);
        rr(0.38, -0.88, 0.3, 0.12, 0.03);
        fillOut(METAL_D);
      }
    },
  });
}

// The colours a player's troops are dressed in.
function teamOf(owner) {
  return { c: colorOf(owner, 55), d: colorOf(owner, 32), l: colorOf(owner, 80) };
}

// Colours from a single hex colour (for HUD icons).
function teamFromHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (t) => {
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t));
    return `rgb(${ch.join(',')})`;
  };
  return { c: hex, d: mix(-0.45), l: mix(0.5) };
}

// Draw troop `kind` on context `ctx` with its feet's centre near (x, y), k pixels per unit.
function drawFigure(ctx, kind, x, y, k, T, face = 1) {
  // workers come as 'worker<job>' or 'worker<job>c' (carrying wood)
  const fn = kind.startsWith('worker') ? (t) => workerFigure(t, Number(kind[6]) || 0, kind.endsWith('c')) : FIGURES[kind];
  if (!fn) return;
  const prevG = g;
  g = ctx;
  LW = Math.max(0.09, 1 / k);
  g.save();
  g.translate(x, y);
  g.scale(k * face, k);
  fn(T);
  g.restore();
  g = prevG;
}

// ---- the sprite cache: one little canvas per (type, colour, size in half pixels)
const cache = new Map();
const PAD_X = 1.05;
const PAD_TOP = 1.55;
const PAD_BOTTOM = 1.0;

function sprite(kind, T, k) {
  const kq = Math.max(2, Math.round(k * 2) / 2);
  const key = `${kind}|${T.c}|${kq}`;
  let c = cache.get(key);
  if (c) return c;
  if (cache.size > 600) cache.clear();
  c = document.createElement('canvas');
  c.width = Math.ceil(PAD_X * 2 * kq) + 4;
  c.height = Math.ceil((PAD_TOP + PAD_BOTTOM) * kq) + 4;
  c.ox = PAD_X * kq + 2;
  c.oy = PAD_TOP * kq + 2;
  drawFigure(c.getContext('2d'), kind, c.ox, c.oy, kq, T);
  cache.set(key, c);
  return c;
}

// A troop on the map: (x, y) is where the figure's middle should be, k = pixels per unit.
function drawTroop(ctx, kind, owner, x, y, k, face) {
  const c = sprite(kind, teamOf(owner), k);
  const oy = y + k * 0.3; // the figure's middle sits about 0.3 units above its unit-space origin
  if (face < 0) {
    ctx.save();
    ctx.translate(x, oy);
    ctx.scale(-1, 1);
    ctx.drawImage(c, -c.ox, -c.oy);
    ctx.restore();
  } else ctx.drawImage(c, x - c.ox, oy - c.oy);
}

// ---- the caravan: an open wagon of barrels behind a horned ox. Drawn in unit space, facing right;
// `spin` turns the wheels and `step` moves the ox's legs; `barrels` grows with the trade post level.
function drawOxWagon(ctx, x, y, u, T, face, spin, step, barrels) {
  const prevG = g;
  g = ctx;
  LW = Math.max(0.09, 1 / u);
  g.save();
  g.translate(x, y);
  g.scale(u * face, u);
  g.translate(-0.2, 0);
  g.lineWidth = LW;
  g.strokeStyle = OUT;
  g.lineJoin = 'round';
  ell(0.15, 0.86, 1.4, 0.2);
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fill();
  // barrels on the bed
  const n = Math.max(1, Math.min(4, barrels));
  const bw = 1.3 / n;
  for (let i = 0; i < n; i++) {
    const bx = -0.95 + i * bw + bw * 0.08;
    rr(bx, -0.62, bw * 0.84, 0.55, 0.12);
    fillOut(BARREL);
    stroke([[bx + 0.03, -0.45], [bx + bw * 0.84 - 0.03, -0.45]], METAL_D, 0.05);
    stroke([[bx + 0.03, -0.25], [bx + bw * 0.84 - 0.03, -0.25]], METAL_D, 0.05);
  }
  rr(-1.0, -0.15, 1.4, 0.55, 0.06);
  fillOut(WOOD);
  stroke([[-0.97, 0.02], [0.37, 0.02]], T.c, 0.1);
  // wheels with turning spokes
  for (const wx of [-0.65, 0.1]) {
    circ(wx, 0.55, 0.3);
    fillOut(WOOD_D);
    for (let s = 0; s < 3; s++) {
      const a = spin + (s * Math.PI) / 3;
      stroke([[wx - Math.cos(a) * 0.22, 0.55 - Math.sin(a) * 0.22], [wx + Math.cos(a) * 0.22, 0.55 + Math.sin(a) * 0.22]], '#8a6a48', 0.05);
    }
    circ(wx, 0.55, 0.07);
    fillOut(METAL_D);
  }
  // yoke pole
  stroke([[0.4, 0.15], [0.62, 0.0]], WOOD_D, 0.07);
  // the ox
  const leg = Math.sin(step) * 0.08;
  rr(0.65, 0.05, 0.14, 0.55 + leg, 0.05);
  fillOut(OX);
  rr(1.05, 0.05, 0.14, 0.55 - leg, 0.05);
  fillOut(OX);
  rr(0.55, -0.35, 0.75, 0.6, 0.25);
  fillOut(OX);
  rr(1.15, -0.55, 0.42, 0.45, 0.15);
  fillOut(OX);
  begin();
  g.moveTo(1.22, -0.5);
  g.quadraticCurveTo(1.05, -0.8, 1.2, -0.95);
  g.lineTo(1.28, -0.55);
  g.closePath();
  fillOut(CLOTH);
  circ(1.45, -0.38, 0.045);
  g.fillStyle = '#1b1f27';
  g.fill();
  rr(0.6, -0.4, 0.65, 0.12, 0.05);
  fillOut(T.c);
  g.restore();
  g = prevG;
}

export { drawFigure, drawOxWagon, drawTroop, teamFromHex, teamOf };
