// Network: the WebSocket connection, incoming messages, and smooth (interpolated) movement.

import { placeWall, wallsBuilt } from './walls.js';
import { onFx, play } from './audio.js';
import { onPing } from './pings.js';
import { resetFog, setExplored, updateFog } from './fog.js';
import { newOffers } from './diplomacy.js';
import { formError, onLeft, onPublicList, onRoom } from './lobby.js';
import { clearSelection } from './overlay.js';
import { showDeath, showMenu, showRoundOver, startSpectating, stopSpectating, toast } from './screens.js';
import { S, $, C, ALL_UNIT_KEYS, baseLift, cam, CAMP_KEYS, hexSpot, CREEP_KEYS, feed, grid, KIND_KEYS, players, selUnits, terr } from './state.js';
import { tipDone } from './tips.js';
import { onFlee } from './workforce.js';

// ------------------------------------------------------------------ network
// If the connection drops mid-game, the client reconnects on its own (retrying for up to
// RESUME_FOR seconds, a little longer between tries each time) and asks to be put back in its game
// (the server holds a dropped player's place for a while), showing a small banner meanwhile.
const RESUME_FOR = 42000;
let resumeUntil = 0;
let retryIn = 500;

function setReconnecting(on) {
  S.reconnecting = on;
  $('reconnect').classList.toggle('hidden', !on);
}

function giveUpResume(why) {
  resumeUntil = 0;
  setReconnecting(false);
  S.myId = null;
  if (S.room) $('code').value = S.room.code; // one click to rejoin the room
  S.room = null;
  showMenu();
  if (why) $('conn').textContent = why;
}

function connect() {
  if (!S.reconnecting) {
    $('conn').textContent = 'Connecting…';
    $('play').disabled = true;
  }
  S.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  S.ws.onopen = () => {
    retryIn = 500;
    if (S.reconnecting && S.resumeToken) {
      S.ws.send(JSON.stringify({ t: 'resume', token: S.resumeToken }));
      return;
    }
    $('conn').textContent = '';
    $('play').disabled = false;
  };
  S.ws.onclose = () => {
    const now = performance.now();
    // in a game: try to get back into it
    if ((S.myId || S.reconnecting) && S.resumeToken) {
      if (!S.reconnecting) {
        resumeUntil = now + RESUME_FOR;
        setReconnecting(true);
      }
      if (now < resumeUntil) {
        setTimeout(connect, retryIn);
        retryIn = Math.min(4000, retryIn * 1.6);
        return;
      }
      giveUpResume('Lost the connection to the game: press Play to start again');
    }
    $('conn').textContent = 'Disconnected - retrying…';
    $('play').disabled = true;
    S.myId = null;
    if (S.room) $('code').value = S.room.code; // one click to rejoin the room once reconnected
    S.room = null;
    showMenu();
    setTimeout(connect, 1500);
  };
  S.ws.onmessage = (ev) => handle(JSON.parse(ev.data));
}

// The sound an action makes as it's sent.
const SEND_SOUND = { build: 'place', walls: 'place', land: 'place', upgrade: 'ok', sell: 'gold', order: 'order', work: 'order' };

function sendMsg(obj) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify(obj));
    if (SEND_SOUND[obj.t]) play(SEND_SOUND[obj.t]);
  }
}

