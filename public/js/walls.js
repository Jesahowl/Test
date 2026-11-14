// Walls in the browser: drawing them along hex edges (palisade, stone, rune wall; gates), building
// them by dragging along your border (press V), and the panel for a selected wall.

import { label } from './render.js';
import { escapeHtml, toast } from './screens.js';
import { sendMsg } from './net.js';
import { S, $, C, colorOf, ctx, explored, HEX, mouse, players, scale, terr, toScreen } from './state.js';
import { iconURL } from './ui.js';

const OUT = '#22272d';
const TIER = ['Palisade', 'Stone wall', 'Rune wall'];

S.walls = new Map();
S.wallDrag = null; // { list: [[a, b]...], set: Set of keys } while dragging
S.selWall = null;

const ownerOfHex = (i) => terr[HEX.hexes[i].tiles[0]];
const keyOf = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

// Which edge of hex a faces hex b (corners k and k+1), or -1.
function edgeIndex(a, b) {
  const h = HEX.hexes[a];
  for (let k = 0; k < 6; k++) if (HEX.across(h, k) === b) return k;
  return -1;
}

// The two end points of the edge between hexes a and b (world coords).
function edgeEnds(a, b) {
  const k = edgeIndex(a, b);
  if (k < 0) return null;
  const cs = HEX.corners(HEX.hexes[a]);
  return [cs[k], cs[(k + 1) % 6]];
}

function wallAtEdge(a, b) {
  for (const w of S.walls.values()) if ((w.a === a && w.b === b) || (w.a === b && w.b === a)) return w;
  return null;
}

