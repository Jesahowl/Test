// Keeps the HUD panels from overlapping on any window size. The top bar runs across the top; the
// dock (and its open drawer) sits bottom centre; the minimap bottom left with the tips above it;
// the selected building's panel bottom right (lifted above the dock when they'd collide). The event
// feed is cut short above whatever is below it.

import { $ } from './state.js';

const EDGE = 12;
const GAP = 8;

function layoutHud() {
  if ($('hud').classList.contains('hidden')) return;
  const H = window.innerHeight;
  const bottom = $('bottom').getBoundingClientRect();
  const mm = $('minimap-wrap').getBoundingClientRect();

  // the tips sit just above the minimap
  const tips = $('tips');
  tips.style.bottom = `${H - mm.top + GAP}px`;

  // the selection panel: bottom right, unless the dock/drawer reaches under it
  const sel = $('selection');
  if (!sel.classList.contains('hidden')) {
    const left = window.innerWidth - EDGE - sel.offsetWidth;
    sel.style.bottom = `${bottom.height && left < bottom.right + GAP ? H - bottom.top + GAP : EDGE}px`;
  }

  // the feed stops above the tips (or the minimap)
  const feed = $('feed');
  const feedTop = feed.getBoundingClientRect().top;
  const limit = tips.classList.contains('hidden') ? mm.top - GAP : tips.getBoundingClientRect().top - GAP;
  feed.style.maxHeight = `${Math.max(0, limit - feedTop)}px`;
}

export { layoutHud };
