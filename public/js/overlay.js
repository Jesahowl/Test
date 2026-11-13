// Overlays: build and land previews, order lines and markers, and the minimap.

import { squadsLabel } from './bar.js';
import { mySquads, squadPicked } from './squads.js';
import { drawShape, label } from './render.js';
import { S, C, canvas, colorOf, ctx, FOG_PAD, fogSoft, grid, mctx, mini, mouse, players, scale, selUnits, terr, terrCanvas, toScreen, toWorld } from './state.js';
import { campVerb, isMineTarget, orderTargetAt, targetName, targetPos } from './targets.js';
import { drawLandMode } from './land.js';

// ---- building preview. Buildings go on my own land with a ring of my land around them (3x3).
function ownsBlock(x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= C.MAP_W || ny >= C.MAP_H || terr[ny * C.MAP_W + nx] !== S.myId) return false;
    }
  }
  return true;
}

// Why a building can't go at (x, y), or null if it can.
function buildProblem(x, y) {
  if (!S.me || x < 0 || y < 0 || x >= C.MAP_W || y >= C.MAP_H) return 'Out of bounds';
  if (grid.has(`${x},${y}`)) return 'Something is already here';
  for (const p of players.values()) if (p.x === x && p.y === y) return 'Something is already here';
  if (!ownsBlock(x, y)) return terr[y * C.MAP_W + x] === S.myId ? 'Too close to your border: build a tile further in' : 'Build on your own land (press L to buy more)';
  if (nearEnemyBuilding(x, y)) return 'Too close to an enemy building';
  return null;
}

