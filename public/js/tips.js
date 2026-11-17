// First-game tips.

import { S, $ } from './state.js';
import { touchOnly } from './touch.js';

// ---- first-game tips: one at a time, each ticks off when you do the thing.
// (one short line each; `touch`: the same said for phones and tablets)
const TIPS = [
  { id: 'attack', text: '<b>Right-click</b> an enemy tower or camp to send your squads.', touch: '<b>Press &amp; hold</b> an enemy tower or camp to send your squads.' },
  { id: 'barracks', text: 'Your first <b>barracks</b> (<kbd>R</kbd>) adds 5 troops to squad 1; more barracks raise more squads.', touch: 'Your first <b>barracks</b> (Build) adds 5 troops to squad 1; more barracks raise more squads.' },
  { id: 'land', text: '<b>Double-click</b> outside your land to grow it. More land, more gold.', touch: '<b>Double-tap</b> outside your land to grow it. More land, more gold.' },
  { id: 'tower', text: 'Press <kbd>B</kbd> and click your land to build a <b>tower</b>: it guards the land round it.', touch: 'Open <b>Build</b> and tap your land to put up a <b>tower</b>: it guards the land round it.' },
  { id: 'workers', text: 'Pick a plan for your <b>workers</b> in <b>Workers</b> (<kbd>J</kbd>): wood, iron, building or gold.', touch: 'Pick a plan for your <b>workers</b> in <b>Workers</b>: wood, iron, building or gold.' },
  { id: 'mix', text: 'Choose each squad\'s troops and stance in <b>Squads</b> (<kbd>C</kbd>).', touch: 'Choose each squad\'s troops and stance in <b>Squads</b>.' },
  { id: 'send', text: 'Press <kbd>1</kbd>–<kbd>4</kbd> (or click a troop) to command just one squad.', touch: 'Tap a troop to command just its squad.' },
  { id: 'jungle', text: 'Beat a <b>Warlord\'s Fort</b> 🔥 to power up your troops for 60s.' },
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
  // (the tutorial has its own guide)
  const tip = !S.tipsOff && !(S.round && S.round.tutorial) && TIPS.find((t) => !S.tipsDone.has(t.id));
  if (!tip || S.buildKind) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  if (el.dataset.key === tip.id) return;
  el.dataset.key = tip.id;
  const n = TIPS.indexOf(tip) + 1;
  el.innerHTML = `<span class="bulb">💡</span><p>${touchOnly && tip.touch ? tip.touch : tip.text}</p>`
    + `<span class="t-foot">${n}/${TIPS.length}<button class="next">Next ›</button><button class="x" data-tip="Hide tips (bring them back from the ? window)">×</button></span>`;
  el.querySelector('.next').onclick = () => tipDone(tip.id);
  el.querySelector('.x').onclick = () => {
    S.tipsOff = true;
    try { localStorage.setItem('ts-tips-off', '1'); } catch { /* ignore */ }
    el.classList.add('hidden');
  };
}

export { tipDone, updateTips };
