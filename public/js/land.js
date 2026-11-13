// Buying land, hex by hex: press L (or the Land button), then click a hex at your border or drag
// along it. Double-clicking outside your land buys the whole ring of hexes around it.
// Hexes you can buy are outlined near the cursor; a drag collects hexes (each must touch your land
// or a hex already in the drag) and buys them all when you let go, as far as your gold goes.

import { sendMsg } from './net.js';
import { label } from './render.js';
import { toast } from './screens.js';
import { S, C, ctx, HEX, mouse, players, scale, terr, toScreen } from './state.js';

S.landDrag = null; // { list: [hex index...], set: Set } while dragging

const ownerOf = (i) => terr[HEX.hexes[i].tiles[0]];

function myLand() {
  const p = players.get(S.myId);
  return p ? p.territory : 0;
}

// Mirrors the server's rule: empty, touching my land (or a hex in this drag), no camp in it.
function canBuy(i, pending) {
  if (i < 0 || ownerOf(i) || (pending && pending.has(i))) return false;
  const h = HEX.hexes[i];
  if (!h.n.some((j) => ownerOf(j) === S.myId || (pending && pending.has(j)))) return false;
  for (const c of S.campsView) if (c.alive && HEX.tileHex[c.y * C.MAP_W + c.x] === i) return false;
  return true;
}

// Gold for hexes `list` (in order), on top of my current land.
function costOf(list) {
  let total = 0;
  let land = myLand();
  for (const i of list) {
    const n = HEX.hexes[i].tiles.length;
    total += C.landCost(land) * n;
    land += n;
  }
  return total;
}

const hexAtMouse = () => (mouse.wx < 0 || mouse.wy < 0 || mouse.wx >= C.MAP_W || mouse.wy >= C.MAP_H ? -1 : HEX.at(mouse.wx, mouse.wy));

function addHovered() {
  const d = S.landDrag;
  if (!d) return;
  const i = hexAtMouse();
  if (i < 0 || !canBuy(i, d.set)) return;
  if (costOf([...d.list, i]) > (S.me ? S.me.gold : 0)) return;
  d.list.push(i);
  d.set.add(i);
}

function landDown() {
  S.landDrag = { list: [], set: new Set() };
  addHovered();
}

function landMove() {
  if (S.landDrag) addHovered();
}

function send(list) {
  for (let k = 0; k < list.length; k += C.LAND_BUY_MAX) sendMsg({ t: 'land', hexes: list.slice(k, k + C.LAND_BUY_MAX) });
}

function landUp() {
  const d = S.landDrag;
  S.landDrag = null;
  if (d && d.list.length) send(d.list);
}

// Double-click outside my land: buy the whole ring of hexes round my border, nearest the
// double-click first if gold runs short.
function expandAll(wx, wy) {
  if (!S.myId || !S.me) return;
  const ring = [];
  for (const h of HEX.hexes) if (canBuy(h.i, null)) ring.push([h.i, Math.hypot(h.cx - wx, h.cy - wy)]);
  if (!ring.length) return;
  ring.sort((a, b) => a[1] - b[1]);
  const list = [];
  for (const [i] of ring) {
    if (costOf([...list, i]) > S.me.gold) break;
    list.push(i);
  }
  if (!list.length) {
    toast(`Not enough gold: the next hex costs ${costOf([ring[0][0]])}g`);
    return;
  }
  send(list);
  S.effects.push({ k: 'ping', x: wx, y: wy, born: performance.now() });
}

function hexPath(h, s, inset) {
  const cs = HEX.corners(h, inset / s);
  ctx.beginPath();
  cs.forEach(([x, y], k) => {
    const [sx, sy] = toScreen(x, y);
    if (k) ctx.lineTo(sx, sy);
    else ctx.moveTo(sx, sy);
  });
  ctx.closePath();
}

function drawLandMode() {
  const s = scale();
  const d = S.landDrag;
  const pending = d ? d.set : null;
  const hover = hexAtMouse();
  const hh = hover >= 0 ? HEX.hexes[hover] : null;
  // buyable hexes around the cursor, fading with distance
  if (hh) {
    for (const h of HEX.hexes) {
      const dd = HEX.dist(h, hh);
      if (dd > 4 || !canBuy(h.i, pending)) continue;
      hexPath(h, s, 4);
      ctx.strokeStyle = `rgba(126, 231, 135, ${0.8 * (1 - dd / 5)})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if (d) {
    for (const i of d.list) {
      hexPath(HEX.hexes[i], s, 2);
      ctx.fillStyle = 'rgba(255, 213, 79, 0.42)';
      ctx.fill();
    }
  }
  const gold = S.me ? S.me.gold : 0;
  let text;
  let color = '#7ee787';
  if (d && d.list.length) {
    text = `+${d.list.length} hex${d.list.length === 1 ? '' : 'es'}: ${costOf(d.list)}g`;
    color = '#ffd54f';
  } else if (hh && canBuy(hover, pending)) {
    const c = costOf([hover]);
    text = c > gold ? `${c}g (not enough gold)` : `Claim: ${c}g`;
    if (c > gold) color = '#ffa198';
    hexPath(hh, s, 2);
    ctx.fillStyle = c > gold ? 'rgba(248, 81, 73, 0.25)' : 'rgba(126, 231, 135, 0.3)';
    ctx.fill();
  } else if (hh) {
    const o = ownerOf(hover);
    text = o === S.myId ? 'Your land: claim hexes at its edge' : o ? "Someone else's land: take their towers to open it up" : 'Too far: land must touch yours';
    color = '#8b949e';
  }
  if (text) label(text, mouse.sx + 18 + text.length * 3.3, mouse.sy + 26, 12, color);
}

export { canBuy, costOf, drawLandMode, expandAll, hexPath, landDown, landMove, landUp, myLand };
