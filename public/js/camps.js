// Barbarian camps: camp markers, tents and campfires, and the barbarians themselves.

import { interpPos, renderTime } from './net.js';
import { hpBar, label, lungeOffset, onScreen } from './render.js';
import { S, C, ctx, hexSpot, scale, toScreen } from './state.js';
import { polygon } from './structures.js';

function drawCamps() {
  const s = scale();
  for (const c of S.campsView) {
    const spot = hexSpot(c.x, c.y);
    const [x, y] = toScreen(spot.x, spot.y);
    if (!onScreen(x, y, s * 3)) continue;
    if (c.alive) {
      if (s >= 8) drawCampDecor(c, x, y, s, performance.now());
      continue;
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(139, 148, 158, 0.3)';
    ctx.lineWidth = c.type === 'large' ? 2.5 : c.type === 'medium' ? 2 : 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(x, y, s * 1.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // An upcoming camp: a ring that fills in as it gets ready to appear here.
    const total = C.BUFF_CAMPS.includes(c.type) ? C.BUFF_CAMP_RESPAWN : C.CAMP_RESPAWN;
    const p = Math.max(0, Math.min(1, 1 - c.respawn / total));
    ctx.strokeStyle = 'rgba(214, 180, 120, 0.55)';
    ctx.lineWidth = Math.max(2, s * 0.08);
    ctx.beginPath();
    ctx.arc(x, y, s * 1.7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    ctx.stroke();
    const big = C.BUFF_CAMPS.includes(c.type);
    label(C.CAMP_INFO[c.type].name, x, y - 2, Math.max(9, Math.round(s * 0.32)), big ? '#ffab40' : '#c9a66b');
    label(`in ${c.respawn}s`, x, y + Math.max(10, s * 0.45), Math.max(10, Math.round(s * 0.4)), '#8b949e');
  }
}

function drawFlame(x, y, r) {
  const flick = 1 + 0.08 * Math.sin(performance.now() / 90);
  ctx.fillStyle = '#ff7043';
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.3 * flick);
  ctx.quadraticCurveTo(x + r, y - r * 0.2, x + r * 0.6, y + r * 0.6);
  ctx.quadraticCurveTo(x, y + r * 1.1, x - r * 0.6, y + r * 0.6);
  ctx.quadraticCurveTo(x - r, y - r * 0.2, x, y - r * 1.3 * flick);
  ctx.fill();
  ctx.fillStyle = '#ffd54f';
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.4 * flick);
  ctx.quadraticCurveTo(x + r * 0.45, y + r * 0.2, x, y + r * 0.7);
  ctx.quadraticCurveTo(x - r * 0.45, y + r * 0.2, x, y - r * 0.4 * flick);
  ctx.fill();
}

function drawCreeps(dt) {
  const s = scale();
  const rt = renderTime();
  const now = performance.now();
  for (const c of S.creeps.values()) {
    const px = c.rx;
    const py = c.ry;
    [c.rx, c.ry] = interpPos(c, rt);
    const [lx, ly] = lungeOffset(c.id, c.rx, c.ry, now);
    const [x, y] = toScreen(c.rx + lx, c.ry + ly);
    if (!onScreen(x, y, s * 2)) continue;
    // facing and walking come from how the monster moved since the last frame
    const vx = px === undefined ? 0 : c.rx - px;
    const vy = py === undefined ? 0 : c.ry - py;
    const moving = Math.hypot(vx, vy) > 0.002;
    if (Math.abs(vx) > 0.002) c.face = vx > 0 ? 1 : -1;
    c.walk = (c.walk || 0) + (moving ? dt * 9 : 0);
    const r = C.CREEPS[c.kind].size * s;
    drawMonster(c, x, y, r, now, moving, c.face || 1);
    hpBar(x, y - r * 1.5 - 4, Math.max(s * 0.7, r * 1.8), c.hp);
  }
}

// ---- barbarians: a round token with a red rim (so they never look like a player's troops), a
// horned helmet, and the weapon that tells the types apart. They bob as they walk and swing
// their weapon when angry.
function drawWeapon(kind, r, swing) {
  ctx.save();
  ctx.rotate(swing);
  ctx.lineCap = 'round';
  const wood = '#7b4a2a';
  const steel = '#cfd6dc';
  if (kind === 'axe' || kind === 'greataxe') {
    const big = kind === 'greataxe';
    ctx.strokeStyle = wood;
    ctx.lineWidth = r * (big ? 0.16 : 0.13);
    ctx.beginPath();
    ctx.moveTo(0, r * 0.45);
    ctx.lineTo(0, -r * (big ? 0.95 : 0.8));
    ctx.stroke();
    ctx.fillStyle = steel;
    for (const side of big ? [-1, 1] : [1]) {
      ctx.beginPath();
      ctx.moveTo(0, -r * (big ? 0.85 : 0.72));
      ctx.quadraticCurveTo(side * r * (big ? 0.62 : 0.5), -r * (big ? 0.95 : 0.8), side * r * (big ? 0.55 : 0.45), -r * (big ? 0.42 : 0.38));
      ctx.lineTo(0, -r * (big ? 0.5 : 0.45));
      ctx.closePath();
      ctx.fill();
    }
  } else if (kind === 'club') {
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.moveTo(-r * 0.07, r * 0.45);
    ctx.lineTo(r * 0.07, r * 0.45);
    ctx.lineTo(r * 0.2, -r * 0.75);
    ctx.arc(0, -r * 0.75, r * 0.2, 0, Math.PI, true);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = steel;
    for (const [sx, sy] of [[-0.22, -0.7], [0.22, -0.62], [0.05, -0.98], [-0.15, -0.45], [0.17, -0.35]]) {
      polygon(r * sx, r * sy, r * 0.07, 3, sx * 4);
      ctx.fill();
    }
  } else if (kind === 'spear') {
    ctx.strokeStyle = wood;
    ctx.lineWidth = r * 0.11;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.6);
    ctx.lineTo(0, -r * 0.95);
    ctx.stroke();
    ctx.fillStyle = steel;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.3);
    ctx.lineTo(r * 0.14, -r * 0.92);
    ctx.lineTo(-r * 0.14, -r * 0.92);
    ctx.closePath();
    ctx.fill();
  }
  ctx.lineCap = 'butt';
  ctx.restore();
}

