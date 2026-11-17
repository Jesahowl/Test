// Map objectives in the browser (see server/game/objectives.js): the five landmarks in their hexes
// (Gold Mine, Watchtower, Shrine of War, Healing Spring, Barracks Ruins), their capture rings, who
// holds them, their reach (the Watchtower's sight, the Spring's healing), a card when hovering one,
// and their icons on the minimap (seen through the fog by everyone).

import { S, C, HEX, colorOf, ctx, mouse, players, scale, toScreen } from './state.js';

const KINDS = Object.keys(C.OBJ_KINDS);
const R0 = 122; // the sprites are drawn for a hex this many units across its corner radius

// Objective rows from the server: [id, kind, hex, holder, progress %, capturer, flags].
function objFromRow(a) {
  const h = HEX.hexes[a[2]];
  return { id: a[0], kind: KINDS[a[1]], hex: a[2], x: h.cx, y: h.cy, holder: a[3], progress: a[4] / 100, capturer: a[5],
    linked: !!(a[6] & 1), active: !!(a[6] & 2), contested: !!(a[6] & 4) };
}

const objectives = () => (S.objMap ? [...S.objMap.values()] : []);
const objectiveAtHex = (i) => objectives().find((o) => o.hex === i) || null;

// Is the Shrine burning now (from the round clock), and seconds until it changes.
function shrineState() {
  const t = (S.round && S.round.t) || 0;
  if (S.round && S.round.sd <= 0) return { awake: false, left: 0, over: true };
  for (const [a, b] of C.SHRINE_AWAKE) {
    if (t < a) return { awake: false, left: a - t };
    if (t < b) return { awake: true, left: b - t };
  }
  return { awake: false, left: 0, over: true };
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---- sprites (drawn about (0, 0), in hex units: R0 is the hex's corner radius)
const P = (d) => new Path2D(d);
const fill = (path, c) => {
  ctx.fillStyle = c;
  ctx.fill(typeof path === 'string' ? P(path) : path);
};
const ell = (x, y, rx, ry, c) => {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
};
const circ = (x, y, r, c) => ell(x, y, r, r, c);
function banner(x, y, colour) {
  ctx.fillStyle = '#5a4630';
  ctx.fillRect(x - 1.5, y - 46, 3, 46);
  fill(`M${x + 1.5} ${y - 46} l26 6 l-26 7 z`, colour);
}
function mine(colour) {
  ell(0, 30, 70, 16, 'rgba(0,0,0,.35)');
  fill('M-70 28 Q-50 -40 0 -46 Q52 -40 72 28 z', '#6d6458');
  fill('M-70 28 Q-50 -40 0 -46 L-6 28 z', '#7f7568');
  for (const [dx, dy, s] of [[-52, 12, 9], [46, 6, 8], [-30, -24, 7], [34, -22, 6], [58, 22, 7]]) ell(dx, dy, s, s * 0.7, '#8c8276');
  fill('M-24 28 L-24 -6 Q0 -24 24 -6 L24 28 z', '#1a140e');
  ctx.fillStyle = '#8a6236';
  ctx.fillRect(-26, -10, 6, 40);
  ctx.fillRect(22, -10, 6, 40);
  ctx.fillStyle = '#a9773f';
  ctx.fillRect(-30, -16, 60, 8);
  for (const [dx, dy] of [[-8, 6], [6, 14], [-2, 20], [12, 2]]) circ(dx, dy, 2.6, '#ffd54f');
  ctx.fillStyle = '#7a5532';
  ctx.fillRect(32, 22, 30, 16);
  fill('M34 22 q13 -12 26 0 z', '#ffc93c');
  circ(38, 40, 4.5, '#333');
  circ(56, 40, 4.5, '#333');
  if (colour) banner(-48, -12, colour);
}
function watchtower(colour) {
  ell(0, 34, 40, 11, 'rgba(0,0,0,.35)');
  fill('M-26 34 L-20 -50 L20 -50 L26 34 z', '#6b7078');
  fill('M-26 34 L-20 -50 L0 -50 L0 34 z', '#7c818a');
  ctx.strokeStyle = '#5a5f66';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    ctx.moveTo(-24 + k * 0.6, 18 - k * 16);
    ctx.lineTo(24 - k * 0.6, 18 - k * 16);
  }
  ctx.stroke();
  ctx.fillStyle = '#2b2420';
  ctx.beginPath();
  ctx.roundRect(-5, 12, 10, 22, 4);
  ctx.fill();
  ctx.fillStyle = '#80858d';
  ctx.fillRect(-30, -62, 60, 14);
  ctx.fillStyle = '#8d939b';
  for (let k = 0; k < 5; k++) ctx.fillRect(-30 + k * 13, -72, 8, 11);
  circ(0, -80, 16, 'rgba(255,210,122,.2)');
  circ(0, -80, 7, '#ffd27a');
  fill('M-22 -86 L0 -108 L22 -86 z', '#5b3d2b');
  if (colour) banner(40, 30, colour);
}
function shrine(colour, awake, now) {
  if (awake) {
    const g = ctx.createRadialGradient(0, 4, 4, 0, 4, 95);
    g.addColorStop(0, 'rgba(255,138,61,.45)');
    g.addColorStop(1, 'rgba(255,138,61,0)');
    circ(0, 4, 95, g);
  }
  ell(0, 34, 64, 15, 'rgba(0,0,0,.35)');
  ell(0, 22, 58, 18, '#5d5a55');
  ell(0, 18, 52, 14, '#6e6a63');
  const stone = (dx, dy, h, back) => {
    fill(`M${dx - 7} ${dy + 16} L${dx - 5} ${dy - h} L${dx + 5} ${dy - h - 4} L${dx + 7} ${dy + 16} z`, '#8a857c');
    if (back) fill(`M${dx - 7} ${dy + 16} L${dx - 5} ${dy - h} L${dx} ${dy - h - 2} L${dx} ${dy + 16} z`, '#9b968c');
    if (awake && back) fill(`M${dx - 2} ${dy - 14} l2 -6 l2 6 l-2 6 z`, '#ffb05c');
  };
  for (const [dx, dy] of [[-46, 6], [-26, -6], [0, -10], [26, -6], [46, 6]]) stone(dx, dy, 26, true);
  fill('M-14 10 L14 10 L9 26 L-9 26 z', '#3a3530');
  if (awake) {
    const f = Math.sin(now * 9) * 2;
    fill(`M0 ${-30 + f} C16 -10 14 8 0 10 C-14 8 -16 -10 0 ${-30 + f} z`, '#ff7a2f');
    fill(`M0 ${-16 + f / 2} C8 -4 7 6 0 8 C-7 6 -8 -4 0 ${-16 + f / 2} z`, '#ffd36e');
  }
  for (const [dx, dy] of [[-36, 26], [36, 26]]) stone(dx, dy, 22, false);
  if (colour) banner(70, 30, colour);
}
function spring(colour, now) {
  const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 90);
  g.addColorStop(0, 'rgba(95,240,208,.35)');
  g.addColorStop(1, 'rgba(95,240,208,0)');
  circ(0, 0, 90, g);
  ell(0, 26, 66, 16, 'rgba(0,0,0,.35)');
  ell(0, 14, 64, 26, '#7a766d');
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    ell(Math.cos(a) * 58, 14 + Math.sin(a) * 22, 9, 6, k % 2 ? '#8e8a80' : '#9b968c');
  }
  ell(0, 14, 48, 17, '#1f8f8a');
  ell(-6, 11, 34, 10, '#3fd3c0');
  ell(-12 + Math.sin(now * 1.3) * 6, 9, 12, 3, 'rgba(201,255,244,.8)');
  ctx.strokeStyle = '#7ef5d6';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [dx, dy] of [[-20, -18], [10, -30], [24, -12], [-4, -42]]) {
    const y = dy - ((now * 10 + dx) % 14);
    ctx.moveTo(dx - 4, y);
    ctx.lineTo(dx + 4, y);
    ctx.moveTo(dx, y - 4);
    ctx.lineTo(dx, y + 4);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  if (colour) banner(70, 20, colour);
}
function ruins(colour) {
  ell(0, 34, 74, 16, 'rgba(0,0,0,.35)');
  ctx.fillStyle = '#6a6660';
  ctx.fillRect(-62, -18, 124, 52);
  ctx.fillStyle = '#77736c';
  ctx.fillRect(-62, -18, 60, 52);
  fill('M-70 -16 L-20 -52 L6 -34 L18 -46 L32 -30 L40 -16 z', '#4c3a2c');
  fill('M40 -16 L52 -26 L70 -16 z', '#4c3a2c');
  ctx.strokeStyle = '#3a2c20';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const dx of [-20, 6, 18]) {
    ctx.moveTo(dx, -46);
    ctx.lineTo(dx + 4, -20);
  }
  ctx.stroke();
  fill('M-14 34 L-14 6 Q0 -6 14 6 L14 34 z', '#241c16');
  ctx.fillStyle = '#3a3530';
  for (const [dx, dy] of [[-48, 4], [36, 0], [48, 20]]) ctx.fillRect(dx, dy, 9, 9);
  for (const [dx, dy, s] of [[-80, 30, 7], [78, 28, 8], [60, 38, 5], [-66, 40, 5]]) ell(dx, dy, s, s * 0.7, '#8c8276');
  ctx.strokeStyle = '#c9c2b4';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-10, -8);
  ctx.lineTo(10, 8);
  ctx.moveTo(10, -8);
  ctx.lineTo(-10, 8);
  ctx.stroke();
  if (colour) banner(-78, 22, colour);
}

