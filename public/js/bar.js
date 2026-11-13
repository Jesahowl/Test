// Command bar: build tiles, wave/troop cards and the squads.

import { buildStats } from './hud.js';
import { sendMsg } from './net.js';
import { clearSelection } from './overlay.js';
import { S, $, C, cam, selUnits, UNIT_KEYS } from './state.js';
import { mySquads, squadPicked } from './squads.js';
import { isMineTarget, targetName, targetPos } from './targets.js';
import { tipDone } from './tips.js';
import { escapeHtml } from './screens.js';
import { iconURL } from './ui.js';

function buildBar() {
  const tb = $('tower-button');
  const d = C.TOWERS.tower;
  const st = C.towerStats('tower', 1);
  tb.dataset.tip = `<span class="t">Tower <kbd>${d.key}</kbd></span>Zaps enemy troops that come near (${st.damage} dmg/s, range ${st.range}). Build on your own land, a tile in from the border. <span class="m">Towers hold land: if an enemy takes one, your land around it opens up.</span>`;
  tb.innerHTML = `<kbd>${d.key}</kbd><img src="${iconURL('tower')}" alt="">${d.name}<span class="cost">${d.cost}g</span>`;
  tb.onclick = () => toggleBuild('tower');
  const bb = $('barracks-button');
  const bd = C.TOWERS.barracks;
  bb.dataset.tip = `<span class="t">Barracks <kbd>${bd.key}</kbd></span><b>+${C.BARRACKS_TROOPS} troops in every wave</b>, marching out from the barracks. Build on your own land. Up to ${C.MAX_BARRACKS}; each costs ${C.BARRACKS_COST_STEP}g more than the last. <span class="m">Enemies who take one get its troops.</span>`;
  bb.innerHTML = `<kbd>${bd.key}</kbd><span class="count"></span><img src="${iconURL('barracks')}" alt="">${bd.name}<span class="cost"></span>`;
  bb.onclick = () => toggleBuild('barracks');
  const lb = $('land-button');
  lb.dataset.tip = `<span class="t">Buy land <kbd>L</kbd></span>Click empty tiles touching your border, or <b>drag along it</b> to buy a strip. <b>Double-click</b> outside your land to grow it one tile outward all round. Each tile costs ${C.LAND_BASE_COST}g + ${C.LAND_COST_PER_TILE}g for every tile you own. <span class="m">Land = more gold and a bigger army. Enemy land can't be bought: take their towers to open it up.</span>`;
  lb.innerHTML = `<kbd>L</kbd><img src="${iconURL('land')}" alt="">Land<span class="cost"></span>`;
  lb.onclick = () => toggleBuild('land');

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
  $('squad-merge').onclick = mergeSquads;
  $('new-waves').onclick = toggleNewWaves;
}

// ---- squads: every wave is a squad of its own

const findSquad = (id) => mySquads().find((q) => q.id === id);

// "Squad 2", "Squads 1 & 3", "All squads"
function squadsLabel() {
  if (S.allSquads) return 'All squads';
  const nums = mySquads().filter((q) => S.selSquads.has(q.id)).map((q) => q.num);
  if (!nums.length) return 'All squads';
  return nums.length === 1 ? `Squad ${nums[0]}` : `Squads ${nums.slice(0, -1).join(', ')} & ${nums[nums.length - 1]}`;
}

// Pick squad `id` (add: add it to / remove it from the picked squads). Picking the same squad
// again quickly jumps the camera to it.
let lastPick = { id: 0, at: 0 };
function pickSquad(id, add = false) {
  if (!S.myId || !findSquad(id)) return;
  selUnits.clear();
  S.selectedId = null;
  const now = performance.now();
  if (!add && lastPick.id === id && now - lastPick.at < 400 && !S.allSquads && S.selSquads.size === 1) {
    centerOnSquad(id);
  } else if (add && !S.allSquads) {
    if (S.selSquads.has(id) && S.selSquads.size > 1) S.selSquads.delete(id);
    else S.selSquads.add(id);
  } else {
    S.selSquads = new Set([id]);
  }
  S.allSquads = false;
  lastPick = { id, at: now };
  updateSquadsUi();
}

