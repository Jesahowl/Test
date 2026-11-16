// Map generation stats over many seeds: sea, mountains, forests, ore, rivers, coast, biomes, and how
// fairly resources sit round 8 bases.   node tools/mapstats.js
const Game = require('../server/game');
const T = require('../shared/terrain');
const C = require('../shared/config');
const N = 60;
const acc = {}; const add = (k, v) => (acc[k] = acc[k] || []).push(v);
const biomeCount = {};
for (let seed = 1; seed <= N; seed++) {
  let s = seed * 977; const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const g = new Game({ botTarget: 0, rounds: true, rand, mapSeed: seed * 131 });
  const L = g.layout, hx = g.hex.hexes, n = hx.length;
  const tiles = (set) => [...set].reduce((a, i) => a + hx[i].tiles.length, 0) / (g.w * g.h);
  add('sea %', tiles(L.ocean) * 100); add('lake %', tiles(L.lakes) * 100); add('mountain %', tiles(L.mountains) * 100); add('forest %', tiles(L.forest) * 100);
  add('iron hexes', L.iron.size); add('vein hexes', L.veins.size); add('rivers', L.rivers.length);
  const bridges = L.rivers.reduce((a, r) => a + r.edges.filter((e) => e.bridge).length, 0); add('bridges', bridges);
  const redges = L.rivers.reduce((a, r) => a + r.edges.length, 0); add('river edges', redges);
  // mountains: lone hexes vs ridges
  const seen = new Set(); let lone = 0, groups = 0;
  for (const i of L.mountains) { if (seen.has(i)) continue; groups++; let c = 0; const st = [i]; seen.add(i); while (st.length) { const k = st.pop(); c++; for (const j of hx[k].n) if (L.mountains.has(j) && !seen.has(j)) { seen.add(j); st.push(j); } } if (c === 1) lone++; }
  add('mountain groups', groups); add('lone mountain hexes %', groups ? (lone / groups) * 100 : 0);
  // coast: 1-hex inlets (sea hex with >=4 land neighbours) and 1-hex spits (land with >=4 sea neighbours)
  let inlets = 0, spits = 0;
  for (const h of hx) { const sea = h.n.filter((j) => L.ocean.has(j)).length; if (L.ocean.has(h.i) && h.n.length - sea >= 4) inlets++; if (!L.ocean.has(h.i) && !L.lakes.has(h.i) && sea >= 4) spits++; }
  add('1-hex sea inlets', inlets); add('1-hex land spits', spits);
  // ore next to mountains share
  add('iron in foothills %', L.iron.size ? [...L.iron].filter((i) => L.foothills.has(i)).length / L.iron.size * 100 : 0);
  // rivers: share of edges that run roughly east-west (the 'staircase' look)
  let ew = 0; for (const r of L.rivers) for (const e of r.edges) if (Math.abs(e.y2 - e.y1) < Math.abs(e.x2 - e.x1) * 0.7) ew++;
  // (edges are at +-30, 90 degrees; east-west-ish runs alternate 30/-30)
  for (const h of hx) { if (L.ocean.has(h.i) || L.mountains.has(h.i) || L.lakes.has(h.i)) continue; const b = T.biomeOf(T.climate(g.mapSeed, h.cx, h.cy, g.w, g.h)); biomeCount[b] = (biomeCount[b] || 0) + 1; }
  // bases: 8 players, resources near each
  const ps = []; for (let k = 0; k < 8; k++) { const p = g.addPlayer('P' + k, true); if (p) ps.push(p); }
  add('bases placed (of 8)', ps.length);
  const near = (p, set, r) => [...set].filter((i) => Math.hypot(hx[i].cx - p.core.x, hx[i].cy - p.core.y) < r).length;
  const nearest = (p, set) => Math.min(...[...set].map((i) => Math.hypot(hx[i].cx - p.core.x, hx[i].cy - p.core.y)));
  const fr = ps.map((p) => near(p, L.forest, 18)), ir = ps.map((p) => near(p, L.iron, 18)), vd = ps.map((p) => nearest(p, L.veins));
  add('forest hexes within 18 (min)', Math.min(...fr)); add('forest hexes within 18 (max)', Math.max(...fr));
  add('iron hexes within 18 (min)', Math.min(...ir)); add('iron hexes within 18 (max)', Math.max(...ir));
  add('bases with 0 iron within 18', ir.filter((x) => x === 0).length);
  add('nearest vein (best base)', Math.min(...vd)); add('nearest vein (worst base)', Math.max(...vd));
  const camps = ps.map((p) => Math.min(...g.camps.map((c) => Math.hypot(c.x - p.core.x, c.y - p.core.y))));
  add('nearest camp (min)', Math.min(...camps)); add('nearest camp (max)', Math.max(...camps));
  let dmin = 1e9; for (const a of ps) for (const b of ps) if (a !== b) dmin = Math.min(dmin, Math.hypot(a.core.x - b.core.x, a.core.y - b.core.y)); add('closest two bases', dmin);
  // bases cut off behind a river from most others? count bases whose straight line to the map centre crosses a river with no bridge within 15 tiles... approx: river edges within 6 of base
  add('bases with a river through their land ring', ps.filter((p) => { const h = hx[g.hexAt(p.core.x, p.core.y)]; const ring = new Set([h.i, ...h.n]); return L.rivers.some((r) => r.edges.some((e) => ring.has(e.a) && ring.has(e.b))); }).length);
}
const f = (a) => { const s = [...a].sort((x, y) => x - y); const avg = a.reduce((x, y) => x + y, 0) / a.length; return `avg ${avg.toFixed(1)}  min ${s[0].toFixed(1)}  max ${s[s.length - 1].toFixed(1)}`; };
for (const [k, v] of Object.entries(acc)) console.log(k.padEnd(34), f(v));
const tot = Object.values(biomeCount).reduce((a, b) => a + b, 0);
console.log('biomes (land hexes):', Object.entries(biomeCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / tot * 100).toFixed(0)}%`).join(' · '));
