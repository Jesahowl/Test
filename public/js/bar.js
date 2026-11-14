// The drawers' contents: build tiles, wave/troop cards and the squads.

import { checkAllyOrder } from './diplomacy.js';
import { buildStats } from './hud.js';
import { sendMsg } from './net.js';
import { clearSelection } from './overlay.js';
import { S, $, C, cam, selUnits, UNIT_KEYS } from './state.js';
import { allSquads, squadPicked } from './squads.js';
import { isMineTarget, targetName, targetPos } from './targets.js';
import { tipDone } from './tips.js';
import { escapeHtml, toast } from './screens.js';
import { iconURL } from './ui.js';

function buildBar() {
  const tb = $('tower-button');
  const d = C.TOWERS.tower;
  const st = C.towerStats('tower', 1);
  tb.dataset.tip = `<span class="t">Tower <kbd>${d.key}</kbd></span>Zaps enemy troops that come near (${st.damage} dmg/s, range ${st.range}). Build on your own land; your workers put it up. <span class="m">If enemies destroy it, it's gone (they get ${C.TOWER_BOUNTY}g); your land stays yours.</span>`;
  tb.innerHTML = `<kbd>${d.key}</kbd><img src="${iconURL('tower')}" alt="">${d.name}<span class="cost"></span>`;
  tb.onclick = () => toggleBuild('tower');
  const bb = $('barracks-button');
  const bd = C.TOWERS.barracks;
  bb.dataset.tip = `<span class="t">Barracks <kbd>${bd.key}</kbd></span><b>Raises a squad</b>: your 1st barracks raises squad 1, the 2nd squad 2, and so on. It gives its squad <b>${C.BARRACKS_TROOPS} troops</b>, +${C.BARRACKS_TROOPS} for each upgrade, up to ${C.SQUAD_MAX_TROOPS}. Troops respawn there too. Up to ${C.MAX_BARRACKS}; each costs ${C.BARRACKS_COST_STEP}g more than the last.`;
  bb.innerHTML = `<kbd>${bd.key}</kbd><span class="count"></span><img src="${iconURL('barracks')}" alt="">${bd.name}<span class="cost"></span>`;
  bb.onclick = () => toggleBuild('barracks');
  const xb = $('trade-button');
  const xd = C.TOWERS.trade;
  xb.dataset.tip = `<span class="t">Trade Post <kbd>${xd.key}</kbd></span>Sends a <b>caravan</b> to an <b>ally's</b> trade post every ${C.CARAVAN_EVERY}s. When it arrives, you <b>both</b> get its cargo (more for longer routes and higher levels). Up to ${C.MAX_TRADE_POSTS}. <span class="m">Enemies can raid caravans for half their cargo: right-click your caravan to send a squad as escort.</span>`;
  xb.innerHTML = `<kbd>${xd.key}</kbd><span class="count"></span><img src="${iconURL('trade')}" alt="">Trade<span class="cost"></span>`;
  xb.onclick = () => toggleBuild('trade');
  const kb = $('workshop-button');
  const kd = C.TOWERS.workshop;
  kb.dataset.tip = `<span class="t">Workshop <kbd>${kd.key}</kbd></span><b>+${C.WORKSHOP_WORKERS} workers</b>, who respawn here too, and a place for workers to drop off wood. Up to ${C.MAX_WORKSHOPS}. <span class="m">Costs ${kd.cost}g and ${kd.wood} wood.</span>`;
  kb.innerHTML = `<kbd>${kd.key}</kbd><span class="count"></span><img src="${iconURL('workshop')}" alt="">Workshop<span class="cost"></span>`;
  kb.onclick = () => toggleBuild('workshop');
  const wb = $('wall-button');
  wb.dataset.tip = `<span class="t">Walls <kbd>V</kbd></span><b>Drag along your border</b> to wall it, ${C.WALL_COST}g a segment (no wood); your workers build it. Walls block <b>every</b> troop and caravan, yours too: click one and make it a <b>gate</b> (${C.WALL_GATE_COST}g) to let your side and your allies through. Each segment has ${C.WALL_HP} HP. <span class="m">Enemies hack through the weakest point; soldiers hit walls twice as hard.</span>`;
  wb.innerHTML = `<kbd>V</kbd><img src="${iconURL('wall')}" alt="">Wall<span class="cost"></span>`;
  wb.onclick = () => toggleBuild('wall');
  const lb = $('land-button');
  lb.dataset.tip = `<span class="t">Claim land <kbd>L</kbd></span>Click an empty <b>hex</b> touching your border, or <b>drag along it</b> to claim a strip. <b>Double-click</b> outside your land to grow it one hex outward all round. A hex costs more the more land you own. <span class="m">Land = more gold and a bigger army. Enemy land can't be claimed: destroy their core to win it.</span>`;
  lb.innerHTML = `<kbd>L</kbd><img src="${iconURL('land')}" alt="">Land<span class="cost"></span>`;
  lb.onclick = () => toggleBuild('land');

  const army = $('army');
  for (const kind of UNIT_KEYS) {
    const u = C.UNITS[kind];
    const card = document.createElement('div');
    card.className = 'troop';
    card.dataset.kind = kind;
    const st1 = C.towerStats(kind, 1);
    const role = u.heal ? `heals ${u.heal}/s` : u.breaker ? `${st1.damage} dmg, ×${u.wallBreaker} against walls, ×${u.siege} against buildings` : `${st1.damage} dmg, ${u.melee ? 'melee' : `range ${st1.range}`}`;
    card.dataset.tip = `<span class="t">${u.name}</span>${u.desc}.<br><span class="m">${st1.hp} HP · ${role} · speed ${u.speed}</span>`;
    card.innerHTML = `
      <div class="head"><img src="${iconURL(kind)}" alt=""><b>${u.name}</b><span class="lvl"></span></div>
      <div class="count"></div>
      <div class="btns"><button class="up"></button></div>`;
    card.querySelector('.up').onclick = () => sendMsg({ t: 'army', op: 'level', kind });
    army.appendChild(card);
  }
  $('alive').dataset.tip = 'Troops alive now / your army size. The army grows with your land (1 troop per 10 tiles) and +4 for each barracks.';
  buildStats();
  $('defend-home').onclick = () => orderAt({ k: 'c', id: S.myId }, { everyone: true });
  $('squad-all').onclick = selectAllSquads;
  bindSquadCards();
}