// 1-9: the squad with that number. With single troops picked: move them into it.
function squadKey(num, add) {
  const q = mySquads().find((x) => x.num === num);
  if (selUnits.size) {
    if (!q) return;
    sendMsg({ t: 'squad', op: 'assign', sq: q.id, ids: [...selUnits] });
    S.pendingOrder = (n) => `${n} troop${n === 1 ? '' : 's'} moved to squad ${num}`;
    selUnits.clear();
    return;
  }
  if (q) pickSquad(q.id, add);
}

// N: the picked single troops become a new squad.
function newSquadFromPicked() {
  if (!selUnits.size) return;
  sendMsg({ t: 'squad', op: 'assign', sq: 'new', ids: [...selUnits] });
  S.pendingOrder = (n) => `${n} troop${n === 1 ? '' : 's'} formed a new squad`;
  selUnits.clear();
}

function selectAllSquads() {
  selUnits.clear();
  S.selectedId = null;
  S.allSquads = true;
  S.selSquads = new Set();
  updateSquadsUi();
}

// Click a troop: pick its squad (Shift: add its squad).
function pickSquadOf(u, add = false) {
  pickSquad(u.sq, add);
}

function mergeSquads() {
  const list = mySquads().filter((q) => squadPicked(q.id));
  if (list.length < 2) return;
  sendMsg({ t: 'squad', op: 'merge', squads: list.map((q) => q.id) });
  S.pendingOrder = () => `Squads ${list.map((q) => q.num).join(' + ')} merged into squad ${list[0].num}`;
  S.selSquads = new Set([list[0].id]);
}

function toggleNewWaves() {
  if (!S.me) return;
  sendMsg({ t: 'squad', op: 'waves', mode: S.me.newWaves === 'follow' ? 'home' : 'follow' });
}

function centerOnSquad(id) {
  const q = findSquad(id);
  if (!q) return;
  cam.x = q.cx;
  cam.y = q.cy;
}

const STATUS_ICON = { defend: '🛡', attack: '⚔', hold: '🚩' };

// A squad's order for its chip: [kind, short text, long text]
function squadStatus(q) {
  const [type, key] = q.status.split(' ');
  if (type === 'defend') return key.startsWith('c:') ? ['defend', 'Home', 'Guarding your core'] : ['defend', targetName(key), `Defending ${targetName(key)}`];
  if (key.startsWith('p:')) return ['hold', 'Holding', 'Holding a spot on the map'];
  return ['attack', targetName(key), `Attacking ${targetName(key)}`];
}

