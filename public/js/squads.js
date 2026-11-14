// My squads: the server sends my (up to four) lasting squads with their number, stance, troop mix
// and order; their troops carry the squad id. From those troops this works out where each squad
// is and what it's doing.

import { S, UNIT_KEYS } from './state.js';

let cache = null;
let cacheAt = -1;

// What a troop is doing, as a key: "attack t:12", "defend c:5", "defend t:9".
function troopStatus(u) {
  if (u.attack) return `attack ${u.attack}`;
  return `defend ${u.anchor ? `t:${u.anchor}` : `c:${u.owner}`}`;
}

// Every squad, troops or not:
// [{ id, num, stance, mix: {kind: n}, size, units, kinds, status, cx, cy, top }] by number.
// cx/cy/top are only set when the squad has troops. Cached per frame.
function allSquads() {
  const now = performance.now();
  if (cache && now - cacheAt < 16) return cache;
  const by = new Map();
  for (const [id, num, stance, mix, order] of (S.me && S.me.squads) || []) {
    const m = Object.fromEntries(UNIT_KEYS.map((k, i) => [k, mix[i] || 0]));
    by.set(id, { id, num, stance, mix: m, size: mix.reduce((a, b) => a + b, 0), order, units: [], kinds: {}, votes: new Map() });
  }
  for (const u of S.units.values()) {
    const q = u.owner === S.myId && by.get(u.sq);
    if (!q) continue;
    q.units.push(u);
    q.kinds[u.kind] = (q.kinds[u.kind] || 0) + 1;
    const st = troopStatus(u);
    q.votes.set(st, (q.votes.get(st) || 0) + 1);
  }
  for (const q of by.values()) {
    q.status = q.units.length ? [...q.votes].sort((a, b) => b[1] - a[1])[0][0] : q.order;
    if (!q.units.length) continue;
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
  }
  cache = [...by.values()].sort((a, b) => a.num - b.num);
  cacheAt = now;
  return cache;
}

// The squads that have troops on the map.
function mySquads() {
  return allSquads().filter((q) => q.units.length);
}

// Is squad q one of the squads my orders go to right now?
function squadPicked(id) {
  return !S.allSquads && S.selSquads.has(id);
}

export { allSquads, mySquads, squadPicked, troopStatus };
