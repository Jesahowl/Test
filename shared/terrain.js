// The ground: biomes, rivers, mountains, forests, iron ore and gold veins. Grown from the round's map seed with value noise, so the
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

  // ---- climate and biomes: temperature runs from a cold side to a warm side of the map (a different
  // way round on each map), moisture comes in patches and highlands rise in places. Each hex's
  // biome (and ground colour) comes from the climate at its centre.
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function climate(seed, x, y, w = 200, h = 100) {
    const ang = hash(seed, 3, 3) * Math.PI * 2; // which way is warm
    const across = ((x - w / 2) * Math.cos(ang) + (y - h / 2) * Math.sin(ang)) / Math.max(w, h) + 0.5;
    const temp = clamp01(across * 1.15 - 0.08 + (fbm(seed + 51, x / 27, y / 27) - 0.5) * 0.6);
    const wet = clamp01((fbm(seed + 52, x / 22.6 + 40, y / 22.6) - 0.5) * 1.6 + 0.5);
    const high = Math.max(0, (fbm(seed + 53, x / 19 + 9, y / 19 + 3) - 0.62) / 0.38);
    return { temp, wet, high };
  }

  // 'tundra' 'taiga' 'meadow' 'woods' 'steppe' 'desert' 'swamp' 'high'
  function biomeOf({ temp, wet, high }) {
    if (high > 0.45) return 'high';
    if (temp < 0.3) return wet > 0.5 ? 'taiga' : 'tundra';
    if (wet > 0.68) return 'swamp';
    if (temp > 0.68 && wet < 0.38) return 'desert';
    if (temp > 0.55 && wet < 0.5) return 'steppe';
    return wet > 0.52 ? 'woods' : 'meadow';
  }

  // The ground colour for a climate ([r, g, b]): muted, blending between the four corners of the
  // climate (cold/warm x dry/wet), a meadow green in the middle, and grey rock on highlands.
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const COLD_DRY = rgb('#4b5559');
  const COLD_WET = rgb('#22353a');
  const WARM_DRY = rgb('#5c4b30');
  const WARM_WET = rgb('#1f3a22');
  const MILD = rgb('#24331f');
  const ROCK = rgb('#3e4045');
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const smooth01 = (t) => smooth(clamp01(t));
  function groundColor({ temp, wet, high }) {
    const dry = mix(COLD_DRY, WARM_DRY, temp);
    const lush = mix(COLD_WET, WARM_WET, temp);
    let c = mix(dry, lush, smooth01((wet - 0.25) / 0.5));
    const midness = (1 - Math.abs(temp - 0.5) * 2) * (1 - Math.abs(wet - 0.5) * 2);
    c = mix(c, MILD, Math.max(0, midness) * 0.6);
    return mix(c, ROCK, smooth01(high) * 0.85);
  }

  // Is hex h (with cx, cy in tiles) forest on the map grown from `seed`? Only whole hexes: the cut-off
  // ones along the map's edge are never forest; nor are deserts.
  const isForest = (seed, h, w, hh) => h.full !== false && fbm(seed, h.cx / 10, h.cy / 10) > FOREST_AT && biomeOf(climate(seed, h.cx, h.cy, w, hh)) !== 'desert';

  // ---- the ocean: a band of sea along one side of the map (sometimes round a corner onto the next
  // side too), with a wandering coastline. Whole hexes, impassable like mountains. Kept to about a
  // tenth of the map (OCEAN_MAX at most), and never leaving bits of land cut off out at sea.
  // Returns { ocean: Set of hex indices, sides: [0 left, 1 top, 2 right, 3 bottom] }.
  const OCEAN_MAX = 0.11;
  function oceanOf(seed, hex, w, h) {
    const first = Math.floor(hash(seed, 11, 11) * 4);
    const sides = [first];
    if (hash(seed, 12, 12) < 0.4) sides.push((first + (hash(seed, 13, 13) < 0.5 ? 1 : 3)) % 4); // (round a corner)
    const fromSide = (sd, x, y) => [x, y, w - x, h - y][sd];
    const alongSide = (sd, x, y) => (sd % 2 ? x : y);
    const tiles = (set) => [...set].reduce((n, i) => n + hex.hexes[i].tiles.length, 0) / (w * h);
    // the sea grown to a given scale, tidied
    const shape = (scale) => {
      let ocean = new Set();
      for (const hx of hex.hexes) {
        for (const sd of sides) {
          const deep = (sd % 2 ? 9 : 12) * scale * (sd === first ? 1 : 0.5); // (a band along a long side is narrower; round a corner, a smaller arm)
          // (a ragged coast, never a straight line: deep bays between headlands that run right out
          // to the map's edge, and a rough 2-D wobble on top for coves, inlets and spits of land)
          const along = alongSide(sd, hx.cx, hx.cy);
          const swell = clamp01((fbm(seed + 90 + sd, along / 15, sd * 7.3) - 0.36) / 0.3);
          const reach = deep * (0.05 + 2.4 * Math.pow(swell, 1.3)) + (fbm(seed + 97, hx.cx / 7, hx.cy / 7) - 0.5) * 9;
          if (fromSide(sd, hx.cx, hx.cy) < reach) ocean.add(hx.i);
        }
      }
      // only sea that reaches the map's edge (no lakes left inland by the wobble)
      const keep = new Set();
      const stack = [...ocean].filter((i) => hex.hexes[i].full === false || hex.hexes[i].n.length < 6);
      for (const i of stack) keep.add(i);
      while (stack.length) {
        const i = stack.pop();
        for (const j of hex.hexes[i].n) if (ocean.has(j) && !keep.has(j)) { keep.add(j); stack.push(j); }
      }
      ocean = keep;
      // tidy the coast: no lone sea hexes poking into the land, no lone land hexes out at sea
      const nIn = (i) => hex.hexes[i].n.filter((j) => ocean.has(j)).length;
      for (const i of [...ocean]) if (nIn(i) <= 1 && hex.hexes[i].full !== false) ocean.delete(i);
      for (const hx of hex.hexes) if (!ocean.has(hx.i) && nIn(hx.i) >= 5) ocean.add(hx.i);
      // any land the sea cuts off from the mainland becomes sea
      const seen = new Set();
      const pieces = [];
      for (const hx of hex.hexes) {
        if (ocean.has(hx.i) || seen.has(hx.i)) continue;
        const piece = [];
        const st = [hx.i];
        seen.add(hx.i);
        while (st.length) {
          const i = st.pop();
          piece.push(i);
          for (const j of hex.hexes[i].n) if (!ocean.has(j) && !seen.has(j)) { seen.add(j); st.push(j); }
        }
        pieces.push(piece);
      }
      const main = pieces.reduce((x, y) => (y.length > x.length ? y : x), []);
      for (const pc of pieces) if (pc !== main) for (const i of pc) ocean.add(i);
      return ocean;
    };
    // (grown as wide as it can be while staying under OCEAN_MAX of the map's tiles)
    let ocean = new Set();
    for (let scale = 4, tries = 0; tries < 40; tries++, scale *= 0.94) {
      ocean = shape(scale);
      if (tiles(ocean) <= OCEAN_MAX) break;
    }
    return { ocean, sides };
  }

  // ---- lakes: a few small lakes inland (one to four hexes each), impassable like the sea. Never
  // near the coast, the map's edge or another lake. Returns a Set of hex indices.
  function lakesOf(seed, hex, w, h, ocean) {
    const lakes = new Set();
    // hexes out from the sea (and the map's edge), to keep lakes inland
    const far = new Map();
    let front = [];
    for (const hx of hex.hexes) if (ocean.has(hx.i) || hx.full === false || hx.n.length < 6) { far.set(hx.i, 0); front.push(hx.i); }
    for (let d = 1; front.length; d++) {
      const next = [];
      for (const i of front) for (const j of hex.hexes[i].n) if (!far.has(j)) { far.set(j, d); next.push(j); }
      front = next;
    }
    const want = 2 + Math.floor(hash(seed, 21, 21) * 3); // 2 to 4 lakes
    // candidates: well inland, the wetter the likelier, in a shuffled order
    const cands = hex.hexes.filter((hx) => (far.get(hx.i) || 0) >= 3)
      .map((hx) => ({ hx, score: climate(seed, hx.cx, hx.cy, w, h).wet * 0.25 + hash(seed + 23, hx.q, hx.r) }))
      .sort((a, b) => b.score - a.score);
    const centres = [];
    for (const { hx } of cands) {
      if (centres.length >= want) break;
      if (centres.some((c) => Math.hypot(c.cx - hx.cx, c.cy - hx.cy) < Math.min(w, h) * 0.35)) continue; // (spread out)
      centres.push(hx);
      const size = 1 + Math.floor(hash(seed + 24, hx.q, hx.r) * 3); // 1 to 3 hexes
      const lake = [hx.i];
      for (let k = 0; lake.length < size && k < 20; k++) {
        const from = hex.hexes[lake[Math.floor(hash(seed + 25, k, hx.i) * lake.length)]];
        const j = from.n[Math.floor(hash(seed + 26, k, hx.i) * from.n.length)];
        if (!lake.includes(j) && (far.get(j) || 0) >= 2) lake.push(j);
      }
      for (const i of lake) lakes.add(i);
    }
    return lakes;
  }

  // ---- rivers: they run along hex edges (between two hexes, like walls), from one side of the map
  // toward the opposite side, meandering. A river edge can't be crossed, except where a bridge is.
  // Returns [{ pts: [[x, y], ...] (the corners it runs along, for drawing), edges: [{ a, b, bridge, x1, y1, x2, y2 }] }].
  // Everything comes from the seed and the hex grid, so the server and every browser agree.
  // With an ocean ({ ocean, sides } from oceanOf), rivers rise on the far side of the map and flow
  // into the sea, ending where they reach the coast.
  const RIVER_GAP = 11; // rivers keep about this far (tiles, |dx| + |dy|) from each other unless joining
  const RIVER_BRIDGE_EVERY = 11; // a bridge every this many edges along a river (at least two each)
  // A river that runs into a lake (lakes: a Set of hex indices) ends there too.
  function riversOf(seed, hex, w, h, sea = null, lakes = new Set()) {
    const ocean = sea ? sea.ocean : new Set();
    const coastal = new Set(); // land hexes on the coast
    for (const i of ocean) for (const j of hex.hexes[i].n) if (!ocean.has(j)) coastal.add(j);
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
        const off = (p) => p[0] < 0 || p[1] < 0 || p[0] > w || p[1] > h;
        if (off(p1) && off(p2)) continue; // wholly off the map (edges running off it count: rivers reach the edge)
        if (ocean.has(hx.i) && ocean.has(j)) continue; // (out at sea)
        const e = { a: hx.i, b: j, v1: vert(p1), v2: vert(p2) };
        e.v1.edges.push(e);
        e.v2.edges.push(e);
        if (ocean.has(hx.i) || ocean.has(j)) e.v1.sea = e.v2.sea = true; // (a corner on the coast)
        if (coastal.has(hx.i) || coastal.has(j)) e.v1.coastal = e.v2.coastal = true; // (near it)
        if (lakes.has(hx.i) || lakes.has(j)) {
          if (lakes.has(hx.i) && lakes.has(j)) { e.v1.edges.pop(); e.v2.edges.pop(); continue; } // (inside a lake)
          e.v1.lake = e.v2.lake = true; // (a corner on a lake's shore)
        }
      }
    }
    const count = Math.max(1, Math.round((w * h) / 6000));
    const used = new Set(); // vertex keys rivers already run through
    const usedPts = []; // ...and their points
    const rivers = [];
    for (let r = 0; r < count; r++) {
      // start on one side of the map (left/top/right/bottom), head for the opposite side
      // (toward the sea when there is one: from the opposite side)
      const side = sea && sea.sides.length ? (sea.sides[r % sea.sides.length] + 2) % 4 : (Math.floor(hash(seed, r, 77) * 4) + r * 2) % 4;
      // (spread out along their side: rivers rising on the same side start well apart)
      const along = 0.15 + ((hash(seed, 0, 78) + r * 0.38) % 1) * 0.7;
      const start = [[2, along * h], [along * w, 2], [w - 2, along * h], [along * w, h - 2]][side];
      const goal = [[w, (0.2 + hash(seed, r, 79) * 0.6) * h], [(0.2 + hash(seed, r, 79) * 0.6) * w, h], [0, (0.2 + hash(seed, r, 79) * 0.6) * h], [(0.2 + hash(seed, r, 79) * 0.6) * w, 0]][side];
      // start on the map's edge (a corner with fewer than three edges), nearest the start point, not on the coast
      let cur = null;
      let best = Infinity;
      for (const v of verts.values()) {
        if (used.has(v.k) || v.edges.length > 2 || !v.edges.length || v.sea || v.lake) continue; // (corners on the map's border have one or two edges)
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
        if (Math.hypot(gx, gy) < 3 && Math.min(cur.p[0], cur.p[1], w - cur.p[0], h - cur.p[1]) < 0.8) break;
        const turn = (vnoise(seed + 31 * r, step / 7, r * 3.1) - 0.5) * 2.4;
        const ang = Math.atan2(gy, gx) + turn;
        let pick = null;
        let score = -Infinity;
        for (const e of cur.edges) {
          const nv = e.v1 === cur ? e.v2 : e.v1;
          if (here.has(nv.k)) continue;
          const dx = nv.p[0] - cur.p[0];
          const dy = nv.p[1] - cur.p[1];
          let sc = Math.cos(Math.atan2(dy, dx) - ang) + (hash(seed, step, r * 13 + 5) - 0.5) * 0.3;
          // one step from the sea or a lake: flow straight in (rather than run along the shore)
          if (nv.sea || nv.lake) sc += 10;
          // keep clear of other rivers (no two running side by side), unless flowing into one
          if (!used.has(nv.k) && usedPts.length) {
            let d = Infinity;
            for (const q of usedPts) d = Math.min(d, Math.abs(q[0] - nv.p[0]) + Math.abs(q[1] - nv.p[1]));
            if (d < RIVER_GAP) sc -= ((RIVER_GAP - d) / RIVER_GAP) * 3;
          }
          // and don't run along the coast (a corner of a coastal hex, short of the sea itself)
          if (nv.coastal && !nv.sea) sc -= 1.2;
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
        if (nv.sea) break; // reached the coast: it flows out into the sea
        if (nv.lake) break; // ran into a lake: it flows into it
        const edgeDist = Math.min(nv.p[0], nv.p[1], w - nv.p[0], h - nv.p[1]);
        const travelled = Math.hypot(nv.p[0] - pts[0][0], nv.p[1] - pts[0][1]);
        if (nv.edges.length < 3 && edges.length > 4 && edgeDist < 0.8 && travelled > 20) break; // reached the far edge of the map
      }
      if (edges.length < 8) continue;
      if (ocean.size && !cur.sea && !cur.lake && !used.has(cur.k)) continue; // (with a sea, every river ends in it, a lake, or a river that does)
      for (const k of here) used.add(k);
      usedPts.push(...pts);
      // bridges, evenly along it (not right at its ends)
      const every = Math.max(4, Math.min(RIVER_BRIDGE_EVERY, Math.floor((edges.length - 4) / 2)));
      const off = 2 + Math.floor(hash(seed, r, 80) * (every - 1));
      for (let k = off; k < edges.length - 2; k += every) edges[k].bridge = true;
      if (!edges.some((e) => e.bridge)) edges[Math.floor(edges.length / 2)].bridge = true; // (never none: no land is ever cut off)
      rivers.push({ pts, edges });
    }
    return rivers;
  }

  // ---- the whole map's layout from its seed (server and browsers alike): rivers, mountains,
  // forests, iron ore and gold veins. Mountains are impassable hexes in ridges, kept out of river
  // valleys, with passes opened wherever they (and rivers) would cut some land off; iron ore and
  // gold veins mostly lie in their foothills (the hexes next to them), a few elsewhere.
  // The ocean comes first; rivers flow into it. opts: { rivers, mountains, ocean } (false turns one off;
  // the ocean follows `mountains` unless given).
  // Returns { rivers, mountains, ocean, oceanSides, blocked, forest, iron, veins, foothills } (Sets of hex indices).
  const cache = new Map();
  function mapTerrain(seed, hex, w, h, opts = {}) {
    const withRivers = opts.rivers !== false;
    const withMountains = opts.mountains !== false;
    const withOcean = opts.ocean !== undefined ? opts.ocean !== false : withMountains;
    const key = `${seed}:${withRivers}:${withMountains}:${withOcean}:${hex.hexes.length}`;
    if (cache.has(key)) return cache.get(key);
    const sea = withOcean ? oceanOf(seed, hex, w, h) : { ocean: new Set(), sides: [] };
    const ocean = sea.ocean;
    const lakes = withOcean ? lakesOf(seed, hex, w, h, ocean) : new Set(); // (lakes come with the sea: real maps only)
    const rivers = withRivers ? riversOf(seed, hex, w, h, sea, lakes) : [];
    const water = new Set([...ocean, ...lakes]); // (the sea and lakes: no mountains, forests or ore there)
    const riverEdge = new Set();
    const riverHex = new Set();
    const ekey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    for (const r of rivers) {
      for (const e of r.edges) {
        riverHex.add(e.a);
        riverHex.add(e.b);
        if (!e.bridge) riverEdge.add(ekey(e.a, e.b));
      }
    }
    // mountains: ridges of a ridged noise, where a broader mask says there's high country
    const mountains = new Set();
    for (const hx of hex.hexes) {
      if (!withMountains || hx.full === false || riverHex.has(hx.i) || water.has(hx.i)) continue;
      const ridge = 1 - Math.abs(fbm(seed + 60, hx.cx / 15, hx.cy / 15) * 2 - 1);
      const mask = fbm(seed + 61, hx.cx / 32, hx.cy / 32);
      if (ridge > 0.9 && mask > 0.55) mountains.add(hx.i);
    }
    // Keep ranges thin and spread out, so nobody gets a natural fortress: (1) a mountain with three
    // or more mountain neighbours goes (blobs become lines); (2) an open hex with three or more
    // mountain neighbours loses some (no sheltered nooks); (3) ridges are at most MAX_RIDGE hexes,
    // with gaps cut in longer ones.
    const MAX_RIDGE = 4; // (hexes: about 24 tiles)
    const order = [...mountains].sort((a, b) => hash(seed + 62, a, 1) - hash(seed + 62, b, 1));
    const mNeighbours = (i) => hex.hexes[i].n.filter((j) => mountains.has(j));
    for (const i of order) if (mountains.has(i) && mNeighbours(i).length >= 3) mountains.delete(i);
    for (const hx of hex.hexes) {
      if (mountains.has(hx.i)) continue;
      const round = mNeighbours(hx.i).sort((a, b) => hash(seed + 63, a, 2) - hash(seed + 63, b, 2));
      const wet = hex.hexes[hx.i].n.filter((j) => water.has(j)).length; // (on the coast the sea shelters it too)
      while (round.length > 2 || (round.length && round.length + wet > 3)) mountains.delete(round.pop());
    }
    for (let guard = 0; guard < 50; guard++) {
      let cut = false;
      const seenR = new Set();
      for (const start of [...mountains].sort((a, b) => a - b)) {
        if (seenR.has(start)) continue;
        const ridge = [];
        const stack = [start];
        seenR.add(start);
        while (stack.length) {
          const i = stack.shift();
          ridge.push(i);
          for (const j of hex.hexes[i].n) if (mountains.has(j) && !seenR.has(j)) { seenR.add(j); stack.push(j); }
        }
        if (ridge.length > MAX_RIDGE) {
          for (let k = MAX_RIDGE; k < ridge.length; k += MAX_RIDGE + 1) mountains.delete(ridge[k]);
          cut = true;
        }
      }
      if (!cut) break;
    }

    // never cut land off: while the open hexes fall apart into pieces, open passes into the
    // smallest piece (remove the mountains round it)
    for (let guard = 0; guard < 60; guard++) {
      const comp = new Map();
      const sizes = [];
      for (const hx of hex.hexes) {
        if (mountains.has(hx.i) || water.has(hx.i) || comp.has(hx.i)) continue;
        const id = sizes.length;
        let n = 0;
        const stack = [hx.i];
        comp.set(hx.i, id);
        while (stack.length) {
          const i = stack.pop();
          n++;
          for (const j of hex.hexes[i].n) {
            if (comp.has(j) || mountains.has(j) || water.has(j) || riverEdge.has(ekey(i, j))) continue;
            comp.set(j, id);
            stack.push(j);
          }
        }
        sizes.push(n);
      }
      if (sizes.length <= 1) break;
      const small = sizes.indexOf(Math.min(...sizes));
      let opened = false;
      for (const [i, id] of comp) {
        if (id !== small) continue;
        for (const j of hex.hexes[i].n) {
          if (mountains.delete(j)) opened = true;
        }
      }
      if (!opened) break; // (cut off by rivers alone: nothing mountains can do)
    }
    const foothills = new Set();
    for (const i of mountains) for (const j of hex.hexes[i].n) if (!mountains.has(j) && !water.has(j)) foothills.add(j);
    const forest = new Set();
    const iron = new Set();
    const veins = new Set();
    for (const hx of hex.hexes) {
      if (mountains.has(hx.i) || water.has(hx.i)) continue;
      if (isForest(seed, hx, w, h)) forest.add(hx.i);
    }
    for (const hx of hex.hexes) {
      if (hx.full === false || mountains.has(hx.i) || water.has(hx.i) || forest.has(hx.i)) continue;
      const hill = foothills.has(hx.i);
      // iron: mostly in the foothills, a little out in the open
      const ore = hill ? hash(seed + 5, hx.q, hx.r) < 0.18 : fbm(seed + 77, hx.cx / 7, hx.cy / 7) > 0.7 && hash(seed + 5, hx.q, hx.r) < 0.12;
      if (ore) {
        iron.add(hx.i);
        continue;
      }
      // gold veins: rare, nearly always in the foothills
      if (hash(seed + 913, hx.q * 7 + 3, hx.r * 11 + 5) < (hill ? 0.08 : 0.002)) veins.add(hx.i); // (per hex: hexes are big, so a little likelier)
    }
    // (blocked: everywhere troops can't go, mountains and sea)
    const out = { rivers, mountains, ocean, oceanSides: sea.sides, lakes, blocked: new Set([...mountains, ...ocean, ...lakes]), forest, iron, veins, foothills };
    if (cache.size > 40) cache.clear();
    cache.set(key, out);
    return out;
  }

  const api = { hash, climate, biomeOf, groundColor, isForest, mapTerrain, oceanOf, lakesOf, riversOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TD_TERRAIN = api;
})(typeof window !== 'undefined' ? window : globalThis);