function updateSquadsUi() {
  if (!S.me || !S.me.squads) return;
  const squads = mySquads();
  // drop picks of squads that are gone
  for (const id of S.selSquads) if (!squads.some((q) => q.id === id)) S.selSquads.delete(id);
  if (!S.allSquads && !S.selSquads.size) S.allSquads = true;
  const moving = selUnits.size;
  const box = $('squads');
  const key = squads.map((q) => `${q.id}:${q.num}:${q.units.length}:${q.status}:${squadPicked(q.id) ? 1 : 0}`).join('|') + `|${moving}|${S.allSquads}`;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = squads.length ? squads.map((q) => {
      const [kind] = squadStatus(q);
      const on = !moving && (S.allSquads || squadPicked(q.id));
      return `<button class="chip ${kind} ${on ? 'on' : ''} ${squadPicked(q.id) ? 'picked' : ''} ${moving ? 'drop' : ''}" data-id="${q.id}">`
        + `<span class="num">${q.num}</span><span class="ic">${STATUS_ICON[kind]}</span><span class="n">${q.units.length}</span></button>`;
    }).join('') : '<div class="none">Your first wave forms squad 1</div>';
    for (const el of box.querySelectorAll('.chip')) {
      const id = Number(el.dataset.id);
      const q = squads.find((x) => x.id === id);
      const [, , long] = squadStatus(q);
      const mix = UNIT_KEYS.filter((k) => q.kinds[k]).map((k) => `${q.kinds[k]} ${C.UNITS[k].name.toLowerCase()}${q.kinds[k] === 1 ? '' : 's'}`).join(', ');
      el.dataset.tip = moving
        ? `<span class="t">Move to squad ${q.num}</span>Put the ${moving} picked troop${moving === 1 ? '' : 's'} in this squad. They take on its orders.${q.num <= 9 ? ` <kbd>${q.num}</kbd>` : ''}`
        : `<span class="t">Squad ${q.num}${q.num <= 9 ? ` <kbd>${q.num}</kbd>` : ''}</span>${escapeHtml(long)} · ${mix}.<br><span class="m">Click to pick it (or click one of its troops), then right-click a target. <kbd>Shift</kbd>-click to pick several. Click again to find it.</span>`;
      el.onclick = (e) => {
        if (moving) {
          sendMsg({ t: 'squad', op: 'assign', sq: id, ids: [...selUnits] });
          S.pendingOrder = (n) => `${n} troop${n === 1 ? '' : 's'} moved to squad ${q.num}`;
          selUnits.clear();
          return;
        }
        pickSquad(id, e.shiftKey);
      };
    }
  }
  const picked = squads.filter((q) => squadPicked(q.id)).length;
  $('squad-all').classList.toggle('on', S.allSquads && !moving);
  $('squad-merge').disabled = picked < 2;
  const follow = S.me.newWaves === 'follow';
  const nw = $('new-waves');
  nw.classList.toggle('on', follow);
  nw.innerHTML = follow ? '⚔ New squads follow your last order <kbd>F</kbd>' : '🛡 New squads guard home <kbd>F</kbd>';
  nw.dataset.tip = `<span class="t">New squads</span>Every wave marches out as a new squad. ${follow
    ? `It follows your <b>last order</b> (now: ${escapeHtml(targetName(S.me.follow))}).`
    : 'It <b>guards your core</b> until you send it somewhere.'}<br><span class="m">Click or press <kbd>F</kbd> to switch.</span>`;
  const hint = moving ? `· moving ${moving} troop${moving === 1 ? '' : 's'}` : `· ${squads.length}`;
  if ($('squad-hint').textContent !== hint) $('squad-hint').textContent = hint;
}

function toggleBuild(kind) {
  S.buildKind = S.buildKind === kind ? null : kind;
  clearSelection();
}

// Order troops at a target: the single troops picked (they become a squad of their own), else the
// picked squads, else every squad. opts.everyone: every squad (Defend home / H).
function orderAt(tg, opts = {}) {
  if (!S.myId || !tg) return;
  const ids = selUnits.size && !opts.everyone ? [...selUnits] : null;
  const everyone = opts.everyone || S.allSquads;
  const squads = everyone ? null : [...S.selSquads];
  sendMsg({ t: 'order', ids, target: tg, squads });
  if (ids) selUnits.clear();
  if (tg.k === 'p') S.effects.push({ k: 'ping', x: (tg.id % C.MAP_W) + 0.5, y: Math.floor(tg.id / C.MAP_W) + 0.5, born: performance.now() });
  else {
    const pos = targetPos(`${tg.k}:${tg.id}`);
    if (pos) S.effects.push({ k: 'ping', x: pos.x, y: pos.y, born: performance.now(), atk: !isMineTarget(tg) });
  }
  if (!isMineTarget(tg)) tipDone('attack');
  if (tg.k === 'j') tipDone('jungle');
  if (!ids && !everyone) tipDone('send');
  const verb = isMineTarget(tg) ? 'defending' : tg.k === 'j' ? 'clearing' : tg.k === 'u' ? 'hunting' : tg.k === 'p' ? 'holding a spot' : 'attacking';
  const what = tg.k === 'p' ? '' : ` ${targetName(`${tg.k}:${tg.id}`)}`;
  const who = ids ? 'New squad' : opts.everyone ? 'All squads' : squadsLabel();
  S.pendingOrder = (n) => `${who} (${n} troop${n === 1 ? '' : 's'}): ${verb}${what}`;
}

export { buildBar, newSquadFromPicked, orderAt, pickSquadOf, selectAllSquads, squadKey, squadsLabel, toggleBuild, toggleNewWaves, updateSquadsUi };
