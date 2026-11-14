// The dock at the bottom of the screen: Build, Army, the next-wave timer, Squads and Diplomacy.
// Each button opens its drawer above the dock (one at a time; the same button or Esc closes it),
// so the map stays clear until you need a panel.

import { S, $ } from './state.js';
import { hideTip } from './ui.js';

S.drawer = null; // 'build' | 'army' | 'squads' | 'diplo' | null

function setDrawer(name) {
  S.drawer = name && S.drawer !== name ? name : null;
  const box = $('drawer');
  box.classList.toggle('hidden', !S.drawer);
  for (const sec of box.querySelectorAll('.dr')) sec.classList.toggle('hidden', sec.dataset.dr !== S.drawer);
  for (const b of document.querySelectorAll('.dock-btn')) b.classList.toggle('open', b.dataset.dr === S.drawer);
  hideTip();
}

function initDock() {
  for (const b of document.querySelectorAll('.dock-btn')) b.onclick = () => setDrawer(b.dataset.dr);
  setDrawer(null);
}

// Little numbers on the dock buttons, and the Build button lit while placing something.
function updateDock(squads, offers) {
  const sb = $('squads-badge');
  const st = squads ? String(squads) : '';
  if (sb.textContent !== st) sb.textContent = st;
  const db = $('diplo-badge');
  const dt = offers ? String(offers) : '';
  if (db.textContent !== dt) db.textContent = dt;
  document.querySelector('.dock-btn[data-dr="build"]').classList.toggle('busy', !!S.buildKind);
}

export { initDock, setDrawer, updateDock };
