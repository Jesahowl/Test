// Towers, barracks and ruins: sprites, health bars and build effects.

import { label, onScreen } from './render.js';
import { S, C, colorOf, ctx, grid, mouse, scale, toScreen } from './state.js';

// ---- structures
// Health bars only appear once a structure has been hit, then fade out. They stay up while it is
// selected, hovered or badly damaged. A pale "trail" shows the damage just taken.
const BAR_HOLD = 3000;

const BAR_FADE = 1000;

function structBarAlpha(o, now, forced) {
  if (forced || o.hp / o.maxHp < 0.35) return 1;
  const since = now - (o.hitAt || -1e9);
  return since < BAR_HOLD ? 1 : Math.max(0, 1 - (since - BAR_HOLD) / BAR_FADE);
}

function structBar(o, x, y, w, now, forced, dt) {
  o.trail = o.trail === undefined ? o.hp : Math.max(o.hp, o.trail - (o.maxHp * 0.35 + (o.trail - o.hp) * 2) * dt);
  const a = structBarAlpha(o, now, forced);
  if (a <= 0) return;
  const h = Math.max(4, Math.round(w * 0.09));
  const frac = Math.max(0, o.hp / o.maxHp);
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  roundRect(x - w / 2 - 1, y - 1, w + 2, h + 2, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(x - w / 2, y, w * Math.min(1, o.trail / o.maxHp), h);
  ctx.fillStyle = frac > 0.5 ? '#3fb950' : frac > 0.25 ? '#d29922' : '#f85149';
  ctx.fillRect(x - w / 2, y, w * frac, h);
  ctx.globalAlpha = 1;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function polygon(x, y, r, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (Math.PI * 2 * i) / n;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

// Small deterministic random numbers per structure, for rubble and cracks.
function hashRand(seed) {
  let h = seed * 2654435761 >>> 0;
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

function drawCracks(x, y, r, damage, seed) {
  if (damage < 0.4) return;
  const rnd = hashRand(seed);
  const n = damage > 0.7 ? 4 : 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let a = rnd() * Math.PI * 2;
    let d = r * (0.25 + rnd() * 0.2);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    for (let j = 0; j < 3; j++) {
      a += (rnd() - 0.5) * 0.9;
      d += r * 0.22;
      ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

function drawSmoke(x, y, r, now, seed) {
  for (let i = 0; i < 3; i++) {
    const p = ((now / 1600 + i / 3 + seed * 0.13) % 1);
    ctx.fillStyle = `rgba(60, 60, 60, ${0.45 * (1 - p)})`;
    ctx.beginPath();
    ctx.arc(x + Math.sin(seed + i * 2 + p * 3) * r * 0.3, y - r * 0.2 - p * r * 1.6, r * (0.2 + p * 0.35), 0, Math.PI * 2);
    ctx.fill();
  }
}

// A floating crystal in a player's colour (also used by cores): a glow, a two-tone gem and a
// highlight. flare (0..1) turns it white-hot for a moment when it fires.
function drawCrystal(x, y, cr, owner, flare = 0, glow = 0) {
  if (glow > 0) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, cr * 2.6);
    g.addColorStop(0, colorOf(owner, 65, 0.45 + 0.4 * flare));
    g.addColorStop(1, colorOf(owner, 65, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, cr * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = flare > 0.3 ? '#ffffff' : colorOf(owner, 82);
  ctx.beginPath();
  ctx.moveTo(x, y - cr * 1.45);
  ctx.lineTo(x + cr * 0.75, y - cr * 0.1);
  ctx.lineTo(x, y + cr);
  ctx.lineTo(x - cr * 0.75, y - cr * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = flare > 0.3 ? colorOf(owner, 90) : colorOf(owner, 52);
  ctx.beginPath();
  ctx.moveTo(x, y - cr * 1.45);
  ctx.lineTo(x + cr * 0.75, y - cr * 0.1);
  ctx.lineTo(x, y + cr);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(x, y - cr * 1.45);
  ctx.lineTo(x - cr * 0.75, y - cr * 0.1);
  ctx.lineTo(x - cr * 0.3, y - cr * 0.25);
  ctx.closePath();
  ctx.fill();
}

// A rune circle on the ground (seen at an angle): a solid ring, a dashed inner ring and four
// small glowing runes, turning with `rot`.
function runeEllipse(x, y, rx, ry, owner, rot, alpha = 0.7) {
  ctx.save();
  ctx.strokeStyle = colorOf(owner, 65, alpha);
  ctx.lineWidth = Math.max(1.5, rx * 0.06);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, rx * 0.04);
  ctx.setLineDash([rx * 0.12, rx * 0.16]);
  ctx.lineDashOffset = rot * rx;
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 0.78, ry * 0.78, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = colorOf(owner, 80, alpha);
  for (let i = 0; i < 4; i++) {
    const a = rot + (Math.PI / 2) * i;
    polygon(x + Math.cos(a) * rx, y + Math.sin(a) * ry, Math.max(1.5, rx * 0.08), 4, 0);
    ctx.fill();
  }
  ctx.restore();
}

// Tower: a stone pillar on a rune circle with a crystal floating above it, which zaps enemy
// troops with lightning. Higher levels: bigger crystal, orbiting shards (2+), a spinning ring (3+),
// gold runes (4+) and a radiant aura (5).
function drawTowerSprite(t, x, y, s, now) {
  const lvl = t.level;
  const r = s * 0.62 * (1 + 0.07 * (lvl - 1));
  const flip = t.flipAt ? (now - t.flipAt) / 900 : 1;
  const bounce = flip < 1 ? 1 + 0.3 * Math.sin(flip * Math.PI * 3) * (1 - flip) : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(bounce, bounce);

  const by = r * 0.55; // ground level: the base of the pillar
  const owner = t.owner;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(r * 0.1, by + r * 0.05, r * 0.95, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();

  // level 5: radiant aura in the owner's colour, around the crystal
  if (lvl >= 5) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 400 + t.id);
    const ag = ctx.createRadialGradient(0, -r * 0.6, r * 0.4, 0, -r * 0.6, r * 2);
    ag.addColorStop(0, colorOf(owner, 65, 0.4 + 0.2 * pulse));
    ag.addColorStop(1, colorOf(owner, 65, 0));
    ctx.fillStyle = ag;
    ctx.beginPath();
    ctx.arc(0, -r * 0.6, r * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // rune circle on the ground, slowly turning
  runeEllipse(0, by, r * 1.05, r * 0.42, owner, now / 3000 + t.id, 0.75);
  // level 4+: an outer ring of gold runes
  if (lvl >= 4) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 213, 79, 0.75)';
    ctx.lineWidth = Math.max(1.5, s * 0.045);
    ctx.setLineDash([s * 0.12, s * 0.1]);
    ctx.lineDashOffset = -now / 60;
    ctx.beginPath();
    ctx.ellipse(0, by, r * 1.4, r * 0.56, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI * 2 * i) / 3 - now / 2500;
      ctx.fillStyle = '#ffd54f';
      polygon(Math.cos(a) * r * 1.4, by + Math.sin(a) * r * 0.56, Math.max(2, s * 0.07), 4, 0);
      ctx.fill();
    }
    ctx.restore();
  }

  // plinth and pillar
  const pTop = -r * 0.5;
  const stone = '#4c535c';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.strokeStyle = '#22272d';
  ctx.fillStyle = '#3a4048';
  ctx.beginPath();
  ctx.moveTo(-r * 0.58, by);
  ctx.lineTo(-r * 0.44, by - r * 0.26);
  ctx.lineTo(r * 0.44, by - r * 0.26);
  ctx.lineTo(r * 0.58, by);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = stone;
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, by - r * 0.26);
  ctx.lineTo(-r * 0.18, pTop);
  ctx.lineTo(r * 0.18, pTop);
  ctx.lineTo(r * 0.3, by - r * 0.26);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; // shaded side
  ctx.beginPath();
  ctx.moveTo(r * 0.06, by - r * 0.26);
  ctx.lineTo(r * 0.04, pTop);
  ctx.lineTo(r * 0.18, pTop);
  ctx.lineTo(r * 0.3, by - r * 0.26);
  ctx.closePath();
  ctx.fill();
  // cap stone
  ctx.fillStyle = '#5c646e';
  ctx.fillRect(-r * 0.26, pTop - r * 0.1, r * 0.52, r * 0.12);
  ctx.strokeRect(-r * 0.26, pTop - r * 0.1, r * 0.52, r * 0.12);
  // glowing rune channel up the pillar; brightens when it fires
  const flare = t.shotAt && now >= t.shotAt ? Math.max(0, 1 - (now - t.shotAt) / 220) : 0;
  ctx.strokeStyle = colorOf(owner, 70 + 20 * flare, 0.75 + 0.25 * flare);
  ctx.lineWidth = Math.max(1.5, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(-r * 0.04, by - r * 0.3);
  ctx.lineTo(-r * 0.02, pTop + r * 0.04);
  ctx.stroke();
  drawCracks(0, (by + pTop) / 2, r * 0.3, 1 - t.hp / t.maxHp, t.id);

  // floating crystal (bigger with level), with orbiting shards from level 2
  const bob = Math.sin(now / 520 + t.id) * r * 0.06;
  const cy = -r * 1.0 + bob;
  const cr = r * (0.3 + 0.045 * Math.min(lvl, 3));
  const shards = lvl >= 3 ? 3 : lvl >= 2 ? 2 : 0;
  const orbit = (front) => {
    for (let i = 0; i < shards; i++) {
      const a = now / 900 + (Math.PI * 2 * i) / shards + t.id;
      if ((Math.sin(a) > 0) !== front) continue;
      drawCrystal(Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.2, r * 0.09, owner, 0);
    }
  };
  orbit(false);
  if (lvl >= 3) {
    ctx.save();
    ctx.strokeStyle = colorOf(owner, 70, 0.55);
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.setLineDash([s * 0.08, s * 0.08]);
    ctx.lineDashOffset = now / 50;
    ctx.beginPath();
    ctx.ellipse(0, cy, r * 0.62, r * 0.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  drawCrystal(0, cy, cr, owner, flare, s * (0.25 + (lvl >= 3 ? 0.15 * (0.5 + 0.5 * Math.sin(now / 300)) : 0)));
  orbit(true);

  // capture / claim flash
  if (flip < 1) {
    ctx.globalAlpha = (1 - flip) * 0.8;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.2, r * 0.8, r * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  if (flip < 1) {
    // burst of shards in the new owner's colour, plus the old colour fading out
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10 + t.id;
      const d = s * (0.6 + flip * 2.2);
      ctx.fillStyle = colorOf(i % 3 === 0 && t.prevOwner ? t.prevOwner : t.owner, 60, 1 - flip);
      polygon(x + Math.cos(a) * d, y + Math.sin(a) * d, s * 0.12 * (1 - flip * 0.5), 3, a + flip * 6);
      ctx.fill();
    }
  }
  if (t.hp / t.maxHp < 0.3) drawSmoke(x, y, r, now, t.id);

  // level pips
  for (let i = 0; i < lvl; i++) {
    ctx.fillStyle = '#ffd54f';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    polygon(x - (lvl - 1) * r * 0.22 + i * r * 0.44, y + r * 1.3, Math.max(2, s * 0.07), 4, 0);
    ctx.fill();
    ctx.stroke();
  }
}

// Barracks: a crystal hall. A long stone hall on a rune circle, with crystals growing from the roof
// ridge, glowing windows and a lit doorway. It flares and pulses when a wave marches out.
function drawBarracksSprite(t, x, y, s, now) {
  const r = s * 0.7;
  const flip = t.flipAt ? (now - t.flipAt) / 900 : 1;
  const bounce = flip < 1 ? 1 + 0.3 * Math.sin(flip * Math.PI * 3) * (1 - flip) : 1;
  const out = t.waveAt ? Math.max(0, 1 - (now - t.waveAt) / 700) : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(bounce * (1 + 0.06 * out), bounce * (1 + 0.06 * out));
  const by = r * 0.72; // ground level
  const owner = t.owner;
  // shadow, rune circle and plinth
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(r * 0.1, by, r * 1.3, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  runeEllipse(0, by, r * 1.38, r * 0.5, owner, now / 3500 + t.id, 0.7 + 0.3 * out);
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.strokeStyle = '#22272d';
  ctx.fillStyle = '#3a4048';
  ctx.beginPath();
  ctx.moveTo(-r * 1.2, by);
  ctx.lineTo(-r * 1.1, by - r * 0.17);
  ctx.lineTo(r * 1.1, by - r * 0.17);
  ctx.lineTo(r * 1.2, by);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // stone walls with mortar lines and a shaded right end
  const wTop = -r * 0.2;
  const wBot = by - r * 0.17;
  ctx.fillStyle = '#4c535c';
  ctx.fillRect(-r, wTop, r * 2, wBot - wTop);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(r * 0.45, wTop, r * 0.55, wBot - wTop);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let yy = wTop + r * 0.2; yy < wBot - 1; yy += r * 0.2) {
    ctx.moveTo(-r, yy);
    ctx.lineTo(r, yy);
  }
  ctx.stroke();
  ctx.strokeStyle = '#22272d';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.strokeRect(-r, wTop, r * 2, wBot - wTop);
  // a band in the owner's colour under the eaves
  ctx.fillStyle = colorOf(owner, 60, 0.9);
  ctx.fillRect(-r, wTop, r * 2, r * 0.07);
  // roof
  ctx.fillStyle = '#3c434b';
  ctx.beginPath();
  ctx.moveTo(-r * 1.12, wTop);
  ctx.lineTo(-r * 0.7, -r * 0.62);
  ctx.lineTo(r * 0.7, -r * 0.62);
  ctx.lineTo(r * 1.12, wTop);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const yy = wTop - ((r * 0.42) * i) / 4;
    const half = r * 1.12 - (r * 0.42 * i) / 4;
    ctx.moveTo(-half, yy);
    ctx.lineTo(half, yy);
  }
  ctx.stroke();
  // glowing rune windows
  for (const wx of [-0.62, 0.6]) {
    ctx.fillStyle = '#1b1f24';
    ctx.fillRect(r * wx - r * 0.1, r * 0.02, r * 0.2, r * 0.22);
    ctx.fillStyle = colorOf(owner, 65 + 20 * out, 0.85);
    ctx.fillRect(r * wx - r * 0.065, r * 0.05, r * 0.13, r * 0.16);
  }
  // arched doorway: lit from inside, flaring when a wave marches out
  const dw = r * 0.2;
  const dh = r * 0.55;
  ctx.beginPath();
  ctx.moveTo(-dw, wBot);
  ctx.lineTo(-dw, wBot - dh + dw);
  ctx.arc(0, wBot - dh + dw, dw, Math.PI, 0);
  ctx.lineTo(dw, wBot);
  ctx.closePath();
  ctx.fillStyle = '#1b1f24';
  ctx.fill();
  const dg = ctx.createLinearGradient(0, wBot - dh, 0, wBot);
  dg.addColorStop(0, out > 0 ? '#ffffff' : colorOf(owner, 80, 0.9));
  dg.addColorStop(1, colorOf(owner, 60, 0.15 + 0.5 * out));
  ctx.fillStyle = dg;
  ctx.globalAlpha = 0.6 + 0.4 * out;
  ctx.fill();
  ctx.globalAlpha = 1;
  // crystals growing from the roof ridge
  for (const [cx, cr] of [[-0.45, 0.12], [0.45, 0.12], [0, 0.17]]) {
    drawCrystal(r * cx, -r * 0.68 - (cx ? 0 : r * 0.05), r * cr, owner, out, cx ? 0 : s * 0.2);
  }
  drawCracks(0, r * 0.2, r * 0.6, 1 - t.hp / t.maxHp, t.id);
  if (flip < 1) {
    ctx.globalAlpha = (1 - flip) * 0.8;
    ctx.fillStyle = '#fff';
    roundRect(-r * 1.15, -r * 0.8, r * 2.3, r * 1.55, r * 0.15);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (t.hp / t.maxHp < 0.3) drawSmoke(x, y, r, now, t.id);
  // "+5" tag
  if (s >= 14) label(`+${C.BARRACKS_TROOPS}`, x - r * 1.0, y - r * 0.85, Math.max(9, Math.round(s * 0.32)), '#ffd54f');
}

// A ruin: scattered rubble and a broken stub.
function drawRuin(t, x, y, s) {
  const r = s * 0.5;
  const rnd = hashRand(t.id + 7);
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.2, r * 1.1, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r * (0.3 + rnd() * 0.75);
    ctx.fillStyle = i % 2 ? '#5d574d' : '#6e675b';
    polygon(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.14 + rnd() * 0.16), 5, rnd() * 6);
    ctx.fill();
  }
  ctx.fillStyle = '#4a453d';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.4, y + r * 0.3);
  ctx.lineTo(x - r * 0.4, y - r * 0.2);
  ctx.lineTo(x - r * 0.15, y - r * 0.45);
  ctx.lineTo(x + r * 0.05, y - r * 0.15);
  ctx.lineTo(x + r * 0.25, y - r * 0.35);
  ctx.lineTo(x + r * 0.4, y - r * 0.05);
  ctx.lineTo(x + r * 0.4, y + r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawTowers(dt) {
  const s = scale();
  const now = performance.now();
  const hover = grid.get(`${Math.floor(mouse.wx)},${Math.floor(mouse.wy)}`);
  for (const t of S.towersView.values()) {
    const [x, y] = toScreen(t.x + 0.5, t.y + 0.5);
    if (!onScreen(x, y, s * 3)) continue;
    if (t.ruin || !t.owner) {
      drawRuin(t, x, y, s);
      if (t.id === S.selectedId) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - s / 2, y - s / 2, s, s);
      }
      continue;
    }
    const r = s * 0.62 * (1 + 0.07 * (t.level - 1));
    if (t.id === S.selectedId) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -now / 60;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (t.kind === 'barracks') drawBarracksSprite(t, x, y, s, now);
    else drawTowerSprite(t, x, y, s, now);
    structBar(t, x, y - r * 1.75, s * 1.0, now, t.id === S.selectedId || t.id === hover, dt);
  }
}

export { drawCracks, drawCrystal, drawSmoke, drawTowers, polygon, roundRect, runeEllipse, structBar };
