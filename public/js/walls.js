// Walls in the browser: drawing them along hex edges (the border lifted into a band of light; gates), building
// them by dragging along your border (press V), and the panel for a selected wall.

import { label } from './render.js';
import { escapeHtml, toast } from './screens.js';
import { sendMsg } from './net.js';
import { S, $, C, colorOf, ctx, explored, HEX, mouse, players, scale, terr, toScreen } from './state.js';
import { iconURL } from './ui.js';


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

// Height of a wall on screen (s = pixels per tile).
const wallHeight = (s) => s * 0.6;

// Join wall segments ({ A, B, w }, A/B world points) that meet end to end into runs, each segment
// turned to face along its run. Only segments with the same owner join (a border's walls never meet
// more than two at a corner, so every run is a simple line or loop).
function chainsOf(items) {
  const key = ([x, y]) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const at = new Map();
  for (const it of items) {
    for (const p of [it.A, it.B]) {
      const k = `${it.w.owner}|${key(p)}`;
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(it);
    }
  }
  const other = (it, p) => (key(it.A) === key(p) ? it.B : it.A);
  const used = new Set();
  const runs = [];
  const walk = (start, from) => {
    const run = [];
    let it = start;
    let p = from;
    while (it && !used.has(it)) {
      used.add(it);
      const q = other(it, p);
      run.push({ A: p, B: q, w: it.w });
      p = q;
      it = at.get(`${it.w.owner}|${key(p)}`).find((n) => !used.has(n));
    }
    return run;
  };
  // open runs first (from an end), then loops
  for (const it of items) {
    if (used.has(it)) continue;
    for (const p of [it.A, it.B]) {
      if (at.get(`${it.w.owner}|${key(p)}`).length === 1) {
        runs.push(walk(it, p));
        break;
      }
    }
  }
  for (const it of items) if (!used.has(it)) runs.push(walk(it, it.A));
  return runs;
}

// One run of wall: the border lifted up into a see-through band of light in its owner's colour,
// all one height. The face is filled segment by segment (they meet edge to edge), and the top is
// ONE line through the whole run,
// so the run reads as a single wall. A gate is a gap in the wall: the top line stops either side of
// it, the walls there end in a lit edge, and a soft light rises from the gap (no line along its foot).
function drawRun(run, s, now, g = ctx) {
  if (!run.length) return;
  const owner = run[0].w.owner;
  const P = run.map(({ A, B, w }) => {
    const a = toScreen(A[0], A[1]);
    const b = toScreen(B[0], B[1]);
    const h = wallHeight(s);
    const pulse = 1;
    return { a, b, h, w, pulse, dmg: w.maxHp ? 1 - w.hp / w.maxHp : 0 };
  });
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // faces: glass for walls; a gate is a gap with soft light rising out of it
  for (const { a, b, h, w, pulse } of P) {
    const grad = g.createLinearGradient(0, Math.max(a[1], b[1]), 0, Math.min(a[1], b[1]) - h);
    if (w.gate) {
      grad.addColorStop(0, colorOf(owner, 75, 0.35));
      grad.addColorStop(1, colorOf(owner, 75, 0));
    } else {
      grad.addColorStop(0, colorOf(owner, 60, 0.3 * pulse));
      grad.addColorStop(1, colorOf(owner, 70, 0.12 * pulse));
    }
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.lineTo(b[0], b[1] - h);
    g.lineTo(a[0], a[1] - h);
    g.closePath();
    g.fill();
  }
  // the foot along the ground under walls
  g.strokeStyle = colorOf(owner, 70, 0.8);
  g.lineWidth = Math.max(1, s * 0.05);
  g.beginPath();
  for (const { a, b, w } of P) {
    if (w.gate) continue;
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
  }
  g.stroke();
  // the top: one path through each stretch of wall between gates
  const first = P[0];
  const last = P[P.length - 1];
  const loop = !P.some((p) => p.w.gate) && P.length > 2 && Math.hypot(first.a[0] - last.b[0], first.a[1] - last.b[1]) < 0.5;
  const topPath = () => {
    g.beginPath();
    let open = false;
    for (const { a, b, h, w } of P) {
      if (w.gate) {
        open = false;
        continue;
      }
      if (!open) g.moveTo(a[0], a[1] - h);
      else g.lineTo(a[0], a[1] - h);
      g.lineTo(b[0], b[1] - h);
      open = true;
    }
    if (loop) g.lineTo(first.a[0], first.a[1] - first.h);
    // the gates' side edges, ground to top, in the same path: each glow layer is painted once over
    // the whole run, so where an edge meets a wall top nothing doubles up
    for (const { a, b, h, w } of P) {
      if (!w.gate) continue;
      for (const [x, y] of [a, b]) {
        g.moveTo(x, y);
        g.lineTo(x, y - h);
      }
    }
  };
  g.strokeStyle = colorOf(owner, 70, 0.25);
  g.lineWidth = Math.max(5, s * 0.36);
  topPath();
  g.stroke();
  g.strokeStyle = colorOf(owner, 80, 0.75);
  g.lineWidth = Math.max(2.5, s * 0.17);
  topPath();
  g.stroke();
  g.strokeStyle = colorOf(owner, 90);
  g.lineWidth = Math.max(1, s * 0.05);
  topPath();
  g.stroke();
  // per segment: battered walls flicker dark along their top
  for (const { a, b, h, w, dmg } of P) {
    if (dmg > 0.5 && !w.gate) {
      g.strokeStyle = `rgba(13, 17, 23, ${0.55 * Math.abs(Math.sin(now / 90 + w.id))})`;
      g.lineWidth = Math.max(2.5, s * 0.17);
      g.setLineDash([s * 0.12, s * 0.3]);
      g.beginPath();
      g.moveTo(a[0], a[1] - h);
      g.lineTo(b[0], b[1] - h);
      g.stroke();
      g.setLineDash([]);
    }
  }
  g.restore();
}