// ---- squads: up to four lasting squads, each with its own troops, stance and order

const findSquad = (id) => allSquads().find((q) => q.id === id);

// "Squad 2", "Squads 1 & 3", "All squads"
function squadsLabel() {
  if (S.allSquads) return 'All squads';
  const nums = allSquads().filter((q) => S.selSquads.has(q.id)).map((q) => q.num);
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

// 1-4: the squad with that number.
function squadKey(num, add) {
  const q = allSquads().find((x) => x.num === num);
  if (q) pickSquad(q.id, add);
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

function centerOnSquad(id) {
  const q = findSquad(id);
  if (!q || !q.units.length) return;
  cam.x = q.cx;
  cam.y = q.cy;
}

const STANCES = [
  ['aggressive', '⚔', 'Aggressive', 'Fights every enemy it meets on the way'],
  ['defensive', '🛡', 'Defensive', 'Marches past fights; fights at its target and defends home'],
  ['hold', '✋', 'Hold', 'Never chases: only fights what comes within reach'],
];

// G: the picked squads (or all) move to the next stance.
function cycleStance() {
  const list = allSquads().filter((q) => S.allSquads || S.selSquads.has(q.id));
  if (!list.length) return;
  const i = STANCES.findIndex(([k]) => k === list[0].stance);
  const next = STANCES[(i + 1) % STANCES.length][0];
  for (const q of list) sendMsg({ t: 'squad', op: 'stance', sq: q.id, stance: next });
  toast(`${S.allSquads ? 'All squads' : squadsLabel()}: ${STANCES.find(([k]) => k === next)[2].toLowerCase()} stance`, true);
}

const STATUS_ICON = { defend: '🛡', attack: '⚔', hold: '🚩' };

// A squad's order for its card: [kind, short text, long text]
function squadStatus(q) {
  const [type, key] = q.status.split(' ');
  if (type === 'defend') return key.startsWith('c:') ? ['defend', 'Guarding home', 'Guarding your core'] : ['defend', `Guarding ${targetName(key)}`, `Defending ${targetName(key)}`];
  if (key.startsWith('p:')) return ['hold', 'Holding a spot', 'Holding a spot on the map'];
  return ['attack', targetName(key), `Attacking ${targetName(key)}`];
}

// The squad cards: one listener for all of them (their HTML is rebuilt when anything changes).
function bindSquadCards() {
  $('squads').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    const card = e.target.closest('.sq-card');
    if (!el || !card) return;
    const id = Number(card.dataset.id);
    const act = el.dataset.act;
    if (act === 'pick') pickSquad(id, e.shiftKey);
    else if (act === 'find') {
      pickSquad(id);
      centerOnSquad(id);
    } else if (act === 'add' || act === 'rem') {
      sendMsg({ t: 'squad', op: 'mix', sq: id, kind: el.dataset.kind, d: act === 'add' ? 1 : -1 });
      tipDone('mix');
    } else if (act === 'stance') sendMsg({ t: 'squad', op: 'stance', sq: id, stance: el.dataset.stance });
  });
}

