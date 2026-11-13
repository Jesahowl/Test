'use strict';

// Building, upgrading, selling and rebuilding towers and barracks.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C } = require('./common');

module.exports = {
  // Place a tower on your land, or leapfrog it onto unclaimed land just past your border.
  build(pid, x, y, kind) {
    const p = this.players.get(pid);
    const def = C.TOWERS[kind];
    if (!p || !p.alive || !def) return 'Invalid build';
    if (!Number.isInteger(x) || !Number.isInteger(y) || !this.inBounds(x, y)) return 'Out of bounds';
    const k = this.idx(x, y);
    if (this.terr[k] !== pid) {
      if (def.ownLandOnly) return `${def.name} must be built on your own land`;
      if (this.terr[k] !== 0) return 'You cannot build on enemy land';
      if (!this.withinLeap(pid, x, y)) return `Towers can leap at most ${C.TOWER_LEAP} tiles beyond your border`;
    }
    if (this.grid[k] !== 0) return 'Tile is occupied';
    if (this.nearEnemyBuilding(pid, x, y)) return `Too close to an enemy building (keep ${C.ENEMY_BUILD_GAP} tiles away)`;
    const owned = this.countOwned(pid, kind);
    if (kind === 'barracks' && owned >= C.MAX_BARRACKS) return `You can have at most ${C.MAX_BARRACKS} barracks`;
    const cost = C.buildCost(kind, owned);
    if (p.gold < cost) return 'Not enough gold';
    p.gold -= cost;
    const id = this.nextId++;
    const stats = C.towerStats(kind, 1);
    this.towers.set(id, {
      isTower: true, id, kind, x, y, owner: pid, level: 1, hp: stats.hp, maxHp: stats.hp, cd: 0, ruin: false,
    });
    this.grid[k] = id;
    this.structVersion++;
    this.terrDirty = true;
    return null;
  },

  // Is there another player's tower, barracks or core within ENEMY_BUILD_GAP tiles of (x, y)?
  nearEnemyBuilding(pid, x, y) {
    const gap = C.ENEMY_BUILD_GAP;
    for (const t of this.towers.values()) {
      if (t.owner && t.owner !== pid && Math.hypot(t.x - x, t.y - y) < gap) return true;
    }
    for (const q of this.players.values()) {
      if (q.alive && q.id !== pid && Math.hypot(q.core.x - x, q.core.y - y) < gap) return true;
    }
    return false;
  },

  countOwned(pid, kind) {
    let n = 0;
    for (const t of this.towers.values()) if (t.owner === pid && t.kind === kind) n++;
    return n;
  },

  // Is unclaimed tile (x, y) within TOWER_LEAP tiles of pid's land?
  withinLeap(pid, x, y) {
    const r = C.TOWER_LEAP;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.hypot(dx, dy) > r + 0.01 || !this.inBounds(x + dx, y + dy)) continue;
        if (this.terr[this.idx(x + dx, y + dy)] === pid) return true;
      }
    }
    return false;
  },

  upgrade(pid, id) {
    const p = this.players.get(pid);
    const t = this.towers.get(id);
    if (!p || !p.alive || !t || t.owner !== pid) return 'Invalid upgrade';
    if (t.level >= C.maxLevel(t.kind)) return t.kind === 'tower' ? 'Already max level' : `A ${C.TOWERS[t.kind].name} can't be upgraded`;
    const cost = C.upgradeCost(t.kind, t.level);
    if (p.gold < cost) return 'Not enough gold';
    p.gold -= cost;
    t.level++;
    const stats = C.towerStats(t.kind, t.level);
    t.hp += stats.hp - t.maxHp;
    t.maxHp = stats.hp;
    this.structVersion++;
    this.terrDirty = true;
    return null;
  },

  sell(pid, id) {
    const p = this.players.get(pid);
    const t = this.towers.get(id);
    if (!p || !p.alive || !t || t.owner !== pid) return 'Invalid sell';
    p.gold += C.sellValue(t.kind, t.level);
    this.removeTower(t);
    return null;
  },

  // Buy back a ruined tower that sits inside your land.
  capture(pid, towerId) {
    const p = this.players.get(pid);
    const t = this.towers.get(towerId);
    if (!p || !p.alive || !t || !t.ruin) return 'Nothing to capture';
    if (this.terr[this.idx(t.x, t.y)] !== pid) return 'Ruin must be inside your land';
    if (p.gold < C.RUIN_CAPTURE_COST) return 'Not enough gold';
    p.gold -= C.RUIN_CAPTURE_COST;
    t.owner = pid;
    t.ruin = false;
    t.hp = t.maxHp;
    delete t.ruinOf;
    delete t.ruinTime;
    this.structVersion++;
    this.terrDirty = true;
    return null;
  },
};
