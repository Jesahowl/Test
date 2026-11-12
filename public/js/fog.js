// Fog of war: what I can see, what I remember, and the fog overlay.

import { S, C, ctx, explored, fogCanvas, fogCtx, fogImg, NTILES, players, scale, terr, terrSeen, toScreen, vis, Vision } from './state.js';
import { drawTerritory } from './territory.js';

const seesTile = (x, y) => vis[Math.floor(y) * C.MAP_W + Math.floor(x)] === 1;

// Recompute my sight and the remembered map. terrChanged: new territory arrived this update.
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
  for (const u of S.units.values()) if (u.owner === S.myId) sources.push({ x: u.x, y: u.y, r: C.UNITS[u.kind].sight || 5 });
  Vision.computeVision(vis, C.MAP_W, C.MAP_H, S.myId, terr, sources);
  for (let k = 0; k < NTILES; k++) {
    if (!vis[k]) continue;
    explored[k] = 1;
    if (terrSeen[k] !== terr[k]) {
      terrSeen[k] = terr[k];
      redraw = true;
    }
  }
  S.terrView = terrSeen;
  if (redraw) drawTerritory();
  // Buildings, cores and camps: live while in sight, otherwise as last seen.
  const remember = (seen, live, posOf) => {
    for (const [id, o] of live) {
      const [x, y] = posOf(o);
      if (seesTile(x, y) || o.owner === S.myId || o.id === S.myId) seen.set(id, o);
    }
    for (const [id, o] of seen) {
      const [x, y] = posOf(o);
      if (!live.has(id) && seesTile(x, y)) seen.delete(id); // gone, and we can see it's gone
    }
    return seen;
  };
  S.towersView = remember(S.towersSeen, S.towers, (t) => [t.x, t.y]);
  S.coresView = remember(S.coresSeen, players, (p) => [p.x, p.y]);
  S.campsView = [...remember(S.campsSeen, S.campMap, (c) => [c.x, c.y]).values()];
  // Fog image: clear where I see, dim where I've been, dark where I've never looked.
  const d = fogImg.data;
  for (let k = 0; k < NTILES; k++) {
    d[k * 4] = 8;
    d[k * 4 + 1] = 11;
    d[k * 4 + 2] = 15;
    d[k * 4 + 3] = vis[k] ? 0 : explored[k] ? 120 : 246;
  }
  fogCtx.putImageData(fogImg, 0, 0);
}

function resetFog() {
  vis.fill(0);
  explored.fill(0);
  terrSeen.fill(0);
  S.towersSeen = new Map();
  S.coresSeen = new Map();
  S.campsSeen = new Map();
  S.fogWasOn = null;
}

function drawFog() {
  if (!S.fogOn) return;
  const s = scale();
  const [ox, oy] = toScreen(0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fogCanvas, ox, oy, C.MAP_W * s, C.MAP_H * s);
  ctx.restore();
}

export { drawFog, resetFog, updateFog };