function updateSquadsUi() {
  if (!S.me || !S.me.squads) return;
  const squads = allSquads();
  for (const id of S.selSquads) if (!squads.some((q) => q.id === id)) S.selSquads.delete(id);
  if (!S.allSquads && !S.selSquads.size) S.allSquads = true;
  const free = squads.reduce((n, q) => n + Math.max(0, q.cap - q.slots), 0);
  const box = $('squads');
  const key = squads.map((q) => `${q.id}:${q.stance}:${q.cap}:${UNIT_KEYS.map((k) => `${q.mix[k]}/${q.kinds[k] || 0}`).join(',')}:${q.status}:${squadPicked(q.id) ? 1 : 0}:${Math.round(10 * hpFrac(q))}`).join('|') + `|${S.allSquads}`;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = squads.map((q) => {
      const [kind, short, long] = squadStatus(q);
      const on = S.allSquads || squadPicked(q.id);
      const alive = q.units.length;
      const room = q.cap - q.slots;
      // + fits in a free slot, or swaps soldiers out of a full squad
      const canAdd = (k) => q.cap && (room >= C.slotsOf(k) || (k !== 'soldier' && q.mix.soldier >= C.slotsOf(k) - Math.max(0, room)));
      const mixHtml = UNIT_KEYS.map((k) => {
        const n = q.mix[k];
        const down = Math.max(0, n - (q.kinds[k] || 0));
        return `<div class="mx${n ? '' : ' none'}" data-tip="<span class='t'>${C.UNITS[k].name}s in squad ${q.num}</span>${n} in the squad${down ? `, ${down} respawning` : ''}">`
          + `<img src="${iconURL(k)}" alt=""><b>${n}</b>${down ? `<i class="down">−${down}</i>` : ''}`
          + `<span class="pm"><button data-act="add" data-kind="${k}"${canAdd(k) ? '' : ' disabled'} data-tip="${!q.cap ? `Build a barracks to raise squad ${q.num}` : room >= C.slotsOf(k) ? `One more ${C.UNITS[k].name.toLowerCase()} (it arrives at the next respawn)` : `Swap ${C.slotsOf(k) > 1 ? 'soldiers' : 'a soldier'} for a ${C.UNITS[k].name.toLowerCase()} (the squad is full)`}">+</button><button data-act="rem" data-kind="${k}"${n ? '' : ' disabled'} data-tip="One fewer ${C.UNITS[k].name.toLowerCase()} (frees a slot for another squad)">−</button></span></div>`;
      }).join('');
      const stances = STANCES.map(([k, ic, name, what]) => `<button data-act="stance" data-stance="${k}" class="${q.stance === k ? 'on' : ''}" data-tip="<span class='t'>${name} <kbd>G</kbd></span>${what}">${ic}${q.stance === k ? ` ${name}` : ''}</button>`).join('');
      const lv = q.cap / C.BARRACKS_TROOPS;
      const cap = q.cap
        ? `<div class="sq-cap" data-tip="Squad ${q.num}'s barracks gives it ${q.cap} troop slots. Upgrade the barracks for +${C.BARRACKS_TROOPS} (up to ${C.SQUAD_MAX_TROOPS}).">Barracks Lv ${lv} · <b>${q.slots}/${q.cap}</b> slots${room > 0 ? ` · <span class="free">${room} free</span>` : ''}</div>`
        : `<div class="sq-cap none">No barracks: build one (<kbd>R</kbd>) to raise squad ${q.num}</div>`;
      return `<div class="sq-card ${kind}${on ? ' on' : ''}${squadPicked(q.id) ? ' picked' : ''}${q.cap ? '' : ' empty'}" data-id="${q.id}">
        <div class="sq-top" data-act="pick" data-tip="<span class='t'>Squad ${q.num} <kbd>${q.num}</kbd></span>${escapeHtml(long)}.<br><span class='m'>Click to pick it, then right-click a target. <kbd>Shift</kbd>-click to pick several.</span>">
          <span class="num">${q.num}</span><span class="st">${STATUS_ICON[kind]} ${escapeHtml(short)}</span><span class="cnt">${alive}/${q.size}</span>
          <button class="find" data-act="find" data-tip="Find squad ${q.num} on the map"${alive ? '' : ' disabled'}>◎</button></div>
        <div class="sq-hp"><i style="width:${Math.round(100 * hpFrac(q))}%"></i></div>
        ${cap}
        <div class="sq-mix">${mixHtml}</div>
        <div class="sq-stance">${stances}</div>
      </div>`;
    }).join('');
  }
  $('squad-all').classList.toggle('on', S.allSquads);
  const hint = free > 0 ? `${free} free troop slot${free === 1 ? '' : 's'}: add troops to a squad` : squads.some((q) => !q.cap) ? 'each barracks raises a squad: build more for more squads' : 'upgrade barracks for bigger squads';
  if ($('squad-hint').textContent !== hint) $('squad-hint').textContent = hint;
}

