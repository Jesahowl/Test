// Rendering basics: canvas sizing, background, labels, health bars and simple shapes.

import { S, C, canvas, ctx, HEX, scale, toScreen } from './state.js';
import { drawTerrain } from './terrain.js';
import { drawTerritoryShapes } from './territory.js';

// ------------------------------------------------------------------ rendering
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

const onScreen = (x, y, pad) => x > -pad && y > -pad && x < canvas.width + pad && y < canvas.height + pad;

// Three edges of every hex (together they outline them all), as one path in tile units.
let gridPath = null;
function hexGridPath() {
  if (gridPath) return gridPath;
  gridPath = new Path2D();
  for (const h of HEX.hexes) {
    const cs = HEX.corners(h);
    gridPath.moveTo(cs[5][0], cs[5][1]);
    for (let k = 0; k < 3; k++) gridPath.lineTo(cs[k][0], cs[k][1]);
  }
  return gridPath;
}

function drawBackground() {
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const s = scale();
  const [ox, oy] = toScreen(0, 0);
  drawTerrain(ox, oy, s); // plains and forests

  // the hex grid: a faint outline round every hex, built once (in tiles) and drawn scaled
  if (s >= 6) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, C.MAP_W * s, C.MAP_H * s);
    ctx.clip();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1 / s;
    ctx.stroke(hexGridPath());
    ctx.restore();
  }

  drawTerritoryShapes(ox, oy, s);

  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 3;
  ctx.strokeRect(ox, oy, C.MAP_W * s, C.MAP_H * s);
}

function hpBar(x, y, w, frac) {
  if (frac >= 0.999) return;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - w / 2, y, w, 4);
  ctx.fillStyle = frac > 0.5 ? '#3fb950' : frac > 0.25 ? '#d29922' : '#f85149';
  ctx.fillRect(x - w / 2, y, w * Math.max(0, frac), 4);
}

