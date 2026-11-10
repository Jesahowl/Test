'use strict';
// Game simulation: nations, troop growth, pixel-by-pixel attacks and AI.
// No DOM access here, so it can run headless in Node for testing.

const SIM_RNG = typeof mulberry32 !== 'undefined' ? mulberry32 : require('./mapgen').mulberry32;

const TICK_MS = 100;           // simulation runs at 10 ticks per second
const TICK_DT = TICK_MS / 1000;

const CFG = {
  startRadius: 5,
  startTroops: 1000,
  baseMaxTroops: 600,
  maxTroopsPerTile: 20,
  baseGrowth: 20,              // troops per second
  growthPerTile: 0.22,         // extra troops per second per tile
  neutralCost: 2.5,            // troops spent per neutral tile captured
  attackBaseCost: 2,           // troops spent per enemy tile captured...
  attackDensityCost: 1.0,      // ...plus this times the defender's troops per tile
  defendDensityLoss: 0.5,      // defender loses this times its troops per tile, per tile lost
  frontierSpeed: 0.035,        // share of the frontier captured each tick
  winShare: 0.8,
  rescanTicks: 30,
};

const PERSONALITIES = {
  expansionist: { label: 'Expansionist', threshold: 0.35, send: 0.45, aggression: 0.1, boldness: 0.7, playerBias: 1.0, maxAttacks: 2 },
  aggressive:   { label: 'Aggressive',   threshold: 0.5,  send: 0.6,  aggression: 0.55, boldness: 1.3, playerBias: 0.8, maxAttacks: 3 },
  defensive:    { label: 'Defensive',    threshold: 0.7,  send: 0.35, aggression: 0.05, boldness: 0.5, playerBias: 1.2, maxAttacks: 1 },
  opportunist:  { label: 'Opportunist',  threshold: 0.5,  send: 0.5,  aggression: 0.3, boldness: 0.9, playerBias: 1.0, maxAttacks: 2 },
};

const NATION_NAMES = [
  'Valdoria', 'Kesh Republic', 'Ostmark', 'Norvania', 'Tarsis', 'Coralia', 'Drevny',
  'Sarkan Union', 'Almira', 'Bruskland', 'Federated Ilos', 'Marovia', 'Quessa', 'Halvik',
];

const NATION_COLORS = [
  '#e63946', '#2a9d8f', '#f4a261', '#9b5de5', '#8ac926', '#ff006e', '#8d5524',
  '#386641', '#ffd166', '#5c677d', '#7b2d26', '#2b2d42', '#80ffdb', '#cdb4db',
];

const PLAYER_COLOR = '#3a86ff';

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

class Nation {
  constructor(id, name, color, isPlayer, personality) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.rgb = hexToRgb(color);
    this.dark = this.rgb.map(c => Math.round(c * 0.55));
    this.isPlayer = isPlayer;
    this.personality = personality;   // null for the human player
    this.troops = 0;
    this.tiles = 0;
    this.growth = 0;
    this.alive = true;
    this.spawned = false;
    this.spawnX = 0; this.spawnY = 0;
    this.neighbors = new Map();       // nation id (0 = neutral land) -> shared border length
    this.lx = 0; this.ly = 0;         // label position
    this.nextThink = 0;
  }
  get maxTroops() { return CFG.baseMaxTroops + this.tiles * CFG.maxTroopsPerTile; }
}

class Game {
  constructor(map, seed) {
    this.map = map;
    this.W = map.W; this.H = map.H;
    this.owner = new Uint8Array(map.W * map.H);  // 0 = nobody, otherwise nation id
    this.nations = [null];
    this.attacks = [];
    this.nextAttackId = 1;
    this.tick = 0;
    this.rng = SIM_RNG((seed ^ 0x5bd1e995) >>> 0);
    this.events = [];
    this.onCellChange = null;
    this.winner = null;
  }

  log(text, type = 'info') { this.events.push({ text, type, tick: this.tick }); }

  addNation(name, color, isPlayer, personality) {
    const n = new Nation(this.nations.length, name, color, isPlayer, personality);
    this.nations.push(n);
    return n;
  }

  get player() { return this.nations.find(n => n && n.isPlayer) || null; }

  // ---- territory -------------------------------------------------------