// How healthy a squad is: its troops' HP over the HP its whole mix would have.
function hpFrac(q) {
  if (!q.size) return 0;
  let hp = 0;
  for (const u of q.units) hp += Math.max(0, u.hp) / (u.maxHp || 1);
  return Math.min(1, hp / q.size);
}

function toggleBuild(kind) {
  S.buildKind = S.buildKind === kind ? null : kind;
  clearSelection();
}

// Order troops at a target: the single troops picked (they become a squad of their own), else the
// picked squads, else every squad. opts.everyone: every squad (Defend home / H).
function orderAt(tg, opts = {}) {
  if (!S.myId || !tg) return;
  checkAllyOrder(tg, () => sendOrder(tg, opts));
}

function sendOrder(tg, opts) {
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
  const verb = isMineTarget(tg) ? 'defending' : tg.k === 'e' ? 'escorting' : tg.k === 'j' ? (S.camps[tg.id]?.alive === false ? 'waiting to clear' : 'clearing') : tg.k === 'u' ? 'hunting' : tg.k === 'p' ? 'holding a spot' : 'attacking';
  const what = tg.k === 'p' ? '' : ` ${targetName(`${tg.k}:${tg.id}`)}`;
  const who = opts.everyone ? 'All squads' : squadsLabel();
  S.pendingOrder = (n) => `${who} (${n} troop${n === 1 ? '' : 's'}): ${verb}${what}`;
}

export { buildBar, cycleStance, orderAt, pickSquadOf, selectAllSquads, squadKey, squadsLabel, toggleBuild, updateSquadsUi };
