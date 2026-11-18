// Keeps the HUD panels from overlapping on any window size. The top bar runs across the top; the
// dock (and its open drawer) sits bottom centre; the minimap bottom left with the tips above it;
// the selected building's panel bottom right (lifted above the dock when they'd collide). The event
// feed is cut short above whatever is below it.

import { $ } from './state.js';

const EDGE = 12;
const GAP = 8;

function layoutHud() {
  if ($('hud').classList.contains('hidden')) return;
  // (on small screens the HUD is scaled down: screen pixels / z = its own pixels)
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hud-zoom')) || 1;
  const H = window.innerHeight;
  const bottom = $('bottom').getBoundingClientRect();
  const mm = $('minimap-wrap').getBoundingClientRect();

  // the tips sit just above the minimap
  const tips = $('tips');
  tips.style.bottom = `${(H - mm.top) / z + GAP + 30}px`; // (clear of the Ping button on the minimap)

  // a wide drawer (Squads) would run over the minimap and tips on a laptop screen: slide it right,
  // as far as the screen allows; the tips step aside while it still covers them
  const drawer = $('drawer');
  drawer.style.transform = '';
  let covered = false;
  if (!drawer.classList.contains('hidden')) {
    const d = drawer.getBoundingClientRect();
    const k = d.width / (drawer.offsetWidth || d.width) || 1; // (screen pixels per drawer pixel)
    const want = mm.right + GAP - d.left;
    const room = window.innerWidth - EDGE - d.right;
    const shift = Math.max(0, Math.min(want, room));
    if (shift > 0) drawer.style.transform = `translateX(${shift / k}px)`;
    const t = tips.getBoundingClientRect();
    covered = !tips.classList.contains('hidden') && d.left + shift < t.right && d.top < t.bottom;
  }
  tips.style.visibility = covered ? 'hidden' : '';

  // the selection panel: bottom right, unless the dock/drawer reaches under it
  const sel = $('selection');
  if (!sel.classList.contains('hidden')) {
    const left = window.innerWidth - (EDGE + sel.offsetWidth) * z;
    sel.style.bottom = `${bottom.height && left < bottom.right + GAP ? (H - bottom.top) / z + GAP : EDGE}px`;
  }

  // the feed stops above the tips (or the minimap)
  const feed = $('feed');
  const feedTop = feed.getBoundingClientRect().top;
  const limit = tips.classList.contains('hidden') ? mm.top - GAP : tips.getBoundingClientRect().top - GAP;
  feed.style.maxHeight = `${Math.max(0, (limit - feedTop) / z)}px`;
}

export { layoutHud };
