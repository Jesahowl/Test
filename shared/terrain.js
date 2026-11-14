// The ground: which hexes are forest. Grown from the round's map seed with value noise, so the
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

  const api = { hash, isForest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TD_TERRAIN = api;
})(typeof window !== 'undefined' ? window : globalThis);
