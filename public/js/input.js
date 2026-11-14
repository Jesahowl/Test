// Input: mouse, keyboard, minimap and help window.

import { closeConfirm, confirmOpen } from './diplomacy.js';
import { expandAll, landDown, landMove, landUp } from './land.js';
import { newSquadFromPicked, orderAt, pickSquadOf, selectAllSquads, squadKey, toggleBuild, toggleNewWaves } from './bar.js';
import { sendMsg } from './net.js';
import { clearSelection } from './overlay.js';
import { resize } from './render.js';
import { join, specNext, startSpectating } from './screens.js';
import { S, $, C, cam, canvas, grid, keys, towerInHex, mini, mouse, players, scale, selUnits, terr, toWorld } from './state.js';
import { orderTargetAt } from './targets.js';
import { hideTip } from './ui.js';

// ------------------------------------------------------------------ input
function updateMouseWorld() {
  [mouse.wx, mouse.wy] = toWorld(mouse.sx, mouse.sy);
}

canvas.addEventListener('mousemove', (e) => {
  mouse.sx = e.clientX;
  mouse.sy = e.clientY;
  if (mouse.rightDown) {
    const dx = e.clientX - mouse.lastX;
    const dy = e.clientY - mouse.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) mouse.dragged = true;
    if (mouse.dragged) {
      cam.x -= dx / scale();
      cam.y -= dy / scale();
    }
    mouse.lastX = e.clientX;
    mouse.lastY = e.clientY;
  }
  updateMouseWorld();
  landMove();
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2 || e.button === 1) {
    mouse.rightDown = true;
    mouse.dragged = false;
    mouse.lastX = e.clientX;
    mouse.lastY = e.clientY;
    return;
  }
  if (e.button !== 0 || !S.myId) return;
  updateMouseWorld();
  const tx = Math.floor(mouse.wx);
  const ty = Math.floor(mouse.wy);

  if (S.buildKind === 'land') {
    landDown();
    return;
  }
  if (S.buildKind) {
    sendMsg({ t: 'build', kind: S.buildKind, x: tx, y: ty });
    return;
  }

  // Left-click a troop: pick its squad (Shift: pick single troops, to move them to another squad).
  // Otherwise select a tower or ruin.
  let hit = null;
  let hitD = 0.6;
  for (const u of S.units.values()) {
    if (u.owner !== S.myId) continue;
    const d = Math.hypot(u.rx - mouse.wx, u.ry - mouse.wy);
    if (d < hitD) {
      hitD = d;
      hit = u;
    }
  }
  if (hit) {
    S.selectedId = null;
    if (e.ctrlKey || e.metaKey || e.altKey) {
      // pick single troops (to split them off or move them to another squad)
      if (selUnits.has(hit.id)) selUnits.delete(hit.id);
      else selUnits.add(hit.id);
    } else {
      pickSquadOf(hit, e.shiftKey);
    }
    return;
  }
  const ht = towerInHex(mouse.wx, mouse.wy);
  const tid = ht ? ht.id : 0;
  selUnits.clear();
  S.buildKind = null;
  S.selectedId = tid && S.towers.has(tid) ? tid : null;
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0 && S.landDrag) landUp();
  if ((e.button === 2 || e.button === 1) && mouse.rightDown) {
    mouse.rightDown = false;
    if (mouse.dragged || !S.myId) return;
    // A right-click (not a drag): order troops at whatever is under the cursor, or cancel.
    if (S.buildKind) {
      S.buildKind = null;
      return;
    }
    updateMouseWorld();
    const tg = orderTargetAt(mouse.wx, mouse.wy);
    if (tg) orderAt(tg);
    else if (mouse.wx >= 0 && mouse.wy >= 0 && mouse.wx < C.MAP_W && mouse.wy < C.MAP_H) {
      // Empty ground: move there and hold the spot.
      orderAt({ k: 'p', id: Math.floor(mouse.wy) * C.MAP_W + Math.floor(mouse.wx) });
    }
  }
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Double-click outside your land: expand your land outward all round (buying the border ring).
canvas.addEventListener('dblclick', (e) => {
  if (e.button !== 0 || !S.myId || S.spectating || (S.buildKind && S.buildKind !== 'land')) return;
  updateMouseWorld();
  const tx = Math.floor(mouse.wx);
  const ty = Math.floor(mouse.wy);
  if (tx < 0 || ty < 0 || tx >= C.MAP_W || ty >= C.MAP_H || terr[ty * C.MAP_W + tx] === S.myId) return;
  expandAll(mouse.wx, mouse.wy);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [bx, by] = toWorld(e.clientX, e.clientY);
  cam.zoom = Math.min(2.5, Math.max(0.35, cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  const [ax, ay] = toWorld(e.clientX, e.clientY);
  cam.x += bx - ax;
  cam.y += by - ay;
  updateMouseWorld();
}, { passive: false });

function moveCamFromMinimap(e) {
  S.specFollow = false;
  const rect = mini.getBoundingClientRect();
  cam.x = ((e.clientX - rect.left) / rect.width) * C.MAP_W;
  cam.y = ((e.clientY - rect.top) / rect.height) * C.MAP_H;
}

mini.addEventListener('mousedown', (e) => {
  moveCamFromMinimap(e);
  const move = (ev) => moveCamFromMinimap(ev);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), { once: true });
});

