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
    let sx = 0;
    let sy = 0;
    let top = Infinity;
    for (const u of q.units) {
      const x = u.rx ?? u.x;
      const y = u.ry ?? u.y;
      sx += x;
      sy += y;
      top = Math.min(top, y);
    }
    q.cx = sx / q.units.length;
    q.cy = sy / q.units.length;
    q.top = top;
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
