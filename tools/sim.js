// Bot rounds, headless and fast: how rounds play out (length, knockouts, economy, armies, deaths).
//   node tools/sim.js --seeds=6 [--bots=8] [--json]
// Prints one line per round and a summary. Use it after any gameplay or balance change.
const { botGame, args, C } = require('./lib');
const o = args({ seeds: 4, bots: 8, from: 1, json: false });

function round(seed) {
  const g = botGame(seed, { bots: o.bots });
  const out = { seed, elims: [], snaps: {}, deaths: {}, workerDeaths: 0, campClears: 0, errors: 0, slowTicks: 0 };
  const kp = g.killPlayer.bind(g);
  g.killPlayer = (p, killerId, left) => { out.elims.push(Math.round(g.time)); return kp(p, killerId, left); };
  let prevUnits = new Map();
  let prevCamps = g.camps.map((c) => c.alive);
  const t0 = Date.now();
  for (let i = 0; i < 20 * 60 * 30 && g.phase !== 'over'; i++) {
    const a = process.hrtime.bigint();
    try { g.update(0.05); } catch (e) { out.errors++; if (out.errors === 1) console.error(`seed ${seed} t=${g.time.toFixed(1)}:`, e.stack); }
    if (Number(process.hrtime.bigint() - a) / 1e6 > 25) out.slowTicks++;
    if (i % 20 === 0) {
      const now = new Map();
      for (const u of g.units.values()) now.set(u.id, u.kind);
      for (const [id, k] of prevUnits) if (!now.has(id)) { if (k === 'worker') out.workerDeaths++; else out.deaths[k] = (out.deaths[k] || 0) + 1; }
      prevUnits = now;
      g.camps.forEach((c, j) => { if (prevCamps[j] && !c.alive) out.campClears++; prevCamps[j] = c.alive; });
    }
    for (const m of [5, 10, 15]) if (Math.abs(g.time - m * 60) < 0.025) {
      const alive = [...g.players.values()].filter((p) => p.alive);
      const avg = (f) => Math.round(alive.reduce((s, p) => s + f(p), 0) / alive.length);
      const st = (p, k) => [...g.towers.values()].filter((t) => t.owner === p.id && t.kind === k).length;
      out.snaps[m] = { alive: alive.length, land: avg((p) => p.territory), gold: avg((p) => p.gold), wood: avg((p) => p.wood), iron: avg((p) => p.iron || 0),
        troops: avg((p) => [...g.units.values()].filter((u) => u.owner === p.id && !u.worker && !u.trade).length), barracks: avg((p) => st(p, 'barracks')), towers: avg((p) => st(p, 'tower')) };
    }
  }
  out.len = Math.round(g.time);
  out.timeout = g.time >= g.rules.suddenDeath + C.SUDDEN_DEATH_LIMIT - 1;
  out.winner = g.winner && g.winner.name;
  out.secs = ((Date.now() - t0) / 1000).toFixed(1);
  const earned = {};
  for (const p of g.players.values()) for (const [k, v] of Object.entries(p.earned)) earned[k] = (earned[k] || 0) + Math.round(v);
  out.earned = earned;
  return out;
}

const rows = [];
for (let s = o.from; s < o.from + o.seeds; s++) {
  const r = round(s);
  rows.push(r);
  if (o.json) console.log(JSON.stringify(r));
  else {
    const at = (m) => (r.snaps[m] ? `${m}m: ${r.snaps[m].alive} alive land ${r.snaps[m].land} troops ${r.snaps[m].troops} g/w/i ${r.snaps[m].gold}/${r.snaps[m].wood}/${r.snaps[m].iron}` : '');
    console.log(`seed ${s}: ${r.len}s${r.timeout ? ' (time up)' : ''} winner ${r.winner} · knockouts at ${r.elims.join(',')} · ${at(10)} · errors ${r.errors} · slow ticks ${r.slowTicks} · ${r.secs}s`);
  }
}
const avg = (f) => (rows.reduce((s, r) => s + f(r), 0) / rows.length).toFixed(0);
console.log(`\n${rows.length} rounds: length avg ${avg((r) => r.len)}s · time-ups ${rows.filter((r) => r.timeout).length} · errors ${avg((r) => r.errors)} · worker deaths ${avg((r) => r.workerDeaths)} · camp clears ${avg((r) => r.campClears)}`);
const e = {};
for (const r of rows) for (const [k, v] of Object.entries(r.earned)) e[k] = (e[k] || 0) + v / rows.length;
console.log('gold earned per round by source:', Object.entries(e).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · '));
