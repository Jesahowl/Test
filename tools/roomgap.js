// How far apart bases start in real 8-player rooms (a human and 7 bots joining as they do in a game).
//   node tools/roomgap.js
const { Room } = require('../server/room');
const ds = [];
for (let s = 0; s < 40; s++) {
  Math.random = require('./lib').seededRand(s + 101);
  const client = { ws: { readyState: 1, OPEN: 1, send: () => {} }, name: 'Me', token: 'x' };
  const room = new Room({ code: 'T' + s }); room.add(client); room.setBots(client, 7); room.start(client);
  const g = room.game; for (let i = 0; i < 20 * 35; i++) room.step();
  const ps = [...g.players.values()]; let m = 1e9;
  for (const a of ps) for (const b of ps) if (a !== b) m = Math.min(m, Math.hypot(a.core.x - b.core.x, a.core.y - b.core.y));
  ds.push(m);
}
ds.sort((a, b) => a - b);
console.log('closest two bases in 40 eight-player rooms: min', ds[0].toFixed(1), 'p10', ds[4].toFixed(1), 'median', ds[20].toFixed(1), '· under 28:', ds.filter((d) => d < 28).length);
