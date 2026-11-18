// Sound: effects and music, all synthesised with the Web Audio API (no sound files).
// - Effects follow what the server sends (arrows, sword hits, tower bolts, explosions, gold...):
//   only things on screen are heard, a little quieter toward the edges and panned left/right, and
//   quieter the further out you zoom (zoomed right out, a faint murmur). Each kind is rate-limited
//   so a big battle doesn't turn into a wall of noise.
// - Music: a slow, calm loop in A minor (pads, a soft bass and a sparse plucked melody) that grows
//   drums and a busier melody while there's fighting in view, and settles again after.
// - Settings (master / music / effects volume, mute) live in the Esc menu and in localStorage.
// Browsers only allow sound after the player has clicked or pressed a key, so everything starts then.

import { S, cam, canvas, toScreen } from './state.js';

const STORE = 'ts-sound';
const settings = { master: 0.8, music: 0.5, sfx: 0.8, muted: false };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(STORE) || '{}'));
} catch (e) { /* no storage: defaults */ }

let ac = null; // AudioContext
let master = null;
let musicBus = null;
let sfxBus = null;
let reverb = null; // shared room for music (and a little of the effects)
let noiseBuf = null;

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(settings));
  } catch (e) { /* ignore */ }
}

function applyVolumes() {
  if (!ac) return;
  const t = ac.currentTime;
  master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, t, 0.05);
  musicBus.gain.setTargetAtTime(settings.music * 0.55, t, 0.05);
  sfxBus.gain.setTargetAtTime(settings.sfx, t, 0.05);
}

// A soft room: a convolver fed with decaying noise.
function makeReverb(seconds = 2.6) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  const conv = ac.createConvolver();
  conv.buffer = buf;
  return conv;
}

function start() {
  if (ac) {
    if (ac.state === 'suspended' && !document.hidden) ac.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  master = ac.createGain();
  const comp = ac.createDynamicsCompressor(); // keeps a busy battle from clipping
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  master.connect(comp);
  comp.connect(ac.destination);
  musicBus = ac.createGain();
  sfxBus = ac.createGain();
  musicBus.connect(master);
  sfxBus.connect(master);
  reverb = makeReverb();
  const wet = ac.createGain();
  wet.gain.value = 0.35;
  reverb.connect(wet);
  wet.connect(master);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVolumes();
  startMusic();
}

// Sound may start once the player has interacted with the page.
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, start, { capture: true });
document.addEventListener('visibilitychange', () => {
  if (!ac) return;
  if (document.hidden) ac.suspend();
  else ac.resume();
});

// Interface buttons click softly.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button');
  if (b && !b.disabled) play('click');
}, true);

// ---- building blocks
// out: where a voice goes (an effect's panner, or the music bus); t: when it starts.
function env(g, t, a, peak, d, sustain = 0) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
}

function tone(out, t, { type = 'sine', f, f2, a = 0.005, d = 0.2, peak = 0.3, detune = 0 }) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  o.detune.value = detune;
  const g = ac.createGain();
  env(g, t, a, peak, d);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + a + d + 0.05);
}

function noise(out, t, { a = 0.003, d = 0.15, peak = 0.3, type = 'bandpass', f = 1500, f2, q = 1 }) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const flt = ac.createBiquadFilter();
  flt.type = type;
  flt.frequency.setValueAtTime(f, t);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  flt.Q.value = q;
  const g = ac.createGain();
  env(g, t, a, peak, d);
  src.connect(flt);
  flt.connect(g);
  g.connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + a + d + 0.05);
}

