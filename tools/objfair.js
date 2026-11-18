// How fair map objectives are to the bases: over 40 maps with 8 bases, how near each base's nearest
// objective is, how many objectives each base is nearest to, and how far apart the bases end up.
//   node tools/objfair.js
const Game = require('../server/game');
const { seededRand } = require('./lib');
const N = 40;
const stat = { nearMin: [], nearMax: [], gap: [], zero: [], two: [], within25min: [], within25max: [], ratio: [] };
const own = new Array(8).fill(0); // how many objectives are closest to a base, histogram
let hist = {};
for (let seed = 1; seed <= N; seed++) {
  const g = new Game({ botTarget: 0, rounds: true, rand: seededRand(seed * 977), mapSeed: seed * 131 });
  const ps = []; for (let k = 0; k < 8; k++) { const p = g.addPlayer('P' + k, true); if (p) ps.push(p); }
  const d = (p, o) => Math.hypot(p.core.x - o.x, p.core.y - o.y);
  const near = ps.map((p) => Math.min(...g.objectives.map((o) => d(p, o))));
  stat.nearMin.push(Math.min(...near)); stat.nearMax.push(Math.max(...near)); stat.gap.push(Math.max(...near) - Math.min(...near));
  stat.ratio.push(Math.max(...near) / Math.min(...near));
  const count = new Map(ps.map((p) => [p, 0]));
  for (const o of g.objectives) { const best = ps.reduce((a, b) => (d(b, o) < d(a, o) ? b : a)); count.set(best, count.get(best) + 1); }
  const cs = [...count.values()];
  for (const c of cs) hist[c] = (hist[c] || 0) + 1;
  stat.zero.push(cs.filter((c) => c === 0).length); stat.two.push(cs.filter((c) => c >= 2).length);
  const w = ps.map((p) => g.objectives.filter((o) => d(p, o) < 25).length);
  stat.within25min.push(Math.min(...w)); stat.within25max.push(Math.max(...w));
}
const f = (a) => { const s = [...a].sort((x, y) => x - y); return `avg ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)}  min ${s[0].toFixed(1)}  max ${s[s.length - 1].toFixed(1)}`; };
console.log('nearest objective, closest base     ', f(stat.nearMin));
console.log('nearest objective, farthest base    ', f(stat.nearMax));
console.log('gap between them (tiles)            ', f(stat.gap));
console.log('farthest / closest                  ', f(stat.ratio));
console.log('objectives within 25 tiles: poorest ', f(stat.within25min), ' richest', f(stat.within25max));
console.log('bases closest to no objective (of 8)', f(stat.zero));
console.log('bases closest to 2+ objectives      ', f(stat.two));
console.log('objectives "owned" by nearness per base:', JSON.stringify(hist));
{
  const cl = [], ok = [];
  for (let seed = 1; seed <= N; seed++) {
    const g = new Game({ botTarget: 0, rounds: true, rand: seededRand(seed * 977), mapSeed: seed * 131 });
    const ps = []; for (let k = 0; k < 8; k++) { const p = g.addPlayer('P' + k, true); if (p) ps.push(p); }
    let m = 1e9; for (const a of ps) for (const b of ps) if (a !== b) m = Math.min(m, Math.hypot(a.core.x - b.core.x, a.core.y - b.core.y));
    cl.push(m); ok.push(ps.length);
    const near = ps.map((p) => Math.min(...g.objectives.map((o) => Math.hypot(p.core.x - o.x, p.core.y - o.y))));
    (globalThis.w30 = globalThis.w30 || []).push(near.filter((d) => d <= 30).length);
  }
  console.log('closest two bases', f(cl), '· bases placed', f(ok), '· bases with an objective within 30 tiles (of 8)', f(globalThis.w30));
}