window.addEventListener('keydown', (e) => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') {
    if (e.key === 'Enter') join();
    return;
  }
  const k = e.key.toLowerCase();
  if (confirmOpen()) {
    // the "break alliance?" box takes the keyboard: Esc cancels (Enter presses its focused button)
    if (k === 'escape') closeConfirm();
    return;
  }
  keys.add(k);
  if (S.spectating) {
    if (k === 'tab') {
      e.preventDefault();
      specNext();
    }
    if (k === ' ') {
      e.preventDefault();
      S.specFollow = true;
    }
    return;
  }
  if (!S.myId) return;
  if (k === 'b') toggleBuild('tower');
  if (k === 'r') toggleBuild('barracks');
  if (k === 'l') toggleBuild('land');
  if (k === 'escape') {
    S.buildKind = null;
    clearSelection();
  }
  if (k === 'q') {
    S.buildKind = null;
    selectAllSquads();
  }
  if (k === 'h') orderAt({ k: 'c', id: S.myId }, { everyone: true });
  if (k === 'f') toggleNewWaves();
  if (k === 'n') newSquadFromPicked();
  if (k === 'm') $('squad-merge').click();
  if (k === ' ') {
    e.preventDefault();
    const p = players.get(S.myId);
    if (p) {
      cam.x = p.x + 0.5;
      cam.y = p.y + 0.5;
    }
  }
  // 1-9: pick the squad with that number (Shift adds; with single troops picked, move them in).
  const m = /^Digit([1-9])$/.exec(e.code);
  if (m) squadKey(Number(m[1]), e.shiftKey);
  if (k === 'u' && S.selectedId) sendMsg({ t: 'upgrade', id: S.selectedId });
  if ((k === 'delete' || k === 'backspace') && S.selectedId) {
    const t = S.towers.get(S.selectedId);
    if (t && t.owner === S.myId) sendMsg({ t: 'sell', id: S.selectedId });
  }
});

window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

window.addEventListener('blur', () => keys.clear());

window.addEventListener('resize', resize);

// Controls / how-to-play window: ? toggles it, Esc or × closes it.
function setHelp(show) {
  $('help').classList.toggle('hidden', !show);
  hideTip();
}

$('help').querySelector('.close').onclick = () => setHelp(false);

$('help').addEventListener('mousedown', (e) => {
  if (e.target === $('help')) setHelp(false);
});

$('help-toggle').onclick = () => setHelp(true);

$('tips-reset').onclick = () => {
  S.tipsDone = new Set();
  S.tipsOff = false;
  try {
    localStorage.removeItem('ts-tips');
    localStorage.removeItem('ts-tips-off');
  } catch { /* ignore */ }
  $('tips').dataset.key = '';
  setHelp(false);
};

window.addEventListener('keydown', (e) => {
  if (document.activeElement?.tagName === 'INPUT') return;
  if (e.key === '?') setHelp($('help').classList.contains('hidden'));
  else if (e.key === 'Escape') setHelp(false);
});

// Menu logo: a core crystal.
(function drawLogo() {
  // the crystal core, in gold: a rune circle, a stone dais and a floating crystal with shards
  const c = $('logo');
  const g = c.getContext('2d');
  const x = 36;
  const glow = g.createRadialGradient(x, 28, 3, x, 28, 34);
  glow.addColorStop(0, 'rgba(255, 213, 79, 0.5)');
  glow.addColorStop(1, 'rgba(255, 213, 79, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 72, 72);
  g.strokeStyle = 'rgba(255, 213, 79, 0.85)';
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(x, 58, 26, 9, 0, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([3, 4]);
  g.lineWidth = 1.2;
  g.beginPath();
  g.ellipse(x, 58, 20, 7, 0, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#3a4048';
  g.strokeStyle = '#22272d';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x - 16, 58);
  g.lineTo(x - 11, 50);
  g.lineTo(x + 11, 50);
  g.lineTo(x + 16, 58);
  g.closePath();
  g.fill();
  g.stroke();
  const gem = (cx, cy, r, light, dark) => {
    g.fillStyle = light;
    g.beginPath();
    g.moveTo(cx, cy - r * 1.45);
    g.lineTo(cx + r * 0.75, cy - r * 0.1);
    g.lineTo(cx, cy + r);
    g.lineTo(cx - r * 0.75, cy - r * 0.1);
    g.closePath();
    g.fill();
    g.fillStyle = dark;
    g.beginPath();
    g.moveTo(cx, cy - r * 1.45);
    g.lineTo(cx + r * 0.75, cy - r * 0.1);
    g.lineTo(cx, cy + r);
    g.closePath();
    g.fill();
  };
  g.shadowColor = '#ffd54f';
  g.shadowBlur = 10;
  gem(x, 31, 15, '#fff1b8', '#e0b23a');
  g.shadowBlur = 0;
  gem(x - 22, 34, 4, '#fff1b8', '#e0b23a');
  gem(x + 22, 28, 4, '#fff1b8', '#e0b23a');
})();

$('play').onclick = join;

$('again').onclick = () => sendMsg(S.room ? { t: 'leave' } : { t: 'join', name: S.lastName });

$('spectate').onclick = startSpectating;

export { updateMouseWorld };
