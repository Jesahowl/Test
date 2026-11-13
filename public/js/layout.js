// Keeps the HUD panels from overlapping on any window size. The bar sits bottom centre; the
// leaderboard top right; the minimap bottom right (lifted above the bar when they'd collide).
// The building panel goes above the minimap when there's room, else bottom left (where the tip
// box is, which steps aside while it's open). The event feed is cut short above whatever is below it.

import { $ } from './state.js';

const EDGE = 12;
const GAP = 8;

function layoutHud() {
  if ($('hud').classList.contains('hidden')) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const bar = $('bar').getBoundingClientRect();
  const barShown = bar.height > 0;
  const lb = $('leaderboard').getBoundingClientRect();

  // minimap
  const mm = $('minimap-wrap');
  const mmW = mm.offsetWidth;
  const mmH = mm.offsetHeight;
  const mmBottom = !barShown || W - EDGE - mmW >= bar.right + GAP ? EDGE : H - bar.top + GAP;
  mm.style.bottom = `${mmBottom}px`;
  const mmTop = H - mmBottom - mmH;

  // bottom-left slot (tips, or the building panel when it doesn't fit on the right)
  const tips = $('tips');
  const slotBottom = !barShown || EDGE + Math.max(tips.offsetWidth, 268) + GAP <= bar.left ? EDGE : H - bar.top + GAP;

  const sel = $('selection');
  let selLeft = false;
  if (!sel.classList.contains('hidden')) {
    const sh = sel.offsetHeight;
    if (mmTop - GAP - sh >= lb.bottom + GAP) {
      sel.style.left = 'auto';
      sel.style.right = `${EDGE}px`;
      sel.style.bottom = `${H - mmTop + GAP}px`;
    } else {
      selLeft = true;
      sel.style.right = 'auto';
      sel.style.left = `${EDGE}px`;
      sel.style.bottom = `${slotBottom}px`;
    }
  }
  tips.style.bottom = `${slotBottom}px`;
  tips.style.visibility = selLeft ? 'hidden' : '';

  // the feed stops above the bottom-left panel (or the bar)
  const feed = $('feed');
  const feedTop = feed.getBoundingClientRect().top;
  let limit = H - slotBottom;
  if (selLeft) limit = H - slotBottom - sel.offsetHeight - GAP;
  else if (!tips.classList.contains('hidden')) limit = H - slotBottom - tips.offsetHeight - GAP;
  feed.style.maxHeight = `${Math.max(0, limit - feedTop)}px`;
}

export { layoutHud };
