// My squads, worked out from my troops (each carries its squad id): number, troops, centre and
// what it's doing. Every wave is a squad of its own; the server sends their numbers.

import { S } from './state.js';

let cache = null;
let cacheAt = -1;

// What a troop is doing, as a key: "attack t:12", "defend c:5", "defend t:9".
function troopStatus(u) {
  if (u.attack) return `attack ${u.attack}`;
  return `defend ${u.anchor ? `t:${u.anchor}` : `c:${u.owner}`}`;
}

// [{ id, num, units, cx, cy, top, kinds, status }] sorted by number. Cached per frame.
function mySquads() {
  const now = performance.now();
  if (cache && now - cacheAt < 16) return cache;
  const nums = new Map((S.me && S.me.squads) || []);
  const by = new Map();
  for (const u of S.units.values()) {
    if (u.owner !== S.myId || !nums.has(u.sq)) continue;
    let q = by.get(u.sq);
    if (!q) by.set(u.sq, (q = { id: u.sq, num: nums.get(u.sq), units: [], kinds: {}, votes: new Map() }));
    q.units.push(u);
    q.kinds[u.kind] = (q.kinds[u.kind] || 0) + 1;
    const st = troopStatus(u);
    q.votes.set(st, (q.votes.get(st) || 0) + 1);
  }
  for (const q of by.values()) {
    // The squad's main group: scouts off exploring (and other strays) don't drag its tag away.
    const pos = (u) => [u.rx ?? u.x, u.ry ?? u.y];
    const core = q.units.filter((u) => u.kind !== 'scout' || u.attack);
    const base = core.length ? core : q.units;
    let mx = base.reduce((a, u) => a + pos(u)[0], 0) / base.length;
    let my = base.reduce((a, u) => a + pos(u)[1], 0) / base.length;
    // the troop nearest that centre, then everyone within 3 tiles of it
    const mid = base.reduce((b, u) => (Math.hypot(pos(u)[0] - mx, pos(u)[1] - my) < Math.hypot(pos(b)[0] - mx, pos(b)[1] - my) ? u : b));
    const [ox, oy] = pos(mid);
    const group = base.filter((u) => Math.hypot(pos(u)[0] - ox, pos(u)[1] - oy) <= 3);
    mx = group.reduce((a, u) => a + pos(u)[0], 0) / group.length;
    my = group.reduce((a, u) => a + pos(u)[1], 0) / group.length;
    q.cx = mx;
    q.cy = my;
    q.top = Math.min(...group.map((u) => pos(u)[1]));
    q.status = [...q.votes].sort((a, b) => b[1] - a[1])[0][0];
  }
  cache = [...by.values()].sort((a, b) => a.num - b.num);
  cacheAt = now;
  return cache;
}

// Is squad q one of the squads my orders go to right now?
function squadPicked(id) {
  return !S.allSquads && S.selSquads.has(id);
}

export { mySquads, squadPicked, troopStatus };
