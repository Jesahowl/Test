// Troops on the map.

import { interpPos, renderTime } from './net.js';
import { drawShape, hpBar, onScreen } from './render.js';
import { S, C, colorOf, ctx, players, scale, selUnits, toScreen } from './state.js';

function drawUnits(dt) {
  const s = scale();
  const rt = renderTime();
  for (const u of S.units.values()) {
    const r = s * 0.34 * (C.UNITS[u.kind].size || 1);
    [u.rx, u.ry] = interpPos(u, rt);
    const [x, y] = toScreen(u.rx, u.ry);
    if (!onScreen(x, y, s)) continue;
    if (selUnits.has(u.id)) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
      ctx.stroke();
    }
    const op = players.get(u.owner);
    if (op && op.buff) {
      // jungle buff: flickering ember aura
      const fl = 0.5 + 0.3 * Math.sin(performance.now() / 90 + u.id);
      ctx.fillStyle = `rgba(255, 120, 40, ${0.35 * fl})`;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 170, 60, ${fl})`;
      ctx.lineWidth = Math.max(1.5, s * 0.05);
      ctx.stroke();
    }
    ctx.fillStyle = colorOf(u.owner, 30, 0.9);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colorOf(u.owner, 60);
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    ctx.stroke();
    drawShape(u.kind, x, y, r, C.UNITS[u.kind].color);
    for (let i = 0; i < u.level; i++) {
      ctx.fillStyle = '#ffd54f';
      ctx.beginPath();
      ctx.arc(x + (i - (u.level - 1) / 2) * r * 0.42, y + r * 1.1, Math.max(1.5, s * 0.055), 0, Math.PI * 2);
      ctx.fill();
    }
    hpBar(x, y - r * 1.6, s * 0.7, u.hp / u.maxHp);
  }
}

export { drawUnits };
