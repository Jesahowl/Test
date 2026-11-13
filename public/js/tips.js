// First-game tips.

import { S, $, UNIT_KEYS } from './state.js';

// ---- first-game tips: one at a time, each ticks off when you do the thing.
const TIPS = [
  { id: 'attack', text: 'Your core sends troops every 20 seconds. <b>Right-click</b> an enemy tower, core or camp to send them. Press <kbd>H</kbd> to bring everyone home.' },
  { id: 'tower', text: 'Press <kbd>B</kbd>, then click near your border to build a <b>tower</b>. Towers claim land (land = gold) and shoot enemies.' },
  { id: 'barracks', text: 'Press <kbd>R</kbd> and click your land for a <b>barracks</b>: <b>+5 troops</b> in every wave, marching out from it.' },
  { id: 'mix', text: 'Choose your wave with the <b>+</b> buttons. <b>Scouts</b> explore the fog, <b>archers</b> shoot from range, <b>medics</b> heal.' },
  { id: 'send', text: 'Your troops form <b>3 squads</b>. Press <kbd>1</kbd>, <kbd>2</kbd> or <kbd>3</kbd> (or click a squad card) and right-click to send <b>just that squad</b>. Keep one home to defend.' },
  { id: 'jungle', text: 'Right-click <b>barbarian camps</b> for gold. Beat a <b>Warlord\'s Fort</b> (🔥) to power up your troops for 60s.' },
];

S.tipsDone = new Set();

S.tipsOff = false;

try {
  S.tipsDone = new Set(JSON.parse(localStorage.getItem('ts-tips') || '[]'));
  S.tipsOff = localStorage.getItem('ts-tips-off') === '1';
} catch { /* ignore */ }

function tipDone(id) {
  if (S.tipsDone.has(id)) return;
  S.tipsDone.add(id);
  try { localStorage.setItem('ts-tips', JSON.stringify([...S.tipsDone])); } catch { /* ignore */ }
}

function updateTips() {
  const el = $('tips');
  // tick off what the player has already done
  const mine = [...S.towers.values()].filter((t) => t.owner === S.myId);
  if (mine.some((t) => t.kind === 'tower')) tipDone('tower');
  if (mine.some((t) => t.kind === 'barracks')) tipDone('barracks');
  if (UNIT_KEYS.some((k) => S.me.army[k] > 0)) tipDone('mix');
  const tip = !S.tipsOff && TIPS.find((t) => !S.tipsDone.has(t.id));
  if (!tip || S.buildKind) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  if (el.dataset.key === tip.id) return;
  el.dataset.key = tip.id;
  const n = TIPS.indexOf(tip) + 1;
  el.innerHTML = `<div class="t-head">💡 Tip ${n} of ${TIPS.length}<button class="x" data-tip="Hide tips (bring them back from the ? window)">×</button></div>
    <p>${tip.text}</p><div class="t-foot"><span>${'●'.repeat(n)}${'○'.repeat(TIPS.length - n)}</span><button class="next">Next ›</button></div>`;
  el.querySelector('.next').onclick = () => tipDone(tip.id);
  el.querySelector('.x').onclick = () => {
    S.tipsOff = true;
    try { localStorage.setItem('ts-tips-off', '1'); } catch { /* ignore */ }
    el.classList.add('hidden');
  };
}

export { tipDone, updateTips };