function handle(msg) {
  switch (msg.t) {
    case 's':
      applyState(msg);
      break;
    case 'welcome':
      if (msg.token) S.resumeToken = msg.token;
      if (msg.resumed) {
        // back in the game after a dropped connection
        setReconnecting(false);
        $('conn').textContent = '';
        $('play').disabled = false;
        toast('Reconnected', true);
      }
      S.watchingGame = false;
      stopSpectating();
      S.queued = false;
      if (S.round && msg.round !== S.round.n) {
        // a new round on a fresh map
        S.effects = [];
        feed.length = 0;
        S.towers = new Map();
        S.units = new Map();
        S.lastKiller = 0;
      }
      $('roundover').classList.add('hidden');
      $('lobby').classList.add('hidden');
      if (!S.myId || (S.round && msg.round !== S.round.n)) resetFog();
      S.myId = msg.id;
      S.centerOnMe = true;
      clearSelection();
      S.buildKind = null;
      $('menu').classList.add('hidden');
      $('death').classList.add('hidden');
      $('hud').classList.remove('hidden');
      break;
    case 'dead':
      S.myId = null;
      S.me = null;
      showDeath(msg);
      break;
    case 'wait':
      // Round in progress: watch it, and join the next one automatically.
      S.queued = true;
      if (!S.spectating) startSpectating();
      toast(msg.over ? 'Next round starts in a few seconds' : `Round ${msg.round} is under way: you'll join the next one`, true);
      break;
    case 'roundover':
      showRoundOver(msg);
      break;
    case 'room':
      S.watchingGame = false;
      onRoom(msg);
      break;
    case 'list':
      onPublicList(msg);
      break;
    case 'ping':
      onPing(msg);
      break;
    case 'resume-fail':
      // couldn't get back in (the game ended, or our core fell meanwhile): to the menu
      giveUpResume(msg.fell ? 'Your core fell while you were disconnected' : 'Couldn\'t get back into that game: press Play for a new one');
      $('play').disabled = false;
      break;
    case 'hello':
      if (!S.reconnecting) S.resumeToken = msg.token; // (the key to this game if the connection drops)
      // (the test-mode fog switch in the round bar: one listener, the bar is redrawn often)
      if (!S.fogClick) {
        S.fogClick = true;
        $('round').addEventListener('pointerdown', (e) => {
          if (e.target.closest('.test-fog')) sendMsg({ t: 'fog', on: !!(S.me && S.me.noFog) });
        });
      }
      // test mode is on offer on this server
      S.dev = !!msg.dev;
      $('test-game').classList.toggle('hidden', !S.dev);
      break;
    case 'watching':
      // watching a public game from the menu: a fresh map, seen whole
      S.effects = [];
      feed.length = 0;
      S.towers = new Map();
      S.units = new Map();
      S.myId = null;
      S.me = null;
      S.lastKiller = 0;
      S.watchingGame = true;
      resetFog();
      $('lobby').classList.add('hidden');
      $('roundover').classList.add('hidden');
      startSpectating();
      toast('Watching a game in progress: Esc → Leave game to go back', true);
      break;
    case 'left':
      S.watchingGame = false;
      onLeft();
      break;
    case 'err':
      if (!formError(msg.m)) toast(msg.m);
      S.pendingOrder = null;
      break;
    case 'bought':
      toast(`+${msg.n} hex${msg.n === 1 ? "" : "es"} of land (−${msg.gold}g)`, true);
      tipDone('land');
      break;
    case 'info':
      toast(msg.m, true);
      break;
    case 'walled':
      wallsBuilt(msg.n, msg.gold);
      break;
    case 'ordered':
      if (S.pendingOrder) toast(S.pendingOrder(msg.n), true);
      S.pendingOrder = null;
      break;
  }
}

// ---- smooth movement
// Troops and monsters are drawn INTERP_DELAY ms in the past, interpolating between the last
// server snapshots, so they glide at a steady speed however unevenly packets arrive.
const TICK_MS = 1000 / C.TICK_RATE; // simulation tick (snapshots carry the tick number)
const SNAP_MS = 1000 / C.SNAPSHOT_RATE; // how often snapshots arrive
const INTERP_DELAY = SNAP_MS * 1.7;

let snapClock = 0; // server time (ms) of the latest snapshot, from its tick number
let clockOffset = null; // estimated server time minus local time
function stampSnapshot(now, tk) {
  snapClock = tk * TICK_MS;
  const target = snapClock - now;
  // follow arrival times loosely (absorbs network jitter); resync after a stall or a burst
  if (clockOffset === null || Math.abs(target - clockOffset) > 400) clockOffset = target;
  else clockOffset += (target - clockOffset) * 0.05;
}

const renderTime = () => performance.now() + (clockOffset || 0) - INTERP_DELAY;

function addSample(old, x, y) {
  const smp = old && old.samples ? old.samples : [];
  if (smp.length >= 6) smp.shift();
  smp.push({ t: snapClock, x, y });
  return smp;
}

// Render position at time rt: interpolate between snapshots, extrapolate briefly past the last one.
function interpPos(o, rt) {
  const smp = o.samples;
  if (!smp || !smp.length) return [o.x, o.y];
  if (rt <= smp[0].t || smp.length === 1) return [smp[0].x, smp[0].y];
  for (let i = smp.length - 1; i > 0; i--) {
    const a = smp[i - 1];
    const b = smp[i];
    if (rt >= a.t) {
      const span = b.t - a.t || 1;
      // past the newest snapshot: keep moving for up to one tick, then hold
      const f = Math.min((rt - a.t) / span, i === smp.length - 1 ? 1 + SNAP_MS / span : 1);
      return [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f];
    }
  }
  return [smp[0].x, smp[0].y];
}