// Wall previews (while placing): drawn at full strength on a layer of their own, then laid over the
// map see-through in one go, so their glow layers don't show through each other.
let ghostLayer = null;
function drawGhostWalls(items, s, now) {
  if (!items.length) return;
  if (!ghostLayer) ghostLayer = document.createElement('canvas');
  if (ghostLayer.width !== ctx.canvas.width || ghostLayer.height !== ctx.canvas.height) {
    ghostLayer.width = ctx.canvas.width;
    ghostLayer.height = ctx.canvas.height;
  }
  const g = ghostLayer.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, ghostLayer.width, ghostLayer.height);
  g.setTransform(ctx.getTransform());
  for (const run of chainsOf(items)) drawRun(run, s, now, g);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.6;
  ctx.drawImage(ghostLayer, 0, 0);
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
  const runs = chainsOf(list.map((w) => ({ A: w.ends[0], B: w.ends[1], w })));
  // farther runs first (by their lowest point) so nearer walls overlap them
  runs.sort((p, q) => Math.max(...p.map((x) => Math.max(x.A[1], x.B[1]))) - Math.max(...q.map((x) => Math.max(x.A[1], x.B[1]))));
  for (const run of runs) drawRun(run, s, now);
  for (const w of list) {
    const [mx, my] = toScreen(w.x, w.y);
    if (mx < -s * 4 || my < -s * 4 || mx > ctx.canvas.width + s * 4 || my > ctx.canvas.height + s * 4) continue;
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
        ctx.fillRect(mx - bw / 2, my - wallHeight(s) - s * 0.45, bw, Math.max(3, s * 0.1));
        ctx.fillStyle = w.hp / w.maxHp > 0.5 ? '#3fb950' : w.hp / w.maxHp > 0.25 ? '#d29922' : '#f85149';
        ctx.fillRect(mx - bw / 2, my - wallHeight(s) - s * 0.45, bw * Math.max(0, w.hp / w.maxHp), Math.max(3, s * 0.1));
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
        if (near && ((near.a === h.i && near.b === j) || (near.a === j && near.b === h.i)) && canWall(near.a, near.b, pending)) continue;
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
  const ghost = { id: 0, owner: S.myId, hp: 1, maxHp: 1 };
  const edges = d ? [...d.list] : [];
  if (near && canWall(near.a, near.b, pending)) edges.push([near.a, near.b]);
  drawGhostWalls(edges.map(([a, b]) => edgeEnds(a, b)).filter(Boolean).map((e) => ({ A: e[0], B: e[1], w: ghost })), s, now);
  const gold = S.me ? S.me.gold : 0;
  let text;
  let color = '#7ee787';
  if (d && d.list.length) {
    text = `+${d.list.length} wall${d.list.length === 1 ? '' : 's'}: ${d.list.length * C.WALL_COST}g`;
    color = '#ffd54f';
  } else if (near && canWall(near.a, near.b, pending)) {
    text = gold < C.WALL_COST ? `${C.WALL_COST}g (not enough gold)` : `Wall: ${C.WALL_COST}g (drag along your border)`;
    if (gold < C.WALL_COST) color = '#ffa198';
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
  const key = `w:${w.id}:${w.gate}:${w.owner}`;
  const name = w.gate ? 'gate' : 'wall';
  if (panel.dataset.key !== key) {
    panel.dataset.key = key;
    const who = mine ? 'Your' : `${escapeHtml((players.get(w.owner) || { name: '?' }).name)}'s`;
    panel.innerHTML = `<h4><img src="${iconURL('wall')}" alt="">${who} ${name}</h4>
      <div id="sel-info" class="stats"></div>
      <div class="muted">${w.gate ? 'Opens for its owner\'s and allies\' troops and caravans; shut to everyone else.' : 'Blocks every troop and caravan, its owner\'s too: add a gate to let your side through.'}</div>
      ${mine ? `<div class="btns">
        <button id="wall-gate" data-tip="${w.gate ? 'Back to a plain wall (free)' : `Your troops, caravans and allies can pass through: ${C.WALL_GATE_COST}g`}">${w.gate ? 'Close up gate' : `⛩ Make gate ${C.WALL_GATE_COST}g`}</button>
      </div>
      <div class="btns"><button id="wall-down" data-tip="Knock it down for ${Math.round(C.WALL_REFUND * 100)}% of its cost back <kbd>Del</kbd>">Knock down</button></div>` : '<div class="muted">Troops that walk into it hack at it. Soldiers hit walls twice as hard.</div>'}`;
    if (mine) {
      $('wall-gate').onclick = () => sendMsg({ t: 'wall', op: 'gate', id: w.id });
      $('wall-down').onclick = () => sendMsg({ t: 'wall', op: 'down', id: w.id });
    }
  }
  $('sel-info').innerHTML = `<div>HP <b>${w.hp}/${w.maxHp}</b></div>`;
  if (mine && $('wall-gate')) $('wall-gate').disabled = !w.gate && gold < C.WALL_GATE_COST;
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
