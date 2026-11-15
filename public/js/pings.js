// Pings: markers players put on the map for their allies (and themselves): ⚔ attack here, 🛡 defend
// here, ⚠ danger, 👁 look here. Alt+click (or Y) opens a little wheel to pick one; the server passes
// it on to your allies only. Shown on the map (with an arrow at the screen's edge when it's off
// screen) and on the minimap, with a sound and a line in the feed.

import { S, C, colorOf, ctx, feed, mctx, mouse, toScreen } from './state.js';
import { sendMsg } from './net.js';
import { play } from './audio.js';

const PINGS = {
  attack: { ic: '⚔', label: 'Attack here', col: '#ff6b5e' },
  defend: { ic: '🛡', label: 'Defend here', col: '#5ec8ff' },
  danger: { ic: '⚠', label: 'Danger!', col: '#ffb000' },
  look: { ic: '👁', label: 'Look here', col: '#e6edf3' },
};
// the wheel: each kind's offset from its centre (screen pixels)
const WHEEL = [['attack', 0, -62], ['defend', 62, 0], ['danger', 0, 62], ['look', -62, 0]];

S.pings = [];
S.pingWheel = null; // { wx, wy } while the wheel is open

function onPing(msg) {
  const p = PINGS[msg.kind];
  if (!p) return;
  S.pings.push({ ...msg, born: performance.now() });
  play('ping', null, 0, { kind: msg.kind });
  feed.push({ text: `${msg.from === S.myId ? 'You' : msg.name}: ${p.ic} ${p.label}`, born: performance.now() });
  while (feed.length > 6) feed.shift();
}

function openPingWheel(wx, wy) {
  if (!S.myId) return;
  S.pingWheel = { wx, wy };
}

function closePingWheel() {
  S.pingWheel = null;
}

// The wheel option under screen point (sx, sy), or null.
function wheelOption(sx, sy) {
  if (!S.pingWheel) return null;
  const [cx, cy] = toScreen(S.pingWheel.wx, S.pingWheel.wy);
  for (const [kind, dx, dy] of WHEEL) if (Math.hypot(sx - cx - dx, sy - cy - dy) < 28) return kind;
  return null;
}

// A click while the wheel is open: send the ping picked (or just close it). True when handled.
function pingWheelClick(sx, sy) {
  if (!S.pingWheel) return false;
  const kind = wheelOption(sx, sy);
  if (kind) sendMsg({ t: 'ping', kind, x: S.pingWheel.wx, y: S.pingWheel.wy });
  closePingWheel();
  return true;
}

function bubble(x, y, r, ping, alpha = 1) {
  const p = PINGS[ping.kind];
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(13, 17, 23, 0.88)';
  ctx.strokeStyle = colorOf(ping.from, 60);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = p.col;
  ctx.font = `${Math.round(r * 1.1)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(p.ic, x, y + 1);
  ctx.globalAlpha = 1;
}

// On the map: rings pulsing out from the spot, the symbol and who sent it; an arrow at the edge of
// the screen for pings out of view.
function drawPings() {
  const now = performance.now();
  S.pings = S.pings.filter((p) => now - p.born < C.PING_LIFE * 1000);
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  for (const ping of S.pings) {
    const age = (now - ping.born) / 1000;
    const fade = Math.min(1, (C.PING_LIFE - age) / 1.2);
    const p = PINGS[ping.kind];
    const [x, y] = toScreen(ping.x, ping.y);
    const inView = x > 20 && y > 60 && x < W - 20 && y < H - 20;
    if (inView) {
      for (let k = 0; k < 3; k++) {
        const t = ((age * 1.1 + k / 3) % 1);
        ctx.strokeStyle = p.col;
        ctx.globalAlpha = (1 - t) * 0.8 * fade;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, 10 + t * 46, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const bob = Math.sin(age * 5) * 2;
      // a stalk from the spot up to the symbol
      ctx.strokeStyle = p.col;
      ctx.globalAlpha = fade;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 30 + bob);
      ctx.stroke();
      bubble(x, y - 44 + bob, 15, ping, fade);
      ctx.globalAlpha = fade;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.fillStyle = '#e6edf3';
      ctx.textAlign = 'center';
      ctx.fillText(ping.from === S.myId ? p.label : `${ping.name}: ${p.label}`, x, y - 68 + bob);
      ctx.globalAlpha = 1;
    } else {
      // off screen: a marker at the edge, pointing at it
      const cx = W / 2;
      const cy = H / 2;
      const a = Math.atan2(y - cy, x - cx);
      const k = Math.min((W / 2 - 34) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - 70) / Math.abs(Math.sin(a) || 1e-6));
      const ex = cx + Math.cos(a) * k;
      const ey = cy + Math.sin(a) * k;
      ctx.fillStyle = p.col;
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(a) * 24, ey + Math.sin(a) * 24);
      ctx.lineTo(ex + Math.cos(a + 2.5) * 12, ey + Math.sin(a + 2.5) * 12);
      ctx.lineTo(ex + Math.cos(a - 2.5) * 12, ey + Math.sin(a - 2.5) * 12);
      ctx.closePath();
      ctx.fill();
      bubble(ex, ey, 13, ping, fade * (0.75 + 0.25 * Math.sin(age * 6)));
    }
  }
}

// On the minimap (sx, sy: minimap pixels per tile): a pulsing ring and the symbol.
function drawMiniPings(sx, sy) {
  const now = performance.now();
  for (const ping of S.pings) {
    const age = (now - ping.born) / 1000;
    if (age > C.PING_LIFE) continue;
    const p = PINGS[ping.kind];
    const x = ping.x * sx;
    const y = ping.y * sy;
    const t = (age * 1.2) % 1;
    mctx.strokeStyle = p.col;
    mctx.globalAlpha = 1 - t;
    mctx.lineWidth = 2;
    mctx.beginPath();
    mctx.arc(x, y, 4 + t * 12, 0, Math.PI * 2);
    mctx.stroke();
    mctx.globalAlpha = 1;
    mctx.font = '11px system-ui, sans-serif';
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    mctx.fillStyle = p.col;
    mctx.fillText(p.ic, x, y);
  }
}

// The wheel: four symbols round the spot, the one under the cursor lit up.
function drawPingWheel() {
  if (!S.pingWheel) return;
  const [cx, cy] = toScreen(S.pingWheel.wx, S.pingWheel.wy);
  const over = wheelOption(mouse.sx, mouse.sy);
  ctx.fillStyle = 'rgba(13, 17, 23, 0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, 98, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e6edf3';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  for (const [kind, dx, dy] of WHEEL) {
    const p = PINGS[kind];
    const lit = over === kind;
    ctx.fillStyle = lit ? '#2a2612' : 'rgba(22, 27, 34, 0.95)';
    ctx.strokeStyle = lit ? '#f2c14e' : p.col;
    ctx.lineWidth = lit ? 3 : 2;
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = p.col;
    ctx.fillText(p.ic, cx + dx, cy + dy + 1);
    if (lit) {
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillStyle = '#e6edf3';
      ctx.fillText(p.label, cx + dx, cy + dy + (dy > 0 ? 38 : dy < 0 ? -38 : 0) + (dy === 0 ? 38 : 0));
    }
  }
}

export { closePingWheel, drawMiniPings, drawPings, drawPingWheel, onPing, openPingWheel, pingWheelClick, PINGS };
