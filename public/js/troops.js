// Troops on the map.

import { interpPos, renderTime } from './net.js';
import { hpBar, lungeOffset, onScreen } from './render.js';
import { S, C, ctx, grid, players, scale, selUnits, toScreen } from './state.js';
import { drawTroop } from './chibi.js';
import { squadPicked } from './squads.js';
import { drawCaravan } from './trade.js';

// Is this spot on top of a tower, barracks or core (their drawings are about 2 tiles wide)?
function overBuilding(wx, wy) {
  const tx = Math.floor(wx);
  const ty = Math.floor(wy);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const id = grid.get(`${tx + dx},${ty + dy}`);
      if (id && S.towers.has(id) && Math.hypot(wx - (tx + dx + 0.5), wy - (ty + dy + 0.5)) < 1.0) return true;
    }
  }
  for (const p of players.values()) if (Math.hypot(wx - p.x - 0.5, wy - p.y - 0.5) < 1.2) return true;
  return false;
}

function drawUnits(dt) {
  const now = performance.now();
  const s = scale();
  const rt = renderTime();
  for (const u of S.units.values()) {
    const r = s * 0.34 * (C.UNITS[u.kind].size || 1);
    const px = u.rx;
    const py = u.ry;
    [u.rx, u.ry] = interpPos(u, rt);
    if (u.kind === 'caravan') {
      // faces the way it's rolling; wheels and legs move only while it does
      if (px !== undefined) {
        const dx = u.rx - px;
        u.moving = Math.hypot(dx, u.ry - py) > 1e-4;
        if (Math.abs(dx) > 1e-4) u.face = dx > 0 ? 1 : -1;
      }
      const [cx, cy] = toScreen(u.rx, u.ry);
      if (!onScreen(cx, cy, s * 2)) continue;
      drawCaravan(u, cx, cy, s, now);
      hpBar(cx, cy - s * 0.95, s * 1.1, u.hp / u.maxHp);
      continue;
    }
    // face the way it's walking (or swinging); bob a little while it walks
    if (px !== undefined) {
      const dx = u.rx - px;
      u.moving = Math.hypot(dx, u.ry - py) > 1e-4;
      if (Math.abs(dx) > 2e-4) u.face = dx > 0 ? 1 : -1;
    }
    const [lx, ly] = lungeOffset(u.id, u.rx, u.ry, now);
    if (Math.abs(lx) > 0.02) u.face = lx > 0 ? 1 : -1;
    const [x, y] = toScreen(u.rx + lx, u.ry + ly);
    if (!onScreen(x, y, s)) continue;
    const mine = u.owner === S.myId;
    // troops standing on a building are drawn see-through, so the building still shows
    const onBuilding = !selUnits.has(u.id) && overBuilding(u.rx, u.ry);
    if (onBuilding) ctx.globalAlpha = 0.6;
    // picked single troops: white ring; troops of the picked squads (when not all): gold ring
    const picked = selUnits.has(u.id) || S.selWorker === u.id;
    const inSquad = mine && !selUnits.size && squadPicked(u.sq);
    if (picked || inSquad) {
      // a ring on the ground round its feet
      ctx.strokeStyle = picked ? '#fff' : 'rgba(255, 213, 79, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y + r * 1.25, r * 1.3, r * 0.55, 0, 0, Math.PI * 2);
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
    // workers bob as they hammer, chop or hoe; troops as they march
    const bob = u.working ? -Math.abs(Math.sin(now / 160 + u.id)) * r * 0.16 : u.moving ? -Math.abs(Math.sin(now / 95 + u.id)) * r * 0.12 : 0;
    const look = u.kind === 'worker' ? `worker${u.job}${u.carry ? 'c' : ''}` : u.kind;
    drawTroop(ctx, look, u.owner, x, y + bob, r * (u.kind === 'worker' ? 0.95 : 1.12), u.face || 1);
    for (let i = 0; i < (u.kind === 'worker' ? 0 : u.level); i++) {
      ctx.fillStyle = '#ffd54f';
      ctx.beginPath();
      ctx.arc(x + (i - (u.level - 1) / 2) * r * 0.42, y + r * 1.45, Math.max(1.5, s * 0.055), 0, Math.PI * 2);
      ctx.fill();
    }
    hpBar(x, y - r * 1.7, s * 0.7, u.hp / u.maxHp);
    ctx.globalAlpha = 1;
  }
}

export { drawUnits };
