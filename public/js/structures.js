// Towers, barracks and ruins: sprites, health bars and build effects.

import { drawTradeSprite } from './trade.js';
import { label, onScreen } from './render.js';
import { S, C, baseLift, colorOf, ctx, hexSpot, mouse, scale, toScreen, towerInHex } from './state.js';

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

// Tower: a wizard tower whose top floats in pieces above its broken stump, held up by magic around
// a crystal that zaps enemy troops with lightning. Higher levels: taller stump with a band and an
// extra fragment (2+), a spinning rune ring (3+), gold runes on the ground (4+), a radiant aura (5).
function drawTowerSprite(t, x, y, s, now) {
  const lvl = t.level;
  const r = s * 0.72 * (1 + 0.07 * (lvl - 1));
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
    const ag = ctx.createRadialGradient(0, -r * 0.9, r * 0.4, 0, -r * 0.9, r * 2);
    ag.addColorStop(0, colorOf(owner, 65, 0.4 + 0.2 * pulse));
    ag.addColorStop(1, colorOf(owner, 65, 0));
    ctx.fillStyle = ag;
    ctx.beginPath();
    ctx.arc(0, -r * 0.9, r * 2, 0, Math.PI * 2);
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

  // plinth
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.strokeStyle = '#22272d';
  ctx.fillStyle = '#3a4048';
  ctx.beginPath();
  ctx.moveTo(-r * 0.58, by);
  ctx.lineTo(-r * 0.46, by - r * 0.2);
  ctx.lineTo(r * 0.46, by - r * 0.2);
  ctx.lineTo(r * 0.58, by);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // the broken stump of the tower, its top jagged where it split
  const flare = t.shotAt && now >= t.shotAt ? Math.max(0, 1 - (now - t.shotAt) / 220) : 0;
  const sBot = by - r * 0.2;
  const sTop = -r * (lvl >= 2 ? 0.3 : 0.15);
  ctx.fillStyle = '#4c535c';
  ctx.beginPath();
  ctx.moveTo(-r * 0.38, sBot);
  ctx.lineTo(-r * 0.34, sTop);
  ctx.lineTo(-r * 0.18, sTop - r * 0.1);
  ctx.lineTo(-r * 0.02, sTop - r * 0.01);
  ctx.lineTo(r * 0.14, sTop - r * 0.13);
  ctx.lineTo(r * 0.34, sTop);
  ctx.lineTo(r * 0.38, sBot);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; // shaded side
  ctx.beginPath();
  ctx.moveTo(r * 0.12, sBot);
  ctx.lineTo(r * 0.12, sTop - r * 0.1);
  ctx.lineTo(r * 0.14, sTop - r * 0.13);
  ctx.lineTo(r * 0.34, sTop);
  ctx.lineTo(r * 0.38, sBot);
  ctx.closePath();
  ctx.fill();
  // mortar lines
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let yy = sBot - r * 0.18; yy > sTop + r * 0.04; yy -= r * 0.18) {
    ctx.moveTo(-r * 0.37, yy);
    ctx.lineTo(r * 0.37, yy);
  }
  ctx.stroke();
  // a band in the owner's colour (level 2+)
  if (lvl >= 2) {
    ctx.fillStyle = colorOf(owner, 60, 0.9);
    ctx.fillRect(-r * 0.36, sTop + r * 0.08, r * 0.72, r * 0.06);
  }
  // arched window, glowing; it flares when the tower fires
  const wy = (sBot + sTop) / 2 + r * 0.05;
  const ww = r * 0.09;
  ctx.fillStyle = '#1b1f24';
  ctx.beginPath();
  ctx.moveTo(-ww, wy + ww * 1.6);
  ctx.lineTo(-ww, wy);
  ctx.arc(0, wy, ww, Math.PI, 0);
  ctx.lineTo(ww, wy + ww * 1.6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = flare > 0 ? '#ffffff' : colorOf(owner, 70, 0.9);
  ctx.beginPath();
  ctx.moveTo(-ww * 0.6, wy + ww * 1.45);
  ctx.lineTo(-ww * 0.6, wy);
  ctx.arc(0, wy, ww * 0.6, Math.PI, 0);
  ctx.lineTo(ww * 0.6, wy + ww * 1.45);
  ctx.closePath();
  ctx.fill();
  drawCracks(0, (sBot + sTop) / 2, r * 0.32, 1 - t.hp / t.maxHp, t.id);

  // the top of the tower, floating in pieces: stone fragments around the crystal and the roof
  // cap hovering above it, all bobbing gently
  const lift = lvl >= 2 ? r * 0.08 : 0;
  const bob = Math.sin(now / 520 + t.id) * r * 0.05;
  const cy = -r * 0.95 - lift + bob;
  const cr = r * (0.24 + 0.03 * Math.min(lvl, 3));
  const frags = lvl >= 2
    ? [[-0.36, 0.3, 0.13, 0], [0.38, 0.26, 0.12, 1.7], [-0.12, 0.42, 0.1, 3.1], [0.16, 0.44, 0.09, 4.4]]
    : [[-0.34, 0.3, 0.13, 0], [0.36, 0.26, 0.12, 1.7], [-0.08, 0.42, 0.1, 3.1]];
  for (const [fx, fy, fw, ph] of frags) {
    const px = r * fx;
    const py = cy + r * fy + Math.sin(now / 600 + ph + t.id) * r * 0.04;
    const w = r * fw;
    ctx.fillStyle = '#5a626b';
    ctx.strokeStyle = '#22272d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px - w, py);
    ctx.lineTo(px - w * 0.2, py - w * 0.75);
    ctx.lineTo(px + w, py - w * 0.1);
    ctx.lineTo(px + w * 0.3, py + w * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // the magic holding it up: a faint glow between the stump and the crystal
  const mg = ctx.createLinearGradient(0, sTop, 0, cy);
  mg.addColorStop(0, colorOf(owner, 65, 0));
  mg.addColorStop(1, colorOf(owner, 65, 0.25 + 0.3 * flare));
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, sTop);
  ctx.lineTo(-r * 0.12, cy);
  ctx.lineTo(r * 0.12, cy);
  ctx.lineTo(r * 0.3, sTop);
  ctx.closePath();
  ctx.fill();
  // level 3+: a spinning ring of runes around the crystal
  if (lvl >= 3) {
    ctx.save();
    ctx.strokeStyle = colorOf(owner, 70, 0.6);
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.setLineDash([s * 0.08, s * 0.08]);
    ctx.lineDashOffset = now / 50;
    ctx.beginPath();
    ctx.ellipse(0, cy + r * 0.05, r * 0.6, r * 0.19, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  drawCrystal(0, cy, cr, owner, flare, s * (0.22 + (lvl >= 3 ? 0.15 * (0.5 + 0.5 * Math.sin(now / 300)) : 0)));
  // the floating roof cap
  const rb = cy - cr * 1.6;
  const rw = r * 0.44;
  const rh = r * 0.58;
  ctx.fillStyle = '#353b42';
  ctx.strokeStyle = '#22272d';
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(-rw, rb);
  ctx.quadraticCurveTo(-rw * 0.3, rb - rh * 0.45, 0, rb - rh);
  ctx.quadraticCurveTo(rw * 0.3, rb - rh * 0.45, rw, rb);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.moveTo(rw * 0.1, rb);
  ctx.quadraticCurveTo(rw * 0.3, rb - rh * 0.45, 0, rb - rh);
  ctx.quadraticCurveTo(rw * 0.3, rb - rh * 0.45, rw, rb);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colorOf(owner, 60, 0.9);
  ctx.fillRect(-rw, rb - r * 0.02, rw * 2, r * 0.05);

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
  const r = s * 0.8;
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
  // "+4" tag
  if (s >= 12) {
    // "+4" badge: troops this barracks adds to every wave
    const bx = x - r * 1.0;
    const by = y - r * 0.82;
    const fs = Math.max(11, Math.round(s * 0.36));
    ctx.font = `800 ${fs}px system-ui, sans-serif`;
    const txt = `+${C.BARRACKS_TROOPS}`;
    const w = ctx.measureText(txt).width + fs * 0.7;
    ctx.fillStyle = 'rgba(13, 17, 23, 0.85)';
    ctx.strokeStyle = 'rgba(255, 213, 79, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx - w / 2, by - fs * 0.7, w, fs * 1.4, fs * 0.7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffd54f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx, by + 0.5);
  }
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
  const hoverT = towerInHex(mouse.wx, mouse.wy);
  const hover = hoverT ? hoverT.id : 0;
  for (const t of S.towersView.values()) {
    // drawn at its hex's centre, lifted so its base sits right on it
    const spot = hexSpot(t.x, t.y);
    const [x, y] = toScreen(spot.x, spot.y - (t.ruin || !t.owner ? 0 : baseLift(t.kind, t.level)));
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
    const r = s * 0.72 * (1 + 0.07 * (t.level - 1));
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
    // a soft pool of the owner's colour on the ground, so buildings stand out from troops
    const gy = y + s * 0.4;
    const gl = ctx.createRadialGradient(x, gy, 0, x, gy, s * 1.4);
    gl.addColorStop(0, colorOf(t.owner, 60, 0.32));
    gl.addColorStop(1, colorOf(t.owner, 60, 0));
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.ellipse(x, gy, s * 1.4, s * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    if (t.kind === 'barracks') drawBarracksSprite(t, x, y, s, now);
    else if (t.kind === 'trade') drawTradeSprite(t, x, y, s, now);
    else drawTowerSprite(t, x, y, s, now);
    structBar(t, x, y - r * (t.kind === 'tower' ? 2.1 : 1.4), s * 1.0, now, t.id === S.selectedId || t.id === hover, dt);
  }
}

export { drawCracks, drawCrystal, drawSmoke, drawTowers, polygon, roundRect, runeEllipse, structBar };
