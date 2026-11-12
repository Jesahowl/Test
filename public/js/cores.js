// Player cores.

import { label, onScreen } from './render.js';
import { S, colorOf, ctx, mouse, scale, toScreen } from './state.js';
import { drawCracks, drawSmoke, polygon, structBar } from './structures.js';

// A core: a stone platform with a turning rune ring and a floating crystal in the player's colour.
// It cracks and smokes as it takes damage, and flashes when hit.
function drawCores(dt) {
  const s = scale();
  const now = performance.now();
  for (const p of S.coresView.values()) {
    const [x, y] = toScreen(p.x + 0.5, p.y + 0.5);
    if (!onScreen(x, y, s * 3)) continue;
    const r = s * 0.75;
    const frac = p.hp / p.maxHp;
    const hit = p.hitAt ? Math.max(0, 1 - (now - p.hitAt) / 160) : 0;

    // glow
    const grd = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2);
    grd.addColorStop(0, colorOf(p.id, 60, 0.55));
    grd.addColorStop(1, colorOf(p.id, 60, 0));
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, y, r * 2, 0, Math.PI * 2);
    ctx.fill();

    // shadow and platform
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.1, y + r * 0.25, r * 1.15, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    polygon(x, y, r * 1.08, 8, Math.PI / 8);
    ctx.fillStyle = '#4d4a44';
    ctx.fill();
    ctx.strokeStyle = colorOf(p.id, 62);
    ctx.lineWidth = Math.max(2, s * 0.09);
    ctx.stroke();
    polygon(x, y, r * 0.86, 8, Math.PI / 8);
    ctx.fillStyle = colorOf(p.id, 22);
    ctx.fill();
    // corner studs
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (Math.PI / 4) * i;
      ctx.fillStyle = '#c9bca3';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 1.08, y + Math.sin(a) * r * 1.08, Math.max(1.5, s * 0.06), 0, Math.PI * 2);
      ctx.fill();
    }

    // turning rune ring
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(now / 4000);
    ctx.strokeStyle = colorOf(p.id, 70, 0.8);
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.setLineDash([s * 0.18, s * 0.12]);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i;
      ctx.fillStyle = colorOf(p.id, 75);
      polygon(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, Math.max(2, s * 0.08), 4, a);
      ctx.fill();
    }
    ctx.restore();
    drawCracks(x, y, r * 0.9, 1 - frac, p.id * 31);

    // floating crystal
    const bob = Math.sin(now / 500 + p.id) * r * 0.07;
    const cy = y - r * 0.12 + bob;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.18, r * 0.3, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    const cg = ctx.createLinearGradient(x - r * 0.3, cy - r * 0.5, x + r * 0.3, cy + r * 0.4);
    cg.addColorStop(0, colorOf(p.id, 85));
    cg.addColorStop(0.5, colorOf(p.id, 58));
    cg.addColorStop(1, colorOf(p.id, 32));
    ctx.fillStyle = cg;
    ctx.shadowColor = colorOf(p.id, 60);
    ctx.shadowBlur = s * (0.3 + 0.15 * Math.sin(now / 350 + p.id) + (p.shotAt && now - p.shotAt < 200 ? 0.5 : 0));
    ctx.beginPath();
    ctx.moveTo(x, cy - r * 0.62);
    ctx.lineTo(x + r * 0.3, cy - r * 0.05);
    ctx.lineTo(x, cy + r * 0.38);
    ctx.lineTo(x - r * 0.3, cy - r * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.moveTo(x, cy - r * 0.62);
    ctx.lineTo(x + r * 0.3, cy - r * 0.05);
    ctx.lineTo(x, cy - r * 0.1);
    ctx.closePath();
    ctx.fill();

    if (hit > 0) {
      ctx.globalAlpha = hit * 0.6;
      ctx.fillStyle = '#fff';
      polygon(x, y, r * 1.08, 8, Math.PI / 8);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (frac < 0.35) drawSmoke(x, y, r, now, p.id);

    // jungle buff: a flickering ember ring
    if (p.buff) {
      ctx.strokeStyle = `rgba(255, 140, 50, ${0.55 + 0.25 * Math.sin(now / 120)})`;
      ctx.lineWidth = Math.max(2, s * 0.07);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
      ctx.stroke();
    }

    structBar(p, x, y - r * 1.55, s * 1.6, now, Math.hypot(mouse.wx - p.x - 0.5, mouse.wy - p.y - 0.5) < 1.2, dt);
    label(p.id === S.myId ? `${p.name} (you)` : p.name, x, y - r * 1.75, Math.max(11, Math.round(s * 0.5)), '#fff');

    if (p.shield) {
      // spawn shield: a shimmering hex bubble
      const a = 0.35 + 0.2 * Math.sin(now / 250);
      ctx.strokeStyle = `rgba(121, 192, 255, ${a + 0.2})`;
      ctx.fillStyle = `rgba(121, 192, 255, ${a * 0.25})`;
      ctx.lineWidth = 2;
      polygon(x, y, r * 1.75, 6, now / 5000);
      ctx.fill();
      ctx.stroke();
      label(`protected ${p.shield}s`, x, y + r * 2.4, Math.max(10, Math.round(s * 0.38)), '#79c0ff');
    }
  }
}

export { drawCores };