// ---- effects
const rnd = (a, b) => a + Math.random() * (b - a);
const SFX = {
  arrow: (o, t) => noise(o, t, { d: 0.14, peak: 0.16, f: 3200, f2: 900, q: 2.5 }),
  slash: (o, t) => {
    noise(o, t, { d: 0.07, peak: 0.22, type: 'highpass', f: 2500 });
    tone(o, t, { type: 'triangle', f: rnd(900, 1300), f2: rnd(700, 900), d: 0.12, peak: 0.07 });
  },
  tshot: (o, t) => {
    tone(o, t, { type: 'triangle', f: 1100, f2: 260, d: 0.18, peak: 0.13 });
    noise(o, t, { d: 0.08, peak: 0.06, f: 4000, q: 3 });
  },
  hit: (o, t) => {
    tone(o, t, { f: 140, f2: 60, d: 0.2, peak: 0.3 });
    noise(o, t, { d: 0.12, peak: 0.16, type: 'lowpass', f: 900 });
  },
  boom: (o, t, f) => {
    const big = (f.r || 0.5) >= 1;
    noise(o, t, { d: big ? 0.9 : 0.45, peak: big ? 0.5 : 0.3, type: 'lowpass', f: big ? 1400 : 1800, f2: 120 });
    tone(o, t, { f: big ? 80 : 110, f2: 32, d: big ? 0.8 : 0.35, peak: big ? 0.5 : 0.3 });
  },
  // (healing makes no sound: the green pulse shows it)
  gold: (o, t) => {
    tone(o, t, { type: 'square', f: 1320, d: 0.07, peak: 0.04 });
    tone(o, t + 0.06, { type: 'square', f: 1976, d: 0.16, peak: 0.04 });
  },
  trade: (o, t) => {
    for (let i = 0; i < 4; i++) tone(o, t + i * 0.06, { type: 'square', f: 1320 * Math.pow(1.122, i), d: 0.1, peak: 0.035 });
  },
  raid: (o, t) => {
    noise(o, t, { d: 0.3, peak: 0.25, type: 'lowpass', f: 1200 });
    tone(o, t, { type: 'square', f: 300, f2: 120, d: 0.25, peak: 0.05 });
  },
  built: (o, t) => {
    noise(o, t, { d: 0.05, peak: 0.2, type: 'lowpass', f: 1500 }); // a last hammer knock...
    [523, 659, 784].forEach((f, i) => tone(o, t + 0.1 + i * 0.08, { type: 'triangle', f, d: 0.35, peak: 0.08 })); // ...and done
  },
  wave: (o, t) => {
    // a horn: troops are back
    for (const [f, dt] of [[220, 0], [330, 0.22]]) {
      tone(o, t + dt, { type: 'sawtooth', f, a: 0.05, d: 0.35, peak: 0.05 });
      tone(o, t + dt, { type: 'sine', f: f / 2, a: 0.05, d: 0.35, peak: 0.08 });
    }
  },
  campSpawn: (o, t) => {
    for (let i = 0; i < 3; i++) tone(o, t + i * 0.18, { f: 110, f2: 55, d: 0.25, peak: 0.3 });
  },
  buff: (o, t) => {
    for (let i = 0; i < 6; i++) tone(o, t + i * 0.05, { type: 'triangle', f: 660 * Math.pow(1.122, i), d: 0.25, peak: 0.05 });
  },
  capture: (o, t) => {
    SFX.boom(o, t, { r: 1.2 });
    [220, 277, 330].forEach((f) => tone(o, t + 0.25, { type: 'sawtooth', f, a: 0.08, d: 1.2, peak: 0.04 }));
  },
  coreDown: (o, t) => {
    SFX.boom(o, t, { r: 1.5 });
    SFX.boom(o, t + 0.3, { r: 1.5 });
    [110, 131, 165].forEach((f) => tone(o, t + 0.4, { type: 'sawtooth', f, a: 0.1, d: 2, peak: 0.05 }));
  },
  ping: (o, t, f) => {
    // an ally's ping: a different call for each kind
    const notes = { attack: [660, 880, 660], defend: [523, 659, 784], danger: [880, 587, 880], look: [784, 988] }[f.kind] || [784];
    notes.forEach((n, i) => tone(o, t + i * 0.09, { type: f.kind === 'danger' ? 'square' : 'triangle', f: n, d: 0.16, peak: f.kind === 'danger' ? 0.06 : 0.1 }));
  },
  // workers running from raiders: a quick two-note alarm
  flee: (o, t) => {
    for (const [f, dt] of [[988, 0], [740, 0.13], [988, 0.32], [740, 0.45]]) tone(o, t + dt, { type: 'square', f, d: 0.1, peak: 0.045 });
  },
  // one of my squads has just got into a fight: a war drum and a short horn
  clash: (o, t) => {
    for (const dt of [0, 0.16]) {
      tone(o, t + dt, { f: 95, f2: 55, d: 0.22, peak: 0.32 });
      noise(o, t + dt, { d: 0.08, peak: 0.12, type: 'lowpass', f: 700 });
    }
    tone(o, t + 0.3, { type: 'sawtooth', f: 196, a: 0.04, d: 0.32, peak: 0.045 });
    tone(o, t + 0.3, { type: 'sawtooth', f: 294, a: 0.04, d: 0.32, peak: 0.035 });
  },
  // the tutorial: a step done (a rising chime), and all done (a little fanfare)
  step: (o, t) => {
    [784, 988, 1319].forEach((f, i) => tone(o, t + i * 0.08, { type: 'triangle', f, d: 0.28, peak: 0.07 }));
  },
  fanfare: (o, t) => {
    [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.4]].forEach(([f, dt]) => {
      tone(o, t + dt, { type: 'triangle', f, d: dt === 0.4 ? 0.7 : 0.18, peak: 0.08 });
      tone(o, t + dt, { type: 'sawtooth', f: f / 2, a: 0.02, d: dt === 0.4 ? 0.6 : 0.16, peak: 0.025 });
    });
  },
  // interface
  click: (o, t) => tone(o, t, { type: 'triangle', f: 1400, f2: 900, d: 0.04, peak: 0.05 }),
  order: (o, t) => {
    // a short drum tap: orders given
    tone(o, t, { f: 320, f2: 200, d: 0.08, peak: 0.12 });
    tone(o, t + 0.07, { f: 420, f2: 260, d: 0.1, peak: 0.1 });
  },
  ok: (o, t) => {
    tone(o, t, { type: 'triangle', f: 784, d: 0.1, peak: 0.07 });
    tone(o, t + 0.07, { type: 'triangle', f: 1175, d: 0.16, peak: 0.07 });
  },
  err: (o, t) => tone(o, t, { type: 'square', f: 150, f2: 120, d: 0.18, peak: 0.05 }),
  place: (o, t) => {
    tone(o, t, { f: 180, f2: 90, d: 0.12, peak: 0.25 });
    noise(o, t, { d: 0.06, peak: 0.12, type: 'lowpass', f: 1200 });
  },
};

