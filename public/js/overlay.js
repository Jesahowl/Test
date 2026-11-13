// Overlays: build preview, leap zone, order lines and markers, and the minimap.

import { squadsLabel } from './bar.js';
import { drawShape, label } from './render.js';
import { S, C, canvas, colorOf, ctx, FOG_PAD, fogSoft, grid, mctx, mini, mouse, players, scale, selUnits, terr, terrCanvas, toScreen, toWorld } from './state.js';
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
  return !nearEnemyBuilding(x, y);
}

// Mirrors the server: no building within ENEMY_BUILD_GAP tiles of another player's building or core.
function nearEnemyBuilding(x, y) {
  const gap = C.ENEMY_BUILD_GAP;
  for (const t of S.towers.values()) if (t.owner && t.owner !== S.myId && Math.hypot(t.x - x, t.y - y) < gap) return true;
  for (const p of players.values()) if (p.id !== S.myId && Math.hypot(p.x - x, p.y - y) < gap) return true;
  return false;
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

  // Each squad's standing order, tagged with the squad numbers going there.
  if (S.myId && S.me && S.me.squads) {
    const byTarget = new Map();
    S.me.squads.forEach((sq, i) => {
      const [type, key] = sq.o.split(' ');
      const k = `${type} ${key}`;
      if (!byTarget.has(k)) byTarget.set(k, { type, key, nums: [] });
      byTarget.get(k).nums.push(i);
    });
    for (const { type, key, nums } of byTarget.values()) {
      if (type === 'defend' && key === `c:${S.myId}`) continue; // home: nothing to point out
      const pos = targetPos(key);
      if (!pos) continue;
      const picked = nums.some((i) => S.selSquads.has(i)) && !selUnits.size;
      drawTargetMarker(pos, type === 'attack', picked);
      const [mx, my] = toScreen(pos.x, pos.y);
      label(nums.map((i) => i + 1).join(' '), mx + s * 1.2, my + s * 1.2, 11, picked ? '#ffd54f' : 'rgba(230,237,243,0.7)');
    }
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
      const who = selUnits.size ? `${selUnits.size} picked troop${selUnits.size === 1 ? '' : 's'}` : squadsLabel();
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
    // soft dots on the tiles a tower could leap to, only around the cursor (fading with distance)
    const DOTS = 6;
    for (let y = Math.max(0, ty - DOTS); y <= Math.min(C.MAP_H - 1, ty + DOTS); y++) {
      for (let x = Math.max(0, tx - DOTS); x <= Math.min(C.MAP_W - 1, tx + DOTS); x++) {
        if (!zone[y * C.MAP_W + x]) continue;
        const d = Math.hypot(x - tx, y - ty);
        if (d > DOTS) continue;
        const [sx, sy] = toScreen(x + 0.5, y + 0.5);
        ctx.fillStyle = `rgba(255,213,79,${0.45 * (1 - d / (DOTS + 0.5))})`;
        ctx.beginPath();
        ctx.arc(sx, sy, s * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
    }
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
    } else if (S.me && tx >= 0 && ty >= 0 && tx < C.MAP_W && ty < C.MAP_H && nearEnemyBuilding(tx, ty)) {
      label('Too close to an enemy building', mouse.sx + 16 + 95, mouse.sy + 26, 12, '#ffa198');
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
  if (S.fogOn) mctx.drawImage(fogSoft, -FOG_PAD * sx, -FOG_PAD * sy, (C.MAP_W + FOG_PAD * 2) * sx, (C.MAP_H + FOG_PAD * 2) * sy);
  const now = performance.now();
  // camps: a little tent (the Warlord's Fort in orange, with a glow); upcoming ones as an outline
  for (const c of S.campsView) {
    const cx = (c.x + 0.5) * sx;
    const cy = (c.y + 0.5) * sy;
    const big = C.BUFF_CAMPS.includes(c.type);
    const t = big ? 4.5 : 3.5;
    if (big && c.alive) {
      mctx.fillStyle = 'rgba(255, 140, 40, 0.3)';
      mctx.beginPath();
      mctx.arc(cx, cy, 6, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.beginPath();
    mctx.moveTo(cx, cy - t);
    mctx.lineTo(cx + t, cy + t * 0.8);
    mctx.lineTo(cx - t, cy + t * 0.8);
    mctx.closePath();
    if (c.alive) {
      mctx.fillStyle = big ? '#ffab40' : '#d9b77e';
      mctx.fill();
    } else {
      mctx.strokeStyle = 'rgba(201, 166, 107, 0.55)';
      mctx.lineWidth = 1;
      mctx.stroke();
    }
  }
  // towers and barracks: small squares in the owner's colour
  for (const t of S.towersView.values()) {
    if (!t.owner) continue;
    mctx.fillStyle = colorOf(t.owner, 72);
    mctx.strokeStyle = 'rgba(0,0,0,0.7)';
    mctx.lineWidth = 1;
    const tx = (t.x + 0.5) * sx;
    const ty = (t.y + 0.5) * sy;
    mctx.fillRect(tx - 1.6, ty - 1.6, 3.2, 3.2);
    mctx.strokeRect(tx - 1.6, ty - 1.6, 3.2, 3.2);
  }
  for (const u of S.units.values()) {
    mctx.fillStyle = u.owner === S.myId ? '#ffffff' : colorOf(u.owner, 72);
    mctx.fillRect(u.x * sx - 0.8, u.y * sy - 0.8, 1.6, 1.6);
  }
  // cores: enemy cores as diamonds; mine white with a pulsing ring so it's easy to find
  for (const p of S.coresView.values()) {
    const px = (p.x + 0.5) * sx;
    const py = (p.y + 0.5) * sy;
    if (p.id === S.myId) {
      const pulse = (now % 1600) / 1600;
      mctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * (1 - pulse)})`;
      mctx.lineWidth = 1.5;
      mctx.beginPath();
      mctx.arc(px, py, 4 + pulse * 7, 0, Math.PI * 2);
      mctx.stroke();
      mctx.fillStyle = '#ffffff';
      mctx.beginPath();
      mctx.arc(px, py, 3.5, 0, Math.PI * 2);
      mctx.fill();
    } else {
      mctx.fillStyle = colorOf(p.id, 62);
      mctx.strokeStyle = 'rgba(0,0,0,0.8)';
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.moveTo(px, py - 4.5);
      mctx.lineTo(px + 4.5, py);
      mctx.lineTo(px, py + 4.5);
      mctx.lineTo(px - 4.5, py);
      mctx.closePath();
      mctx.fill();
      mctx.stroke();
    }
  }
  for (const sq of (S.me && S.me.squads) || []) {
    const [type, key] = sq.o.split(' ');
    const pos = type === 'attack' && targetPos(key);
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