// The hex an objective stands in: a dashed rim while it's free, its holder's colour once taken.
function hexOutline(o, s, colour, tint) {
  const cs = HEX.corners(HEX.hexes[o.hex]);
  ctx.beginPath();
  cs.forEach(([x, y], k) => {
    const [sx, sy] = toScreen(x, y);
    if (k) ctx.lineTo(sx, sy);
    else ctx.moveTo(sx, sy);
  });
  ctx.closePath();
  ctx.fillStyle = tint || 'rgba(255, 255, 255, 0.03)';
  ctx.fill();
  ctx.setLineDash(colour ? [] : [Math.max(4, s * 0.3), Math.max(3, s * 0.2)]);
  ctx.lineWidth = Math.max(1.5, s * 0.09);
  ctx.strokeStyle = colour || 'rgba(255, 230, 170, 0.6)';
  ctx.stroke();
  ctx.setLineDash([]);
}

function label(text, x, y, colour, size) {
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size * 0.25);
  ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}
function chip(text, x, y, colour, size) {
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + size * 1.4;
  ctx.fillStyle = 'rgba(10, 13, 18, 0.88)';
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - size * 0.85, w, size * 1.7, size * 0.85);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}

const KIND_COLOUR = { mine: '#ffd54f', watchtower: '#9ecbff', shrine: '#ff9b6b', spring: '#7ee7c7', ruins: '#d2a8ff' };
const holderName = (id) => (id === S.myId ? 'Yours' : `${(players.get(id) || { name: '?' }).name}'s`);