// Fewest milliseconds between two sounds of a kind, and how many may play at once at most.
const GAP = { flee: 1500, clash: 1200, step: 300, fanfare: 2000, ping: 150, click: 40, ok: 80, err: 120, place: 60, order: 120, arrow: 45, slash: 40, tshot: 60, hit: 90, boom: 70, gold: 120, raid: 200, built: 150, wave: 300, campSpawn: 500, buff: 300, trade: 150, capture: 300, coreDown: 300 };
const lastAt = new Map();
let voices = 0;
const MAX_VOICES = 18;
let lastVol = 0; // (for checks) the volume the last effect played at

// How loud the map sounds at this zoom: full when zoomed in, fading as you zoom out (default zoom
// about 85%, all the way out about 15%).
function zoomVolume() {
  const f = Math.max(0, Math.min(1, (cam.zoom - 0.35) / (1.1 - 0.35)));
  return 0.12 + 0.88 * Math.pow(f, 1.2);
}

// Play effect `kind` (now, or `delay` seconds from now). pos: { x, y } in tiles where it happens
// on the map (heard only if that's on screen), or null for interface sounds.
function play(kind, pos = null, delay = 0, f = {}) {
  if (!ac || settings.muted || !settings.sfx || !SFX[kind]) return;
  const now = performance.now();
  if (now - (lastAt.get(kind) || 0) < (GAP[kind] || 0)) return;
  let vol = 1;
  let pan = 0;
  if (pos) {
    const [sx, sy] = toScreen(pos.x, pos.y);
    const w = canvas.width;
    const h = canvas.height;
    const edge = 24; // (just past the edge still counts: a troop half off screen)
    if (sx < -edge || sy < -edge || sx > w + edge || sy > h + edge) return; // off screen: not heard
    const cx = sx / w - 0.5;
    const cy = sy / h - 0.5;
    vol = Math.max(0.35, 1 - Math.hypot(cx, cy) * 0.9) * zoomVolume();
    pan = Math.max(-0.8, Math.min(0.8, cx * 1.4));
  }
  if (voices >= MAX_VOICES) return;
  lastAt.set(kind, now);
  lastVol = vol;
  const t = ac.currentTime + delay + 0.01;
  const g = ac.createGain();
  g.gain.value = vol;
  const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
  if (p) {
    p.pan.value = pan;
    g.connect(p);
    p.connect(sfxBus);
  } else g.connect(sfxBus);
  voices++;
  setTimeout(() => {
    voices--;
    g.disconnect();
  }, (delay + 2.5) * 1000);
  SFX[kind](g, t, f);
}

// A game event from the server (see net.js), shown `delay` seconds from now.
const COMBAT = new Set(['arrow', 'slash', 'tshot', 'hit', 'boom']);
function onFx(f, delay) {
  if (!ac) return;
  const pos = f.x1 !== undefined ? { x: f.x1, y: f.y1 } : { x: f.x, y: f.y };
  if (COMBAT.has(f.k)) {
    const [sx, sy] = toScreen(pos.x, pos.y);
    if (sx > 0 && sy > 0 && sx < canvas.width && sy < canvas.height) heat += f.k === 'boom' ? 0.6 : 0.12;
  }
  const mine = f.o !== undefined && f.o === S.myId;
  switch (f.k) {
    case 'gold':
    case 'trade':
    case 'wave':
      if (mine) play(f.k, pos, delay); // my income and my troops coming back (where it's on screen)
      return;
    case 'tshot':
      if (f.c) return; // chain jumps: the first bolt's sound covers them
      play('tshot', pos, delay);
      return;
    case 'ping':
      return;
    case 'flee':
      if (mine) play('flee'); // (heard wherever you're looking: your workers need you)
      return;
    default:
      play(f.k, pos, delay, f);
  }
}

