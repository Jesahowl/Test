// Short-lived visual effects (shots, hits, gold pop-ups, waves...).

import { drawFlame } from './camps.js';
import { label } from './render.js';
import { S, colorOf, ctx, scale, toScreen } from './state.js';

function drawEffects(now) {
  const s = scale();
  S.effects = S.effects.filter((f) => now - f.born < (f.k === 'coreDown' || f.k === 'buff' ? 1200 : f.k === 'arrow' ? 250 : f.k === 'ping' ? 600 : f.k === 'campSpawn' ? 1000 : f.k === 'wave' ? 700 : f.k === 'gold' ? 1100 : 450));
  for (const f of S.effects) {
    const age = (now - f.born) / 1000;
    if (age < 0) continue; // not due yet (effects are delayed to match troop interpolation)
    switch (f.k) {
      case 'tshot': {
        const life = 0.16;
        if (age > life) break;
        const [x1, y1] = toScreen(f.x1, f.y1);
        const [x2, y2] = toScreen(f.x2, f.y2);
        ctx.strokeStyle = colorOf(f.o, 70, 1 - age / life);
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;
      }
      case 'slash': {
        if (age > 0.18) break;
        const [x, y] = toScreen(f.x, f.y);
        ctx.strokeStyle = `rgba(255, 255, 255, ${1 - age / 0.18})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, s * 0.4, -2.4 + age * 8, -0.8 + age * 8);
        ctx.stroke();
        break;
      }
      case 'heal': {
        if (age > 0.5) break;
        const [x, y] = toScreen(f.x, f.y);
        const p = age / 0.5;
        ctx.strokeStyle = `rgba(126, 231, 135, ${0.6 * (1 - p)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, f.r * s * (0.3 + 0.7 * p), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(126, 231, 135, ${1 - p})`;
        ctx.font = `bold ${Math.round(s * 0.5)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('+', x, y - s * (0.5 + p * 0.6));
        break;
      }
      case 'boom': {
        const [x, y] = toScreen(f.x, f.y);
        const p = age / 0.45;
        ctx.fillStyle = `rgba(255, 171, 64, ${0.7 * (1 - p)})`;
        ctx.beginPath();
        ctx.arc(x, y, f.r * s * (0.5 + p), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'hit': {
        if (age > 0.2) break;
        const [x, y] = toScreen(f.x, f.y);
        ctx.fillStyle = `rgba(248, 81, 73, ${0.6 * (1 - age / 0.2)})`;
        ctx.beginPath();
        ctx.arc(x, y, s * 0.35, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'gold': {
        // Bounty popup - only for the player who earned it.
        if (f.o !== S.myId) break;
        const [x, y] = toScreen(f.x, f.y);
        const p = age / 1.1;
        const big = f.n >= 100;
        ctx.globalAlpha = Math.max(0, 1 - p * p);
        label(`+${f.n}g`, x, y - s * (0.6 + p * 1.4), Math.round((big ? 18 : 13) + (big ? 4 : 0) * (1 - p)), '#ffd54f');
        ctx.globalAlpha = 1;
        break;
      }
      case 'ping': {
        // where you sent troops to: a shrinking double ring
        const [x, y] = toScreen(f.x, f.y);
        const p = age / 0.6;
        ctx.strokeStyle = `rgba(255, 213, 79, ${1 - p})`;
        ctx.lineWidth = 2.5;
        for (const r of [1.4, 0.8]) {
          ctx.beginPath();
          ctx.arc(x, y, s * r * (1 - p * 0.6), 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'arrow': {
        // an archer's arrow streaking to its target
        const life = 0.22;
        if (age > life) break;
        const p = age / life;
        const [x1, y1] = toScreen(f.x1, f.y1);
        const [x2, y2] = toScreen(f.x2, f.y2);
        const hx = x1 + (x2 - x1) * p;
        const hy = y1 + (y2 - y1) * p;
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const tx = hx - ((x2 - x1) / len) * s * 0.45;
        const ty = hy - ((y2 - y1) / len) * s * 0.45;
        ctx.strokeStyle = colorOf(f.o, 75, 0.9);
        ctx.lineWidth = Math.max(1.5, s * 0.06);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.fillStyle = '#e6edf3';
        ctx.beginPath();
        ctx.arc(hx, hy, Math.max(1.2, s * 0.05), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'campSpawn': {
        // monsters burst out of the ground: rising dust ring
        const [x, y] = toScreen(f.x, f.y);
        const p = age / 1;
        ctx.strokeStyle = `rgba(214, 180, 120, ${0.9 * (1 - p)})`;
        ctx.lineWidth = 4 * (1 - p) + 1;
        ctx.beginPath();
        ctx.arc(x, y, s * (0.5 + p * 2.4), 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 8; i++) {
          const a = (Math.PI * 2 * i) / 8;
          ctx.fillStyle = `rgba(160, 130, 90, ${0.7 * (1 - p)})`;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * s * (0.4 + p * 1.8), y + Math.sin(a) * s * (0.4 + p * 1.8) - p * s * 0.6, s * 0.14 * (1 - p * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'buff': {
        const [x, y] = toScreen(f.x, f.y);
        const p = age / 1.2;
        ctx.strokeStyle = `rgba(255, 140, 50, ${1 - p})`;
        ctx.lineWidth = 5 * (1 - p) + 1;
        ctx.beginPath();
        ctx.arc(x, y, s * (0.8 + p * 4), 0, Math.PI * 2);
        ctx.stroke();
        drawFlame(x, y - s * p * 1.5, s * 0.6 * (1 - p * 0.5));
        if (f.o === S.myId) label('EMPOWERED!', x, y - s * (1.6 + p * 1.5), Math.max(13, Math.round(s * 0.6)), '#ffab40');
        break;
      }
      case 'wave': {
        const [x, y] = toScreen(f.x, f.y);
        const p = age / 0.7;
        ctx.strokeStyle = colorOf(f.o, 70, 0.8 * (1 - p));
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, s * (0.8 + p * 2.2), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'capture': {
        const [x, y] = toScreen(f.x, f.y);
        const p = Math.min(1, age / 0.45);
        ctx.strokeStyle = colorOf(f.o, 60, 1 - p);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, y, s * (0.5 + p * 4), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'coreDown': {
        const [x, y] = toScreen(f.x, f.y);
        const p = age / 1.2;
        ctx.strokeStyle = `rgba(255, 213, 79, ${1 - p})`;
        ctx.lineWidth = 6 * (1 - p) + 1;
        ctx.beginPath();
        ctx.arc(x, y, s * (1 + p * 7), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 112, 67, ${0.5 * (1 - p)})`;
        ctx.beginPath();
        ctx.arc(x, y, s * (0.5 + p * 3), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }
}

export { drawEffects };
