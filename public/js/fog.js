// Fog of war: only ground nobody on my side has explored is hidden. Once an area has been seen
// (by my core, buildings, troops or scouts) it stays revealed, with everything happening there.

import { S, C, ctx, explored, FOG_PAD, FOG_RES, fogCanvas, fogCtx, fogImg, fogSoft, fogSoftCtx, NTILES, players, scale, terr, toScreen, vis, Vision } from './state.js';
import { drawTerritory } from './territory.js';

const seesTile = (x, y) => explored[Math.floor(y) * C.MAP_W + Math.floor(x)] === 1;

// Recompute my sight and the remembered map. terrChanged: new territory arrived this update.
// The server's map of where I've explored (run lengths, starting with unexplored).
function setExplored(runs) {
  let k = 0;
  let v = 0;
  for (const n of runs) {
    explored.fill(v, k, Math.min(NTILES, k + n));
    k += n;
    v = 1 - v;
  }
}

function updateFog(terrChanged) {
  S.fogOn = !!(S.myId && players.has(S.myId) && !S.spectating);
  let redraw = terrChanged || S.fogOn !== S.fogWasOn;
  S.fogWasOn = S.fogOn;
  if (!S.fogOn) {
    S.terrView = terr;
    S.towersView = S.towers;
    S.coresView = players;
    S.campsView = S.camps;
    if (redraw) drawTerritory();
    return;
  }
  const me0 = players.get(S.myId);
  const sources = [{ x: me0.x + 0.5, y: me0.y + 0.5, r: C.CORE_SIGHT }];
  for (const t of S.towers.values()) if (t.owner === S.myId) sources.push({ x: t.x + 0.5, y: t.y + 0.5, r: C.structSight(t.kind, t.level) });
  for (const u of S.units.values()) if (u.owner === S.myId) sources.push({ x: u.x, y: u.y, r: u.kind === 'worker' && u.job === 5 ? C.SCOUT_SIGHT : C.UNITS[u.kind].sight || 5 });
  Vision.computeVision(vis, C.MAP_W, C.MAP_H, S.myId, terr, sources);
  // (explored ground comes from the server: see net.js, msg.exp)
  // Territory is always drawn with its real borders; the fog simply covers what I haven't
  // explored, so clearing fog reveals the border underneath instead of re-tracing it.
  S.terrView = terr;
  if (redraw) drawTerritory();
  // Buildings, cores and camps: live once their spot has been explored.
  // mine(o): always shown (my own buildings and core); everything else once its spot is explored.
  const remember = (seen, live, posOf, mine) => {
    for (const [id, o] of live) {
      const [x, y] = posOf(o);
      if (seesTile(x, y) || mine(o)) seen.set(id, o);
    }
    // Forget what we remember at a spot we can see that isn't there any more: gone, or moved away
    // (a cleared camp comes back somewhere else under the same id).
    for (const [id, o] of seen) {
      const [x, y] = posOf(o);
      if (!seesTile(x, y)) continue;
      const cur = live.get(id);
      if (!cur) {
        seen.delete(id);
        continue;
      }
      const [cx, cy] = posOf(cur);
      if (cx !== x || cy !== y) seen.delete(id);
    }
    return seen;
  };
  S.towersView = remember(S.towersSeen, S.towers, (t) => [t.x, t.y], (t) => t.owner === S.myId);
  S.coresView = remember(S.coresSeen, players, (p) => [p.x, p.y], (p) => p.id === S.myId);
  S.campsView = [...remember(S.campsSeen, S.campMap, (c) => [c.x, c.y], () => false).values()];
  // Fog image: clear wherever explored, dark where nobody has looked yet. Rebuilt only when
  // the explored area grows; drawn blurred so its edge is soft and round, not tile steps.
  let count = 0;
  for (let k = 0; k < NTILES; k++) count += explored[k];
  if (count === exploredCount) return;
  exploredCount = count;
  const W = fogCanvas.width;
  const d = fogImg.data;
  for (let py = 0; py < fogCanvas.height; py++) {
    for (let px = 0; px < W; px++) {
      const x = px - FOG_PAD;
      const y = py - FOG_PAD;
      const inside = x >= 0 && y >= 0 && x < C.MAP_W && y < C.MAP_H;
      const i = (py * W + px) * 4;
      d[i] = 8;
      d[i + 1] = 11;
      d[i + 2] = 15;
      d[i + 3] = inside && explored[y * C.MAP_W + x] ? 0 : 255;
    }
  }
  fogCtx.putImageData(fogImg, 0, 0);
  fogSoftCtx.clearRect(0, 0, fogSoft.width, fogSoft.height);
  fogSoftCtx.save();
  fogSoftCtx.imageSmoothingEnabled = true;
  fogSoftCtx.filter = `blur(${FOG_RES * 0.9}px)`;
  fogSoftCtx.drawImage(fogCanvas, 0, 0, fogSoft.width, fogSoft.height);
  fogSoftCtx.restore();
}

let exploredCount = -1; // explored tiles when the fog layer was last rebuilt

function resetFog() {
  vis.fill(0);
  explored.fill(0);
  S.towersSeen = new Map();
  S.coresSeen = new Map();
  S.campsSeen = new Map();
  S.fogWasOn = null;
  exploredCount = -1;
}

function drawFog() {
  if (!S.fogOn) return;
  const s = scale();
  const [ox, oy] = toScreen(0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fogSoft, ox - FOG_PAD * s, oy - FOG_PAD * s, (C.MAP_W + FOG_PAD * 2) * s, (C.MAP_H + FOG_PAD * 2) * s);
  ctx.restore();
}

export { drawFog, resetFog, setExplored, updateFog };
