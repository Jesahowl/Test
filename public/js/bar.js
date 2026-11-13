// Command bar: build tiles, wave/troop cards, the Send slider and orders.

import { buildStats } from './hud.js';
import { sendMsg } from './net.js';
import { clearSelection } from './overlay.js';
import { S, $, allKinds, C, selUnits, setFollow, SHARE_STEP, UNIT_KEYS, wavesFollow } from './state.js';
import { isMineTarget, targetName } from './targets.js';
import { tipDone } from './tips.js';
import { iconURL } from './ui.js';

function buildBar() {
  const tb = $('tower-button');
  const d = C.TOWERS.tower;
  const st = C.towerStats('tower', 1);
  tb.dataset.tip = `<span class="t">Tower <kbd>${d.key}</kbd></span>Claims land around it and shoots enemy troops (${st.damage} dmg/s, range ${st.range}). Build on your land or up to ${C.TOWER_LEAP} tiles past your border. <span class="m">More land = more gold and a bigger army.</span>`;
  tb.innerHTML = `<kbd>${d.key}</kbd><img src="${iconURL('tower')}" alt="">${d.name}<span class="cost">${d.cost}g</span>`;
  tb.onclick = () => toggleBuild('tower');
  const bb = $('barracks-button');
  const bd = C.TOWERS.barracks;
  bb.dataset.tip = `<span class="t">Barracks <kbd>${bd.key}</kbd></span><b>+${C.BARRACKS_TROOPS} troops in every wave</b>, marching out from the barracks. Build on your own land. Up to ${C.MAX_BARRACKS}; each costs ${C.BARRACKS_COST_STEP}g more than the last. <span class="m">Enemies who take one get its troops.</span>`;
  bb.innerHTML = `<kbd>${bd.key}</kbd><span class="count"></span><img src="${iconURL('barracks')}" alt="">${bd.name}<span class="cost"></span>`;
  bb.onclick = () => toggleBuild('barracks');

  const army = $('army');
  for (const kind of UNIT_KEYS) {
    const u = C.UNITS[kind];
    const card = document.createElement('div');
    card.className = 'troop';
    card.dataset.kind = kind;
    const st1 = C.towerStats(kind, 1);
    const role = u.heal ? `heals ${u.heal}/s` : u.scout ? `sees ${u.sight} tiles, never fights` : `${st1.damage} dmg, ${u.melee ? 'melee' : `range ${st1.range}`}`;
    card.dataset.tip = `<span class="t">${u.name} <kbd>${u.key}</kbd></span>${u.desc}.<br><span class="m">${st1.hp} HP · ${role} · speed ${u.speed}${C.slotsOf(kind) > 1 ? ` · <b>${C.slotsOf(kind)} wave slots</b>` : ''}</span>`;
    card.innerHTML = `
      <div class="head"><img src="${iconURL(kind)}" alt=""><b>${u.name}</b><span class="lvl"></span></div>
      <div class="count"></div>
      <div class="btns">
        <button class="rem" data-tip="One fewer ${u.name} per wave (the slot goes back to soldiers)">−</button>
        <button class="add" data-tip="One more ${u.name} in every wave. Free: it uses ${C.slotsOf(kind)} wave slot${C.slotsOf(kind) > 1 ? 's' : ''} <kbd>${u.key}</kbd>">+</button>
        <button class="up"></button>
      </div>`;
    card.querySelector('.add').onclick = () => sendMsg({ t: 'army', op: 'add', kind });
    card.querySelector('.rem').onclick = () => sendMsg({ t: 'army', op: 'remove', kind });
    card.querySelector('.up').onclick = () => sendMsg({ t: 'army', op: 'level', kind });
    army.appendChild(card);
  }
  $('slots').dataset.tip = `<span class="t">Wave slots</span>${C.BASE_WAVE} from your core, +${C.BARRACKS_TROOPS} per barracks. Bright slots are troops you picked; faded ones are filled with soldiers automatically.`;
  $('alive').dataset.tip = 'Troops alive now / the most you can have. The cap grows with your land (and always fits one full wave).';
  buildStats();
  $('defend-home').onclick = () => orderAt({ k: 'c', id: S.myId }, 1, { everyone: true });
  $('follow').onclick = () => setFollow(!wavesFollow);

  // Send slider: what share of your troops a right-click order sends.
  const slider = $('share-slider');
  slider.min = SHARE_STEP * 100;
  slider.max = 100;
  slider.step = SHARE_STEP * 100;
  slider.oninput = () => setShare(Number(slider.value) / 100);
  slider.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShare(S.sendShare + (e.deltaY < 0 ? SHARE_STEP : -SHARE_STEP));
  }, { passive: false });
  // Keep keyboard focus off the slider so game keys (A/D pan, numbers) still work.
  slider.addEventListener('change', () => slider.blur());
  slider.addEventListener('pointerup', () => slider.blur());
  // Troop-type toggles for orders.
  const kinds = $('kinds');
  for (const kind of UNIT_KEYS) {
    const b = document.createElement('button');
    b.dataset.kind = kind;
    b.innerHTML = `<img src="${iconURL(kind, 36)}" alt="">`;
    b.dataset.tip = `<span class="t">Send ${C.UNITS[kind].name.toLowerCase()}s</span>Toggle whether right-click orders include ${C.UNITS[kind].name.toLowerCase()}s.<br><span class="m"><kbd>Shift</kbd>-click or right-click: send <b>only</b> ${C.UNITS[kind].name.toLowerCase()}s (again: all types).</span>`;
    b.onclick = (e) => toggleKind(kind, e.shiftKey);
    b.oncontextmenu = (e) => {
      e.preventDefault();
      toggleKind(kind, true);
    };
    kinds.appendChild(b);
  }
  setShare(S.sendShare);
}