function applyState(msg) {
  S.me = msg.me;
  S.meAt = performance.now(); // (squad respawn timers count down from here between snapshots)
  newOffers(toast);
  const now = performance.now();
  stampSnapshot(now, msg.tk);
  if (msg.round) S.round = msg.round;

  if (msg.terr) {
    let i = 0;
    for (let j = 0; j < msg.terr.length; j += 2) {
      terr.fill(msg.terr[j], i, i + msg.terr[j + 1]);
      i += msg.terr[j + 1];
    }
  }

  // Collections arrive as { c: changed rows, r: removed ids }; `full` replaces everything.
  const full = !!msg.full;
  const merge = (prev, part, build) => {
    const next = full ? new Map() : new Map(prev);
    if (!full) for (const id of part.r) next.delete(id);
    for (const a of part.c) next.set(a[0], build(a, prev.get(a[0])));
    return next;
  };

  const np = merge(players, msg.players, (a, old) => {
    const p = { id: a[0], name: a[1], hue: a[2], tone: a[13] || 0, x: a[3], y: a[4], hp: a[5], maxHp: a[6], territory: a[7], kills: a[8], isBot: !!a[9],
      shield: a[10] || 0, buff: a[11] || 0, allies: a[12] || [], hitAt: old ? old.hitAt : 0, trail: old ? old.trail : undefined, shotAt: old ? old.shotAt : 0 };
    if (old && p.hp < old.hp) p.hitAt = now;
    return p;
  });
  players.clear();
  for (const [id, p] of np) players.set(id, p);

  S.walls = merge(S.walls, msg.walls, (a, old) => {
    const w = { id: a[0], a: a[1], b: a[2], owner: a[3], hp: a[4], maxHp: a[5], gate: !!a[6], progress: (a[7] ?? 100) / 100 };
    if (old && old.a === w.a && old.b === w.b) {
      w.ends = old.ends;
      w.x = old.x;
      w.y = old.y;
    } else placeWall(w);
    return w;
  });
  if (S.selWall && !S.walls.has(S.selWall)) S.selWall = null;
  S.towers = merge(S.towers, msg.towers, (a, old) => {
    const t = { id: a[0], kind: KIND_KEYS[a[1]], x: a[2], y: a[3], owner: a[4], level: a[5], hp: a[6], maxHp: a[7], ruinOf: a[8] || '', partner: a[9] || 0, road: a[10] || null,
      progress: (a[11] ?? 100) / 100, squad: a[12] || 0 };
    t.ruin = !t.owner;
    if (old) {
      // remember render state: when it was last hit, when it changed hands, where its turret points
      for (const k of ['hitAt', 'flipAt', 'prevOwner', 'aim', 'shotAt', 'trail', 'waveAt']) t[k] = old[k];
      if (t.hp < old.hp && t.owner === old.owner) t.hitAt = now;
      if (t.owner && old.owner !== t.owner) {
        t.flipAt = now;
        t.prevOwner = old.owner;
        t.trail = t.hp;
      }
    }
    return t;
  });
  grid.clear();
  for (const t of S.towers.values()) grid.set(`${t.x},${t.y}`, t.id);
  if (S.selectedId && !S.towers.has(S.selectedId)) S.selectedId = null;
  if (S.selCaravan && !S.units.has(S.selCaravan)) S.selCaravan = null;

  // Troops and monsters: positions come in tenths of a tile. Ones that didn't change still get a
  // sample at this snapshot's time, so interpolation knows they stood still.
  const moved = new Set();
  S.units = merge(S.units, msg.units, (a, old) => {
    moved.add(a[0]);
    const kind = ALL_UNIT_KEYS[a[1]];
    const x = a[2] / 10;
    const y = a[3] / 10;
    const wc = a[11] || 0; // workers: job (0 idle, 1 build, 2 repair, 3 gather, 4 farm, 5 scout, 6 mine), +8 carrying, +16 at work, +32 running from raiders
    return { id: a[0], kind, x, y, owner: a[4], level: a[5], hp: a[6], maxHp: C.towerStats(kind, a[5]).hp, anchor: a[7], attack: a[8] || '', sq: a[9] || 0, from: a[10] || 0,
      job: wc & 7, carry: !!(wc & 8), working: !!(wc & 16), flee: !!(wc & 32), rx: old ? old.rx : x, ry: old ? old.ry : y, samples: addSample(old, x, y) };
  });
  for (const u of S.units.values()) if (!moved.has(u.id)) addSample(u, u.x, u.y);
  for (const id of selUnits) if (!S.units.has(id)) selUnits.delete(id);
  for (const id of S.selWorkers) if (!S.units.has(id)) S.selWorkers.delete(id);

  moved.clear();
  S.creeps = merge(S.creeps, msg.creeps, (a, old) => {
    moved.add(a[0]);
    const x = a[2] / 10;
    const y = a[3] / 10;
    return { id: a[0], kind: CREEP_KEYS[a[1]], x, y, angry: a[4], hp: a[5] / 100, camp: a[6], rx: old ? old.rx : x, ry: old ? old.ry : y,
      samples: addSample(old, x, y) };
  });
  for (const c of S.creeps.values()) if (!moved.has(c.id)) addSample(c, c.x, c.y);

  // Forest hexes that have been chopped: hex -> wood left in fifths (missing = full).
  S.forestLeft = merge(S.forestLeft, msg.forest, (a) => a[1]);
  if (msg.ore) S.oreLeft = merge(S.oreLeft, msg.ore, (a) => a[1]);
  if (S.selWorker && !S.units.has(S.selWorker)) S.selWorker = null;
  S.campMap = merge(S.campMap, msg.camps, (a) => ({ id: a[0], x: a[1], y: a[2], type: CAMP_KEYS[a[3]], alive: !!a[4], respawn: a[5] }));
  S.camps = [...S.campMap.values()];
  if (msg.exp) setExplored(msg.exp);
  updateFog(!!msg.terr);

  for (const f of msg.fx) {
    const fx = { ...f, born: now + INTERP_DELAY }; // shown in step with the delayed troops
    S.effects.push(fx);
    onFx(f, INTERP_DELAY / 1000); // its sound, in step too
    if (f.k === 'flee') onFlee(f);
    if ((f.k === 'slash' || f.k === 'arrow') && f.a) S.struckAt.set(f.a, now + INTERP_DELAY); // (squad tags show who's fighting)
    if (f.k === 'wave') {
      const t = S.towers.get(grid.get(`${Math.floor(f.x)},${Math.floor(f.y)}`));
      if (t) t.waveAt = now + INTERP_DELAY;
    }
    if (f.k === 'slash' && f.a) {
      // the attacker lunges at its target (drawn in troops.js / camps.js)
      S.lunges.set(f.a, { at: now + INTERP_DELAY, x: f.x, y: f.y });
    }
    if (f.k === 'tshot' && !f.c) {
      // flare the shooting tower's (or core's) crystal (chain jumps, f.c, start at a troop)
      const tx = Math.floor(f.x1);
      const ty = Math.floor(f.y1);
      const t = S.towers.get(grid.get(`${tx},${ty}`));
      const p = t ? null : [...players.values()].find((q) => q.x === tx && q.y === ty);
      const o = t || p;
      if (o) {
        // the bolt leaves from the building as drawn: at its hex centre, lifted
        const spot = hexSpot(tx, ty);
        const lift0 = t ? baseLift(t.kind, t.level) : baseLift('core');
        fx.x1 = spot.x;
        fx.y1 = spot.y - lift0;
        o.aim = Math.atan2(f.y2 - f.y1, f.x2 - f.x1);
        o.shotAt = now + INTERP_DELAY; // the crystal flares as the bolt leaves
      }
      // the bolt leaves from the tip of the crystal, which floats above the building
      fx.lift = t ? 0.62 * (1 + 0.07 * (t.level - 1)) * (0.95 + (t.level >= 2 ? 0.08 : 0)) : p ? 0.55 : 0;
    }
  }
  // forget melee lunges once they're over (troops that died never ask for theirs again)
  for (const [id, l] of S.lunges) if (now - l.at > 1000) S.lunges.delete(id);
  for (const text of msg.feed) feed.push({ text, born: now });
  while (feed.length > 6) feed.shift();

  if (S.centerOnMe && S.myId && players.has(S.myId)) {
    const p = players.get(S.myId);
    cam.x = p.x + 0.5;
    cam.y = p.y + 0.5;
    S.centerOnMe = false;
  }
}

export { connect, interpPos, renderTime, sendMsg };
