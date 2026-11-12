// Overlays: build preview, leap zone, order lines and markers, and the minimap.

import { kindsLabel, shareCount } from './bar.js';
import { drawShape, label } from './render.js';
import { S, allKinds, C, canvas, colorOf, ctx, fogCanvas, grid, mctx, mini, mouse, players, scale, selUnits, terr, terrCanvas, toScreen, toWorld } from './state.js';
import { campVerb, isMineTarget, orderTargetAt, targetName, targetPos } from './targets.js';

// ---- leapfrogging: unclaimed tiles within TOWER_LEAP of my land accept towers
let leapZone = new Uint8Array(C.MAP_W * C.MAP_H);

let leapKey = '';

function getLeapZone() {
  const key = `${S.myId}:${S.terrStamp}`;
  if (key === leapKey) return leapZone;
  leapKey = key;
  leapZone = new Uint8Array(C.MAP_W * C.MAP_H);
  if (!S.myId) return leapZone;
  const R = C.TOWER_LEAP;
  for (let y = 0; y < C.MAP_H; y++) {
    for (let x = 0; x < C.MAP_W; x++) {
      if (terr[y * C.MAP_W + x] !== S.myId) continue;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= C.MAP_W || ny >= C.MAP_H || Math.hypot(dx, dy) > R + 0.01) continue;
          const k = ny * C.MAP_W + nx;
          if (terr[k] === 0) leapZone[k] = 1;
        }
      }
    }
  }
  return leapZone;
}

function canBuildAt(x, y) {
  if (!S.me || x < 0 || y < 0 || x >= C.MAP_W || y >= C.MAP_H) return false;
  const k = y * C.MAP_W + x;
  if (terr[k] !== S.myId && (C.TOWERS[S.buildKind]?.ownLandOnly || !getLeapZone()[k])) return false;
  if (grid.has(`${x},${y}`)) return false;
  for (const p of players.values()) if (p.x === x && p.y === y) return false;
  return true;
}

// Land a new tower at (bx, by) would win: mirrors the server's nearest-claim rule
// (cores hold land at half distance, towers at full distance).
function claimPreview(bx, by) {
  const r = C.towerStats(S.buildKind || 'tower', 1).claim + 0.25;
  const R = Math.ceil(r);
  const gained = [];
  const stolen = new Map();
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = bx + dx;
      const y = by + dy;
      const d = Math.hypot(dx, dy);
      if (d > r || x < 0 || y < 0 || x >= C.MAP_W || y >= C.MAP_H) continue;
      const o = terr[y * C.MAP_W + x];
      if (o === S.myId) continue;
      if (o) {
        const core = players.get(o);
        let eff = core ? Math.hypot(core.x - x, core.y - y) * 0.5 : Infinity;
        for (const t of S.towers.values()) {
          if (t.owner !== o) continue;
          const td = Math.hypot(t.x - x, t.y - y);
          if (td <= C.towerStats('tower', t.level).claim + 0.25) eff = Math.min(eff, td);
        }
        if (!(d < eff)) continue;
        stolen.set(o, (stolen.get(o) || 0) + 1);
      }
      gained.push([x, y, o]);
    }
  }
  return { gained, stolen };
}