// How many troops a share-order would send right now (the server picks the same number).
function myTroopCount() {
  let n = 0;
  for (const u of S.units.values()) if (u.owner === S.myId && S.sendKinds.has(u.kind)) n++;
  return n;
}

function shareCount(sh) {
  const total = myTroopCount();
  return total ? (sh >= 1 ? total : Math.max(1, Math.round(total * sh))) : 0;
}

// "archers", "soldiers & medics", ... for labels.
function kindsLabel(n = 2) {
  const names = UNIT_KEYS.filter((k) => S.sendKinds.has(k)).map((k) => C.UNITS[k].name.toLowerCase() + (n === 1 ? '' : 's'));
  return names.length <= 2 ? names.join(' & ') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

// Toggle a troop type for orders (Shift / right-click: only that type; click the last one: all again).
function toggleKind(kind, solo) {
  if (solo) S.sendKinds = S.sendKinds.size === 1 && S.sendKinds.has(kind) ? new Set(UNIT_KEYS) : new Set([kind]);
  else if (S.sendKinds.has(kind)) {
    S.sendKinds.delete(kind);
    if (!S.sendKinds.size) S.sendKinds = new Set(UNIT_KEYS);
  } else S.sendKinds.add(kind);
  try { localStorage.setItem('ts-kinds', JSON.stringify([...S.sendKinds])); } catch { /* ignore */ }
  updateShareUi();
}

function setShare(sh) {
  S.sendShare = Math.min(1, Math.max(SHARE_STEP, Math.round(sh / SHARE_STEP) * SHARE_STEP));
  try { localStorage.setItem('ts-share', String(S.sendShare)); } catch { /* ignore */ }
  updateShareUi();
}

function updateShareUi() {
  const slider = $('share-slider');
  const pct = Math.round(S.sendShare * 100);
  if (Number(slider.value) !== pct) slider.value = pct;
  slider.style.setProperty('--fill', `${((pct - SHARE_STEP * 100) / (100 - SHARE_STEP * 100)) * 100}%`);
  slider.classList.toggle('all', S.sendShare >= 1);
  const total = myTroopCount();
  const n = shareCount(S.sendShare);
  const all = allKinds();
  const what = all ? `troop${total === 1 ? '' : 's'}` : kindsLabel(total);
  $('share-pct').textContent = `${pct}%`;
  $('share-count').innerHTML = S.sendShare >= 1
    ? `<b>All ${total}</b> ${what}`
    : `<b>${n}</b> of ${total} ${what}`;
  for (const b of document.querySelectorAll('#kinds button')) b.classList.toggle('on', S.sendKinds.has(b.dataset.kind));
  slider.parentElement.dataset.tip = `<span class="t">Send</span>Right-click orders send <b>${S.sendShare >= 1 ? 'every troop' : `${pct}% of your troops`}</b>${S.sendShare < 1 ? ' (nearest first)' : ''}.<br><span class="m">Drag, scroll, or press <kbd>Z</kbd><kbd>X</kbd><kbd>C</kbd><kbd>V</kbd> for 25/50/75/100%.</span>`;
  const fb = $('follow');
  fb.classList.toggle('on', wavesFollow);
  fb.innerHTML = `${wavesFollow ? '☑' : '☐'} New waves follow <kbd>F</kbd>`;
  fb.dataset.tip = `<span class="t">New waves follow: ${wavesFollow ? 'on' : 'off'}</span>${wavesFollow
    ? 'Each order also redirects your <b>future waves</b>: they march to the same target.'
    : 'Orders only move the troops you send. <b>Future waves</b> keep their current orders.'}<br><span class="m">Hunting a single troop never redirects waves. Click or press <kbd>F</kbd> to switch.</span>`;
}

function toggleBuild(kind) {
  S.buildKind = S.buildKind === kind ? null : kind;
  clearSelection();
}

// Order troops at a target: the selected troops, else `share` of all troops (of the chosen types).
// opts.everyone: ignore the selection, type filter and follow toggle (Defend home / H).
function orderAt(tg, share = S.sendShare, opts = {}) {
  if (!S.myId || !tg) return;
  const ids = selUnits.size && !opts.everyone ? [...selUnits] : null;
  const filtered = !allKinds() && !opts.everyone;
  const follow = opts.everyone ? true : wavesFollow && tg.k !== 'u';
  sendMsg({ t: 'order', ids, target: tg, share: ids ? 1 : share, kinds: filtered ? [...S.sendKinds] : null, follow });
  if (tg.k === 'p') S.effects.push({ k: 'ping', x: (tg.id % C.MAP_W) + 0.5, y: Math.floor(tg.id / C.MAP_W) + 0.5, born: performance.now() });
  if (!isMineTarget(tg)) tipDone('attack');
  if (tg.k === 'j') tipDone('jungle');
  const verb = isMineTarget(tg) ? 'defending' : tg.k === 'j' ? 'clearing' : tg.k === 'u' ? 'hunting' : tg.k === 'p' ? 'moving to' : 'attacking';
  const what = targetName(`${tg.k}:${tg.id}`);
  S.pendingOrder = (n) => {
    const troopsTxt = filtered ? `${n} ${kindsLabel(n)}` : `${n} troop${n === 1 ? '' : 's'}`;
    const wavesTxt = follow ? ' · new waves too' : '';
    if (ids) return `${troopsTxt}: ${verb} ${what}${wavesTxt}`;
    if (share < 1) return `${troopsTxt} (${Math.round(share * 100)}%): ${verb} ${what}${wavesTxt}`;
    return `All ${troopsTxt}: ${verb} ${what}${wavesTxt}`;
  };
}

export { buildBar, kindsLabel, orderAt, setShare, shareCount, toggleBuild, updateShareUi };
