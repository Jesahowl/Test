// Short-lived visual effects (shots, hits, gold pop-ups, waves...).

import { drawFlame } from './camps.js';
import { label } from './render.js';
import { S, colorOf, ctx, scale, toScreen } from './state.js';

// Lightning: a jagged line that re-rolls every frame so it crackles, with a glow in the owner's
// colour, a white-hot core, a fork or two, and a spark burst where it hits.
function jagged(x1, y1, x2, y2, rough, n) {
  const pts = [[x1, y1]];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const off = (Math.random() - 0.5) * 2 * rough * Math.sin(t * Math.PI);
    pts.push([x1 + dx * t + nx * off, y1 + dy * t + ny * off]);
  }
  pts.push([x2, y2]);
  return pts;
}

function strokePts(pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function drawZap(f, p, s) {
  const [x1, y0] = toScreen(f.x1, f.y1);
  const y1 = y0 - (f.lift || 0) * s;
  const [x2, y2] = toScreen(f.x2, f.y2);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.max(4, Math.round(len / Math.max(8, s * 0.35)));
  const fade = 1 - p;
  const main = jagged(x1, y1, x2, y2, Math.max(4, s * 0.22), n);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = colorOf(f.o, 65);
  ctx.shadowBlur = s * 0.4;
  ctx.strokeStyle = colorOf(f.o, 65, 0.55 * fade);
  ctx.lineWidth = Math.max(4, s * 0.16);
  strokePts(main);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = colorOf(f.o, 92, fade);
  ctx.lineWidth = Math.max(1.5, s * 0.05);
  strokePts(main);
  // forks off the main bolt
  ctx.strokeStyle = colorOf(f.o, 80, 0.7 * fade);
  ctx.lineWidth = Math.max(1, s * 0.035);
  for (let k = 0; k < 2; k++) {
    const i = 1 + Math.floor(Math.random() * (main.length - 2));
    const [bx, by] = main[i];
    const a = Math.atan2(y2 - y1, x2 - x1) + (Math.random() - 0.5) * 2.2;
    const bl = s * (0.3 + Math.random() * 0.4);
    strokePts(jagged(bx, by, bx + Math.cos(a) * bl, by + Math.sin(a) * bl, s * 0.08, 3));
  }
  // impact: a bright flash and sparks
  const ig = ctx.createRadialGradient(x2, y2, 0, x2, y2, s * 0.5);
  ig.addColorStop(0, `rgba(255, 255, 255, ${0.9 * fade})`);
  ig.addColorStop(0.4, colorOf(f.o, 70, 0.5 * fade));
  ig.addColorStop(1, colorOf(f.o, 70, 0));
  ctx.fillStyle = ig;
  ctx.beginPath();
  ctx.arc(x2, y2, s * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(255, 255, 255, ${fade})`;
  ctx.lineWidth = Math.max(1, s * 0.03);
  for (let k = 0; k < 5; k++) {
    const a = Math.random() * Math.PI * 2;
    const d0 = s * 0.12;
    const d1 = s * (0.25 + 0.3 * p);
    ctx.beginPath();
    ctx.moveTo(x2 + Math.cos(a) * d0, y2 + Math.sin(a) * d0);
    ctx.lineTo(x2 + Math.cos(a) * d1, y2 + Math.sin(a) * d1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEffects(now) {
  const s = scale();
  S.effects = S.effects.filter((f) => now - f.born < (f.k === 'coreDown' || f.k === 'buff' || f.k === 'trade' ? 1200 : f.k === 'raid' ? 1000 : f.k === 'arrow' ? 250 : f.k === 'tshot' ? 260 : f.k === 'ping' ? 600 : f.k === 'campSpawn' ? 1000 : f.k === 'wave' ? 700 : f.k === 'gold' ? 1100 : 450));
  for (const f of S.effects) {
    const age = (now - f.born) / 1000;
    if (age < 0) continue; // not due yet (effects are delayed to match troop interpolation)
    switch (f.k) {
      case 'tshot': {
        // a crackling lightning bolt from the crystal to the target
        const life = 0.22;
        if (age > life) break;
        drawZap(f, age / life, s);
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
        // a small soft pulse round the medic (not its whole reach, which cluttered busy fights)
        ctx.strokeStyle = `rgba(126, 231, 135, ${0.35 * (1 - p)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, s * (0.45 + 0.35 * p), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(126, 231, 135, ${1 - p})`;
        ctx.font = `bold ${Math.round(s * 0.5)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('+', x, y - s * (0.5 + p * 0.6));
        break;
      }
      case 'trade': {
        // a caravan delivered: coins burst up from the trade post
        const life = 1.2;
        if (age > life) break;
        const [x, y] = toScreen(f.x, f.y - 0.6);
        const p = age / life;
        ctx.fillStyle = `rgba(255, 213, 79, ${1 - p})`;
        ctx.strokeStyle = `rgba(165, 124, 0, ${1 - p})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 9; i++) {
          const a = -Math.PI / 2 + (i - 4) * 0.28;
          const d = s * (0.4 + p * 1.6) * (0.8 + (i % 3) * 0.15);
          const cx = x + Math.cos(a) * d;
          const cy = y + Math.sin(a) * d + s * p * p * 1.6; // they fall back down
          ctx.beginPath();
          ctx.ellipse(cx, cy, s * 0.12, s * 0.08, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        break;
      }
      case 'raid': {
        // a caravan destroyed: splinters and spilled coins
        const life = 1.0;
        if (age > life) break;
        const [x, y] = toScreen(f.x, f.y);
        const p = age / life;
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 + 0.4;
          const d = s * (0.3 + p * 1.1);
          ctx.fillStyle = i % 2 ? `rgba(255, 213, 79, ${1 - p})` : `rgba(107, 74, 47, ${1 - p})`;
          ctx.save();
          ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6);
          ctx.rotate(a + p * 4);
          if (i % 2) {
            ctx.beginPath();
            ctx.ellipse(0, 0, s * 0.1, s * 0.07, 0, 0, Math.PI * 2);
            ctx.fill();
          } else ctx.fillRect(-s * 0.15, -s * 0.04, s * 0.3, s * 0.08);
          ctx.restore();
        }
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
        ctx.strokeStyle = f.atk ? `rgba(255, 110, 100, ${1 - p})` : `rgba(255, 213, 79, ${1 - p})`;
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
      case 'built': {
        // a building finished: a puff of golden sparks
        const [x, y] = toScreen(f.x, f.y);
        const p = Math.min(1, age / 0.45);
        ctx.fillStyle = `rgba(242, 193, 78, ${0.9 * (1 - p)})`;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * s * (0.4 + p * 1.2), y - s * 0.4 + Math.sin(a) * s * (0.3 + p * 0.8), Math.max(1.5, s * 0.07), 0, Math.PI * 2);
          ctx.fill();
        }
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
        ctx.strokeStyle = f.atk ? `rgba(255, 110, 100, ${1 - p})` : `rgba(255, 213, 79, ${1 - p})`;
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
