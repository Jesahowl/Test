// Shared helpers for the dev tools in this folder (not loaded by the game).
const Game = require('../server/game');
const { Room } = require('../server/room');
const C = require('../shared/config');

// A repeatable random number source (LCG) for seeded games.
function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A headless bot round: a Game with `bots` bots on map `mapSeed`, its randomness from `seed`.
function botGame(seed, { bots = 8, mapSeed = seed * 7919 } = {}) {
  return new Game({ botTarget: bots, rounds: true, rand: seededRand(seed), mapSeed });
}

// A room with one silent human (kept alive) and `bots` bots, started: for timing whole ticks
// including snapshots and broadcasts. Returns { room, g, me, sent: { bytes, msgs } }.
function profRoom(bots = 9) {
  const sent = { bytes: 0, msgs: 0 };
  const client = { ws: { readyState: 1, OPEN: 1, send: (s) => { sent.bytes += s.length; sent.msgs++; } }, name: 'Tester', token: 'x' };
  const room = new Room({ code: 'PROF' });
  room.add(client);
  room.setBots(client, bots);
  room.start(client);
  const g = room.game;
  const me = [...g.players.values()].find((p) => !p.isBot);
  return { room, g, me, sent, step: () => { me.core.hp = me.core.maxHp; room.step(); } };
}

// Wrap methods of obj so their time (ms, inclusive), calls and slowest call are tallied.
function timeMethods(obj, names) {
  const t = {};
  for (const f of names) {
    if (typeof obj[f] !== 'function') continue;
    const o = obj[f];
    t[f] = { ms: 0, calls: 0, max: 0 };
    obj[f] = function (...a) {
      const s = process.hrtime.bigint();
      const r = o.apply(this, a);
      const d = Number(process.hrtime.bigint() - s) / 1e6;
      t[f].ms += d;
      t[f].calls++;
      if (d > t[f].max) t[f].max = d;
      return r;
    };
  }
  t.reset = () => { for (const k of Object.keys(t)) if (k !== 'reset') t[k] = { ms: 0, calls: 0, max: 0 }; };
  return t;
}

const args = (defaults) => {
  const out = { ...defaults };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : isNaN(+m[2]) ? m[2] : +m[2];
  }
  return out;
};

module.exports = { Game, Room, C, seededRand, botGame, profRoom, timeMethods, args };
