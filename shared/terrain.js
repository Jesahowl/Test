// The ground: which hexes are forest, and where the rivers run. Grown from the round's map seed with value noise, so the
// server (where workers chop wood) and every browser (which draws the trees) agree.
(function (root) {
  'use strict';

  const FOREST_AT = 0.64; // noise above this is forest (about one hex in six)

  function hash(seed, x, y) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 0x27d4eb2d);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  function vnoise(seed, x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = hash(seed, xi, yi);
    const b = hash(seed, xi + 1, yi);
    const c = hash(seed, xi, yi + 1);
    const d = hash(seed, xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }
  const fbm = (seed, x, y) => 0.6 * vnoise(seed, x, y) + 0.3 * vnoise(seed + 1, x * 2.1, y * 2.1) + 0.1 * vnoise(seed + 2, x * 4.3, y * 4.3);

  // Is hex h (with cx, cy in tiles) forest on the map grown from `seed`? Only whole hexes: the cut-off
  // ones along the map's edge are never forest.
  const isForest = (seed, h) => h.full !== false && fbm(seed, h.cx / 10, h.cy / 10) > FOREST_AT;

  // ---- rivers: they run along hex edges (between two hexes, like walls), from one side of the map
  // toward the opposite side, meandering. A river edge can't be crossed, except where a bridge is.
  // Returns [{ pts: [[x, y], ...] (the corners it runs along, for drawing), edges: [{ a, b, bridge, x1, y1, x2, y2 }] }].
  // Everything comes from the seed and the hex grid, so the server and every browser agree.
  const RIVER_BRIDGE_EVERY = 6; // a bridge every this many edges along a river
  function riversOf(seed, hex, w, h) {
    const vkey = (p) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
    const verts = new Map(); // key -> { p: [x, y], edges: [] }
    const edgeSeen = new Set();
    const vert = (p) => {
      const k = vkey(p);
      let v = verts.get(k);
      if (!v) verts.set(k, (v = { k, p, edges: [] }));
      return v;
    };
    for (const hx of hex.hexes) {
      const cs = hex.corners(hx);
      for (let k = 0; k < 6; k++) {
        const j = hex.across(hx, k);
        if (j < 0) continue; // the map's edge
        const id = hx.i < j ? `${hx.i}:${j}` : `${j}:${hx.i}`;
        if (edgeSeen.has(id)) continue;
        edgeSeen.add(id);
        const [p1, p2] = [cs[k], cs[(k + 1) % 6]];
        if (p1[0] < 0 || p1[1] < 0 || p2[0] < 0 || p2[1] < 0 || p1[0] > w || p2[0] > w || p1[1] > h || p2[1] > h) continue; // off the map
        const e = { a: hx.i, b: j, v1: vert(p1), v2: vert(p2) };
        e.v1.edges.push(e);
        e.v2.edges.push(e);
      }
    }
    const count = Math.max(1, Math.round((w * h) / 6000));
    const used = new Set(); // vertex keys rivers already run through
    const rivers = [];
    for (let r = 0; r < count; r++) {
      // start on one side of the map (left/top/right/bottom), head for the opposite side
      const side = (Math.floor(hash(seed, r, 77) * 4) + r * 2) % 4;
      const along = 0.25 + hash(seed, r, 78) * 0.5;
      const start = [[2, along * h], [along * w, 2], [w - 2, along * h], [along * w, h - 2]][side];
      const goal = [[w, (0.2 + hash(seed, r, 79) * 0.6) * h], [(0.2 + hash(seed, r, 79) * 0.6) * w, h], [0, (0.2 + hash(seed, r, 79) * 0.6) * h], [(0.2 + hash(seed, r, 79) * 0.6) * w, 0]][side];
      let cur = null;
      let best = Infinity;
      for (const v of verts.values()) {
        if (used.has(v.k) || v.edges.length < 2) continue;
        const d = Math.hypot(v.p[0] - start[0], v.p[1] - start[1]);
        if (d < best) {
          best = d;
          cur = v;
        }
      }
      if (!cur) continue;
      const pts = [cur.p];
      const edges = [];
      const here = new Set([cur.k]);
      for (let step = 0; step < 400; step++) {
        // wander: the way to the goal, turned by smooth noise along the river
        const gx = goal[0] - cur.p[0];
        const gy = goal[1] - cur.p[1];
        if (Math.hypot(gx, gy) < 3) break;
        const turn = (vnoise(seed + 31 * r, step / 7, r * 3.1) - 0.5) * 2.4;
        const ang = Math.atan2(gy, gx) + turn;
        let pick = null;
        let score = -Infinity;
        for (const e of cur.edges) {
          const nv = e.v1 === cur ? e.v2 : e.v1;
          if (here.has(nv.k)) continue;
          const dx = nv.p[0] - cur.p[0];
          const dy = nv.p[1] - cur.p[1];
          const sc = Math.cos(Math.atan2(dy, dx) - ang) + (hash(seed, step, r * 13 + 5) - 0.5) * 0.3;
          if (sc > score) {
            score = sc;
            pick = e;
          }
        }
        if (!pick) break;
        const nv = pick.v1 === cur ? pick.v2 : pick.v1;
        edges.push({ a: pick.a, b: pick.b, x1: cur.p[0], y1: cur.p[1], x2: nv.p[0], y2: nv.p[1], bridge: false });
        pts.push(nv.p);
        here.add(nv.k);
        cur = nv;
        if (used.has(nv.k)) break; // ran into another river: it flows into it
        if (nv.edges.length < 3 && edges.length > 4) break; // reached the map's edge
      }
      if (edges.length < 8) continue;
      for (const k of here) used.add(k);
      // bridges, evenly along it (not right at its ends)
      const off = 2 + Math.floor(hash(seed, r, 80) * (RIVER_BRIDGE_EVERY - 1));
      for (let k = off; k < edges.length - 2; k += RIVER_BRIDGE_EVERY) edges[k].bridge = true;
      rivers.push({ pts, edges });
    }
    return rivers;
  }

  // Is hex h an iron ore deposit? Rarer than forests (about one hex in thirty, in clusters), never on a forest,
  // and only whole hexes.
  const IRON_AT = 0.7;
  const isIron = (seed, h) => h.full !== false && !isForest(seed, h) && fbm(seed + 77, h.cx / 7, h.cy / 7) > IRON_AT && hash(seed + 5, h.q, h.r) < 0.45;

  // Is hex h a gold vein? Rare (about one hex in 140: a handful a map): whole hexes only, never a
  // forest or an ore deposit.
  const isGoldVein = (seed, h) => h.full !== false && !isForest(seed, h) && !isIron(seed, h) && hash(seed + 913, h.q * 7 + 3, h.r * 11 + 5) < 0.007;

  const api = { hash, isForest, isIron, isGoldVein, riversOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TD_TERRAIN = api;
})(typeof window !== 'undefined' ? window : globalThis);