// ---- music
const BPM = 72;
const EIGHTH = 60 / BPM / 2;
// A minor: Am - F - C - G, two bars each (MIDI notes)
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const BASS = [45, 41, 36, 43];
const SCALE = [57, 60, 62, 64, 67, 69, 72, 74, 76]; // A minor pentatonic, two octaves
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
let heat = 0; // recent fighting in view
let tension = 0; // smoothed 0..1
let step = 0;
let nextAt = 0;
let lastNote = 4;
let musicTimer = null;

function musicVoice(t, gain, toReverb = 0.6) {
  const g = ac.createGain();
  g.gain.value = gain;
  g.connect(musicBus);
  const send = ac.createGain();
  send.gain.value = toReverb;
  g.connect(send);
  send.connect(reverb);
  setTimeout(() => g.disconnect(), (t - ac.currentTime + 8) * 1000);
  return g;
}

function pad(t, notes, len) {
  const out = musicVoice(t, 0.05, 0.8);
  const flt = ac.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.value = 900 + tension * 600;
  flt.connect(out);
  for (const m of notes) {
    for (const [type, det] of [['triangle', -6], ['sine', 7]]) {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = hz(m);
      o.detune.value = det;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 1.6);
      g.gain.setValueAtTime(0.5, t + len - 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + 1.8);
      o.connect(g);
      g.connect(flt);
      o.start(t);
      o.stop(t + len + 2);
    }
  }
}

function scheduleStep(t) {
  const bar = Math.floor(step / 8);
  const chordI = Math.floor(bar / 2) % CHORDS.length;
  const beat = step % 8;
  if (step % 16 === 0) pad(t, CHORDS[chordI], EIGHTH * 16);
  // bass: on the first and third beats
  if (beat === 0 || beat === 4) tone(musicVoice(t, 0.16, 0.2), t, { f: hz(BASS[chordI]), a: 0.02, d: 1.1, peak: 0.6 });
  // melody: sparse when calm, busier in a fight; mostly steps along the scale
  if (Math.random() < 0.14 + tension * 0.3 && (beat % 2 === 0 || tension > 0.3)) {
    lastNote = Math.max(0, Math.min(SCALE.length - 1, lastNote + Math.round(rnd(-2.4, 2.4))));
    tone(musicVoice(t, 0.07, 0.7), t, { type: 'triangle', f: hz(SCALE[lastNote] + 12), a: 0.005, d: 0.7, peak: 0.5 });
  }
  // drums, fading in with the fighting
  if (tension > 0.12) {
    const v = Math.min(1, tension * 1.3);
    if (beat === 0 || beat === 3 || beat === 6) tone(musicVoice(t, 0.3 * v, 0.15), t, { f: 95, f2: 48, d: 0.35, peak: 0.7 });
    if (beat % 2 === 1) noise(musicVoice(t, 0.05 * v, 0.1), t, { d: 0.05, peak: 0.5, type: 'highpass', f: 6000 });
  }
  step++;
}

function startMusic() {
  if (musicTimer) return;
  nextAt = ac.currentTime + 0.3;
  musicTimer = setInterval(() => {
    if (!ac || ac.state !== 'running') return;
    // fighting in view heats the music up; it cools off over ~10s
    heat = Math.max(0, heat * 0.9 - 0.01);
    tension += (Math.min(1, heat / 3) - tension) * 0.06;
    if (!settings.music || settings.muted) {
      nextAt = ac.currentTime + 0.3;
      return;
    }
    while (nextAt < ac.currentTime + 0.4) {
      scheduleStep(nextAt);
      nextAt += EIGHTH;
    }
  }, 120);
}

// ---- settings
function setSetting(key, value) {
  settings[key] = value;
  save();
  applyVolumes();
}

function toggleMute() {
  setSetting('muted', !settings.muted);
  return settings.muted;
}

// (for checks) whether sound is running, voices playing now, and the music's tension
const audioStatus = () => ({ state: ac ? ac.state : 'off', voices, lastVol: Math.round(lastVol * 100) / 100, tension: Math.round(tension * 100) / 100, step });

export { audioStatus, onFx, play, settings, setSetting, toggleMute, start as startAudio };
