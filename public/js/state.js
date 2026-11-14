/* global TD_CONFIG */
// Shared state: config, DOM handles, game data received from the server, camera and UI preferences.

// Values that several modules reassign live on S (e.g. S.towers); everything else is
// exported directly (ES module exports are live, so readers always see the current value).
export const S = {};


const C = TD_CONFIG;

const KIND_KEYS = Object.keys(C.TOWERS);

// troop types you can put in a wave (not caravans); ALL_UNIT_KEYS also has caravans, for snapshots
const UNIT_KEYS = Object.keys(C.UNITS).filter((k) => !C.UNITS[k].caravan && !C.UNITS[k].worker);
const ALL_UNIT_KEYS = Object.keys(C.UNITS);

const CREEP_KEYS = Object.keys(C.CREEPS);

const CAMP_KEYS = Object.keys(C.CAMP_TYPES);

const TPX = 2; // minimap territory canvas pixels per tile

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
S.forestLeft = new Map(); // chopped forest hexes: hex -> wood left in fifths
S.selWorker = null; // the worker picked (right-click sends it to work)
S.workerSent = new Map(); // worker id -> { x, y, at }: where I sent it by hand (marked until it gets there)

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
// the hex grid land, buildings and borders work in (same as the server's)
const HEX = window.TD_HEX.build(C.MAP_W, C.MAP_H, C.HEX_R);

// Buildings and camps stand at the centre of their hex (their tile is just the nearest one).
function hexSpot(tx, ty) {
  const h = HEX.hexes[HEX.tileHex[ty * C.MAP_W + tx]];
  return { x: h.cx, y: h.cy };
}

// How far above its base (in tiles) a building's drawing is anchored: drawn this much higher, its
// base (rune circle) sits right on the hex centre.
function baseLift(kind, level = 1) {
  if (kind === 'core') return 0.375;
  if (kind === 'barracks' || kind === 'trade' || kind === 'workshop') return 0.576;
  if (kind === 'tower') return 0.396 * (1 + 0.07 * (level - 1));
  return 0;
}

// The tower or barracks in the hex under world point (wx, wy), if any.
function towerInHex(wx, wy) {
  if (wx < 0 || wy < 0 || wx >= C.MAP_W || wy >= C.MAP_H) return null;
  const i = HEX.at(wx, wy);
  for (const t of S.towersView.values()) if (HEX.tileHex[t.y * C.MAP_W + t.x] === i) return t;
  return null;
}

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
S.selCaravan = null; // selected caravan (shows its trade road)
const selUnits = new Set(); // selected troop ids
S.centerOnMe = false;

// Spectating after your core falls: free camera that can follow a player.
S.spectating = false;

S.specTarget = 0;

S.specFollow = true;

// Squads: right-click orders go to every squad (S.allSquads) or to the squads picked (ids).
S.allSquads = true;
S.selSquads = new Set();

S.lunges = new Map(); // troop or barbarian id -> { at, x, y }: a sword swing's dash at its target
S.pendingOrder = null; // toast text waiting for the server to say how many troops moved
const keys = new Set();

const mouse = { sx: 0, sy: 0, wx: 0, wy: 0, rightDown: false, dragged: false, lastX: 0, lastY: 0 };

const scale = () => BASE_SCALE * cam.zoom;

const toScreen = (wx, wy) => [(wx - cam.x) * scale() + canvas.width / 2, (wy - cam.y) * scale() + canvas.height / 2];

const toWorld = (sx, sy) => [(sx - canvas.width / 2) / scale() + cam.x, (sy - canvas.height / 2) / scale() + cam.y];


// tone 0: the normal colour; 1: paler; 2: deeper (for games with more than 12 players)
const hslOf = (hue, tone, l = 55, a = 1) => {
  const sat = tone === 1 ? 45 : tone === 2 ? 90 : 75;
  const lit = Math.max(8, Math.min(92, l + (tone === 1 ? 14 : tone === 2 ? -14 : 0)));
  return `hsla(${hue}, ${sat}%, ${lit}%, ${a})`;
};
const colorOf = (pid, l = 55, a = 1) => {
  const p = pid && players.get(pid);
  return p ? hslOf(p.hue, p.tone, l, a) : pid ? hslOf(0, 0, l, a) : `rgba(140, 120, 90, ${a})`;
};

export { hslOf, baseLift, hexSpot, towerInHex, HEX, FOG_PAD, FOG_RES, fogSoft, fogSoftCtx, $, C, CAMP_KEYS, CREEP_KEYS, KIND_KEYS, NTILES, TPX, UNIT_KEYS, ALL_UNIT_KEYS, Vision, cam, canvas, colorOf, ctx, explored, feed, fogCanvas, fogCtx, fogImg, grid, keys, mctx, mini, mouse, players, scale, selUnits, tctx, terr, terrCanvas, toScreen, toWorld, vis, withContext };