// Mirrors the server: no building within ENEMY_BUILD_GAP tiles of another player's building or core.
function nearEnemyBuilding(x, y) {
  const gap = C.ENEMY_BUILD_GAP;
  for (const t of S.towers.values()) if (t.owner && t.owner !== S.myId && Math.hypot(t.x - x, t.y - y) < gap) return true;
  for (const p of players.values()) if (p.id !== S.myId && Math.hypot(p.x - x, p.y - y) < gap) return true;
  return false;
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

// Things a squad's number tag must not cover, in screen space: enemy troops, barbarians and
// buildings (with their name/health bar above). Built once per frame.
function tagObstacles(s) {
  const obs = [];
  const add = (wx, wy, r) => {
    const [x, y] = toScreen(wx, wy);
    if (x > -60 && y > -60 && x < canvas.width + 60 && y < canvas.height + 60) obs.push({ x, y, r });
  };
  for (const u of S.units.values()) if (u.owner !== S.myId) add(u.rx ?? u.x, u.ry ?? u.y, s * 0.45);
  for (const c of S.creeps.values()) add(c.rx ?? c.x, c.ry ?? c.y, s * 0.5);
  for (const t of S.towersView.values()) {
    add(t.x + 0.5, t.y + 0.5, s * 0.85);
    add(t.x + 0.5, t.y - 0.5, s * 0.75); // its floating top / health bar
  }
  for (const p of S.coresView.values()) {
    add(p.x + 0.5, p.y + 0.5, s * 1.05);
    add(p.x + 0.5, p.y - 0.9, s * 1.0); // name and health bar
  }
  return obs;
}

const rectHitsCircle = (r, c) => {
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  return Math.hypot(nx - c.x, ny - c.y) < c.r;
};
const rectsHit = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

// A squad's number in a little flag above the group, so you can see and click squads at a glance.
// Gold when it's one of the squads your orders go to. It moves to a free spot nearby (with a thin
// line back to its squad) rather than cover another tag, an enemy or a building.
function drawSquadTag(q, s, obs, placed) {
  const [ax, ay] = toScreen(q.cx, q.top);
  const picked = squadPicked(q.id) && !selUnits.size;
  const fs = Math.max(10, Math.min(15, Math.round(s * 0.36)));
  ctx.font = `800 ${fs}px system-ui, sans-serif`;
  const txt = String(q.num);
  const w = Math.max(fs * 1.35, ctx.measureText(txt).width + fs * 0.7);
  const h = fs * 1.3;
  const up = s * 0.75;
  // candidate spots: above, then up-left/up-right, the sides, higher up, and below
  const cands = [[0, -up], [-w * 1.1, -up], [w * 1.1, -up], [0, -up - h * 1.2], [-w * 1.2, 0], [w * 1.2, 0],
    [-w * 1.1, -up - h * 1.2], [w * 1.1, -up - h * 1.2], [0, -up - h * 2.4], [0, s * 0.9]];
  let x = ax;
  let y = ay - up;
  let moved = false;
  for (let i = 0; i < cands.length; i++) {
    const cx = ax + cands[i][0];
    const cy = ay + cands[i][1];
    const r = { x: cx - w / 2 - 2, y: cy - h / 2 - 2, w: w + 4, h: h + 4 };
    if (placed.some((p) => rectsHit(r, p)) || obs.some((o) => rectHitsCircle(r, o))) continue;
    x = cx;
    y = cy;
    moved = i > 0;
    break;
  }
  placed.push({ x: x - w / 2 - 2, y: y - h / 2 - 2, w: w + 4, h: h + 4 });
  if (moved) {
    ctx.strokeStyle = picked ? 'rgba(255, 213, 79, 0.7)' : 'rgba(230, 237, 243, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + (y < ay ? h / 2 : -h / 2));
    ctx.lineTo(ax, ay - s * 0.25);
    ctx.stroke();
  }
  ctx.fillStyle = picked ? '#ffd54f' : 'rgba(13, 17, 23, 0.85)';
  ctx.strokeStyle = picked ? '#fff3c4' : 'rgba(230, 237, 243, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h * 0.3);
  ctx.fill();
  ctx.stroke();
  if (!moved) {
    // a little pointer down to the squad
    ctx.beginPath();
    ctx.moveTo(x - fs * 0.25, y + h / 2);
    ctx.lineTo(x, y + h / 2 + fs * 0.3);
    ctx.lineTo(x + fs * 0.25, y + h / 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = picked ? '#1a1505' : '#e6edf3';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(txt, x, y + 0.5);
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

  // Where my squads are headed (tagged with their numbers), and each squad's number over it.
  if (S.myId && S.me && S.me.squads) {
    const squads = mySquads();
    const byTarget = new Map();
    for (const q of squads) {
      if (!byTarget.has(q.status)) byTarget.set(q.status, []);
      byTarget.get(q.status).push(q);
    }
    for (const [status, list] of byTarget) {
      const [type, key] = status.split(' ');
      if (type === 'defend' && key === `c:${S.myId}`) continue; // home: nothing to point out
      const pos = targetPos(key);
      if (!pos) continue;
      const picked = list.some((q) => squadPicked(q.id)) && !selUnits.size;
      drawTargetMarker(pos, type === 'attack', picked);
      const [mx, my] = toScreen(pos.x, pos.y);
      label(list.map((q) => q.num).join(' '), mx + s * 1.2, my + s * 1.2, 11, picked ? '#ffd54f' : 'rgba(230,237,243,0.7)');
    }
    if (s >= 12 && squads.length) {
      const obs = tagObstacles(s);
      const placed = [];
      // picked squads first, so they get the best spots
      for (const q of [...squads].sort((x, y) => squadPicked(y.id) - squadPicked(x.id))) drawSquadTag(q, s, obs, placed);
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

  if (S.buildKind === 'land' && S.myId) {
    drawLandMode();
    return;
  }
  if (S.buildKind && S.myId) {
    const tx = Math.floor(mouse.wx);
    const ty = Math.floor(mouse.wy);
    const problem = buildProblem(tx, ty);
    const ok = !problem;
    // the 3x3 of my land the building needs
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= C.MAP_W || ny >= C.MAP_H) continue;
        const [sx, sy] = toScreen(nx, ny);
        ctx.fillStyle = terr[ny * C.MAP_W + nx] === S.myId ? 'rgba(126,231,135,0.18)' : 'rgba(248,81,73,0.3)';
        ctx.fillRect(sx + 1, sy + 1, s - 2, s - 2);
      }
    }
    if (problem) label(problem, mouse.sx + 22 + problem.length * 3.2, mouse.sy + 26, 12, '#ffa198');
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
  const attacked = new Set(S.me && S.me.squads ? mySquads().map((q) => q.status).filter((st) => st.startsWith('attack')) : []);
  for (const st of attacked) {
    const pos = targetPos(st.split(' ')[1]);
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
