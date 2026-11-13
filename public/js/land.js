// Buying land: press L (or the Land button), then click border tiles or drag along your border.
// Tiles you can buy light up near the cursor; a drag collects tiles (each must touch your land or
// a tile already in the drag) and buys them all when you let go, as far as your gold goes.

import { sendMsg } from './net.js';
import { label } from './render.js';
import { S, C, ctx, mouse, players, scale, terr, toScreen } from './state.js';

const W = C.MAP_W;
const H = C.MAP_H;

S.landDrag = null; // { tiles: [k...], set: Set(k) } while dragging

function myLand() {
  const p = players.get(S.myId);
  return p ? p.territory : 0;
}

// Mirrors the server's rule: empty, touching my land (or tiles in this drag), and not making my
// land touch itself only diagonally across someone else's.
function canBuy(k, pending) {
  if (k < 0 || k >= W * H || terr[k] || (pending && pending.has(k))) return false;
  const x = k % W;
  const y = (k - x) / W;
  const at = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return -1;
    const j = ty * W + tx;
    return pending && pending.has(j) ? S.myId : terr[j];
  };
  const me = S.myId;
  if (at(x - 1, y) !== me && at(x + 1, y) !== me && at(x, y - 1) !== me && at(x, y + 1) !== me) return false;
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const h = at(x + dx, y);
    if (at(x + dx, y + dy) === me && h > 0 && h !== me && at(x, y + dy) === h) return false;
  }
  return true;
}

// Gold for the next n tiles.
function costOf(n) {
  let total = 0;
  const land = myLand();
  for (let i = 0; i < n; i++) total += C.landCost(land + i);
  return total;
}

const tileAtMouse = () => {
  const tx = Math.floor(mouse.wx);
  const ty = Math.floor(mouse.wy);
  return tx < 0 || ty < 0 || tx >= W || ty >= H ? -1 : ty * W + tx;
};

// Add the tile under the cursor to the drag if it's buyable and affordable.
function addHovered() {
  const d = S.landDrag;
  if (!d) return;
  const k = tileAtMouse();
  if (k < 0 || !canBuy(k, d.set)) return;
  if (costOf(d.tiles.length + 1) > (S.me ? S.me.gold : 0)) return;
  d.tiles.push(k);
  d.set.add(k);
}

function landDown() {
  S.landDrag = { tiles: [], set: new Set() };
  addHovered();
}

function landMove() {
  if (S.landDrag) addHovered();
}

function landUp() {
  const d = S.landDrag;
  S.landDrag = null;
  if (!d || !d.tiles.length) return;
  for (let i = 0; i < d.tiles.length; i += C.LAND_BUY_MAX) sendMsg({ t: 'land', tiles: d.tiles.slice(i, i + C.LAND_BUY_MAX) });
}

function drawLandMode() {
  const s = scale();
  const d = S.landDrag;
  const pending = d ? d.set : null;
  const hover = tileAtMouse();
  const hx = hover % W;
  const hy = Math.floor(hover / W);
  // buyable tiles around the cursor, fading with distance
  const R = 9;
  for (let y = Math.max(0, hy - R); y <= Math.min(H - 1, hy + R); y++) {
    for (let x = Math.max(0, hx - R); x <= Math.min(W - 1, hx + R); x++) {
      const k = y * W + x;
      const dd = Math.hypot(x - hx, y - hy);
      if (dd > R || !canBuy(k, pending)) continue;
      const [sx, sy] = toScreen(x, y);
      ctx.strokeStyle = `rgba(126, 231, 135, ${0.7 * (1 - dd / (R + 1))})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(sx + 3, sy + 3, s - 6, s - 6, s * 0.2);
      ctx.stroke();
    }
  }
  // tiles in the current drag
  if (d) {
    ctx.fillStyle = 'rgba(255, 213, 79, 0.4)';
    for (const k of d.tiles) {
      const [sx, sy] = toScreen(k % W, Math.floor(k / W));
      ctx.fillRect(sx + 1, sy + 1, s - 2, s - 2);
    }
  }
  // the hovered tile and what it costs
  const gold = S.me ? S.me.gold : 0;
  let text;
  let color = '#7ee787';
  if (d && d.tiles.length) {
    const c = costOf(d.tiles.length);
    text = `+${d.tiles.length} land: ${c}g`;
    color = '#ffd54f';
  } else if (hover >= 0 && canBuy(hover, pending)) {
    const c = C.landCost(myLand());
    text = c > gold ? `${c}g (not enough gold)` : `Buy: ${c}g`;
    if (c > gold) color = '#ffa198';
    const [sx, sy] = toScreen(hx, hy);
    ctx.fillStyle = c > gold ? 'rgba(248, 81, 73, 0.25)' : 'rgba(126, 231, 135, 0.3)';
    ctx.fillRect(sx + 1, sy + 1, s - 2, s - 2);
  } else if (hover >= 0) {
    const o = terr[hover];
    text = o === S.myId ? 'Your land: click a tile at its edge' : o ? "Someone else's land: take their towers to open it up" : 'Too far: land must touch yours';
    color = '#8b949e';
  }
  if (text) label(text, mouse.sx + 18 + text.length * 3.3, mouse.sy + 26, 12, color);
}

export { canBuy, drawLandMode, landDown, landMove, landUp };
