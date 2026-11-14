// Trade in the browser: the trade post (a stone market hall with a striped awning in the owner's
// colour), caravans (an open wagon of barrels pulled by an ox, two guards walking alongside), the trade roads
// between allied posts, and the trade post's panel.

import { isAlly } from './diplomacy.js';
import { sendMsg } from './net.js';
import { escapeHtml } from './screens.js';
import { S, $, C, colorOf, ctx, hexSpot, players, scale, toScreen } from './state.js';
import { drawCracks, drawCrystal, drawSmoke, runeEllipse } from './structures.js';
import { drawOxWagon, drawTroop, teamOf } from './chibi.js';

const OUT = '#22272d';
const WOOD = '#6b4a2f';
const WOOD_D = '#4a321f';
const CLOTH = '#d9c7a0';
const GOLD = '#ffd54f';

function box(x, y, w, h, fill, lw) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = lw;
  ctx.strokeRect(x, y, w, h);
}

function crate(x, y, sz, lw) {
  box(x - sz / 2, y - sz, sz, sz, WOOD, lw);
  ctx.strokeStyle = WOOD_D;
  ctx.lineWidth = Math.max(0.8, lw * 0.7);
  ctx.beginPath();
  ctx.moveTo(x - sz / 2, y - sz);
  ctx.lineTo(x + sz / 2, y);
  ctx.moveTo(x + sz / 2, y - sz);
  ctx.lineTo(x - sz / 2, y);
  ctx.stroke();
}

