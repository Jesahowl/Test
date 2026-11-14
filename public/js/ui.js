// HUD helpers: icons drawn from the in-game shapes, and tooltips.

import { drawShape } from './render.js';
import { drawFigure, teamFromHex } from './chibi.js';
import { $, C, withContext } from './state.js';

// ------------------------------------------------------------------ HUD
// ---- UI icons: the in-game shapes, drawn once into little images for the HUD.
const iconCache = new Map();

function iconURL(kind, size = 44) {
  const key = `${kind}:${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const unit = C.UNITS[kind];
  if (unit) {
    // troops: the little figure itself, dressed in the type's colour
    drawFigure(c.getContext('2d'), kind, size / 2, size * 0.63, size * 0.38, teamFromHex(unit.color));
  } else {
    withContext(c.getContext('2d'), () => {
      const color = kind === 'wall' ? '#9aa4ae' : (C.TOWERS[kind] || { color: '#7ee787' }).color;
      drawShape(kind, size / 2, size / 2 + size * 0.04, size * 0.44, color);
    });
  }
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

// ---- tooltips: any element with data-tip (trusted HTML) shows it on hover.
const tipEl = $('tip');

let tipFor = null;

let tipTimer = null;

function placeTip() {
  if (!tipFor || !document.body.contains(tipFor)) return hideTip();
  tipEl.innerHTML = tipFor.dataset.tip;
  const r = tipFor.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  let top = r.top - h - 8;
  if (top < 8) top = r.bottom + 8;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
  tipEl.classList.add('show');
}

function hideTip() {
  tipFor = null;
  clearTimeout(tipTimer);
  tipEl.classList.remove('show');
}

document.addEventListener('mouseover', (e) => {
  const el = e.target.closest ? e.target.closest('[data-tip]') : null;
  if (el === tipFor) return;
  hideTip();
  if (!el) return;
  tipFor = el;
  tipTimer = setTimeout(placeTip, 250);
});

document.addEventListener('mousedown', () => {
  if (tipFor) tipEl.classList.remove('show');
});

const refreshTip = () => {
  if (tipFor && tipEl.classList.contains('show')) placeTip();
};

export { hideTip, iconURL, refreshTip };