// The hex edge nearest world point (wx, wy), within `reach` tiles: { a (the hex it's in), b, d } or null.
function edgeNear(wx, wy, reach = 0.8) {
  if (wx < 0 || wy < 0 || wx >= C.MAP_W || wy >= C.MAP_H) return null;
  const a = HEX.at(wx, wy);
  if (a < 0) return null;
  const cs = HEX.corners(HEX.hexes[a]);
  let best = null;
  for (let k = 0; k < 6; k++) {
    const [x1, y1] = cs[k];
    const [x2, y2] = cs[(k + 1) % 6];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((wx - x1) * dx + (wy - y1) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(wx - x1 - dx * t, wy - y1 - dy * t);
    if (d > reach || (best && d >= best.d)) continue;
    const b = HEX.across(HEX.hexes[a], k);
    if (b < 0) continue;
    best = { a, b, d };
  }
  return best;
}

// Can I wall the edge a-b: exactly one side mine, no wall there yet (mirrors the server).
function canWall(a, b, pending) {
  if (a < 0 || b < 0) return false;
  if ((ownerOfHex(a) === S.myId) === (ownerOfHex(b) === S.myId)) return false;
  if (pending && pending.has(keyOf(a, b))) return false;
  return !wallAtEdge(a, b);
}

// ---- build mode
function wallDown() {
  S.wallDrag = { list: [], set: new Set() };
  wallMove();
}

function wallMove() {
  const d = S.wallDrag;
  if (!d) return;
  const e = edgeNear(mouse.wx, mouse.wy);
  if (!e || !canWall(e.a, e.b, d.set)) return;
  if ((d.list.length + 1) * C.WALL_COST > (S.me ? S.me.gold : 0)) return;
  d.list.push([e.a, e.b]);
  d.set.add(keyOf(e.a, e.b));
}

function wallUp() {
  const d = S.wallDrag;
  S.wallDrag = null;
  if (d && d.list.length) sendMsg({ t: 'walls', edges: d.list });
}

// ---- drawing

// One wall segment from world point A to B (A, B: [x, y]). style 0 palisade, 1 stone, 2 rune.
function drawSegment(A, B, w, s, now, ghost) {
  const [ax, ay] = toScreen(A[0], A[1]);
  const [bx, by] = toScreen(B[0], B[1]);
  const len = Math.hypot(bx - ax, by - ay);
  const lw = Math.max(1, s * 0.05);
  const style = w.level - 1;
  const ht = s * (style === 0 ? 0.62 : 0.55); // height of the wall on screen
  const owner = w.owner;
  const dmg = w.maxHp ? 1 - w.hp / w.maxHp : 0;
  if (ghost) ctx.globalAlpha = 0.45;
  if (w.gate) {
    drawGate(ax, ay, bx, by, w, s, lw, ht);
    ctx.globalAlpha = 1;
    return;
  }
  if (style === 0) {
    // wooden palisade: pointed stakes with a rope band in the owner's colour
    const n = Math.max(3, Math.round(len / (s * 0.24)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const sh = ht * (0.85 + 0.15 * Math.sin(i * 2.7 + w.id));
      const hw = s * 0.11;
      ctx.fillStyle = i % 2 ? '#7a5434' : '#9a7048';
      ctx.strokeStyle = OUT;
      ctx.lineWidth = Math.max(0.8, lw * 0.7);
      ctx.beginPath();
      ctx.moveTo(x - hw, y + hw * 0.8);
      ctx.lineTo(x - hw, y - sh);
      ctx.lineTo(x, y - sh - s * 0.16);
      ctx.lineTo(x + hw, y - sh);
      ctx.lineTo(x + hw, y + hw * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.strokeStyle = colorOf(owner, 55);
    ctx.lineWidth = Math.max(1.2, s * 0.08);
    ctx.beginPath();
    ctx.moveTo(ax, ay - ht * 0.45);
    ctx.lineTo(bx, by - ht * 0.45);
    ctx.stroke();
  } else {
    // stone: a front face, a top face and battlements; the rune wall glows in the owner's colour
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const th = s * 0.2;
    const nx = -uy * th / 2;
    const ny = ux * th / 2;
    const A0 = [ax - nx, ay - ny];
    const B0 = [bx - nx, by - ny];
    const A1 = [ax + nx, ay + ny];
    const B1 = [bx + nx, by + ny];
    const up = (p, h = ht) => [p[0], p[1] - h];
    const quad = (pts, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = OUT;
      ctx.lineWidth = lw;
      ctx.stroke();
    };
    quad([A1, B1, up(B1), up(A1)], style === 2 ? '#4a525c' : '#5a626c');
    quad([up(A0), up(B0), up(B1), up(A1)], '#79828d');
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(A1[0], A1[1] - ht / 2);
    ctx.lineTo(B1[0], B1[1] - ht / 2);
    ctx.stroke();
    const n = Math.max(2, Math.round(len / (s * 0.4)));
    for (let i = 0; i < n; i++) {
      const t1 = (i + 0.25) / n;
      const t2 = (i + 0.65) / n;
      const p1 = [A1[0] + (B1[0] - A1[0]) * t1, A1[1] + (B1[1] - A1[1]) * t1 - ht];
      const p2 = [A1[0] + (B1[0] - A1[0]) * t2, A1[1] + (B1[1] - A1[1]) * t2 - ht];
      quad([p1, p2, [p2[0], p2[1] - s * 0.16], [p1[0], p1[1] - s * 0.16]], '#79828d');
    }
    if (style === 2) {
      ctx.strokeStyle = colorOf(owner, 70, 0.9);
      ctx.lineWidth = Math.max(1, s * 0.07);
      ctx.beginPath();
      ctx.moveTo(A1[0], A1[1] - s * 0.08);
      ctx.lineTo(B1[0], B1[1] - s * 0.08);
      ctx.stroke();
      const pulse = 0.75 + 0.25 * Math.sin(now / 500 + w.id);
      for (let i = 0; i < 2; i++) {
        const t = (i + 0.5) / 2;
        const x = A1[0] + (B1[0] - A1[0]) * t;
        const y = A1[1] + (B1[1] - A1[1]) * t - ht * 0.55;
        const g = ctx.createRadialGradient(x, y, 0, x, y, s * 0.35);
        g.addColorStop(0, colorOf(owner, 70, 0.7 * pulse));
        g.addColorStop(1, colorOf(owner, 70, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, s * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colorOf(owner, 85);
        ctx.beginPath();
        ctx.moveTo(x, y - s * 0.15);
        ctx.lineTo(x + s * 0.1, y);
        ctx.lineTo(x, y + s * 0.15);
        ctx.lineTo(x - s * 0.1, y);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  if (dmg > 0.35) {
    // cracks
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2 - ht * 0.7;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(mx + s * 0.12, my + s * 0.18);
    ctx.lineTo(mx + s * 0.04, my + s * 0.34);
    if (dmg > 0.65) {
      ctx.moveTo(mx + s * 0.12, my + s * 0.18);
      ctx.lineTo(mx + s * 0.3, my + s * 0.22);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// A gate: two small gate towers with banners, and a raised portcullis between them.
function drawGate(ax, ay, bx, by, w, s, lw, ht) {
  const wood = w.level === 1;
  for (const [x, y] of [[ax, ay], [bx, by]]) {
    ctx.fillStyle = wood ? '#7a5434' : '#5a626c';
    ctx.strokeStyle = OUT;
    ctx.lineWidth = lw;
    ctx.fillRect(x - s * 0.17, y - ht * 1.6, s * 0.34, ht * 1.6 + s * 0.06);
    ctx.strokeRect(x - s * 0.17, y - ht * 1.6, s * 0.34, ht * 1.6 + s * 0.06);
    ctx.fillStyle = wood ? '#9a7048' : '#79828d';
    ctx.fillRect(x - s * 0.22, y - ht * 1.6 - s * 0.12, s * 0.44, s * 0.13);
    ctx.strokeRect(x - s * 0.22, y - ht * 1.6 - s * 0.12, s * 0.44, s * 0.13);
    ctx.fillStyle = colorOf(w.owner, 55);
    ctx.beginPath();
    ctx.moveTo(x, y - ht * 1.6 - s * 0.12);
    ctx.lineTo(x, y - ht * 1.6 - s * 0.5);
    ctx.lineTo(x + s * 0.22, y - ht * 1.6 - s * 0.4);
    ctx.lineTo(x, y - ht * 1.6 - s * 0.32);
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = Math.max(0.8, lw * 0.6);
    ctx.beginPath();
    ctx.moveTo(x, y - ht * 1.6 - s * 0.12);
    ctx.lineTo(x, y - ht * 1.6 - s * 0.5);
    ctx.stroke();
  }
  // the raised portcullis: bar ends showing under the arch
  ctx.strokeStyle = '#2a2f35';
  ctx.lineWidth = Math.max(1, s * 0.06);
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    ctx.beginPath();
    ctx.moveTo(x, y - ht * 1.35);
    ctx.lineTo(x, y - ht * 1.05);
    ctx.stroke();
  }
  ctx.strokeStyle = wood ? '#9a7048' : '#79828d';
  ctx.lineWidth = Math.max(1.5, s * 0.12);
  ctx.beginPath();
  ctx.moveTo(ax, ay - ht * 1.4);
  ctx.lineTo(bx, by - ht * 1.4);
  ctx.stroke();
  if (w.level === 3) {
    ctx.strokeStyle = colorOf(w.owner, 70, 0.9);
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(ax, ay - ht * 1.4);
    ctx.lineTo(bx, by - ht * 1.4);
    ctx.stroke();
  }
}

function seenWall(w) {
  if (!S.fogOn || w.owner === S.myId) return true;
  return explored[Math.floor(w.y) * C.MAP_W + Math.floor(w.x)] === 1;
}

function drawWalls() {
  const s = scale();
  const now = performance.now();
  const list = [];
  for (const w of S.walls.values()) {
    if (!w.ends || !seenWall(w)) continue;
    list.push(w);
  }
  // farther (higher up) walls first so nearer ones overlap them
  list.sort((p, q) => p.ends[0][1] + p.ends[1][1] - q.ends[0][1] - q.ends[1][1]);
  const hover = S.myId && !S.buildKind ? edgeNear(mouse.wx, mouse.wy, 0.5) : null;
  for (const w of list) {
    const [mx, my] = toScreen(w.x, w.y);
    if (mx < -s * 4 || my < -s * 4 || mx > ctx.canvas.width + s * 4 || my > ctx.canvas.height + s * 4) continue;
    drawSegment(w.ends[0], w.ends[1], w, s, now, false);
    const hovered = hover && wallAtEdge(hover.a, hover.b) === w;
    if (w.id === S.selWall || hovered || w.hp < w.maxHp) {
      if (w.id === S.selWall) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -now / 60;
        ctx.beginPath();
        ctx.ellipse(mx, my - s * 0.3, s * 1.5, s * 0.75, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (w.hp < w.maxHp || hovered || w.id === S.selWall) {
        const bw = s * 0.9;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(mx - bw / 2, my - s * 1.25, bw, Math.max(3, s * 0.1));
        ctx.fillStyle = w.hp / w.maxHp > 0.5 ? '#3fb950' : w.hp / w.maxHp > 0.25 ? '#d29922' : '#f85149';
        ctx.fillRect(mx - bw / 2, my - s * 1.25, bw * Math.max(0, w.hp / w.maxHp), Math.max(3, s * 0.1));
      }
    }
  }
}

// Build mode overlay: buildable edges near the cursor, the drag so far, and the price.
function drawWallMode() {
  const s = scale();
  const d = S.wallDrag;
  const pending = d ? d.set : null;
  const near = edgeNear(mouse.wx, mouse.wy);
  const hh = mouse.wx >= 0 && mouse.wy >= 0 && mouse.wx < C.MAP_W && mouse.wy < C.MAP_H ? HEX.at(mouse.wx, mouse.wy) : -1;
  // buildable border edges around the cursor
  if (hh >= 0) {
    const h0 = HEX.hexes[hh];
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2.5;
    for (const h of HEX.hexes) {
      const dd = HEX.dist(h, h0);
      if (dd > 3 || ownerOfHex(h.i) !== S.myId) continue;
      for (const j of h.n) {
        if (!canWall(h.i, j, pending)) continue;
        const e = edgeEnds(h.i, j);
        if (!e) continue;
        const [x1, y1] = toScreen(e[0][0], e[0][1]);
        const [x2, y2] = toScreen(e[1][0], e[1][1]);
        ctx.strokeStyle = `rgba(126, 231, 135, ${0.85 * (1 - dd / 4)})`;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  const now = performance.now();
  if (d) {
    for (const [a, b] of d.list) {
      const e = edgeEnds(a, b);
      if (e) drawSegment(e[0], e[1], { id: 0, owner: S.myId, level: 1, hp: 1, maxHp: 1 }, s, now, true);
    }
  }
  const gold = S.me ? S.me.gold : 0;
  let text;
  let color = '#7ee787';
  if (d && d.list.length) {
    text = `+${d.list.length} wall${d.list.length === 1 ? '' : 's'}: ${d.list.length * C.WALL_COST}g`;
    color = '#ffd54f';
  } else if (near && canWall(near.a, near.b, pending)) {
    text = gold < C.WALL_COST ? `${C.WALL_COST}g (not enough gold)` : `Wall: ${C.WALL_COST}g (drag along your border)`;
    if (gold < C.WALL_COST) color = '#ffa198';
    const e = edgeEnds(near.a, near.b);
    if (e) drawSegment(e[0], e[1], { id: 0, owner: S.myId, level: 1, hp: 1, maxHp: 1 }, s, now, true);
  } else if (hh >= 0) {
    text = 'Walls go on your border: drag along its edge';
    color = '#8b949e';
  }
  if (text) label(text, mouse.sx + 18 + text.length * 3.3, mouse.sy + 26, 12, color);
}

// Click: select the wall under the cursor (any visible wall). Returns true if one was picked.
function pickWall(wx, wy) {
  const e = edgeNear(wx, wy, 0.6);
  const w = e ? wallAtEdge(e.a, e.b) : null;
  S.selWall = w && seenWall(w) ? w.id : null;
  return !!S.selWall;
}

// ---- the selection panel for a wall
function wallPanel(panel, gold) {
  const w = S.walls.get(S.selWall);
  if (!w) {
    S.selWall = null;
    return false;
  }
  panel.classList.remove('hidden');
  const mine = w.owner === S.myId;
  const key = `w:${w.id}:${w.level}:${w.gate}:${w.owner}`;
  const name = `${w.gate ? `${TIER[w.level - 1]} gate` : TIER[w.level - 1]}`;
  if (panel.dataset.key !== key) {
    panel.dataset.key = key;
    const who = mine ? 'Your' : `${escapeHtml((players.get(w.owner) || { name: '?' }).name)}'s`;
    const up = w.level < C.WALL_HP.length ? C.WALL_UPGRADE[w.level - 1] : 0;
    panel.innerHTML = `<h4><img src="${iconURL('wall')}" alt="">${who} ${name}</h4>
      <div id="sel-info" class="stats"></div>
      <div class="muted">${w.gate ? 'Opens for its owner\'s and allies\' troops and caravans; shut to everyone else.' : 'Blocks every troop and caravan, its owner\'s too: add a gate to let your side through.'}</div>
      ${mine ? `<div class="btns">
        <button id="wall-up" class="primary" data-tip="${up ? `${TIER[w.level]}: ${C.WALL_HP[w.level]} HP <kbd>U</kbd>` : 'Already the strongest wall'}">${up ? `▲ ${TIER[w.level]} ${up}g` : 'Max tier'}</button>
        <button id="wall-gate" data-tip="${w.gate ? 'Back to a plain wall (free)' : `Your troops, caravans and allies can pass through: ${C.WALL_GATE_COST}g`}">${w.gate ? 'Close up gate' : `⛩ Make gate ${C.WALL_GATE_COST}g`}</button>
      </div>
      <div class="btns"><button id="wall-down" data-tip="Knock it down for ${Math.round(C.WALL_REFUND * 100)}% of its cost back <kbd>Del</kbd>">Knock down</button></div>` : '<div class="muted">Troops that walk into it hack at it. Soldiers hit walls twice as hard.</div>'}`;
    if (mine) {
      $('wall-up').onclick = () => sendMsg({ t: 'wall', op: 'up', id: w.id });
      $('wall-gate').onclick = () => sendMsg({ t: 'wall', op: 'gate', id: w.id });
      $('wall-down').onclick = () => sendMsg({ t: 'wall', op: 'down', id: w.id });
    }
  }
  $('sel-info').innerHTML = `<div>HP <b>${w.hp}/${w.maxHp}</b></div><div>Tier <b>${w.level}/3</b></div>`;
  if (mine && $('wall-up')) {
    $('wall-up').disabled = w.level >= C.WALL_HP.length || gold < C.WALL_UPGRADE[w.level - 1];
    $('wall-gate').disabled = !w.gate && gold < C.WALL_GATE_COST;
  }
  return true;
}

// New walls from the server: work out where each sits on screen.
function placeWall(w) {
  w.ends = edgeEnds(w.a, w.b);
  const ha = HEX.hexes[w.a];
  const hb = HEX.hexes[w.b];
  w.x = (ha.cx + hb.cx) / 2;
  w.y = (ha.cy + hb.cy) / 2;
}

function wallsBuilt(n, gold) {
  toast(`+${n} wall${n === 1 ? '' : 's'} (−${gold}g)`, true);
}

export { drawWallMode, drawWalls, pickWall, placeWall, wallDown, wallMove, wallPanel, wallUp, wallsBuilt };
