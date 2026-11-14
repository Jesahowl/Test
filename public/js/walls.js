// Walls in the browser: drawing them along hex edges (the border lifted into a band of light; gates), building
// them by dragging along your border (press V), and the panel for a selected wall.

import { label } from './render.js';
import { escapeHtml, toast } from './screens.js';
import { sendMsg } from './net.js';
import { S, $, C, colorOf, ctx, explored, HEX, mouse, players, scale, terr, toScreen } from './state.js';
import { iconURL } from './ui.js';

const TIER = ['Light wall', 'Strong wall', 'Rune wall'];

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

// Height of a wall of this tier on screen (s = pixels per tile).
const wallHeight = (level, s) => s * [0.42, 0.62, 0.82][level - 1];

// One wall segment from world point A to B: the border lifted up into a see-through band of light
// in its owner's colour, taller and brighter for each tier. The band has a little thickness, so it
// shows a lit top from any angle. A gate is the same band opened up: a hollow top frame on two
// bright posts, joined to the walls either side.
function drawSegment(A, B, w, s, now, ghost) {
  const [ax, ay] = toScreen(A[0], A[1]);
  const [bx, by] = toScreen(B[0], B[1]);
  const owner = w.owner;
  const tier = w.level;
  const h = wallHeight(tier, s);
  const dmg = w.maxHp ? 1 - w.hp / w.maxHp : 0;
  const pulse = tier === 3 ? 0.85 + 0.15 * Math.sin(now / 450 + w.id) : 1;
  const flicker = dmg > 0.5 ? 0.55 + 0.45 * Math.abs(Math.sin(now / 90 + w.id)) : 1;
  // half the band's thickness, across the edge (pointing toward the viewer)
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let nx = -(by - ay) / len;
  let ny = (bx - ax) / len;
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const th = s * 0.09;
  const A0 = [ax - nx * th, ay - ny * th];
  const B0 = [bx - nx * th, by - ny * th];
  const A1 = [ax + nx * th, ay + ny * th];
  const B1 = [bx + nx * th, by + ny * th];
  const up = (p) => [p[0], p[1] - h];
  const poly = (pts) => {
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.55;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // the face toward the viewer: glassy, fainter toward the top (a gate's doorway is nearly clear)
  const g = ctx.createLinearGradient(0, Math.max(A1[1], B1[1]), 0, Math.min(A1[1], B1[1]) - h);
  g.addColorStop(0, colorOf(owner, 60, (w.gate ? 0.06 : 0.14 + tier * 0.11) * pulse));
  g.addColorStop(1, colorOf(owner, 70, (w.gate ? 0.03 : 0.04 + tier * 0.08) * pulse));
  ctx.fillStyle = g;
  poly([A1, B1, up(B1), up(A1)]);
  ctx.fill();
  // the foot, where it meets the ground (dashed through a gate's doorway)
  ctx.strokeStyle = colorOf(owner, 70, 0.8);
  ctx.lineWidth = Math.max(1, s * 0.05);
  if (w.gate) ctx.setLineDash([s * 0.2, s * 0.18]);
  ctx.beginPath();
  ctx.moveTo(A1[0], A1[1]);
  ctx.lineTo(B1[0], B1[1]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (w.gate) {
    // the posts at the gate's ends, standing a little proud of the wall
    for (const [x, y] of [[ax, ay], [bx, by]]) {
      ctx.strokeStyle = colorOf(owner, 70, 0.35 * pulse);
      ctx.lineWidth = Math.max(5, s * 0.3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - h - s * 0.12);
      ctx.stroke();
      ctx.strokeStyle = colorOf(owner, 85);
      ctx.lineWidth = Math.max(2.5, s * 0.13);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - h - s * 0.12);
      ctx.stroke();
    }
  }
  // the top: a glow, then the lit surface (a gate's top is an open frame); a battered wall flickers
  const top = [up(A0), up(B0), up(B1), up(A1)];
  ctx.strokeStyle = colorOf(owner, 70, 0.25 * pulse * flicker);
  ctx.lineWidth = Math.max(4, s * (0.2 + tier * 0.04));
  poly(top);
  ctx.stroke();
  if (!w.gate) {
    ctx.fillStyle = colorOf(owner, 80, (0.55 + 0.12 * tier) * flicker);
    poly(top);
    ctx.fill();
  }
  ctx.strokeStyle = colorOf(owner, 85, flicker);
  ctx.lineWidth = Math.max(1.2, s * (0.04 + tier * 0.01));
  if (dmg > 0.5) ctx.setLineDash([s * 0.35, s * 0.12]);
  poly(top);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
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
        ctx.fillRect(mx - bw / 2, my - wallHeight(w.level, s) - s * 0.45, bw, Math.max(3, s * 0.1));
        ctx.fillStyle = w.hp / w.maxHp > 0.5 ? '#3fb950' : w.hp / w.maxHp > 0.25 ? '#d29922' : '#f85149';
        ctx.fillRect(mx - bw / 2, my - wallHeight(w.level, s) - s * 0.45, bw * Math.max(0, w.hp / w.maxHp), Math.max(3, s * 0.1));
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
  const name = w.gate ? `gate (${TIER[w.level - 1].toLowerCase()})` : TIER[w.level - 1].toLowerCase();
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