function barrel(x, y, w, h, lw) {
  ctx.fillStyle = '#7a5434';
  ctx.strokeStyle = OUT;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.ellipse(x, y - h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function coins(x, y, r, n = 6) {
  const spots = [[-0.6, 0], [0.6, 0], [0, 0], [-0.3, -0.5], [0.3, -0.5], [0, -1], [-0.9, -0.4], [0.9, -0.4], [0, -1.5]];
  ctx.fillStyle = GOLD;
  ctx.strokeStyle = '#a57c00';
  ctx.lineWidth = Math.max(0.6, r * 0.2);
  for (const [dx, dy] of spots.slice(0, n)) {
    ctx.beginPath();
    ctx.ellipse(x + dx * r * 1.6, y + dy * r * 1.2, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

// A striped awning from x0..x1 (top y0, bottom y1) with a scalloped edge.
function awning(x0, x1, y0, y1, n, owner, lw) {
  const mid = (x0 + x1) / 2;
  for (let i = 0; i < n; i++) {
    const a = x0 + ((x1 - x0) * i) / n;
    const b = x0 + ((x1 - x0) * (i + 1)) / n;
    ctx.fillStyle = i % 2 ? CLOTH : colorOf(owner, 52);
    ctx.beginPath();
    ctx.moveTo(a, y0);
    ctx.lineTo(b, y0);
    ctx.lineTo(b + (b - mid) * 0.12, y1);
    ctx.lineTo(a + (a - mid) * 0.12, y1);
    ctx.closePath();
    ctx.fill();
  }
  const L = x0 - (x1 - x0) * 0.06;
  const R = x1 + (x1 - x0) * 0.06;
  ctx.strokeStyle = OUT;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y0);
  ctx.lineTo(R, y1);
  ctx.lineTo(L, y1);
  ctx.closePath();
  ctx.stroke();
  const sc = (R - L) / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? CLOTH : colorOf(owner, 52);
    ctx.beginPath();
    ctx.arc(L + sc * (i + 0.5), y1, sc / 2, 0, Math.PI);
    ctx.fill();
    ctx.stroke();
  }
}

// The trade post: a stone market hall. Higher levels: more goods out front and a bigger crystal.
function drawTradeSprite(t, x, y, s, now) {
  const r = s * 0.8;
  const out = t.waveAt ? Math.max(0, 1 - (now - t.waveAt) / 700) : 0; // a caravan just set off
  const owner = t.owner;
  const lv = t.level;
  ctx.save();
  ctx.translate(x, y);
  const by = r * 0.72;
  const lw = Math.max(1, s * 0.03);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(r * 0.1, by, r * 1.3, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  runeEllipse(0, by, r * 1.38, r * 0.5, owner, now / 3500 + t.id, 0.7 + 0.3 * out);
  box(-r * 1.1, by - r * 0.17, r * 2.2, r * 0.17, '#3a4048', lw);
  const wTop = -r * 0.25;
  const wBot = by - r * 0.17;
  box(-r * 0.95, wTop, r * 1.9, wBot - wTop, '#4c535c', lw);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(r * 0.4, wTop, r * 0.55, wBot - wTop);
  ctx.fillStyle = '#3c434b';
  ctx.strokeStyle = OUT;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(-r * 1.08, wTop);
  ctx.lineTo(-r * 0.65, -r * 0.62);
  ctx.lineTo(r * 0.65, -r * 0.62);
  ctx.lineTo(r * 1.08, wTop);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // counter window, lit in the owner's colour, with coins and a barrel on the counter
  box(-r * 0.6, r * 0.02, r * 1.2, r * 0.32, '#1b1f24', lw);
  ctx.fillStyle = colorOf(owner, 70 + 15 * out, 0.55 + 0.3 * out);
  ctx.fillRect(-r * 0.55, r * 0.06, r * 1.1, r * 0.24);
  coins(-r * 0.25, r * 0.3, r * 0.07, 3 + lv * 2);
  barrel(r * 0.3, r * 0.34, r * 0.18, r * 0.24, lw * 0.8);
  awning(-r * 0.75, r * 0.75, -r * 0.12, r * 0.08, 6, owner, lw);
  // goods out front: more with each level
  crate(-r * 1.0, by - r * 0.1, r * 0.3, lw);
  if (lv >= 2) crate(-r * 0.72, by - r * 0.1, r * 0.24, lw);
  if (lv >= 3) crate(-r * 0.98, by - r * 0.4, r * 0.22, lw);
  barrel(r * 0.95, by - r * 0.1, r * 0.22, r * 0.3, lw);
  if (lv >= 2) coins(r * 0.7, by - r * 0.12, r * 0.06, lv * 2);
  // a gold crystal on the roof between two in the owner's colour
  drawGoldCrystal(0, -r * 0.72, r * (0.17 + 0.03 * lv), s * 0.2 * (1 + out));
  drawCrystal(-r * 0.42, -r * 0.66, r * 0.1, owner, out);
  drawCrystal(r * 0.42, -r * 0.66, r * 0.1, owner, out);
  drawCracks(0, r * 0.2, r * 0.6, 1 - t.hp / t.maxHp, t.id);
  ctx.restore();
  if (t.hp / t.maxHp < 0.3) drawSmoke(x, y, r, now, t.id);
}

function drawGoldCrystal(x, y, cr, glow) {
  if (glow > 0) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, cr * 2.6);
    g.addColorStop(0, 'rgba(255,213,79,0.55)');
    g.addColorStop(1, 'rgba(255,213,79,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, cr * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fff2b0';
  ctx.beginPath();
  ctx.moveTo(x, y - cr * 1.45);
  ctx.lineTo(x + cr * 0.75, y - cr * 0.1);
  ctx.lineTo(x, y + cr);
  ctx.lineTo(x - cr * 0.75, y - cr * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e0a800';
  ctx.beginPath();
  ctx.moveTo(x, y - cr * 1.45);
  ctx.lineTo(x + cr * 0.75, y - cr * 0.1);
  ctx.lineTo(x, y + cr);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(x, y - cr * 1.45);
  ctx.lineTo(x - cr * 0.75, y - cr * 0.1);
  ctx.lineTo(x - cr * 0.3, y - cr * 0.25);
  ctx.closePath();
  ctx.fill();
}

// ---- caravans

// A caravan at screen (x, y), s = pixels per tile. face: 1 heading right, -1 left.
function drawCaravan(u, x, y, s, now) {
  const sz = s * 1.25;
  const t = now / 1000 + u.id;
  const moving = u.moving ? 1 : 0;
  ctx.save();
  ctx.translate(x, y);
  if (S.selCaravan === u.id) {
    // selected: a turning dashed ring
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -now / 60;
    ctx.beginPath();
    ctx.ellipse(0, sz * 0.1, sz * 1.15, sz * 0.75, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // the two guards: one walking behind on the far side, one ahead on the near side (bobbing as they walk)
  const f = u.face || 1;
  const bob = -Math.abs(Math.sin(t * 8)) * sz * 0.04 * moving;
  const gk = s * 0.27;
  drawTroop(ctx, 'soldier', u.owner, -f * sz * 0.95, -sz * 0.35 + bob, gk, f);
  drawOxWagon(ctx, 0, 0, sz * 0.62, teamOf(u.owner), f, t * 4 * moving, t * 6 * moving, 1 + (u.level || 1));
  drawTroop(ctx, 'soldier', u.owner, f * sz * 0.15, sz * 0.5 + bob, gk, f);
  ctx.restore();
}

// ---- trade roads: shown for the selected trade post or caravan (mine or an ally's).
function drawTradeRoads() {
  if (!S.myId) return;
  const s = scale();
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // only the road of the selected trade post, or of the selected caravan's post
  const cart = S.selCaravan ? S.units.get(S.selCaravan) : null;
  const showId = cart ? cart.from : S.selectedId;
  if (!showId) return;
  for (const t of S.towersView.values()) {
    if (t.id !== showId) continue;
    if (t.kind !== 'trade' || !t.partner || !t.owner || !t.road || !t.road.length) continue;
    if (t.owner !== S.myId && !isAlly(t.owner)) continue;
    const o = S.towersView.get(t.partner);
    if (!o) continue;
    const a = hexSpot(t.x, t.y);
    const b = hexSpot(o.x, o.y);
    const pts = [[a.x, a.y + 0.6], ...t.road.map((k) => [(k % C.MAP_W) + 0.5, Math.floor(k / C.MAP_W) + 0.5]), [b.x, b.y + 0.6]].map(([x, y]) => toScreen(x, y));
    const trace = () => {
      ctx.beginPath();
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    };
    // a soft road bed, then dashes rolling toward the partner
    ctx.strokeStyle = 'rgba(160, 130, 90, 0.16)';
    ctx.lineWidth = Math.max(3, s * 0.45);
    trace();
    ctx.stroke();
    ctx.strokeStyle = colorOf(t.owner, 70, 0.45);
    ctx.lineWidth = Math.max(1.5, s * 0.09);
    ctx.setLineDash([s * 0.5, s * 0.6]);
    ctx.lineDashOffset = -performance.now() / 150;
    trace();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// ---- the trade post panel (selection panel): who it trades with, and switching partner.

// Allied trade posts trade post t could trade with.
function partnerChoices(t) {
  return [...S.towers.values()].filter((o) => o.kind === 'trade' && o.owner && !o.ruin && o.owner !== t.owner && isAlly(o.owner));
}

function cargoOf(t, o) {
  const d = Math.hypot(t.x - o.x, t.y - o.y);
  return Math.round((C.CARAVAN_BASE + C.CARAVAN_PER_TILE * d) * (1 + C.CARAVAN_LEVEL_CARGO * (t.level - 1)));
}

function tradeInfo(t) {
  const o = t.partner ? S.towers.get(t.partner) : null;
  if (!o) {
    const allies = (players.get(S.myId)?.allies || []).length;
    return `<div style="grid-column:span 2" class="muted">${allies
      ? 'No route yet: an ally needs a trade post too.'
      : 'No route: make an alliance (player list, top right), and get your ally to build a trade post.'}</div>`;
  }
  const q = players.get(o.owner);
  const choices = partnerChoices(t);
  const mine = S.myId === t.owner;
  return `<div style="grid-column:span 2">Trading with <b style="color:${colorOf(o.owner, 70)}">${escapeHtml(q ? q.name : '?')}</b></div>
    <div>Cargo <b>${cargoOf(t, o)}g</b></div><div>Every <b>${C.CARAVAN_EVERY}s</b></div>
    ${mine && choices.length > 1 ? '<div style="grid-column:span 2"><button id="sel-partner">⇄ Trade with another ally post</button></div>' : ''}`;
}

function bindTradePanel(t) {
  const b = $('sel-partner');
  if (!b) return;
  b.onclick = () => {
    const list = partnerChoices(t).sort((a, c) => a.id - c.id);
    const k = list.findIndex((o) => o.id === t.partner);
    const next = list[(k + 1) % list.length];
    if (next) sendMsg({ t: 'trade', id: t.id, partner: next.id });
  };
}

export { bindTradePanel, cargoOf, drawCaravan, drawGoldCrystal, drawTradeRoads, drawTradeSprite, tradeInfo };