function drawRange(wx, wy, range, color) {
  if (!range) return;
  const [x, y] = toScreen(wx, wy);
  ctx.fillStyle = color.replace('A', '0.08');
  ctx.strokeStyle = color.replace('A', '0.6');
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, range * scale(), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function clearSelection() {
  S.selectedId = null;
  selUnits.clear();
}

// An animated marker on an order target: red crosshair for attack, green shield ring for defend.
function drawTargetMarker(pos, attack, strong, size = 1) {
  const s = scale() * size;
  const [x, y] = toScreen(pos.x, pos.y);
  const t = performance.now() / 300;
  ctx.save();
  ctx.strokeStyle = attack ? `rgba(255, 82, 82, ${strong ? 0.95 : 0.6})` : `rgba(126, 231, 135, ${strong ? 0.95 : 0.6})`;
  ctx.lineWidth = strong ? 2.5 : 1.5;
  ctx.setLineDash([6, 5]);
  ctx.lineDashOffset = -t * 4;
  ctx.beginPath();
  ctx.arc(x, y, s * 1.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (attack) {
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * s * 1.2, y + Math.sin(a) * s * 1.2);
      ctx.lineTo(x + Math.cos(a) * s * 2, y + Math.sin(a) * s * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawOverlay() {
  const s = scale();
  if (S.selectedId) {
    const t = S.towers.get(S.selectedId);
    if (t && t.owner) {
      const st = C.towerStats(t.kind, t.level);
      drawRange(t.x + 0.5, t.y + 0.5, st.range, 'rgba(255,255,255,A)');
    }
  }

  // Standing order for my waves.
  if (S.myId && S.me && S.me.order) {
    const pos = targetPos(S.me.order.target);
    if (pos) drawTargetMarker(pos, S.me.order.type === 'attack', !selUnits.size);
  }

  // Selected troops: range and a line to where they're headed.
  const shown = new Set();
  for (const id of selUnits) {
    const u = S.units.get(id);
    if (!u) continue;
    if (selUnits.size <= 4) drawRange(u.rx, u.ry, C.towerStats(u.kind, u.level).range, 'rgba(255,255,255,A)');
    const key = u.attack || (u.anchor ? `t:${u.anchor}` : `c:${u.owner}`);
    const pos = targetPos(key);
    if (!pos) continue;
    const [ux, uy] = toScreen(u.rx, u.ry);
    const [ax, ay] = toScreen(pos.x, pos.y);
    ctx.strokeStyle = u.attack ? 'rgba(255,123,114,0.6)' : 'rgba(126,231,135,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ux, uy);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    if (!shown.has(key)) {
      shown.add(key);
      drawTargetMarker(pos, !!u.attack, true, pos.unit ? 0.6 : 1);
    }
  }

  // Enemy troops my troops are hunting get a crosshair (selected or not).
  if (S.myId) {
    for (const u of S.units.values()) {
      if (u.owner !== S.myId || !u.attack || !u.attack.startsWith('u:') || shown.has(u.attack)) continue;
      shown.add(u.attack);
      const pos = targetPos(u.attack);
      if (pos) drawTargetMarker(pos, true, false, 0.6);
    }
  }

  // Hover feedback for right-click orders.
  if (S.myId && !S.buildKind) {
    const tg = orderTargetAt(mouse.wx, mouse.wy);
    if (tg) {
      const pos = targetPos(`${tg.k}:${tg.id}`);
      const mine = isMineTarget(tg);
      const n = shareCount(S.sendShare);
      const kindTxt = allKinds() ? `troop${n === 1 ? '' : 's'}` : kindsLabel(n);
      const who = selUnits.size ? `${selUnits.size} selected` : S.sendShare < 1 ? `${n} ${kindTxt} (${Math.round(S.sendShare * 100)}%)` : `all ${allKinds() ? 'troops' : kindsLabel(2)}`;
      const verb = mine ? 'defend' : tg.k === 'j' ? campVerb(tg.id) : tg.k === 'u' ? `hunt ${targetName(`u:${tg.id}`)}` : 'attack';
      const [hx, hy] = toScreen(pos.x, pos.y);
      if (tg.k === 'u') drawTargetMarker(pos, true, false, 0.6);
      label(`Right-click: ${who} ${verb}`, hx, hy - s * (tg.k === 'u' ? 1.2 : 2.4), 12, mine ? '#7ee787' : '#ffa198');
    }
  }

  if (S.buildKind && S.myId) {
    const tx = Math.floor(mouse.wx);
    const ty = Math.floor(mouse.wy);
    const ok = canBuildAt(tx, ty);
    // Leap zone: unclaimed ground a tower can jump to (barracks stay on your own land).
    const zone = C.TOWERS[S.buildKind].ownLandOnly ? new Uint8Array(0) : getLeapZone();
    const [x0, y0] = toWorld(0, 0);
    const [x1, y1] = toWorld(canvas.width, canvas.height);
    // a soft dot on every tile a tower could leap to
    ctx.fillStyle = 'rgba(255,213,79,0.35)';
    ctx.beginPath();
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(C.MAP_H - 1, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(C.MAP_W - 1, Math.ceil(x1)); x++) {
        if (!zone[y * C.MAP_W + x]) continue;
        const [sx, sy] = toScreen(x + 0.5, y + 0.5);
        ctx.moveTo(sx + s * 0.09, sy);
        ctx.arc(sx, sy, s * 0.09, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    if (ok) {
      const { gained, stolen } = claimPreview(tx, ty);
      for (const [gx, gy, o] of gained) {
        const [sx, sy] = toScreen(gx, gy);
        ctx.fillStyle = o ? 'rgba(255,123,114,0.32)' : 'rgba(126,231,135,0.22)';
        ctx.beginPath();
        ctx.roundRect(sx + 2, sy + 2, s - 4, s - 4, s * 0.25);
        ctx.fill();
      }
      const taken = [...stolen].map(([o, n]) => `${n} from ${(players.get(o) || { name: '?' }).name}`).join(', ');
      const text = `+${gained.length} land${taken ? ` (taking ${taken})` : ''}`;
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(text, mouse.sx + 16, mouse.sy + 24);
      ctx.fillStyle = taken ? '#ffa198' : '#7ee787';
      ctx.fillText(text, mouse.sx + 16, mouse.sy + 24);
    }
    const st = C.towerStats(S.buildKind, 1);
    if (st.range) drawRange(tx + 0.5, ty + 0.5, st.range, ok ? 'rgba(88,166,255,A)' : 'rgba(248,81,73,A)');
    const [x, y] = toScreen(tx + 0.5, ty + 0.5);
    ctx.globalAlpha = 0.6;
    drawShape(S.buildKind, x, y, s * 0.45, ok ? C.TOWERS[S.buildKind].color : '#f85149');
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? '#58a6ff' : '#f85149';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - s / 2, y - s / 2, s, s);
  }
}

function drawMinimap() {
  const W = mini.width;
  const H = mini.height;
  const sx = W / C.MAP_W;
  const sy = H / C.MAP_H;
  mctx.clearRect(0, 0, W, H);
  mctx.drawImage(terrCanvas, 0, 0, W, H);
  if (S.fogOn) mctx.drawImage(fogCanvas, 0, 0, W, H);
  for (const c of S.campsView) {
    if (!c.alive) {
      // where a camp will appear next
      mctx.strokeStyle = 'rgba(201, 166, 107, 0.6)';
      mctx.lineWidth = 1;
      mctx.strokeRect((c.x + 0.5) * sx - 1.5, (c.y + 0.5) * sy - 1.5, 3, 3);
      continue;
    }
    mctx.fillStyle = C.BUFF_CAMPS.includes(c.type) ? '#ffab40' : '#c9a66b';
    mctx.fillRect((c.x + 0.5) * sx - 1.5, (c.y + 0.5) * sy - 1.5, 3, 3);
  }
  for (const u of S.units.values()) {
    mctx.fillStyle = u.owner === S.myId ? '#ffffff' : colorOf(u.owner, 70);
    mctx.fillRect(u.x * sx - 0.75, u.y * sy - 0.75, 1.5, 1.5);
  }
  for (const p of S.coresView.values()) {
    mctx.fillStyle = p.id === S.myId ? '#fff' : colorOf(p.id, 60);
    mctx.beginPath();
    mctx.arc((p.x + 0.5) * sx, (p.y + 0.5) * sy, p.id === S.myId ? 4 : 3, 0, Math.PI * 2);
    mctx.fill();
  }
  if (S.me && S.me.order && S.me.order.type === 'attack') {
    const pos = targetPos(S.me.order.target);
    if (pos) {
      mctx.strokeStyle = '#ff5252';
      mctx.lineWidth = 1.5;
      mctx.beginPath();
      mctx.arc(pos.x * sx, pos.y * sy, 6, 0, Math.PI * 2);
      mctx.stroke();
    }
  }
  const [x0, y0] = toWorld(0, 0);
  const [x1, y1] = toWorld(canvas.width, canvas.height);
  mctx.strokeStyle = 'rgba(255,255,255,0.7)';
  mctx.lineWidth = 1;
  mctx.strokeRect(x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy);
}

export { clearSelection, drawMinimap, drawOverlay };
