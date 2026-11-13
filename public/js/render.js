// Rendering basics: canvas sizing, background, labels, health bars and simple shapes.

import { C, canvas, ctx, scale, toScreen, toWorld } from './state.js';
import { roundRect } from './structures.js';
import { drawTerritoryShapes } from './territory.js';

// ------------------------------------------------------------------ rendering
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

const onScreen = (x, y, pad) => x > -pad && y > -pad && x < canvas.width + pad && y < canvas.height + pad;

function drawBackground() {
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const s = scale();
  const [ox, oy] = toScreen(0, 0);
  ctx.fillStyle = '#121820';
  ctx.fillRect(ox, oy, C.MAP_W * s, C.MAP_H * s);

  if (s >= 14) {
    const [x0, y0] = toWorld(0, 0);
    const [x1, y1] = toWorld(canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(C.MAP_W, Math.ceil(x1)); x++) {
      const sx = Math.round(ox + x * s) + 0.5;
      ctx.moveTo(sx, Math.max(oy, 0));
      ctx.lineTo(sx, Math.min(oy + C.MAP_H * s, canvas.height));
    }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(C.MAP_H, Math.ceil(y1)); y++) {
      const sy = Math.round(oy + y * s) + 0.5;
      ctx.moveTo(Math.max(ox, 0), sy);
      ctx.lineTo(Math.min(ox + C.MAP_W * s, canvas.width), sy);
    }
    ctx.stroke();
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
    case 'tower':
      // crystal tower: a pillar with a crystal floating above it
      ctx.beginPath();
      ctx.moveTo(x - r * 0.5, y + r * 0.85);
      ctx.lineTo(x - r * 0.38, y + r * 0.6);
      ctx.lineTo(x - r * 0.22, y + r * 0.6);
      ctx.lineTo(x - r * 0.14, y - r * 0.1);
      ctx.lineTo(x + r * 0.14, y - r * 0.1);
      ctx.lineTo(x + r * 0.22, y + r * 0.6);
      ctx.lineTo(x + r * 0.38, y + r * 0.6);
      ctx.lineTo(x + r * 0.5, y + r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.95);
      ctx.lineTo(x + r * 0.3, y - r * 0.55);
      ctx.lineTo(x, y - r * 0.22);
      ctx.lineTo(x - r * 0.3, y - r * 0.55);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
  }
}

export { drawBackground, drawShape, hpBar, label, onScreen, resize };
