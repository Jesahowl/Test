// The hex grid: land, buildings and borders all work in hexagons (pointy-top). Under the hood the
// map keeps its fine square tiles (troop movement, pathfinding and fog use them); every tile
// belongs to the hex its centre falls in. Shared by the server and the browser so both agree.
(function (root) {
  'use strict';

  const SQ3 = Math.sqrt(3);

  // Build the grid for a w x h tile map with hexes of radius r (in tiles).
  function build(w, h, r) {
    const ox = r; // hex (0, 0) sits near the top-left corner
    const oy = r;
    const toAxial = (px, py) => {
      const x = (px - ox) / r;
      const y = (py - oy) / r;
      let q = (SQ3 / 3) * x - y / 3;
      let rr = (2 / 3) * y;
      let s = -q - rr;
      let rq = Math.round(q);
      let rr2 = Math.round(rr);
      const rs = Math.round(s);
      const dq = Math.abs(rq - q);
      const dr = Math.abs(rr2 - rr);
      const ds = Math.abs(rs - s);
      if (dq > dr && dq > ds) rq = -rr2 - rs;
      else if (dr > ds) rr2 = -rq - rs;
      return [rq, rr2];
    };
    const index = new Map(); // "q,r" -> hex index
    const hexes = []; // { i, q, r, cx, cy, tiles: [], n: [neighbour indices], centre: tile index or -1 }
    const tileHex = new Int32Array(w * h);
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const [q, rr] = toAxial(tx + 0.5, ty + 0.5);
        const key = `${q},${rr}`;
        let i = index.get(key);
        if (i === undefined) {
          i = hexes.length;
          index.set(key, i);
          hexes.push({ i, q, r: rr, cx: ox + r * SQ3 * (q + rr / 2), cy: oy + r * 1.5 * rr, tiles: [], n: [], centre: -1 });
        }
        hexes[i].tiles.push(ty * w + tx);
        tileHex[ty * w + tx] = i;
      }
    }
    const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    for (const hx of hexes) {
      for (const [dq, dr] of DIRS) {
        const j = index.get(`${hx.q + dq},${hx.r + dr}`);
        if (j !== undefined) hx.n.push(j);
      }
      // the tile at the hex's centre (where its building stands), if it's on the map
      const ctx = Math.floor(hx.cx);
      const cty = Math.floor(hx.cy);
      if (ctx >= 0 && cty >= 0 && ctx < w && cty < h && tileHex[cty * w + ctx] === hx.i) hx.centre = cty * w + ctx;
      hx.full = hx.tiles.length >= 0.85 * 2.598 * r * r; // not clipped by the map edge
    }
    const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
    // The six corners of hex hx (world/tile units), corner k at angle 60k - 30 degrees.
    const corners = (hx, inset = 0) => {
      const out = [];
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 180) * (60 * k - 30);
        out.push([hx.cx + (r - inset) * Math.cos(a), hx.cy + (r - inset) * Math.sin(a)]);
      }
      return out;
    };
    // The neighbour across edge k (between corners k and k+1), or -1.
    const across = (hx, k) => {
      const a = (Math.PI / 180) * (60 * k);
      const [q, rr] = toAxial(hx.cx + r * SQ3 * Math.cos(a), hx.cy + r * SQ3 * Math.sin(a));
      const j = index.get(`${q},${rr}`);
      return j === undefined ? -1 : j;
    };
    const at = (px, py) => {
      const [q, rr] = toAxial(px, py);
      const j = index.get(`${q},${rr}`);
      return j === undefined ? -1 : j;
    };
    return { r, hexes, tileHex, dist, corners, across, at };
  }

  const Hex = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = Hex;
  else root.TD_HEX = Hex;
})(typeof window !== 'undefined' ? window : globalThis);