// What a held objective's chip says it's doing.
function statusText(o) {
  if (o.contested) return 'Contested';
  if (o.capturer && o.progress > 0) return `${o.capturer === S.myId ? 'Capturing' : `${(players.get(o.capturer) || { name: '?' }).name} capturing`} ${Math.round(o.progress * 100)}%`;
  if (!o.holder) return o.kind === 'shrine' ? shrineLine() : 'Free';
  const who = holderName(o.holder);
  if (!o.linked) return `${who} · not linked`;
  if (!o.active) return `${who} · resting (3 at most)`;
  if (o.kind === 'shrine') return `${who} · ${shrineLine()}`;
  return who;
}
function shrineLine() {
  const st = shrineState();
  if (st.over) return 'dormant';
  return st.awake ? `awake ${mmss(st.left)}` : `wakes in ${mmss(st.left)}`;
}

function drawObjectives() {
  const list = objectives();
  if (!list.length) return;
  const s = scale();
  const now = performance.now() / 1000;
  const k = (C.HEX_R * s) / R0; // sprite units to screen pixels
  const hoverHex = mouse.wx >= 0 && mouse.wy >= 0 && mouse.wx < C.MAP_W && mouse.wy < C.MAP_H ? HEX.tileHex[Math.floor(mouse.wy) * C.MAP_W + Math.floor(mouse.wx)] : -1;
  for (const o of list) {
    const [x, y] = toScreen(o.x, o.y);
    const pad = C.HEX_R * s * 1.4;
    if (x < -pad - 400 || y < -pad - 400 || x > ctx.canvas.width + pad + 400 || y > ctx.canvas.height + pad + 400) continue;
    const colour = o.holder ? colorOf(o.holder, 60) : null;
    // reach: the Watchtower's sight and the Spring's healing (yours, or the one under the cursor)
    const reach = o.kind === 'watchtower' ? C.WATCH_SIGHT : o.kind === 'spring' ? C.SPRING_RANGE : 0;
    if (reach && (o.hex === hoverHex || (o.holder === S.myId && o.active))) {
      ctx.strokeStyle = o.kind === 'spring' ? 'rgba(126, 231, 199, 0.5)' : 'rgba(158, 203, 255, 0.45)';
      ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.setLineDash([s * 0.35, s * 0.25]);
      ctx.beginPath();
      ctx.arc(x, y, reach * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    hexOutline(o, s, colour, o.holder ? colorOf(o.holder, 60, 0.13) : null);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    // the capture ring (under the sprite's foot): the capturer's colour, grey while contested
    if (o.progress > 0) {
      ctx.lineWidth = 9;
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath();
      ctx.arc(0, 62, 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.strokeStyle = o.contested ? '#8b949e' : colorOf(o.capturer, 60);
      ctx.beginPath();
      ctx.arc(0, 62, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * o.progress);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    if (o.kind === 'mine') mine(colour);
    else if (o.kind === 'watchtower') watchtower(colour);
    else if (o.kind === 'shrine') shrine(colour, shrineState().awake, now);
    else if (o.kind === 'spring') spring(colour, now);
    else ruins(colour);
    ctx.restore();
    // name and state (close enough to read)
    if (s >= 9) {
      const fs = Math.max(10, Math.min(15, s * 0.42));
      const def = C.OBJ_KINDS[o.kind];
      label(`${def.icon} ${def.name}`, x, y - C.HEX_R * s * 0.82, KIND_COLOUR[o.kind], fs);
      chip(statusText(o), x, y + C.HEX_R * s * 0.86, o.holder ? colour : o.capturer ? colorOf(o.capturer, 60) : '#8b949e', fs * 0.85);
    }
  }
}

// What an objective gives, in words (hover card, help).
function perkText(kind) {
  return {
    mine: `+${C.MINE_GOLD} gold a second`,
    watchtower: `no fog within ${C.WATCH_SIGHT} tiles: enemy squads there show on your minimap`,
    shrine: `+${Math.round(C.SHRINE_DAMAGE * 100)}% damage for all your troops while it's awake`,
    spring: `your troops within ${C.SPRING_RANGE} tiles heal ${Math.round(C.SPRING_HEAL * 100)}% HP a second out of combat`,
    ruins: `fallen troops rejoin every ${C.RUINS_TRICKLE}s; wiped squads back ${Math.round((1 - C.RUINS_WIPE) * 100)}% sooner`,
  }[kind];
}

// A card when hovering an objective: who holds it, what it gives, whether it's working, how to take it.
function drawObjectiveHover() {
  if (document.body.classList.contains('touch') || S.buildKind) return;
  if (mouse.wx < 0 || mouse.wy < 0 || mouse.wx >= C.MAP_W || mouse.wy >= C.MAP_H) return;
  const o = objectiveAtHex(HEX.tileHex[Math.floor(mouse.wy) * C.MAP_W + Math.floor(mouse.wx)]);
  if (!o) return;
  const def = C.OBJ_KINDS[o.kind];
  const lines = [
    [`${def.icon} ${def.name}`, '#e6edf3', '700 13px'],
    [o.holder ? `Held by ${o.holder === S.myId ? 'you' : (players.get(o.holder) || { name: '?' }).name}` : 'Free: nobody holds it', o.holder === S.myId ? '#7ee787' : '#8b949e', '12px'],
    [`Gives ${perkText(o.kind)}${o.kind === 'shrine' ? ` (${shrineLine()})` : ''}`, '#e6edf3', '12px'],
  ];
  if (o.holder === S.myId) lines.push(o.active ? ['✓ Working: linked to your land', '#7ee787', '12px'] : o.linked ? [`Resting: at most ${C.OBJ_MAX_ACTIVE} work at once`, '#d29922', '12px'] : ['✗ Not linked: claim land up to it', '#ffa198', '12px']);
  lines.push(['Take it: stand troops in its hex (no enemies there)', '#8b949e', '11.5px']);
  const s = scale();
  const [cx, cy] = toScreen(o.x, o.y);
  let w = 0;
  for (const [t, , f] of lines) {
    ctx.font = `${f} system-ui, sans-serif`;
    w = Math.max(w, ctx.measureText(t).width);
  }
  w += 24;
  const h = 14 + lines.length * 18;
  const x = Math.min(ctx.canvas.width - w - 8, cx + s * C.HEX_R * 1.05);
  const y = Math.max(50, Math.min(ctx.canvas.height - h - 90, cy - h / 2));
  ctx.fillStyle = 'rgba(14, 18, 25, 0.95)';
  ctx.strokeStyle = '#273041';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 9);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  lines.forEach(([t, c, f], i) => {
    ctx.font = `${f} system-ui, sans-serif`;
    ctx.fillStyle = c;
    ctx.fillText(t, x + 12, y + 22 + i * 18);
  });
}

// Minimap icons: a dot in the holder's colour (white rim if free), seen through the fog.
function drawObjectivesMinimap(m, sx, sy) {
  for (const o of objectives()) {
    const x = o.x * sx;
    const y = o.y * sy;
    m.fillStyle = '#0b0f14';
    m.strokeStyle = o.holder ? colorOf(o.holder, 62) : 'rgba(230, 237, 243, 0.85)';
    m.lineWidth = 2;
    m.beginPath();
    m.arc(x, y, 5, 0, Math.PI * 2);
    m.fill();
    m.stroke();
    m.fillStyle = KIND_COLOUR[o.kind];
    m.beginPath();
    m.arc(x, y, 2.2, 0, Math.PI * 2);
    m.fill();
    if (o.progress > 0) {
      m.strokeStyle = o.contested ? '#8b949e' : colorOf(o.capturer, 62);
      m.lineWidth = 1.5;
      m.beginPath();
      m.arc(x, y, 7.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * o.progress);
      m.stroke();
    }
  }
}

export { drawObjectiveHover, drawObjectives, drawObjectivesMinimap, objFromRow, objectiveAtHex, perkText };
