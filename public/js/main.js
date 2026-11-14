// Entry point: the main loop and start-up.

import { drawWalls } from './walls.js';
import { layoutHud } from './layout.js';
import { buildBar } from './bar.js';
import { drawCamps, drawCreeps } from './camps.js';
import { drawCores } from './cores.js';
import { initDiplomacy } from './diplomacy.js';
import { drawEffects } from './effects.js';
import { drawFog } from './fog.js';
import { updateHud } from './hud.js';
import { updateMouseWorld } from './input.js';
import { connect } from './net.js';
import './lobby.js'; // private rooms: menu buttons, lobby screen, invite links
import { drawMinimap, drawOverlay } from './overlay.js';
import { drawBackground, resize } from './render.js';
import { specNext } from './screens.js';
import { S, $, C, cam, keys, mouse, players } from './state.js';
import { drawTowers } from './structures.js';
import { drawTradeRoads } from './trade.js';
import { drawUnits } from './troops.js';

// ------------------------------------------------------------------ main loop
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const pan = (18 / cam.zoom) * dt;
  if (S.myId || S.spectating) {
    const before = cam.x + cam.y;
    if (keys.has('w') || keys.has('arrowup')) cam.y -= pan;
    if (keys.has('s') || keys.has('arrowdown')) cam.y += pan;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= pan;
    if (keys.has('d') || keys.has('arrowright')) cam.x += pan;
    if (S.spectating) {
      if (cam.x + cam.y !== before || (mouse.rightDown && mouse.dragged)) S.specFollow = false;
      if (!players.has(S.specTarget)) specNext(); // followed player is gone: pick the leader
      const t = players.get(S.specTarget);
      if (t && S.specFollow) {
        const k = Math.min(1, dt * 4);
        cam.x += (t.x + 0.5 - cam.x) * k;
        cam.y += (t.y + 0.5 - cam.y) * k;
      }
    }
  } else {
    // Slow drift across the live map behind the menu.
    cam.x = C.MAP_W / 2 + Math.cos(now / 20000) * C.MAP_W * 0.25;
    cam.y = C.MAP_H / 2 + Math.sin(now / 20000) * C.MAP_H * 0.25;
  }
  cam.x = Math.max(0, Math.min(C.MAP_W, cam.x));
  cam.y = Math.max(0, Math.min(C.MAP_H, cam.y));
  updateMouseWorld();

  drawBackground();
  drawTradeRoads();
  drawCamps();
  drawTowers(dt);
  drawWalls();
  drawCreeps(dt);
  drawUnits(dt);
  drawCores(dt);
  drawEffects(now);
  drawFog();
  drawOverlay();
  if (S.myId || S.spectating) drawMinimap();

  S.hudTimer -= dt;
  if (S.hudTimer <= 0) {
    S.hudTimer = 0.15;
    updateHud();
    layoutHud();
  }
  requestAnimationFrame(frame);
}

try { $('name').value = localStorage.getItem('ts-name') || ''; } catch { /* ignore */ }

resize();

buildBar();
initDiplomacy();

connect();

requestAnimationFrame(frame);
