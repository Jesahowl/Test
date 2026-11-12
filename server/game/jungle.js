'use strict';

// Barbarian camps: placement, spawning, behaviour and respawning.
// These methods are mixed into Game (see ../game.js), so `this` is the game.

const { C, dist, round2 } = require('./common');

module.exports = {
  setupCamps() {
    // A shuffled mix of camp sizes (CAMP_MIX), dealt out over a jittered grid.
    const types = [];
    for (const [type, n] of Object.entries(C.CAMP_MIX)) for (let k = 0; k < n; k++) types.push(type);
    for (let k = types.length - 1; k > 0; k--) {
      const j = Math.floor(this.rand() * (k + 1));
      [types[k], types[j]] = [types[j], types[k]];
    }
    const cols = 4;
    const rows = 3;
    const margin = 10;
    const cw = (this.w - margin * 2) / cols;
    const ch = (this.h - margin * 2) / rows;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (i >= C.CAMP_COUNT) break;
        const x = Math.round(margin + (c + 0.5) * cw + (this.rand() - 0.5) * cw * 0.5);
        const y = Math.round(margin + (r + 0.5) * ch + (this.rand() - 0.5) * ch * 0.5);
        this.camps.push({ id: i, x, y, type: types[i % types.length], alive: false, respawnAt: 0 });
        i++;
      }
    }
  },

  // Is (x, y) a good place for a camp? `strict` also requires unclaimed land and a real move.
  campSpotOk(camp, x, y, strict) {
    const k = this.idx(x, y);
    if (this.grid[k] !== 0) return false;
    if (strict && this.terr[k] !== 0) return false;
    if (strict && dist(x, y, camp.x, camp.y) < C.CAMP_MOVE_MIN) return false;
    for (const o of this.camps) if (o !== camp && dist(x, y, o.x, o.y) < C.CAMP_SPACING) return false;
    for (const p of this.players.values()) if (p.alive && dist(x, y, p.core.x, p.core.y) < C.CAMP_CORE_DIST) return false;
    for (const t of this.towers.values()) if (dist(x, y, t.x, t.y) < 3) return false;
    return true;
  },

  // A new random spot for a camp: unclaimed land if possible, else anywhere clear.
  pickCampSpot(camp) {
    const margin = 6;
    for (let i = 0; i < 400; i++) {
      const x = margin + Math.floor(this.rand() * (this.w - margin * 2));
      const y = margin + Math.floor(this.rand() * (this.h - margin * 2));
      if (this.campSpotOk(camp, x, y, i < 250)) return { x, y };
    }
    return { x: camp.x, y: camp.y };
  },

  // Move a camp to a new spot (its monsters must already be gone).
  moveCamp(camp) {
    const spot = this.pickCampSpot(camp);
    camp.x = spot.x;
    camp.y = spot.y;
  },

  spawnCamp(camp) {
    const leader = Object.keys(C.CAMP_TYPES[camp.type])[0];
    if (!this.campSpotOk(camp, camp.x, camp.y, false)) this.moveCamp(camp); // someone built here meanwhile
    this.fx.push({ k: 'campSpawn', x: camp.x + 0.5, y: camp.y + 0.5 });
    for (const [kind, n] of Object.entries(C.CAMP_TYPES[camp.type])) {
      const def = C.CREEPS[kind];
      for (let i = 0; i < n; i++) {
        const id = this.nextId++;
        const lead = kind === leader && i === 0 && camp.type !== 'small';
        const hx = camp.x + 0.5 + (lead ? 0 : Math.cos(i * 2.1 + (kind === leader ? 0 : 1)) * 1);
        const hy = camp.y + 0.5 + (lead ? 0 : Math.sin(i * 2.1 + (kind === leader ? 0 : 1)) * 1);
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
            this.fx.push({ k: 'slash', x: round2(foe.x), y: round2(foe.y) });
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