  setOwner(i, id) {
    const old = this.owner[i];
    if (old === id) return;
    this.owner[i] = id;
    if (id) this.nations[id].tiles++;
    if (old) {
      const o = this.nations[old];
      o.tiles--;
      if (o.tiles <= 0 && o.alive) this.eliminate(o, id);
    }
    if (this.onCellChange) this.onCellChange(i);
  }

  touches(i, id) {
    const W = this.W, own = this.owner, x = i % W;
    return (x > 0 && own[i - 1] === id) ||
           (x < W - 1 && own[i + 1] === id) ||
           (i >= W && own[i - W] === id) ||
           (i < W * (this.H - 1) && own[i + W] === id);
  }

  canSpawnAt(x, y, minDist) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
    const i = y * this.W + x;
    if (!this.map.land[i] || this.owner[i]) return false;
    for (const n of this.nations) {
      if (!n || !n.spawned) continue;
      if (Math.hypot(n.spawnX - x, n.spawnY - y) < minDist) return false;
    }
    return true;
  }

  findSpawn(minDist) {
    for (let d = minDist; d > 2; d *= 0.85) {
      for (let t = 0; t < 400; t++) {
        const x = Math.floor(this.rng() * this.W), y = Math.floor(this.rng() * this.H);
        if (this.canSpawnAt(x, y, d)) return { x, y };
      }
    }
    return null;
  }

  spawnNation(n, cx, cy) {
    const r = CFG.startRadius;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= this.W || y >= this.H) continue;
        const i = y * this.W + x;
        if (this.map.land[i] && !this.owner[i]) this.setOwner(i, n.id);
      }
    }
    n.troops = CFG.startTroops;
    n.spawned = true;
    n.spawnX = cx; n.spawnY = cy;
    n.lx = cx; n.ly = cy;
    n.nextThink = this.tick + 5 + Math.floor(this.rng() * 20);
  }

  eliminate(n, byId) {
    n.alive = false;
    n.troops = 0;
    const by = byId ? this.nations[byId] : null;
    if (n.isPlayer) this.log(`Your nation has fallen${by ? ' to ' + by.name : ''}.`, 'danger');
    else if (by && by.isPlayer) this.log(`You conquered ${n.name}!`, 'good');
    else this.log(`${n.name} has been eliminated${by ? ' by ' + by.name : ''}.`);
  }

  // ---- attacks ---------------------------------------------------------

  buildFrontier(a) {
    const land = this.map.land, own = this.owner, f = [];
    for (let i = 0; i < own.length; i++) {
      if (land[i] && own[i] === a.target && this.touches(i, a.attacker)) f.push(i);
    }
    a.frontier = f;
    a.lastScan = this.tick;
  }

  // Returns the attack object, or a string explaining why it could not start.
  launchAttack(attackerId, targetId, troops, tx = null, ty = null) {
    const att = this.nations[attackerId];
    if (!att || !att.alive) return 'You have no nation.';
    if (attackerId === targetId) return 'That is your own land.';
    const def = targetId ? this.nations[targetId] : null;
    if (def && !def.alive) return `${def.name} no longer exists.`;
    troops = Math.min(troops, att.troops);
    if (troops < 1) return 'Not enough troops.';

    let a = this.attacks.find(x => !x.done && x.attacker === attackerId && x.target === targetId);
    if (a) {
      a.troops += troops; att.troops -= troops;
      if (tx !== null) { a.tx = tx; a.ty = ty; }
      return a;
    }
    a = { id: this.nextAttackId++, attacker: attackerId, target: targetId, troops, tx, ty,
          frontier: [], done: false, lastScan: 0 };
    this.buildFrontier(a);
    if (!a.frontier.length) {
      return def ? `You don't border ${def.name}. (Boats are coming in a later update.)`
                 : 'There is no free land next to your border.';
    }
    att.troops -= troops;
    this.attacks.push(a);
    if (def && def.isPlayer) this.log(`${att.name} is attacking you!`, 'danger');
    return a;
  }

  endAttack(a) {
    if (a.done) return;
    a.done = true;
    const att = this.nations[a.attacker];
    if (att.alive) att.troops += a.troops;
    a.troops = 0;
  }

  retreat(attackId) {
    const a = this.attacks.find(x => x.id === attackId);
    if (a) this.endAttack(a);
  }

  stepAttack(a) {
    const att = this.nations[a.attacker];
    const def = a.target ? this.nations[a.target] : null;
    if (!att.alive) { a.done = true; return; }
    if (def && !def.alive) { this.endAttack(a); return; }
    if (!a.frontier.length || this.tick - a.lastScan >= CFG.rescanTicks) this.buildFrontier(a);
    if (!a.frontier.length) { this.endAttack(a); return; }

    const f = a.frontier, own = this.owner, land = this.map.land, W = this.W, H = this.H;
    let n = Math.max(2, Math.round(f.length * CFG.frontierSpeed));
    const aimed = a.tx !== null;
    while (n > 0 && f.length) {
      // Pick a random frontier cell; when aimed, prefer the one nearer the target point.
      let k = Math.floor(this.rng() * f.length);
      if (aimed) {
        const k2 = Math.floor(this.rng() * f.length);
        const d1 = (f[k] % W - a.tx) ** 2 + (Math.floor(f[k] / W) - a.ty) ** 2;
        const d2 = (f[k2] % W - a.tx) ** 2 + (Math.floor(f[k2] / W) - a.ty) ** 2;
        if (d2 < d1) k = k2;
      }
      const i = f[k];
      f[k] = f[f.length - 1]; f.pop();
      if (own[i] !== a.target || !land[i] || !this.touches(i, a.attacker)) continue;

      let cost;
      if (def) {
        const density = def.troops / Math.max(1, def.tiles);
        cost = CFG.attackBaseCost + density * CFG.attackDensityCost;
        if (a.troops < cost) { a.troops = 0; break; }
        def.troops = Math.max(0, def.troops - density * CFG.defendDensityLoss);
      } else {
        cost = CFG.neutralCost;
        if (a.troops < cost) { a.troops = 0; break; }
      }
      a.troops -= cost;
      this.setOwner(i, a.attacker);
      n--;

      const x = i % W;
      if (x > 0 && own[i - 1] === a.target) f.push(i - 1);
      if (x < W - 1 && own[i + 1] === a.target) f.push(i + 1);
      if (i >= W && own[i - W] === a.target) f.push(i - W);
      if (i < W * (H - 1) && own[i + W] === a.target) f.push(i + W);
      if (def && !def.alive) break;
    }
    if (a.troops < 1) { a.troops = 0; a.done = true; }
  }

  // ---- AI --------------------------------------------------------------

  think(n) {
    const p = n.personality;
    n.nextThink = this.tick + 10 + Math.floor(this.rng() * 20);
    const max = n.maxTroops;
    if (n.troops < max * p.threshold) return;
    const active = this.attacks.filter(a => !a.done && a.attacker === n.id).length;
    if (active >= p.maxAttacks) return;

    const hasNeutral = n.neighbors.has(0);
    let target = null;
    if (hasNeutral && this.rng() > p.aggression) {
      target = 0;
    } else {
      const myDensity = n.troops / Math.max(1, n.tiles);
      let best = null, bestScore = Infinity;
      for (const id of n.neighbors.keys()) {
        if (id === 0) continue;
        const o = this.nations[id];
        if (!o.alive) continue;
        let score = (o.troops / Math.max(1, o.tiles)) / (myDensity + 1);
        if (o.isPlayer) score *= p.playerBias;
        score *= 0.8 + this.rng() * 0.4;
        if (score < bestScore) { bestScore = score; best = o; }
      }
      if (best && (bestScore < p.boldness || n.troops > max * 0.95)) target = best.id;
      else if (hasNeutral) target = 0;
    }
    if (target === null) return;
    const t = target ? this.nations[target] : null;
    this.launchAttack(n.id, target, n.troops * p.send, t ? Math.round(t.lx) : null, t ? Math.round(t.ly) : null);
  }

  // ---- bookkeeping -----------------------------------------------------

  // Recompute neighbours and label positions (once per second).
  stats() {
    const W = this.W, H = this.H, own = this.owner, land = this.map.land, nations = this.nations;
    const sx = new Float64Array(nations.length), sy = new Float64Array(nations.length);
    for (const n of nations) if (n) n.neighbors = new Map();
    const inc = (a, b) => { const m = nations[a].neighbors; m.set(b, (m.get(b) || 0) + 1); };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!land[i]) continue;
        const a = own[i];
        if (a) { sx[a] += x; sy[a] += y; }
        if (x < W - 1 && land[i + 1]) { const b = own[i + 1]; if (a !== b) { if (a) inc(a, b); if (b) inc(b, a); } }
        if (y < H - 1 && land[i + W]) { const b = own[i + W]; if (a !== b) { if (a) inc(a, b); if (b) inc(b, a); } }
      }
    }
    this.absorbEnclaves();
    for (const n of nations) {
      if (!n || !n.alive || n.tiles <= 0) continue;
      const cx = Math.round(sx[n.id] / n.tiles), cy = Math.round(sy[n.id] / n.tiles);
      const p = this.nearestOwned(n.id, cx, cy, 60);
      if (p) { n.lx = p.x; n.ly = p.y; }
    }
  }

  // Free land cells completely surrounded by one nation (and/or sea) join it for free,
  // so stranded specks inside a country fill in over a few seconds.
  absorbEnclaves() {
    const W = this.W, H = this.H, own = this.owner, land = this.map.land;
    const take = [];
    for (let i = 0; i < own.length; i++) {
      if (!land[i] || own[i]) continue;
      const x = i % W;
      let id = 0, ok = true;
      const check = j => {
        if (!land[j]) return;
        const o = own[j];
        if (!o || (id && o !== id)) { ok = false; return; }
        id = o;
      };
      if (x > 0) check(i - 1);
      if (ok && x < W - 1) check(i + 1);
      if (ok && i >= W) check(i - W);
      if (ok && i < W * (H - 1)) check(i + W);
      if (ok && id) take.push(i, id);
    }
    for (let k = 0; k < take.length; k += 2) this.setOwner(take[k], take[k + 1]);
  }

  nearestOwned(id, cx, cy, maxR) {
    const W = this.W, H = this.H, own = this.owner;
    const ok = (x, y) => x >= 0 && y >= 0 && x < W && y < H && own[y * W + x] === id;
    if (ok(cx, cy)) return { x: cx, y: cy };
    for (let r = 1; r <= maxR; r++) {
      for (let d = -r; d <= r; d++) {
        if (ok(cx + d, cy - r)) return { x: cx + d, y: cy - r };
        if (ok(cx + d, cy + r)) return { x: cx + d, y: cy + r };
        if (ok(cx - r, cy + d)) return { x: cx - r, y: cy + d };
        if (ok(cx + r, cy + d)) return { x: cx + r, y: cy + d };
      }
    }
    return null;
  }

  checkWin() {
    if (this.winner) return;
    const alive = this.nations.filter(n => n && n.alive && n.spawned);
    for (const n of alive) {
      if (n.tiles / this.map.landCount >= CFG.winShare) { this.winner = n; break; }
    }
    if (!this.winner && alive.length === 1) this.winner = alive[0];
    if (this.winner) this.log(`${this.winner.isPlayer ? 'You have' : this.winner.name + ' has'} won the war for the continent!`, this.winner.isPlayer ? 'good' : 'danger');
  }

  update() {
    if (this.winner) return;
    this.tick++;

    for (const n of this.nations) {
      if (!n || !n.alive || !n.spawned) continue;
      const max = n.maxTroops;
      if (n.troops < max) {
        // Full speed until half the cap, then slowing as you fill up: spending troops pays off.
        n.growth = (CFG.baseGrowth + n.tiles * CFG.growthPerTile) * Math.min(1, 2 * (1 - n.troops / max));
        n.troops = Math.min(max, n.troops + n.growth * TICK_DT);
      } else {
        n.growth = 0;
        n.troops -= (n.troops - max) * 0.02;   // over the cap: slowly decay
      }
    }

    for (const a of this.attacks) if (!a.done) this.stepAttack(a);
    this.attacks = this.attacks.filter(a => !a.done);

    for (const n of this.nations) {
      if (n && n.alive && n.spawned && !n.isPlayer && this.tick >= n.nextThink) this.think(n);
    }

    if (this.tick % 10 === 0) { this.stats(); this.checkWin(); }
  }
}

if (typeof module !== 'undefined') {
  module.exports = { Game, Nation, CFG, PERSONALITIES, NATION_NAMES, NATION_COLORS, PLAYER_COLOR, TICK_MS };
}
