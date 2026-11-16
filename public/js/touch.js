// Touch controls (phones and tablets), turned into the mouse actions the rest of the client already
// understands:
// - tap: a left click (pick a troop, worker or building; place what you're building)
// - press and hold (half a second): a right click (send the picked squad or worker there; a ring fills while you hold)
// - one-finger drag: move the map (while placing land or walls: drag along the border as with a mouse)
// - two fingers: pinch to zoom, drag to move the map
// - double tap outside your land: grow your land all round (as a double-click)

import { S, cam, canvas, ctx, toWorld } from './state.js';

const HOLD_MS = 480;
const MOVE_SLOP = 10; // pixels a finger may wander and still count as a tap or a hold

let one = null; // { x0, y0, x, y, at, moved, held, timer, passThrough }
let pinch = null; // { d, mx, my, zoom }
let lastTap = { at: 0, x: 0, y: 0 };

const mouse = (type, x, y, button = 0, target = canvas) => {
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button, buttons: type === 'mouseup' ? 0 : button === 2 ? 2 : 1, bubbles: true, cancelable: true }));
};
const hover = (x, y) => canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));

function startOne(t) {
  const x = t.clientX;
  const y = t.clientY;
  hover(x, y);
  // placing land or walls: the finger drags along the border, as the mouse would
  const passThrough = S.buildKind === 'land' || S.buildKind === 'wall';
  if (passThrough) mouse('mousedown', x, y, 0);
  one = { x0: x, y0: y, x, y, at: performance.now(), moved: false, held: false, passThrough, timer: 0 };
  if (!passThrough) {
    one.timer = setTimeout(() => {
      if (!one || one.moved) return;
      // held still: a right click there
      one.held = true;
      if (navigator.vibrate) navigator.vibrate(15);
      mouse('mousedown', one.x, one.y, 2);
      mouse('mouseup', one.x, one.y, 2, window);
    }, HOLD_MS);
  }
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const ts = e.touches;
  if (ts.length === 1) startOne(ts[0]);
  else if (ts.length === 2) {
    // a second finger: pinching (whatever the first one was doing is called off)
    if (one) {
      clearTimeout(one.timer);
      if (one.passThrough) mouse('mouseup', one.x, one.y, 0, window);
      one = null;
    }
    const [a, b] = ts;
    pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2 };
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const ts = e.touches;
  if (pinch && ts.length >= 2) {
    const [a, b] = ts;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mx = (a.clientX + b.clientX) / 2;
    const my = (a.clientY + b.clientY) / 2;
    // zoom about the point between the fingers, then follow them
    const [bx, by] = toWorld(mx, my);
    cam.zoom = Math.min(2.5, Math.max(0.35, cam.zoom * (d / (pinch.d || d))));
    const [ax, ay] = toWorld(mx, my);
    cam.x += bx - ax;
    cam.y += by - ay;
    const s = 28 * cam.zoom;
    cam.x -= (mx - pinch.mx) / s;
    cam.y -= (my - pinch.my) / s;
    pinch = { d, mx, my };
    S.specFollow = false;
    return;
  }
  if (!one || ts.length !== 1) return;
  const t = ts[0];
  const dx = t.clientX - one.x;
  const dy = t.clientY - one.y;
  if (!one.moved && Math.hypot(t.clientX - one.x0, t.clientY - one.y0) > MOVE_SLOP) {
    one.moved = true;
    clearTimeout(one.timer);
  }
  one.x = t.clientX;
  one.y = t.clientY;
  if (one.passThrough) {
    hover(one.x, one.y);
    return;
  }
  if (one.moved && !one.held) {
    // drag the map
    const s = 28 * cam.zoom;
    cam.x -= dx / s;
    cam.y -= dy / s;
    S.specFollow = false;
  }
}, { passive: false });

function end(e) {
  e.preventDefault();
  if (pinch && e.touches.length < 2) {
    pinch = null;
    // (one finger left on the glass: carry on as a fresh drag, never a tap)
    if (e.touches.length === 1) {
      startOne(e.touches[0]);
      one.moved = true;
      clearTimeout(one.timer);
    }
    return;
  }
  if (!one || e.touches.length) return;
  const o = one;
  one = null;
  clearTimeout(o.timer);
  if (o.passThrough) {
    mouse('mouseup', o.x, o.y, 0, window);
    return;
  }
  if (o.moved || o.held) return;
  // a tap: a left click (two quick taps in one spot: a double-click too)
  hover(o.x, o.y);
  mouse('mousedown', o.x, o.y, 0);
  mouse('mouseup', o.x, o.y, 0, window);
  const now = performance.now();
  if (now - lastTap.at < 320 && Math.hypot(o.x - lastTap.x, o.y - lastTap.y) < 30) {
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: o.x, clientY: o.y, button: 0, bubbles: true }));
    lastTap.at = 0;
  } else lastTap = { at: now, x: o.x, y: o.y };
}
canvas.addEventListener('touchend', end, { passive: false });
canvas.addEventListener('touchcancel', end, { passive: false });

// While a finger is held still: a ring filling up round it, until it counts as a right click.
function drawTouch() {
  if (!one || one.moved || one.held || one.passThrough) return;
  const t = (performance.now() - one.at) / HOLD_MS;
  if (t < 0.15) return;
  ctx.strokeStyle = 'rgba(242, 193, 78, 0.9)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(one.x, one.y, 30, -Math.PI / 2, -Math.PI / 2 + Math.min(1, t) * Math.PI * 2);
  ctx.stroke();
}

// Is this a touch device (with no mouse)? Hints and the help mention taps instead of clicks.
const touchOnly = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
if (touchOnly) document.body.classList.add('touch');

export { drawTouch, touchOnly };