function drawMonster(c, x, y, r, now, moving, face) {
  const def = C.CREEPS[c.kind];
  const t = now / 1000 + c.id * 0.37;
  const angry = !!c.angry;
  const bob = moving ? Math.abs(Math.sin(c.walk)) * r * 0.12 : Math.sin(t * 2) * r * 0.03;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.85, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y - bob);
  // weapon on the side it's facing; swings when fighting
  ctx.save();
  ctx.translate(face * r * 1.05, r * 0.05);
  ctx.scale(1.3, 1.3);
  const swing = angry ? -face * (0.3 + 0.7 * Math.max(0, Math.sin(t * 7))) : face * (0.25 + Math.sin(t * 1.5) * 0.06);
  drawWeapon(def.weapon, r, swing);
  ctx.restore();
  // token
  if (def.crown) {
    // the warlord: a gold rim and a red cape
    ctx.fillStyle = '#8e1b12';
    ctx.beginPath();
    ctx.arc(0, r * 0.12, r * 1.08, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.fill();
  }
  ctx.fillStyle = '#3b2418';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = angry ? `rgba(255, 82, 82, ${0.75 + 0.25 * Math.sin(t * 10)})` : def.crown ? '#e0b43c' : '#c0392b';
  ctx.lineWidth = Math.max(1.5, r * (def.crown ? 0.16 : 0.13));
  ctx.stroke();
  // face and beard
  ctx.fillStyle = '#e2b48a';
  ctx.beginPath();
  ctx.arc(0, r * 0.08, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = def.crown ? '#8d8d8d' : '#b5651d';
  ctx.beginPath();
  ctx.moveTo(-r * 0.36, r * 0.15);
  ctx.quadraticCurveTo(0, r * 0.95, r * 0.36, r * 0.15);
  ctx.quadraticCurveTo(0, r * 0.4, -r * 0.36, r * 0.15);
  ctx.fill();
  // horns, then the helmet over the top of the head
  ctx.fillStyle = '#efe3c4';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * r * 0.32, -r * 0.12);
    ctx.quadraticCurveTo(side * r * 0.85, -r * 0.2, side * r * 0.78, -r * 0.78);
    ctx.quadraticCurveTo(side * r * 0.62, -r * 0.35, side * r * 0.22, -r * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#9aa0a6';
  ctx.beginPath();
  ctx.arc(0, -r * 0.02, r * 0.46, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#6e757c';
  ctx.fillRect(-r * 0.46, -r * 0.06, r * 0.92, r * 0.1);
  if (def.crown) {
    ctx.fillStyle = '#e0b43c';
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.3);
    for (let i = 0; i < 3; i++) {
      ctx.lineTo(-r * 0.3 + r * 0.3 * i + r * 0.15, -r * 0.62);
      ctx.lineTo(-r * 0.3 + r * 0.3 * (i + 1), -r * 0.3);
    }
    ctx.closePath();
    ctx.fill();
  }
  // eyes
  ctx.fillStyle = angry ? '#ff1744' : '#2b1a10';
  for (const ex of [-0.15, 0.15]) {
    ctx.beginPath();
    ctx.arc(ex * r + face * r * 0.04, r * 0.12, r * (angry ? 0.075 : 0.06), 0, Math.PI * 2);
    ctx.fill();
  }
  if (angry) {
    ctx.strokeStyle = '#2b1a10';
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(-r * 0.27, r * 0.0);
    ctx.lineTo(-r * 0.06, r * 0.06);
    ctx.moveTo(r * 0.27, r * 0.0);
    ctx.lineTo(r * 0.06, r * 0.06);
    ctx.stroke();
  }
  ctx.restore();
}

// A barbarian camp: tents and a campfire.
// ---- camp look: a tent village on a patch of trampled earth. Bigger camps have more tents;
// the Barbarian Outpost adds war banners, and the Warlord's Fort a watchtower whose beacon
// fire marks the buff it gives.
const CAMP_LAYOUT = {
  small: { ground: 1.6, tent: 0.46, tents: [[-1.1, -1.0], [1.1, -1.0], [0, -1.55]] },
  medium: { ground: 1.9, tent: 0.5, tents: [[-1.35, -0.85], [1.35, -0.85], [-0.6, -1.6], [0.6, -1.6]], banners: true },
  large: { ground: 2.2, tent: 0.52, tents: [[-1.65, -0.55], [1.65, -0.55], [-1.0, -1.6], [0.7, -1.7], [-0.15, -2.2]], banners: true, tower: [1.75, -1.75] },
};

// An irregular patch of earth, the same shape every frame for a given camp.
function campGround(c, x, y, r) {
  for (const [scale, col] of [[1, 'rgba(110, 84, 56, 0.3)'], [0.62, 'rgba(70, 50, 32, 0.32)']]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const rr = r * scale * (0.88 + 0.08 * Math.sin(a * 5 + c.id * 1.7) + 0.05 * Math.sin(a * 9 + c.id * 0.7));
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.92);
    }
    ctx.fill();
  }
}

