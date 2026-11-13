// Command bar: build tiles, wave/troop cards and the squads.

import { buildStats } from './hud.js';
import { sendMsg } from './net.js';
import { clearSelection } from './overlay.js';
import { S, $, C, cam, selUnits, SQUAD_N, UNIT_KEYS } from './state.js';
import { isMineTarget, targetName, targetPos } from './targets.js';
import { tipDone } from './tips.js';
import { escapeHtml } from './screens.js';
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
    card.dataset.tip = `<span class="t">${u.name}</span>${u.desc}.<br><span class="m">${st1.hp} HP · ${role} · speed ${u.speed}${C.slotsOf(kind) > 1 ? ` · <b>${C.slotsOf(kind)} wave slots</b>` : ''}</span>`;
    card.innerHTML = `
      <div class="head"><img src="${iconURL(kind)}" alt=""><b>${u.name}</b><span class="lvl"></span></div>
      <div class="count"></div>
      <div class="btns">
        <button class="rem" data-tip="One fewer ${u.name} per wave (the slot goes back to soldiers)">−</button>
        <button class="add" data-tip="One more ${u.name} in every wave. Free: it uses ${C.slotsOf(kind)} wave slot${C.slotsOf(kind) > 1 ? 's' : ''}">+</button>
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
  $('defend-home').onclick = () => orderAt({ k: 'c', id: S.myId }, { everyone: true });
  $('squad-all').onclick = selectAllSquads;
  const box = $('squads');
  for (let i = 0; i < SQUAD_N; i++) {
    const card = document.createElement('div');
    card.className = 'squad';
    card.innerHTML = `<span class="num">${i + 1}</span><span class="what"></span><span class="n"></span><button class="reinf">⬇</button>`;
    card.onclick = (e) => squadKey(i, e.shiftKey);
    const rb = card.querySelector('.reinf');
    rb.onclick = (e) => {
      e.stopPropagation();
      const on = !(S.me && S.me.squads[i].r);
      sendMsg({ t: 'squad', op: 'reinforce', sq: i, on });
    };
    box.appendChild(card);
  }
}

// ---- squads

const SQUAD_NAMES = Array.from({ length: SQUAD_N }, (_, i) => `Squad ${i + 1}`);

// "Squad 1", "Squads 1 & 3", "All squads"
function squadsLabel(set = S.selSquads) {
  if (set.size === SQUAD_N) return 'All squads';
  const nums = [...set].sort().map((i) => i + 1);
  return nums.length === 1 ? `Squad ${nums[0]}` : `Squads ${nums.slice(0, -1).join(', ')} & ${nums[nums.length - 1]}`;
}

function myTroops(sqSet = null) {
  const out = [];
  for (const u of S.units.values()) if (u.owner === S.myId && (!sqSet || sqSet.has(u.sq))) out.push(u);
  return out;
}

// 1/2/3 or a click on a squad card. With single troops picked: move them into that squad.
// Otherwise pick that squad (Shift: add/remove it); pressing the same squad again finds it on the map.
let lastKey = { i: -1, at: 0 };
function squadKey(i, add) {
  if (!S.myId) return;
  if (selUnits.size) {
    sendMsg({ t: 'squad', op: 'assign', sq: i, ids: [...selUnits] });
    S.pendingOrder = (n) => `${n} troop${n === 1 ? '' : 's'} moved to ${SQUAD_NAMES[i]}`;
    selUnits.clear();
    return;
  }
  const now = performance.now();
  if (!add && lastKey.i === i && now - lastKey.at < 400 && S.selSquads.size === 1) {
    centerOnSquad(i);
  } else if (add) {
    if (S.selSquads.has(i) && S.selSquads.size > 1) S.selSquads.delete(i);
    else S.selSquads.add(i);
  } else {
    S.selSquads = new Set([i]);
  }
  lastKey = { i, at: now };
  S.selectedId = null;
  updateSquadsUi();
}

function selectAllSquads() {
  selUnits.clear();
  S.selectedId = null;
  S.selSquads = new Set(Array.from({ length: SQUAD_N }, (_, k) => k));
  updateSquadsUi();
}

// Click a troop: pick its squad.
function pickSquadOf(u) {
  selUnits.clear();
  S.selSquads = new Set([u.sq]);
  updateSquadsUi();
}

function centerOnSquad(i) {
  const list = myTroops(new Set([i]));
  if (!list.length) return;
  cam.x = list.reduce((a, u) => a + u.rx, 0) / list.length;
  cam.y = list.reduce((a, u) => a + u.ry, 0) / list.length;
}

// A squad's standing order, for its card: [css class, text, tooltip text]
function squadStatus(i) {
  const o = S.me && S.me.squads ? S.me.squads[i].o : 'defend c:0';
  const [type, key] = o.split(' ');
  if (type === 'defend') {
    return key.startsWith('c:') ? ['def', '🛡 Home', 'Defending your core'] : ['def', `🛡 ${targetName(key)}`, `Defending ${targetName(key)}`];
  }
  if (key.startsWith('p:')) return ['atk', '🚩 Holding a spot', 'Holding a spot on the map'];
  return ['atk', `⚔ ${targetName(key)}`, `Attacking ${targetName(key)}`];
}

function updateSquadsUi() {
  if (!S.me || !S.me.squads) return;
  const cards = $('squads').children;
  const counts = new Array(SQUAD_N).fill(0);
  const kinds = Array.from({ length: SQUAD_N }, () => ({}));
  for (const u of myTroops()) {
    counts[u.sq]++;
    kinds[u.sq][u.kind] = (kinds[u.sq][u.kind] || 0) + 1;
  }
  const moving = selUnits.size;
  for (let i = 0; i < SQUAD_N; i++) {
    const card = cards[i];
    const [cls, text, long] = squadStatus(i);
    const on = S.selSquads.has(i);
    card.classList.toggle('on', on && !moving);
    card.classList.toggle('drop', !!moving);
    const what = card.querySelector('.what');
    const label = moving ? `Move ${moving} here` : text;
    if (what.textContent !== label) what.textContent = label;
    what.className = `what ${moving ? '' : cls}`;
    card.querySelector('.n').textContent = counts[i];
    const r = !!S.me.squads[i].r;
    const rb = card.querySelector('.reinf');
    rb.classList.toggle('on', r);
    rb.dataset.tip = `<span class="t">New troops: ${r ? 'on' : 'off'}</span>${r
      ? `New waves add troops to ${SQUAD_NAMES[i]}. Click to stop, so it stays the size it is.`
      : `${SQUAD_NAMES[i]} gets no new troops. Click to start adding them again.`}`;
    const mix = UNIT_KEYS.filter((k) => kinds[i][k]).map((k) => `${kinds[i][k]} ${C.UNITS[k].name.toLowerCase()}${kinds[i][k] === 1 ? '' : 's'}`).join(', ') || 'no troops yet';
    card.dataset.tip = moving
      ? `<span class="t">Move to ${SQUAD_NAMES[i]}</span>Put the ${moving} picked troop${moving === 1 ? '' : 's'} in this squad. They take on its orders. <kbd>${i + 1}</kbd>`
      : `<span class="t">${SQUAD_NAMES[i]} <kbd>${i + 1}</kbd></span>${escapeHtml(long)} · ${mix}.<br><span class="m">Click to pick it, then right-click a target. <kbd>Shift</kbd>-click to pick several. Press <kbd>${i + 1}</kbd> twice to find it.</span>`;
  }
  $('squad-all').classList.toggle('on', S.selSquads.size === SQUAD_N && !moving);
  const hint = moving ? `· moving ${moving} troop${moving === 1 ? '' : 's'}` : '';
  if ($('squad-hint').textContent !== hint) $('squad-hint').textContent = hint;
}

function toggleBuild(kind) {
  S.buildKind = S.buildKind === kind ? null : kind;
  clearSelection();
}

// Order troops at a target: the single troops picked, else the picked squads.
// opts.everyone: every squad (Defend home / H).
function orderAt(tg, opts = {}) {
  if (!S.myId || !tg) return;
  const ids = selUnits.size && !opts.everyone ? [...selUnits] : null;
  const squads = opts.everyone ? null : [...S.selSquads];
  sendMsg({ t: 'order', ids, target: tg, squads });
  if (tg.k === 'p') S.effects.push({ k: 'ping', x: (tg.id % C.MAP_W) + 0.5, y: Math.floor(tg.id / C.MAP_W) + 0.5, born: performance.now() });
  else {
    const pos = targetPos(`${tg.k}:${tg.id}`);
    if (pos) S.effects.push({ k: 'ping', x: pos.x, y: pos.y, born: performance.now(), atk: !isMineTarget(tg) });
  }
  if (!isMineTarget(tg)) tipDone('attack');
  if (tg.k === 'j') tipDone('jungle');
  if (!ids && squads && squads.length < SQUAD_N) tipDone('send');
  const verb = isMineTarget(tg) ? 'defending' : tg.k === 'j' ? 'clearing' : tg.k === 'u' ? 'hunting' : tg.k === 'p' ? 'holding a spot' : 'attacking';
  const what = tg.k === 'p' ? '' : ` ${targetName(`${tg.k}:${tg.id}`)}`;
  const who = ids ? null : opts.everyone ? 'All squads' : squadsLabel();
  S.pendingOrder = (n) => {
    const troopsTxt = `${n} troop${n === 1 ? '' : 's'}`;
    if (ids) return `${troopsTxt}: ${verb}${what}`;
    const follow = tg.k === 'u' ? '' : ' · new troops follow';
    return `${who} (${troopsTxt}): ${verb}${what}${follow}`;
  };
}

export { buildBar, orderAt, pickSquadOf, selectAllSquads, squadKey, squadsLabel, toggleBuild, updateSquadsUi };
