// Server tick cost in a busy room (9 bots + a silent human kept alive), including snapshots and
// broadcasts. Times a minute at several marks, lists where the time goes, and the worst spikes.
//   node tools/profile-server.js [--marks=3,9,15] [--detail]   (--detail: per-function inside troops)
const { profRoom, timeMethods, args } = require('./lib');
const o = args({ marks: '3,9,15', detail: false, bots: 9 });
const { room, g, sent, step } = profRoom(o.bots);
const TOP = ['updateWorkers', 'updateUnits', 'updateBots', 'updateWaves', 'updateStructures', 'separateUnits', 'updateCreeps', 'updateTrade', 'buildUnitGrid',
  'enforceWalls', 'updateDiplomacy', 'updateVision', 'snapshot', 'assignSlots', 'squadGroups', 'recomputeTerritory', 'personal', 'encodeTerritory', 'checkRoundOver'];
const DETAIL = ['getFieldTo', 'planUnit', 'planDetour', 'detourStep', 'lineBlocked', 'marchTo', 'moveUnit', 'stepToward', 'fieldStep', 'pickTarget', 'resolveAttack',
  'nearUnits', 'unitFire', 'homeIntruder', 'borderRaider', 'nearHome', 'homeZone', 'squadPace', 'breakerTarget', 'medicTick', 'workerTick', 'caravanTick', 'frontFoe',
  'freeSlots', 'rankSpots', 'walkable', 'findTask', 'assignWorkers', 'checkFlee', 'botThink', 'botOrders'];
const t = timeMethods(g, o.detail ? DETAIL : TOP);
let bt = 0;
const ob = room.broadcast.bind(room);
room.broadcast = () => { const a = process.hrtime.bigint(); ob(); bt += Number(process.hrtime.bigint() - a) / 1e6; };
for (const mark of String(o.marks).split(',').map(Number)) {
  while (g.time < (mark - 1) * 60 && g.phase === 'playing') step();
  t.reset(); bt = 0; sent.bytes = 0; sent.msgs = 0;
  let n = 0, worst = 0, total = 0;
  const spikes = [];
  while (g.time < mark * 60 && g.phase === 'playing') {
    const before = Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'reset').map(([k, v]) => [k, v.ms]));
    const a = process.hrtime.bigint();
    step();
    const d = Number(process.hrtime.bigint() - a) / 1e6;
    total += d; n++; worst = Math.max(worst, d);
    if (d > 25) spikes.push(`${d.toFixed(0)}ms: ` + Object.entries(t).filter(([k]) => k !== 'reset').map(([k, v]) => [k, v.ms - before[k]]).filter(([, v]) => v > 3).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '));
  }
  if (!n) break;
  const alive = [...g.players.values()].filter((p) => p.alive).length;
  console.log(`\n@${mark}m: ${(total / n).toFixed(2)} ms/tick (worst ${worst.toFixed(1)}, ${spikes.length} over 25ms) · units ${g.units.size} creeps ${g.creeps.size} towers ${g.towers.size} walls ${g.walls.size} alive ${alive} · broadcast ${(bt / n).toFixed(2)} ms/tick, ${(sent.bytes / Math.max(1, sent.msgs) / 1024).toFixed(1)} KB/msg`);
  console.log('  ' + Object.entries(t).filter(([k, v]) => k !== 'reset' && v.ms > 0).sort((a, b) => b[1].ms - a[1].ms).slice(0, 14)
    .map(([k, v]) => `${k} ${(v.ms / n).toFixed(2)}${o.detail ? ` (${(v.calls / n).toFixed(0)}/tick, max ${v.max.toFixed(1)})` : ''}`).join(' · '));
  for (const s of spikes.slice(0, 5)) console.log('   spike', s);
}
process.exit(0);
