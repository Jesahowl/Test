'use strict';

// Barbarian camps: placement, spawning, behaviour and respawning.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, dist, round2 } = require('./common');

module.exports = {
  setupCamps() {
    // A shuffled mix of camp sizes (CAMP_MIX), each placed as far as possible from the others.
    const types = [];
    for (const [type, n] of Object.entries(C.CAMP_MIX)) for (let k = 0; k < n; k++) types.push(type);
    for (let k = types.length - 1; k > 0; k--) {
      const j = Math.floor(this.rand() * (k + 1));
      [types[k], types[j]] = [types[j], types[k]];
    }
    for (let i = 0; i < C.CAMP_COUNT; i++) {
      const camp = { id: i, x: -1000, y: -1000, type: types[i % types.length], alive: false, respawnAt: 0 };
      this.camps.push(camp);
      this.moveCamp(camp);
    }
  },

  // Distance from (x, y) to the nearest other (placed) camp.
  campGap(camp, x, y) {
    let best = Infinity;
    for (const o of this.camps) if (o !== camp && o.x >= 0) best = Math.min(best, dist(x, y, o.x, o.y));
    return best;
  },

  // Is (x, y) a good place for a camp? `strict` also requires unclaimed land and a real move.
  campSpotOk(camp, x, y, strict) {
    const k = this.idx(x, y);
    if (this.grid[k] !== 0) return false;
    if (strict && this.terr[k] !== 0) return false;
    if (strict && camp.x >= 0 && dist(x, y, camp.x, camp.y) < C.CAMP_MOVE_MIN) return false;
    if (this.campGap(camp, x, y) < C.CAMP_SPACING) return false;
    for (const p of this.players.values()) if (p.alive && dist(x, y, p.core.x, p.core.y) < C.CAMP_CORE_DIST) return false;
    for (const t of this.towers.values()) if (dist(x, y, t.x, t.y) < 3) return false;
    return true;
  },

  // A new spot for a camp: of many random spots, the one furthest from other camps - preferring
  // unclaimed land and a real move, and keeping clear of cores and towers. If the map is too
  // crowded for the minimum gap, the roomiest spot found is used anyway.
  pickCampSpot(camp) {
    const margin = 6;
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < C.CAMP_CANDIDATES; i++) {
      const x = margin + Math.floor(this.rand() * (this.w - margin * 2));
      const y = margin + Math.floor(this.rand() * (this.h - margin * 2));
      if (this.grid[this.idx(x, y)] !== 0) continue;
      let nearCore = false;
      for (const p of this.players.values()) if (p.alive && dist(x, y, p.core.x, p.core.y) < C.CAMP_CORE_DIST) nearCore = true;
      for (const t of this.towers.values()) if (dist(x, y, t.x, t.y) < 3) nearCore = true;
      if (nearCore) continue;
      const gap = Math.min(this.campGap(camp, x, y), 60);
      // strict spots (good gap, unclaimed land, a real move) always beat relaxed ones
      const score = gap + (this.campSpotOk(camp, x, y, true) ? 1000 : this.campSpotOk(camp, x, y, false) ? 500 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return best || { x: camp.x, y: camp.y };
  },

  // Move a camp to a new spot (its monsters must already be gone).
  moveCamp(camp) {
    const spot = this.pickCampSpot(camp);
    // camps stand at the centre of a hex
    const hx = this.hex.hexes[this.hexAt(spot.x, spot.y)];
    if (hx.centre >= 0 && !this.grid[hx.centre]) {
      camp.x = hx.centre % this.w;
      camp.y = (hx.centre - camp.x) / this.w;
    } else {
      camp.x = spot.x;
      camp.y = spot.y;
    }
  },

  spawnCamp(camp) {
    const leader = Object.keys(C.CAMP_TYPES[camp.type])[0];
    if (!this.campSpotOk(camp, camp.x, camp.y, false)) this.moveCamp(camp); // someone built here meanwhile
    const mid = this.hex.hexes[this.hexAt(camp.x, camp.y)]; // barbarians gather round the hex centre
    this.fx.push({ k: 'campSpawn', x: round2(mid.cx), y: round2(mid.cy) });
    for (const [kind, n] of Object.entries(C.CAMP_TYPES[camp.type])) {
      const def = C.CREEPS[kind];
      for (let i = 0; i < n; i++) {
        const id = this.nextId++;
        const lead = kind === leader && i === 0 && camp.type !== 'small';
        const hx = mid.cx + (lead ? 0 : Math.cos(i * 2.1 + (kind === leader ? 0 : 1)) * 1);
        const hy = mid.cy + (lead ? 0 : Math.sin(i * 2.1 + (kind === leader ? 0 : 1)) * 1);
        this.creeps.set(id, {
          isCreep: true, id, kind, owner: 0, camp: camp.id, hx, hy, x: hx, y: hy,
          hp: def.hp, maxHp: def.hp, angry: 0, atkCd: 0, dead: false,
        });
      }
    }
    camp.alive = true;
  },

  updateCreeps(dt) {
    for (const c of this.creeps.values()) {
      if (c.dead) continue;
      const def = C.CREEPS[c.kind];
      c.atkCd -= dt;
      const speed = def.speed;
      const homeD = dist(c.x, c.y, c.hx, c.hy);
      if (c.angry && homeD > C.CAMP_LEASH + 1.5) c.angry = 0; // dragged too far: reset
      if (!c.angry && homeD < 1.5) {
        // Someone's units came within a tile of the camp: the whole camp turns on that player.
        for (const u of this.nearUnits(c.x, c.y, C.CAMP_AGGRO + 0.5)) {
          if (u.trade || !u.owner || dist(u.x, u.y, c.x, c.y) > C.CAMP_AGGRO) continue;
          for (const m of this.creeps.values()) if (m.camp === c.camp && !m.dead && !m.angry) m.angry = u.owner;
          break;
        }
      }

      if (c.angry) {
        // Fight back against the player who attacked the camp, without leaving the camp area.
        let foe = null;
        let foeD = Infinity;
        for (const u of this.nearUnits(c.hx, c.hy, C.CAMP_LEASH + 2)) {
          if (u.owner !== c.angry || dist(u.x, u.y, c.hx, c.hy) > C.CAMP_LEASH + 2) continue;
          const d = dist(u.x, u.y, c.x, c.y);
          if (d < foeD) {
            foeD = d;
            foe = u;
          }
        }
        if (!foe) {
          c.angry = 0;
        } else if (foeD <= C.CREEP_REACH) {
          if (c.atkCd <= 0) {
            c.atkCd = 1;
            this.fx.push({ k: 'slash', x: round2(foe.x), y: round2(foe.y), a: c.id });
            this.damageUnit(foe, def.damage, 0);
          }
          continue;
        } else {
          const step = Math.min(foeD - C.CREEP_REACH * 0.9, speed * dt);
          c.x += ((foe.x - c.x) / foeD) * step;
          c.y += ((foe.y - c.y) / foeD) * step;
          continue;
        }
      }
      // Calm: walk home and regenerate.
      if (homeD > 0.05) {
        const step = Math.min(homeD, speed * dt);
        c.x += ((c.hx - c.x) / homeD) * step;
        c.y += ((c.hy - c.y) / homeD) * step;
      } else {
        c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.25 * dt);
      }
    }
    const living = new Set();
    for (const [id, c] of this.creeps) {
      if (c.dead) this.creeps.delete(id);
      else living.add(c.camp);
    }
    for (const camp of this.camps) {
      if (camp.alive && !living.has(camp.id)) {
        // Cleared: it will come back somewhere new (players can see where and when).
        camp.alive = false;
        camp.respawnAt = this.time + (C.BUFF_CAMPS.includes(camp.type) ? C.BUFF_CAMP_RESPAWN : C.CAMP_RESPAWN);
        this.moveCamp(camp);
      } else if (!camp.alive && this.time >= camp.respawnAt) {
        this.spawnCamp(camp);
      }
    }
  },
};
