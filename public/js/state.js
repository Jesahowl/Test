/* global TD_CONFIG */
// Shared state: config, DOM handles, game data received from the server, camera and UI preferences.

// Values that several modules reassign live on S (e.g. S.towers); everything else is
// exported directly (ES module exports are live, so readers always see the current value).
export const S = {};

import { updateShareUi } from './bar.js';

const C = TD_CONFIG;

const KIND_KEYS = Object.keys(C.TOWERS);

const UNIT_KEYS = Object.keys(C.UNITS);

const CREEP_KEYS = Object.keys(C.CREEPS);

const CAMP_KEYS = Object.keys(C.CAMP_TYPES);

const TPX = 2; // minimap territory canvas pixels per tile
const SMOOTH_WINDOW = 1; // outline points averaged on each side when smoothing territory
const SMOOTH_PASSES = 1;

// ------------------------------------------------------------------ DOM
const $ = (id) => document.getElementById(id);

const canvas = $('game');

let ctx = canvas.getContext('2d'); // swapped briefly when drawing UI icons
// Draw with another canvas context for a moment (HUD icons reuse the in-game shapes).
function withContext(c, fn) {
  const saved = ctx;
  ctx = c;
  try {
    return fn();
  } finally {
    ctx = saved;
  }
}

const mini = $('minimap');

const mctx = mini.getContext('2d');

// ------------------------------------------------------------------ state
S.ws = null;

S.myId = null;

S.me = null; // { id, gold, nextWave, army, levels, order }
S.lastName = '';

S.round = null; // { n, phase, t, join, sd }
S.queued = false; // waiting to join the next round
const players = new Map(); // id -> { id, name, hue, x, y, hp, maxHp, territory, kills, isBot, shield }
S.towers = new Map(); // id -> tower / ruin
S.units = new Map(); // id -> troop (with rx/ry render positions)
S.creeps = new Map(); // id -> jungle monster (with rx/ry render positions)
S.camps = [];

S.campMap = new Map();

S.effects = [];

const feed = [];

const terr = new Int32Array(C.MAP_W * C.MAP_H);

const terrCanvas = document.createElement('canvas');

terrCanvas.width = C.MAP_W * TPX;

terrCanvas.height = C.MAP_H * TPX;

const tctx = terrCanvas.getContext('2d');

const grid = new Map(); // "x,y" -> tower id
S.terrShapes = []; // [{ owner, path: Path2D in tile units }]
// ---- fog of war
// vis: what I can see now; explored: what I've ever seen. Explored ground stays revealed with
// live activity; the fog overlay covers the rest (territory is drawn in full underneath). The
// server only sends enemy troops in explored ground. Spectators see everything.
const Vision = window.TD_VISION;

const NTILES = C.MAP_W * C.MAP_H;
const vis = new Uint8Array(NTILES);
const explored = new Uint8Array(NTILES);

S.terrView = terr; // what the territory layer draws
S.fogOn = false;

S.fogWasOn = null;

S.towersSeen = new Map();

S.coresSeen = new Map();

S.campsSeen = new Map();

S.towersView = new Map();

S.coresView = new Map();

S.campsView = [];

// Fog layers: one pixel per tile (with FOG_PAD tiles of solid fog around the map, so blurring
// never thins the map's edges), then a blurred, FOG_RES-times larger copy for smooth edges.
const FOG_PAD = 3;
const FOG_RES = 6;
const fogCanvas = document.createElement('canvas');
fogCanvas.width = C.MAP_W + FOG_PAD * 2;
fogCanvas.height = C.MAP_H + FOG_PAD * 2;
const fogCtx = fogCanvas.getContext('2d');
const fogImg = fogCtx.createImageData(fogCanvas.width, fogCanvas.height);
const fogSoft = document.createElement('canvas');
fogSoft.width = fogCanvas.width * FOG_RES;
fogSoft.height = fogCanvas.height * FOG_RES;
const fogSoftCtx = fogSoft.getContext('2d');

S.terrStamp = 0; // bumps whenever territory changes

const cam = { x: C.MAP_W / 2, y: C.MAP_H / 2, zoom: 1 };

const BASE_SCALE = 28;

S.buildKind = null; // 'tower' while placing
S.selectedId = null; // selected tower / ruin
const selUnits = new Set(); // selected troop ids
S.centerOnMe = false;

// Spectating after your core falls: free camera that can follow a player.
S.spectating = false;

S.specTarget = 0;

S.specFollow = true;

const SHARES = [0.25, 0.5, 0.75, 1]; // presets on Z X C V
const SHARE_KEYS = ['z', 'x', 'c', 'v'];

const SHARE_STEP = 0.05; // the send slider moves in 5% steps
S.sendShare = 1; // share of troops a right-click order sends (when no troops are selected)
try {
  const saved = Number(localStorage.getItem('ts-share'));
  if (saved >= SHARE_STEP && saved <= 1) S.sendShare = saved;
} catch { /* ignore */ }

// Which troop types right-click orders send (all by default).
S.sendKinds = new Set(UNIT_KEYS);

try {
  const saved = JSON.parse(localStorage.getItem('ts-kinds') || 'null');
  if (Array.isArray(saved) && saved.some((k) => UNIT_KEYS.includes(k))) S.sendKinds = new Set(saved.filter((k) => UNIT_KEYS.includes(k)));
} catch { /* ignore */ }

const allKinds = () => UNIT_KEYS.every((k) => S.sendKinds.has(k));

// Whether right-click orders also redirect new waves (an explicit toggle, F).
let wavesFollow = true;

try { wavesFollow = localStorage.getItem('ts-follow') !== '0'; } catch { /* ignore */ }

function setFollow(on) {
  wavesFollow = on;
  try { localStorage.setItem('ts-follow', on ? '1' : '0'); } catch { /* ignore */ }
  updateShareUi();
}

S.pendingOrder = null; // toast text waiting for the server to say how many troops moved
const keys = new Set();

const mouse = { sx: 0, sy: 0, wx: 0, wy: 0, rightDown: false, dragged: false, lastX: 0, lastY: 0 };

const scale = () => BASE_SCALE * cam.zoom;

const toScreen = (wx, wy) => [(wx - cam.x) * scale() + canvas.width / 2, (wy - cam.y) * scale() + canvas.height / 2];

const toWorld = (sx, sy) => [(sx - canvas.width / 2) / scale() + cam.x, (sy - canvas.height / 2) / scale() + cam.y];

const hueOf = (pid) => (players.get(pid) || { hue: 0 }).hue;

const colorOf = (pid, l = 55, a = 1) => (pid ? `hsla(${hueOf(pid)}, 75%, ${l}%, ${a})` : `rgba(140, 120, 90, ${a})`);

export { FOG_PAD, FOG_RES, fogSoft, fogSoftCtx, $, C, CAMP_KEYS, CREEP_KEYS, KIND_KEYS, NTILES, SHARES, SHARE_KEYS, SHARE_STEP, SMOOTH_PASSES, SMOOTH_WINDOW, TPX, UNIT_KEYS, Vision, allKinds, cam, canvas, colorOf, ctx, explored, feed, fogCanvas, fogCtx, fogImg, grid, keys, mctx, mini, mouse, players, scale, selUnits, setFollow, tctx, terr, terrCanvas, toScreen, toWorld, vis, wavesFollow, withContext };
