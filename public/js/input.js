// Input: mouse, keyboard, minimap and help window.

import { orderAt, pickSquadOf, selectAllSquads, squadKey, toggleBuild } from './bar.js';
import { sendMsg } from './net.js';
import { clearSelection } from './overlay.js';
import { resize } from './render.js';
import { join, specNext, startSpectating } from './screens.js';
import { S, $, C, cam, canvas, grid, keys, mini, mouse, players, scale, selUnits, SQUAD_N, toWorld } from './state.js';
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
    if (e.shiftKey) {
      if (selUnits.has(hit.id)) selUnits.delete(hit.id);
      else selUnits.add(hit.id);
    } else {
      pickSquadOf(hit);
    }
    return;
  }
  const tid = grid.get(`${tx},${ty}`);
  selUnits.clear();
  S.buildKind = null;
  S.selectedId = tid && S.towers.has(tid) ? tid : null;
});

window.addEventListener('mouseup', (e) => {
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
  if (k === 'escape') {
    S.buildKind = null;
    clearSelection();
  }
  if (k === 'q') {
    S.buildKind = null;
    selectAllSquads();
  }
  if (k === 'h') orderAt({ k: 'c', id: S.myId }, { everyone: true });
  if (k === ' ') {
    e.preventDefault();
    const p = players.get(S.myId);
    if (p) {
      cam.x = p.x + 0.5;
      cam.y = p.y + 0.5;
    }
  }
  // 1-3: pick a squad (Shift adds; with single troops picked, move them into it).
  const m = /^Digit(\d)$/.exec(e.code);
  const idx = m ? Number(m[1]) - 1 : -1;
  if (idx >= 0 && idx < SQUAD_N) squadKey(idx, e.shiftKey);
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
  const c = $('logo');
  const g = c.getContext('2d');
  const x = 36;
  const y = 36;
  const glow = g.createRadialGradient(x, y, 4, x, y, 36);
  glow.addColorStop(0, 'rgba(255, 213, 79, 0.55)');
  glow.addColorStop(1, 'rgba(255, 213, 79, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 72, 72);
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (Math.PI / 4) * i;
    g.lineTo(x + Math.cos(a) * 24, y + Math.sin(a) * 24);
  }
  g.closePath();
  g.fillStyle = '#3a3220';
  g.fill();
  g.strokeStyle = '#ffd54f';
  g.lineWidth = 3;
  g.stroke();
  const cg = g.createLinearGradient(x - 9, y - 18, x + 9, y + 12);
  cg.addColorStop(0, '#fff6c8');
  cg.addColorStop(0.5, '#ffd54f');
  cg.addColorStop(1, '#a8801c');
  g.fillStyle = cg;
  g.beginPath();
  g.moveTo(x, y - 18);
  g.lineTo(x + 10, y - 2);
  g.lineTo(x, y + 12);
  g.lineTo(x - 10, y - 2);
  g.closePath();
  g.fill();
})();

$('play').onclick = join;

$('again').onclick = () => sendMsg(S.room ? { t: 'leave' } : { t: 'join', name: S.lastName });

$('spectate').onclick = startSpectating;

export { updateMouseWorld };
