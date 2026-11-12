// Fog of war: which tiles a player can see. Shared by the server (to decide which enemy troops
// to send) and the browser (to draw the fog), so both agree exactly.
(function (root) {
  'use strict';

  // Mark every tile within r of (cx, cy) as visible.
  function stamp(vis, w, h, cx, cy, r) {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.floor(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.floor(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy <= r2) vis[y * w + x] = 1;
      }
    }
  }

  // vis: Uint8Array(w*h) to fill. Your own land is always visible; sources are { x, y, r } (centres).
  function computeVision(vis, w, h, pid, terr, sources) {
    for (let k = 0; k < vis.length; k++) vis[k] = terr[k] === pid ? 1 : 0;
    for (const s of sources) stamp(vis, w, h, s.x, s.y, s.r);
    return vis;
  }

  const Vision = { stamp, computeVision };
  if (typeof module !== 'undefined' && module.exports) module.exports = Vision;
  else root.TD_VISION = Vision;
})(typeof window !== 'undefined' ? window : globalThis);
