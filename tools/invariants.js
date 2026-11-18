// Plays bot rounds and checks the game's invariants every second: no NaN or negative resources or
// hp, troops on the map and never standing on mountains, sea or lakes, squads within their caps,
// buildings and walls owned by living players (or nobody), territory counts matching the hexes.
//   node tools/invariants.js [--seeds=1 --from=11]
const { botGame, args, C } = require('./lib');
const o = args({ seeds: 1, from: 11 });
for (let seed = o.from; seed < o.from + o.seeds; seed++) {
  const g = botGame(seed);
  const maxCap = new Map();
  const found = new Map(); // problem -> [count, first time, example]
  const bad = (what, ex) => { const f = found.get(what); if (f) f[0]++; else found.set(what, [1, Math.round(g.time), ex]); };
  for (let i = 0; i < 20 * 60 * 30 && g.phase !== 'over'; i++) {
    g.update(0.05);
    if (i % 20) continue;
    for (const p of g.players.values()) {
      for (const k of ['gold', 'wood', 'iron']) if (!Number.isFinite(p[k] ?? 0) || (p[k] ?? 0) < -0.001) bad(`player ${k} not a sane number`, `${p.name} ${p[k]}`);
      if (p.alive && !(p.core.hp > 0)) bad('alive player with a dead core', p.name);
      if (p.alive && p.squads) for (const q of p.squads) {
        const n = [...g.units.values()].filter((u) => u.owner === p.id && u.sq === q.id && !u.worker && !u.trade).length;
        // (a squad that loses its barracks keeps the troops it has: only more than it was ever
        // allowed is wrong)
        const cap = Math.max(g.squadCap(p, q), maxCap.get(q.id) || 0);
        maxCap.set(q.id, cap);
        if (n > cap) bad('squad over its cap', `${p.name} squad ${q.id}: ${n}/${cap}`);
      }
    }
    for (const u of g.units.values()) {
      if (!Number.isFinite(u.x) || !Number.isFinite(u.y) || !Number.isFinite(u.hp)) { bad('troop with NaN position or hp', `${u.kind} ${u.x},${u.y} hp ${u.hp}`); continue; }
      if (u.x < 0 || u.y < 0 || u.x >= g.w || u.y >= g.h) bad('troop off the map', `${u.kind} ${u.x.toFixed(1)},${u.y.toFixed(1)}`);
      const h = g.hexAt(Math.floor(u.x), Math.floor(u.y));
      if (g.mountains.has(h)) bad(`${u.worker ? 'worker' : u.trade ? 'caravan' : 'troop'} on a mountain/sea/lake hex`, `${u.kind} of ${u.owner} at ${u.x.toFixed(1)},${u.y.toFixed(1)} order ${JSON.stringify(u.attack || u.job || null)}`);
      if (u.owner && !g.players.has(u.owner)) bad('troop of a player who is gone', `${u.kind} owner ${u.owner}`);
    }
    for (const c of g.creeps.values()) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.hp)) bad('barbarian with NaN', c.id);
      else if (g.mountains.has(g.hexAt(Math.floor(c.x), Math.floor(c.y)))) bad('barbarian on a mountain/sea/lake hex', `${c.x.toFixed(1)},${c.y.toFixed(1)}`);
    }
    for (const t of g.towers.values()) {
      if (t.owner && !(g.players.get(t.owner) || {}).alive) bad('building owned by a knocked-out player', `${t.kind} ${t.id}`);
      if (!(t.hp > 0) && t.owner) bad('owned building with no hp', `${t.kind} ${t.id} hp ${t.hp}`);
      if (t.owner && g.hexOwner[g.hexAt(t.x, t.y)] !== t.owner) bad('building on land its owner does not hold', `${t.kind} ${t.id} owner ${t.owner} land ${g.hexOwner[g.hexAt(t.x, t.y)]}`);
    }
    for (const w of g.walls.values()) if (w.owner && !(g.players.get(w.owner) || {}).alive) bad('wall owned by a knocked-out player', w.id);
    if (i % 400 === 0) {
      for (const p of g.players.values()) {
        if (!p.alive) continue;
        let n = 0;
        for (let k = 0; k < g.terr.length; k++) if (g.terr[k] === p.id) n++;
        if (Math.abs(n - p.territory) > 1) bad('territory count out of step with the land', `${p.name} ${p.territory} vs ${n}`);
      }
    }
  }
  console.log(`seed ${seed}: ${Math.round(g.time)}s, winner ${g.winner && g.winner.name}`);
  if (!found.size) console.log('  all invariants held');
  for (const [what, [n, t, ex]] of found) console.log(`  ${what}: ${n} checks (first at ${t}s) e.g. ${ex}`);
}