function drawTent(cx, cy, w, hide, shade, c, now) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + w * 0.55, w * 0.95, w * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hide;
  ctx.beginPath();
  ctx.moveTo(cx - w, cy + w * 0.55);
  ctx.lineTo(cx, cy - w * 0.75);
  ctx.lineTo(cx + w, cy + w * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(cx, cy - w * 0.75);
  ctx.lineTo(cx + w, cy + w * 0.55);
  ctx.lineTo(cx + w * 0.35, cy + w * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3b2418';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.22, cy + w * 0.55);
  ctx.lineTo(cx, cy - w * 0.05);
  ctx.lineTo(cx + w * 0.22, cy + w * 0.55);
  ctx.closePath();
  ctx.fill();
  // crossed poles poking out of the top
  ctx.strokeStyle = '#5d4037';
  ctx.lineWidth = Math.max(1, w * 0.08);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.22, cy - w * 1.05);
  ctx.lineTo(cx + w * 0.12, cy - w * 0.62);
  ctx.moveTo(cx + w * 0.22, cy - w * 1.05);
  ctx.lineTo(cx - w * 0.12, cy - w * 0.62);
  ctx.stroke();
}

// A war banner on a pole: red cloth with a skull, waving.
function drawBanner(bx, by, h, c, now, col = '#c0392b') {
  ctx.strokeStyle = '#5d4037';
  ctx.lineWidth = Math.max(1.5, h * 0.06);
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx, by - h);
  ctx.stroke();
  const wave = Math.sin(now / 260 + c.id + bx) * h * 0.04;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(bx, by - h);
  ctx.lineTo(bx + h * 0.5, by - h * 0.86 + wave);
  ctx.lineTo(bx + h * 0.38, by - h * 0.71 + wave);
  ctx.lineTo(bx + h * 0.5, by - h * 0.56 + wave);
  ctx.lineTo(bx, by - h * 0.56);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#efe6d2';
  ctx.beginPath();
  ctx.arc(bx + h * 0.2, by - h * 0.72 + wave * 0.5, h * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

function drawWatchtower(tx, ty, s, now) {
  const leg = s * 0.26;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(tx, ty + s * 0.72, s * 0.4, s * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6d4426';
  ctx.lineWidth = Math.max(1.5, s * 0.08);
  ctx.beginPath();
  ctx.moveTo(tx - leg, ty + s * 0.7);
  ctx.lineTo(tx - leg * 0.6, ty - s * 0.3);
  ctx.moveTo(tx + leg, ty + s * 0.7);
  ctx.lineTo(tx + leg * 0.6, ty - s * 0.3);
  ctx.moveTo(tx - leg * 0.85, ty + s * 0.35);
  ctx.lineTo(tx + leg * 0.75, ty - s * 0.05);
  ctx.stroke();
  ctx.fillStyle = '#8a5a35';
  ctx.fillRect(tx - s * 0.32, ty - s * 0.55, s * 0.64, s * 0.28);
  ctx.strokeStyle = '#4e321d';
  ctx.lineWidth = 1;
  ctx.strokeRect(tx - s * 0.32, ty - s * 0.55, s * 0.64, s * 0.28);
  // beacon fire on top: this camp grants the jungle buff
  const glow = ctx.createRadialGradient(tx, ty - s * 0.75, 0, tx, ty - s * 0.75, s * 0.8);
  glow.addColorStop(0, 'rgba(255, 140, 0, 0.45)');
  glow.addColorStop(1, 'rgba(255, 140, 0, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(tx, ty - s * 0.75, s * 0.8, 0, Math.PI * 2);
  ctx.fill();
  drawFlame(tx, ty - s * 0.78, s * 0.2);
}

function drawCampfire(fx, fy, s) {
  ctx.strokeStyle = '#5d4037';
  ctx.lineWidth = Math.max(1.5, s * 0.08);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fx - s * 0.22, fy + s * 0.1);
  ctx.lineTo(fx + s * 0.22, fy - s * 0.02);
  ctx.moveTo(fx - s * 0.22, fy - s * 0.02);
  ctx.lineTo(fx + s * 0.22, fy + s * 0.1);
  ctx.stroke();
  ctx.lineCap = 'butt';
  const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, s * 0.7);
  glow.addColorStop(0, 'rgba(255, 152, 0, 0.35)');
  glow.addColorStop(1, 'rgba(255, 152, 0, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(fx, fy, s * 0.7, 0, Math.PI * 2);
  ctx.fill();
  drawFlame(fx, fy - s * 0.12, s * 0.18);
}

function drawCampDecor(c, x, y, s, now) {
  const L = CAMP_LAYOUT[c.type] || CAMP_LAYOUT.small;
  const fort = c.type === 'large';
  campGround(c, x, y, s * L.ground);
  const hide = fort ? '#8a5444' : '#b08d5f';
  const shade = fort ? '#6a3c30' : '#8c6b40';
  const items = L.tents.map(([tx, ty]) => ({ y: ty, draw: () => drawTent(x + tx * s, y + ty * s, s * L.tent, hide, shade, c, now) }));
  if (L.tower) items.push({ y: L.tower[1] + 0.7, draw: () => drawWatchtower(x + L.tower[0] * s, y + L.tower[1] * s, s, now) });
  items.sort((a, b) => a.y - b.y); // back to front
  for (const it of items) it.draw();
  if (L.banners) {
    const bx = s * L.ground * 0.88;
    for (const side of [-1, 1]) drawBanner(x + side * bx, y + s * 0.95, s * 0.95, c, now, fort ? '#e65100' : '#c0392b');
  }
  drawCampfire(x - s * 0.8, y + s * 0.95, s);
  if (fort && s >= 12) label('buff', x + L.tower[0] * s + s * 0.55, y + (L.tower[1] - 0.8) * s, Math.max(9, Math.round(s * 0.3)), '#ffab40');
}

export { drawCamps, drawCreeps, drawFlame };
