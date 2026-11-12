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
    case 'soldier': {
      // shield with a sword behind it
      ctx.strokeStyle = '#e6edf3';
      ctx.lineWidth = Math.max(1.2, r * 0.16);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.75, y + r * 0.75);
      ctx.lineTo(x + r * 0.75, y - r * 0.75);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.6, y - r * 0.6);
      ctx.lineTo(x + r * 0.6, y - r * 0.6);
      ctx.lineTo(x + r * 0.6, y);
      ctx.quadraticCurveTo(x + r * 0.5, y + r * 0.55, x, y + r * 0.75);
      ctx.quadraticCurveTo(x - r * 0.5, y + r * 0.55, x - r * 0.6, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = Math.max(1, r * 0.1);
      ctx.stroke();
      break;
    }
    case 'scout':
      // a swift chevron with an eye
      ctx.moveTo(x, y - r * 0.85);
      ctx.lineTo(x + r * 0.75, y + r * 0.65);
      ctx.lineTo(x, y + r * 0.25);
      ctx.lineTo(x - r * 0.75, y + r * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(x, y - r * 0.05, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'medic':
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - r * 0.14, y - r * 0.5, r * 0.28, r);
      ctx.fillRect(x - r * 0.5, y - r * 0.14, r, r * 0.28);
      break;
    case 'giant': {
      // a hulking body with a club
      ctx.arc(x, y + r * 0.1, r * 0.78, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.arc(x, y - r * 0.45, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y - r * 0.48, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6d4c41';
      ctx.save();
      ctx.translate(x + r * 0.6, y - r * 0.1);
      ctx.rotate(0.5);
      roundRect(-r * 0.12, -r * 0.7, r * 0.24, r * 0.95, r * 0.12);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'barracks':
      // a hall with a pitched roof and a door
      ctx.fillRect(x - r * 0.8, y - r * 0.2, r * 1.6, r * 0.95);
      ctx.beginPath();
      ctx.moveTo(x - r * 0.95, y - r * 0.15);
      ctx.lineTo(x, y - r * 0.9);
      ctx.lineTo(x + r * 0.95, y - r * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x - r * 0.2, y + r * 0.2, r * 0.4, r * 0.55);
      break;
    case 'tower':
      // battlemented turret
      ctx.moveTo(x - r * 0.8, y + r * 0.8);
      ctx.lineTo(x - r * 0.8, y - r * 0.55);
      for (let i = 0; i < 4; i++) {
        const bx = x - r * 0.8 + (i * r * 1.6) / 3.5;
        ctx.lineTo(bx, y - r * 0.9);
        ctx.lineTo(bx + r * 0.25, y - r * 0.9);
        ctx.lineTo(bx + r * 0.25, y - r * 0.55);
        ctx.lineTo(bx + r * 0.46, y - r * 0.55);
      }
      ctx.lineTo(x + r * 0.8, y - r * 0.9);
      ctx.lineTo(x + r * 0.8, y + r * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x - r * 0.18, y + r * 0.1, r * 0.36, r * 0.7);
      break;
    default:
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
  }
}

export { drawBackground, drawShape, hpBar, label, onScreen, resize };
