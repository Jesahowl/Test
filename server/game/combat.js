'use strict';

// Damage to troops, monsters, towers and cores; towers and cores shooting.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, dist, round2 } = require('./common');

module.exports = {
  hurt(obj, amount, byPid) {
    if (obj.isUnit) this.damageUnit(obj, amount, byPid);
    else if (obj.isCreep) this.damageCreep(obj, amount, byPid);
    else if (obj.isTower) this.damageTower(obj, amount, byPid);
    else if (obj.isPlayer) this.damageCore(obj, amount, byPid);
    else if (obj.isWall) this.damageWall(obj, amount, byPid);
  },

  damageUnit(u, amount, byPid) {
    if (!this.units.has(u.id)) return;
    u.hp -= this.buffed(u.owner) ? amount * (1 - C.JUNGLE_BUFF_ARMOR) : amount;
    if (u.hp > 0) return;
    this.units.delete(u.id);
    this.fx.push({ k: 'boom', x: round2(u.x), y: round2(u.y), r: 0.5 });
    if (u.trade) {
      this.raidCaravan(u, byPid);
      return;
    }
    const p = this.players.get(byPid);
    if (p && p.alive && byPid !== u.owner) {
      this.award(p, C.TROOP_BOUNTY + C.TROOP_BOUNTY_PER_LEVEL * (u.level - 1), 'troops', u.x, u.y);
      p.kills++;
    }
  },

  damageCreep(c, amount, byPid) {
    if (c.dead) return;
    c.hp -= amount;
    const camp = this.camps[c.camp];
    if (byPid) {
      // The whole camp joins in.
      for (const m of this.creeps.values()) if (m.camp === c.camp && !m.angry) m.angry = byPid;
      c.angry = byPid;
    }
    if (c.hp <= 0) {
      c.dead = true;
      const p = this.players.get(byPid);
      if (p && p.alive) {
        this.award(p, C.CREEPS[c.kind].bounty, 'camps', c.x, c.y);
        p.kills++;
        const cleared = ![...this.creeps.values()].some((m) => m.camp === c.camp && !m.dead);
        if (cleared && camp && C.BUFF_CAMPS.includes(camp.type)) {
          p.buffUntil = this.time + C.JUNGLE_BUFF_TIME;
          this.fx.push({ k: 'buff', x: camp.x + 0.5, y: camp.y + 0.5, o: p.id });
          this.pushFeed(`${p.name} defeated a Warlord: troops empowered for ${C.JUNGLE_BUFF_TIME}s`);
        }
      }
    }
  },

  damageCore(p, amount, byPid) {
    if (this.isShielded(p)) return;
    p.core.hp -= amount * (1 - this.coreArmor());
    this.fx.push({ k: 'hit', x: p.core.x + 0.5, y: p.core.y + 0.5 });
    if (p.core.hp <= 0) this.killPlayer(p, byPid);
  },

  damageTower(t, amount, byPid) {
    if (!t.owner || this.isShielded(this.players.get(t.owner))) return;
    t.hp -= amount;
    t.hitAt = this.time;
    this.fx.push({ k: 'hit', x: t.x + 0.5, y: t.y + 0.5 });
    if (t.hp > 0) return;
    const owner = this.players.get(t.owner);
    const p = this.players.get(byPid);
    this.fx.push({ k: 'boom', x: t.x + 0.5, y: t.y + 0.5, r: 1.2 });
    if (p && p.alive && p.id !== t.owner) {
      // Brought down by a player: it's simply gone. They get the bounty; the land stays its owner's.
      this.award(p, C.TOWER_BOUNTY, 'towers', t.x + 0.5, t.y + 0.5);
      p.towersDestroyed++;
      if (owner) this.pushFeed(`${p.name} destroyed ${owner.name}'s ${C.TOWERS[t.kind].name.toLowerCase()} (+${C.TOWER_BOUNTY}g)`);
      const ownerId = t.owner;
      this.removeTower(t);
      this.rollOnOrders(t, ownerId);
      return;
    }
    const ownerId = t.owner;
    this.ruinTower(t, owner ? owner.name : '');
    this.rollOnOrders(t, ownerId);
  },

  // A fallen tower becomes a ruin: no owner, no land, can be bought back by whoever's land covers it.
  ruinTower(t, ruinOf) {
    t.owner = 0;
    t.ruin = true;
    t.ruinOf = ruinOf;
    t.ruinTime = this.time;
    t.hp = t.maxHp;
    this.structVersion++;
    this.terrDirty = true;
  },

  removeTower(t) {
    this.towers.delete(t.id);
    this.grid[this.idx(t.x, t.y)] = 0;
    this.structVersion++;
    if (t.owner) this.terrDirty = true;
  },

  updateStructures(dt) {
    const shooters = [];
    for (const t of this.towers.values()) {
      if (!t.owner) continue;
      const s = C.towerStats(t.kind, t.level);
      if (!s.damage) continue; // barracks don't shoot
      shooters.push({ obj: t, x: t.x + 0.5, y: t.y + 0.5, owner: t.owner, range: s.range, damage: s.damage, rate: s.rate });
    }
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      shooters.push({
        obj: p.core, x: p.core.x + 0.5, y: p.core.y + 0.5, owner: p.id, range: C.CORE_RANGE, damage: C.CORE_DAMAGE, rate: C.CORE_RATE,
      });
    }
    for (const sh of shooters) {
      sh.obj.cd = (sh.obj.cd || 0) - dt;
      if (sh.obj.cd > 0) continue;
      let target = null;
      let bestD = Infinity;
      for (const u of this.nearUnits(sh.x, sh.y, sh.range)) {
        if (!this.hostile(sh.owner, u.owner)) continue;
        const d = dist(sh.x, sh.y, u.x, u.y);
        if (d <= sh.range && d < bestD) {
          bestD = d;
          target = u;
        }
      }
      if (!target) continue;
      sh.obj.cd = 1 / sh.rate;
      this.fx.push({ k: 'tshot', x1: sh.x, y1: sh.y, x2: round2(target.x), y2: round2(target.y), o: sh.owner });
      // chain lightning: the bolt jumps on to nearby enemies, weaker each time
      const hit = new Set([target.id]);
      let from = target;
      let dmg = sh.damage;
      const chain = [];
      for (let j = 0; j < C.CHAIN_JUMPS; j++) {
        let next = null;
        let nd = C.CHAIN_RANGE;
        for (const u of this.nearUnits(from.x, from.y, C.CHAIN_RANGE)) {
          if (!this.hostile(sh.owner, u.owner) || hit.has(u.id)) continue;
          const d = dist(from.x, from.y, u.x, u.y);
          if (d <= nd) {
            nd = d;
            next = u;
          }
        }
        if (!next) break;
        dmg *= C.CHAIN_FALLOFF;
        hit.add(next.id);
        chain.push([next, dmg]);
        this.fx.push({ k: 'tshot', c: 1, x1: round2(from.x), y1: round2(from.y), x2: round2(next.x), y2: round2(next.y), o: sh.owner });
        from = next;
      }
      this.damageUnit(target, sh.damage, sh.owner);
      for (const [u, d] of chain) if (this.units.has(u.id)) this.damageUnit(u, d, sh.owner);
    }
  },
};
