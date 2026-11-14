'use strict';

// Building, upgrading, selling and rebuilding towers, barracks and trade posts.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C } = require('./common');

module.exports = {
  // Place a tower or barracks in one of your own hexes: it stands at the hex's centre, one building
  // per hex. (x, y) is any tile in the hex.
  build(pid, x, y, kind) {
    const p = this.players.get(pid);
    const def = C.TOWERS[kind];
    if (!p || !p.alive || !def) return 'Invalid build';
    if (!Number.isInteger(x) || !Number.isInteger(y) || !this.inBounds(x, y)) return 'Out of bounds';
    const hx = this.hex.hexes[this.hexAt(x, y)];
    if (this.hexOwner[hx.i] !== pid) return `${def.name}s go on your own land`;
    if (hx.centre < 0 || !hx.full) return 'Too close to the edge of the map';
    if (this.buildingHexes()[hx.i]) return 'There is already a building in that hex';
    x = hx.centre % this.w;
    y = (hx.centre - x) / this.w;
    const k = hx.centre;
    if (this.grid[k] !== 0) return 'There is already a building in that hex';
    if (this.nearEnemyBuilding(pid, x, y)) return 'Too close to an enemy building (not in the hex next to one)';
    const owned = this.countOwned(pid, kind);
    if (kind === 'barracks' && owned >= C.MAX_BARRACKS) return `You can have at most ${C.MAX_BARRACKS} barracks`;
    if (kind === 'trade' && owned >= C.MAX_TRADE_POSTS) return `You can have at most ${C.MAX_TRADE_POSTS} trade posts`;
    if (kind === 'workshop' && owned >= C.MAX_WORKSHOPS) return `You can have at most ${C.MAX_WORKSHOPS} workshops`;
    const cost = C.buildCost(kind, owned);
    if (p.gold < cost) return 'Not enough gold';
    if (p.wood < (def.wood || 0)) return 'Not enough wood';
    p.gold -= cost;
    p.wood -= def.wood || 0;
    const id = this.nextId++;
    const stats = C.towerStats(kind, 1);
    // A building site: workers put it up (see workers.js); until then it does nothing.
    const progress = this.instantBuild ? 1 : 0;
    this.towers.set(id, {
      isTower: true, id, kind, x, y, owner: pid, level: 1, hp: progress ? stats.hp : Math.round(stats.hp * C.SITE_START_HP), maxHp: stats.hp, cd: 0, ruin: false, progress,
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

  // ...counting only finished ones (not building sites).
  countBuilt(pid, kind) {
    let n = 0;
    for (const t of this.towers.values()) if (t.owner === pid && t.kind === kind && !(t.progress < 1)) n++;
    return n;
  },

  // Does pid own the hex at tile (x, y)?
  ownsBlock(pid, x, y) {
    return this.inBounds(x, y) && this.hexOwner[this.hexAt(x, y)] === pid;
  },

  upgrade(pid, id) {
    const p = this.players.get(pid);
    const t = this.towers.get(id);
    if (!p || !p.alive || !t || t.owner !== pid) return 'Invalid upgrade';
    if (t.progress < 1) return 'Finish building it first';
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
    // no selling a building out from under its attackers (that would deny them the bounty)
    if (t.hitAt !== undefined && this.time - t.hitAt < C.SELL_LOCK) return "Can't sell while it's under attack";
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
