// First-game tips.

import { S, $ } from './state.js';

// ---- first-game tips: one at a time, each ticks off when you do the thing.
const TIPS = [
  { id: 'attack', text: 'You start with <b>no troops</b>: press <kbd>R</kbd> and click your land for a <b>barracks</b>. It raises <b>squad 1</b> with 5 troops; any that fall respawn every 20 seconds. <b>Right-click</b> an enemy tower, core or camp to send them. Press <kbd>H</kbd> to bring everyone home.' },
  { id: 'land', text: '<b>Double-click</b> outside your land to grow it all round, or press <kbd>L</kbd> and <b>drag along your border</b> to claim just the hexes you want. Land means more gold and a bigger army. Each tile costs a little more the more you own.' },
  { id: 'tower', text: 'Open <b>Build</b> (<kbd>Z</kbd>) or press <kbd>B</kbd>, and click your land to build a <b>tower</b>. Towers zap enemies and hold your land: lose one and the land around it opens up.' },
  { id: 'workers', text: 'Your <b>workers</b> (hard hats) put up what you build, repair, chop <b>wood</b> 🪵 from forests next to your land and farm. Open <b>Workers</b> (<kbd>J</kbd>) to set what matters most. Buildings and walls cost wood as well as gold.' },
  { id: 'barracks', text: 'Each barracks raises a squad: your 2nd raises squad 2, and so on (up to 4). Click a barracks and <b>upgrade</b> it for +5 troops in its squad, up to 20.' },
  { id: 'mix', text: 'Open <b>Squads</b> (<kbd>C</kbd>): you have up to <b>4 squads</b>. Choose each one\'s troops with <b>+</b> and <b>−</b>, and its <b>stance</b>. <b>Archers</b> shoot from range, <b>medics</b> heal and <b>siege rams</b> smash walls and buildings.' },
  { id: 'send', text: 'Each squad\'s number floats above it. <b>Click one of its troops</b> or press <kbd>1</kbd>–<kbd>4</kbd>, then right-click to send <b>just that squad</b>. Keep one home to defend.' },
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
  if (mine.filter((t) => t.kind === 'barracks').length >= 2 || mine.some((t) => t.kind === 'barracks' && t.level > 1)) tipDone('barracks');
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