function label(text, x, y, size, color) {
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawShape(kind, x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  switch (kind) {
    case 'soldier':
      // crossed swords
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((side * Math.PI) / 4);
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.85);
        ctx.lineTo(r * 0.11, -r * 0.65);
        ctx.lineTo(r * 0.1, r * 0.3);
        ctx.lineTo(-r * 0.1, r * 0.3);
        ctx.lineTo(-r * 0.11, -r * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#e0b43c';
        ctx.fillRect(-r * 0.32, r * 0.28, r * 0.64, r * 0.11);
        ctx.fillStyle = '#7b4a2a';
        ctx.fillRect(-r * 0.06, r * 0.39, r * 0.12, r * 0.3);
        ctx.restore();
      }
      break;
    case 'scout':
      // an eye: sees far
      ctx.moveTo(x - r * 0.8, y);
      ctx.quadraticCurveTo(x, y - r * 0.75, x + r * 0.8, y);
      ctx.quadraticCurveTo(x, y + r * 0.75, x - r * 0.8, y);
      ctx.fill();
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x + r * 0.08, y - r * 0.08, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'medic':
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - r * 0.14, y - r * 0.5, r * 0.28, r);
      ctx.fillRect(x - r * 0.5, y - r * 0.14, r, r * 0.28);
      break;
    case 'archer': {
      // a bow with an arrow nocked, held diagonally
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 4);
      const bx = -r * 0.25;
      const R = r * 0.62;
      const a = 1.2;
      ctx.strokeStyle = '#e6edf3';
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.beginPath();
      ctx.moveTo(bx + Math.cos(-a) * R, Math.sin(-a) * R);
      ctx.lineTo(bx + Math.cos(a) * R, Math.sin(a) * R);
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = Math.max(1.5, r * 0.17);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(bx, 0, R, -a, a);
      ctx.stroke();
      ctx.strokeStyle = '#d7a86e';
      ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, 0);
      ctx.lineTo(r * 0.6, 0);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#e6edf3';
      ctx.beginPath();
      ctx.moveTo(r * 0.85, 0);
      ctx.lineTo(r * 0.55, -r * 0.14);
      ctx.lineTo(r * 0.55, r * 0.14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e57373';
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, 0);
      ctx.lineTo(-r * 0.85, -r * 0.13);
      ctx.lineTo(-r * 0.55, 0);
      ctx.lineTo(-r * 0.85, r * 0.13);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'wall': {
      // a stretch of battlemented stone wall
      ctx.fillRect(x - r * 0.95, y - r * 0.2, r * 1.9, r * 0.75);
      for (let i = 0; i < 4; i++) ctx.fillRect(x - r * 0.95 + i * r * 0.52, y - r * 0.48, r * 0.34, r * 0.3);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (const yy of [0.1, 0.32]) ctx.fillRect(x - r * 0.95, y + r * yy, r * 1.9, Math.max(1, r * 0.05));
      break;
    }
    case 'workshop': {
      // a cog with a hammer across it
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const rr = k % 2 ? r * 0.75 : r * 0.55;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#8a5a32';
      ctx.fillRect(-r * 0.08, -r * 0.2, r * 0.16, r * 1.0);
      ctx.fillStyle = '#d0d7de';
      ctx.fillRect(-r * 0.32, -r * 0.42, r * 0.64, r * 0.26);
      ctx.restore();
      break;
    }
    case 'trade': {
      // market hall: a roofed stall with a striped awning and a coin on top
      ctx.fillRect(x - r * 0.8, y - r * 0.05, r * 1.6, r * 0.8);
      ctx.beginPath();
      ctx.moveTo(x - r * 0.92, y - r * 0.05);
      ctx.lineTo(x - r * 0.55, y - r * 0.4);
      ctx.lineTo(x + r * 0.55, y - r * 0.4);
      ctx.lineTo(x + r * 0.92, y - r * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x - r * 0.5, y + r * 0.2, r * 1.0, r * 0.3);
      ctx.fillStyle = fill;
      for (let i = 0; i < 5; i++) {
        if (i % 2) continue;
        ctx.fillRect(x - r * 0.62 + i * r * 0.248, y + r * 0.02, r * 0.248, r * 0.16);
      }
      ctx.fillStyle = '#fff2b0';
      ctx.beginPath();
      ctx.arc(x, y - r * 0.62, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'caravan': {
      // covered wagon: a hooped canvas top on a cart with two wheels
      ctx.beginPath();
      ctx.moveTo(x - r * 0.75, y + r * 0.1);
      ctx.bezierCurveTo(x - r * 0.8, y - r * 0.75, x + r * 0.75, y - r * 0.75, x + r * 0.7, y + r * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - r * 0.8, y + r * 0.1, r * 1.6, r * 0.25);
      for (const wx of [-0.45, 0.45]) {
        ctx.beginPath();
        ctx.arc(x + wx * r, y + r * 0.45, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'barracks': {
      // crystal hall: a stone hall with crystals on the roof ridge and a lit doorway
      ctx.fillRect(x - r * 0.85, y - r * 0.05, r * 1.7, r * 0.8);
      ctx.beginPath();
      ctx.moveTo(x - r * 0.98, y - r * 0.05);
      ctx.lineTo(x - r * 0.6, y - r * 0.42);
      ctx.lineTo(x + r * 0.6, y - r * 0.42);
      ctx.lineTo(x + r * 0.98, y - r * 0.05);
      ctx.closePath();
      ctx.fill();
      for (const [cx, h] of [[-0.4, 0.3], [0, 0.42], [0.4, 0.3]]) {
        ctx.beginPath();
        ctx.moveTo(x + r * cx, y - r * (0.42 + h));
        ctx.lineTo(x + r * (cx + h * 0.42), y - r * (0.42 + h * 0.3));
        ctx.lineTo(x + r * cx, y - r * 0.38);
        ctx.lineTo(x + r * (cx - h * 0.42), y - r * (0.42 + h * 0.3));
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.2, y + r * 0.75);
      ctx.lineTo(x - r * 0.2, y + r * 0.35);
      ctx.arc(x, y + r * 0.35, r * 0.2, Math.PI, 0);
      ctx.lineTo(x + r * 0.2, y + r * 0.75);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'land': {
      // a plot of land with a flag: a tilted square and a pennant on a pole
      ctx.beginPath();
      ctx.moveTo(x, y + r * 0.1);
      ctx.lineTo(x + r * 0.95, y + r * 0.5);
      ctx.lineTo(x, y + r * 0.9);
      ctx.lineTo(x - r * 0.95, y + r * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.moveTo(x, y + r * 0.28);
      ctx.lineTo(x + r * 0.6, y + r * 0.5);
      ctx.lineTo(x, y + r * 0.72);
      ctx.lineTo(x - r * 0.6, y + r * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e6edf3';
      ctx.fillRect(x - r * 0.05, y - r * 0.9, r * 0.1, r * 1.4);
      ctx.fillStyle = '#ffd54f';
      ctx.beginPath();
      ctx.moveTo(x + r * 0.05, y - r * 0.9);
      ctx.lineTo(x + r * 0.7, y - r * 0.68);
      ctx.lineTo(x + r * 0.05, y - r * 0.45);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'tower': {
      // wizard tower with a floating top: a broken stump, the crystal, and the roof hovering above
      const w = r * 1.35; // drawn wide and bold so it reads at icon size
      ctx.beginPath();
      ctx.moveTo(x - w * 0.42, y + r * 0.95);
      ctx.lineTo(x - w * 0.38, y + r * 0.22);
      ctx.lineTo(x - w * 0.14, y + r * 0.06);
      ctx.lineTo(x + w * 0.04, y + r * 0.2);
      ctx.lineTo(x + w * 0.2, y + r * 0.04);
      ctx.lineTo(x + w * 0.38, y + r * 0.22);
      ctx.lineTo(x + w * 0.42, y + r * 0.95);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.52);
      ctx.lineTo(x + w * 0.22, y - r * 0.22);
      ctx.lineTo(x, y - r * 0.02);
      ctx.lineTo(x - w * 0.22, y - r * 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - w * 0.42, y - r * 0.6);
      ctx.lineTo(x, y - r * 1.05);
      ctx.lineTo(x + w * 0.42, y - r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.12, y + r * 0.78);
      ctx.lineTo(x - r * 0.12, y + r * 0.45);
      ctx.arc(x, y + r * 0.45, r * 0.12, Math.PI, 0);
      ctx.lineTo(x + r * 0.12, y + r * 0.78);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
  }
}

// A melee swing: the attacker dashes in at its target and springs back. Returns the offset to draw
// troop/barbarian `id` (at world x, y) with, in tiles.
const LUNGE_MS = 240;
function lungeOffset(id, x, y, now) {
  const l = S.lunges.get(id);
  if (!l) return [0, 0];
  const p = (now - l.at) / LUNGE_MS;
  if (p < 0) return [0, 0];
  if (p >= 1) {
    S.lunges.delete(id);
    return [0, 0];
  }
  const dx = l.x - x;
  const dy = l.y - y;
  const d = Math.hypot(dx, dy) || 1;
  // quick dash out (first third), slower spring back
  const k = p < 0.33 ? Math.sin((p / 0.33) * (Math.PI / 2)) : Math.cos(((p - 0.33) / 0.67) * (Math.PI / 2));
  const reach = Math.min(0.45, d * 0.6) * k;
  return [(dx / d) * reach, (dy / d) * reach];
}

export { lungeOffset, drawBackground, drawShape, hpBar, label, onScreen, resize };
