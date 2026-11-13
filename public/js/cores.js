// Player cores.

import { label, onScreen } from './render.js';
import { S, baseLift, colorOf, ctx, hexSpot, mouse, scale, toScreen } from './state.js';
import { drawCracks, drawCrystal, drawSmoke, polygon, runeEllipse, structBar } from './structures.js';

// A core: a great crystal in the player's colour floating over a stone dais on a rune circle,
// with small shards orbiting it. It cracks and smokes as it takes damage, and flashes when hit;
// it zaps nearby enemy troops with lightning like the towers.
function drawCores(dt) {
  const s = scale();
  const now = performance.now();
  for (const p of S.coresView.values()) {
    const spot = hexSpot(p.x, p.y);
    const [x, y] = toScreen(spot.x, spot.y - baseLift('core'));
    if (!onScreen(x, y, s * 3)) continue;
    const r = s * 0.75;
    const frac = p.hp / p.maxHp;
    const hit = p.hitAt ? Math.max(0, 1 - (now - p.hitAt) / 160) : 0;

    const by = y + r * 0.5; // ground level under the dais
    const flare = p.shotAt && now >= p.shotAt ? Math.max(0, 1 - (now - p.shotAt) / 220) : 0;

    // glow around the crystal
    const bob = Math.sin(now / 500 + p.id) * r * 0.06;
    const cy = y - r * 0.45 + bob;
    const grd = ctx.createRadialGradient(x, cy, r * 0.2, x, cy, r * 2);
    grd.addColorStop(0, colorOf(p.id, 60, 0.5 + 0.3 * flare));
    grd.addColorStop(1, colorOf(p.id, 60, 0));
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, cy, r * 2, 0, Math.PI * 2);
    ctx.fill();

    // shadow, rune circle, dais
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.08, by + r * 0.05, r * 1.25, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    runeEllipse(x, by, r * 1.35, r * 0.55, p.id, now / 4000 + p.id, 0.85);
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.strokeStyle = '#22272d';
    ctx.fillStyle = '#3a4048';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.85, by);
    ctx.lineTo(x - r * 0.62, by - r * 0.36);
    ctx.lineTo(x + r * 0.62, by - r * 0.36);
    ctx.lineTo(x + r * 0.85, by);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(x + r * 0.2, by);
    ctx.lineTo(x + r * 0.15, by - r * 0.36);
    ctx.lineTo(x + r * 0.62, by - r * 0.36);
    ctx.lineTo(x + r * 0.85, by);
    ctx.closePath();
    ctx.fill();
    // top of the dais, glowing in the player's colour
    ctx.fillStyle = '#4c535c';
    ctx.beginPath();
    ctx.ellipse(x, by - r * 0.36, r * 0.62, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colorOf(p.id, 55, 0.45 + 0.25 * flare);
    ctx.beginPath();
    ctx.ellipse(x, by - r * 0.36, r * 0.4, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    // corner studs on the dais front
    for (const k of [-0.6, -0.2, 0.2, 0.6]) {
      ctx.fillStyle = colorOf(p.id, 75, 0.9);
      polygon(x + k * r, by - r * 0.16, Math.max(1.5, s * 0.05), 4, 0);
      ctx.fill();
    }
    drawCracks(x, by - r * 0.18, r * 0.55, 1 - frac, p.id * 31);

    // the crystal, with shards orbiting it (behind first, then in front)
    const orbit = (front) => {
      for (let i = 0; i < 3; i++) {
        const a = now / 1100 + (Math.PI * 2 * i) / 3 + p.id;
        if ((Math.sin(a) > 0) !== front) continue;
        drawCrystal(x + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.3, r * 0.1, p.id, 0);
      }
    };
    orbit(false);
    ctx.shadowColor = colorOf(p.id, 60);
    ctx.shadowBlur = s * (0.3 + 0.15 * Math.sin(now / 350 + p.id) + 0.5 * flare);
    drawCrystal(x, cy, r * 0.5, p.id, Math.max(flare, hit));
    ctx.shadowBlur = 0;
    orbit(true);

    if (frac < 0.35) drawSmoke(x, y, r, now, p.id);

    // jungle buff: a flickering ember ring
    if (p.buff) {
      ctx.strokeStyle = `rgba(255, 140, 50, ${0.55 + 0.25 * Math.sin(now / 120)})`;
      ctx.lineWidth = Math.max(2, s * 0.07);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
      ctx.stroke();
    }

    structBar(p, x, y - r * 1.75, s * 1.6, now, Math.hypot(mouse.wx - p.x - 0.5, mouse.wy - p.y - 0.5) < 1.2, dt);
    label(p.id === S.myId ? `${p.name} (you)` : p.name, x, y - r * 1.98, Math.max(11, Math.round(s * 0.5)), '#fff');

    if (p.shield) {
      // spawn shield: a soft glassy dome over the core, shimmering
      const a = 0.5 + 0.5 * Math.sin(now / 300);
      const dx = x;
      const dy = by - r * 0.15;
      const dr = r * 1.45;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(dx, dy, dr, dr * 1.05, 0, Math.PI, 0);
      ctx.ellipse(dx, dy, dr, dr * 0.4, 0, 0, Math.PI);
      const dg = ctx.createRadialGradient(dx - dr * 0.35, dy - dr * 0.6, dr * 0.1, dx, dy - dr * 0.3, dr * 1.2);
      dg.addColorStop(0, `rgba(190, 225, 255, ${0.16 + 0.06 * a})`);
      dg.addColorStop(1, 'rgba(121, 192, 255, 0.04)');
      ctx.fillStyle = dg;
      ctx.fill();
      ctx.strokeStyle = `rgba(160, 210, 255, ${0.35 + 0.2 * a})`;
      ctx.lineWidth = Math.max(1.5, s * 0.04);
      ctx.stroke();
      ctx.restore();
      label(`🛡 ${p.shield}s`, x, by + r * 0.85, Math.max(10, Math.round(s * 0.36)), '#9ccfff');
    }
  }
}

export { drawCores };
