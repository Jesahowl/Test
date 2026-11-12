// Order targets: what is under the cursor and how to name it.

import { S, C, grid, players } from './state.js';

// ------------------------------------------------------------------ targets
// Targets are encoded like the server does: 't:<tower id>', 'c:<player id>', 'j:<camp id>'.
function targetPos(key) {
  if (!key) return null;
  const [k, raw] = key.split(':');
  const id = Number(raw);
  if (k === 't') {
    const t = S.towers.get(id);
    return t ? { x: t.x + 0.5, y: t.y + 0.5 } : null;
  }
  if (k === 'c') {
    const p = players.get(id);
    return p ? { x: p.x + 0.5, y: p.y + 0.5 } : null;
  }
  if (k === 'u') {
    const u = S.units.get(id);
    return u ? { x: u.rx, y: u.ry, unit: true } : null;
  }
  if (k === 'p') return { x: (id % C.MAP_W) + 0.5, y: Math.floor(id / C.MAP_W) + 0.5, unit: true };
  const camp = S.camps[id];
  return camp ? { x: camp.x + 0.5, y: camp.y + 0.5 } : null;
}

function targetName(key) {
  if (!key) return '';
  const [k, raw] = key.split(':');
  const id = Number(raw);
  if (k === 'c') return id === S.myId ? 'your core' : `${(players.get(id) || { name: '?' }).name}'s core`;
  if (k === 'j') {
    const c = S.campsView.find((o) => o.id === id);
    return c ? `the ${C.CAMP_INFO[c.type].name}` : 'a jungle camp';
  }
  if (k === 'p') return 'a rally point';
  if (k === 'u') {
    const u = S.units.get(id);
    return u ? `${(players.get(u.owner) || { name: '?' }).name}'s ${C.UNITS[u.kind].name}` : 'a troop';
  }
  const t = S.towers.get(id);
  if (!t) return 'a tower';
  return t.owner === S.myId ? 'your tower' : `${(players.get(t.owner) || { name: '?' }).name}'s tower`;
}

// What's under world point (wx, wy) that troops can be ordered at?
function orderTargetAt(wx, wy) {
  // Enemy troops first (they're small, so only right under the cursor).
  let best = null;
  let bestD = 0.55;
  for (const u of S.units.values()) {
    if (u.owner === S.myId) continue;
    const d = Math.hypot(u.rx - wx, u.ry - wy);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  if (best) return { k: 'u', id: best.id };
  for (const p of S.coresView.values()) {
    if (Math.hypot(p.x + 0.5 - wx, p.y + 0.5 - wy) < 1.1) return { k: 'c', id: p.id };
  }
  const tid = grid.get(`${Math.floor(wx)},${Math.floor(wy)}`);
  const t = tid && S.towersView.get(tid);
  if (t && t.owner) return { k: 't', id: t.id };
  for (const c of S.campsView) {
    if (c.alive && Math.hypot(c.x + 0.5 - wx, c.y + 0.5 - wy) < 1.8) return { k: 'j', id: c.id };
  }
  return null;
}

// "clear the Barbarian Outpost (190g)" for hover labels.
function campVerb(id) {
  const c = S.campsView.find((o) => o.id === id);
  if (!c) return 'clear';
  return `clear the ${C.CAMP_INFO[c.type].name} (${C.campBounty(c.type)}g${C.BUFF_CAMPS.includes(c.type) ? ' + buff' : ''})`;
}

function isMineTarget(tg) {
  return (tg.k === 'c' && tg.id === S.myId) || (tg.k === 't' && S.towers.get(tg.id)?.owner === S.myId);
}

export { campVerb, isMineTarget, orderTargetAt, targetName, targetPos };
