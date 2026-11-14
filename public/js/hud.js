// HUD panels: player card, wave info, leaderboard, feed and selection panel.

import { wallPanel } from './walls.js';
import { orderAt, squadsLabel, updateSquadsUi } from './bar.js';
import { allyButton, isAlly, offersHtml } from './diplomacy.js';
import { bindTradePanel, tradeInfo } from './trade.js';
import { sendMsg } from './net.js';
import { escapeHtml, updateRound } from './screens.js';
import { S, $, C, colorOf, feed, players, selUnits, terr, UNIT_KEYS } from './state.js';
import { targetName } from './targets.js';
import { tipDone, updateTips } from './tips.js';
import { iconURL, refreshTip } from './ui.js';
import { updateDock } from './dock.js';
import { allSquads } from './squads.js';

S.hudTimer = 0;

function updateHud() {
  if (S.spectating) {
    updateBoards();
    const t = players.get(S.specTarget);
    const bar = $('spec-bar');
    const humans = [...players.values()].some((q) => !q.isBot);
    const btn = S.room ? 'Leave room' : S.queued ? '✓ Joining next round' : humans ? 'Join next round' : 'New round';
    const key = `${t ? t.name : ''}:${S.specFollow}:${btn}`;
    if (bar.dataset.key !== key) {
      bar.dataset.key = key;
      bar.innerHTML = `<span>👁 Spectating${t ? ` <b>${escapeHtml(t.name)}</b>` : ''}${t && !S.specFollow ? ' <span class="muted">(free camera)</span>' : ''}</span>
        <span class="muted">Tab: next player · Space: follow · WASD: move</span>
        <button id="spec-new"${S.queued && !S.room ? ' disabled' : ''}>${btn}</button>`;
      $('spec-new').onclick = () => sendMsg(S.room ? { t: 'leave' } : { t: 'join', name: S.lastName });
    }
    updateRound();
    return;
  }
  if (!S.myId) return;
  const p = players.get(S.myId);
  if (!p || !S.me) return;
  const gold = S.me.gold;
  const sorted = [...players.values()].sort((a, b) => b.territory - a.territory);
  const rank = sorted.findIndex((q) => q.id === S.myId) + 1;
  const myTroops = [...S.units.values()].filter((u) => u.owner === S.myId && u.kind !== 'caravan' && u.kind !== 'worker').reduce((n, u) => n + C.slotsOf(u.kind), 0);
  const armySize = S.me.armySize;
  updateRound();
  updateStats(p, gold, rank, sorted.length);

  // respawns: countdown ring, and who comes back when it runs out
  const squads = allSquads();
  const used = squads.reduce((n, q) => n + UNIT_KEYS.reduce((m, k) => m + q.mix[k] * C.slotsOf(k), 0), 0); // army slots taken
  $('wave-size').textContent = `${used} / ${armySize} army slots used · fallen troops respawn every ${C.WAVE_INTERVAL}s`;
  const frac = Math.max(0, Math.min(1, S.me.nextWave / C.WAVE_INTERVAL));
  $('wave-timer').innerHTML = `<svg viewBox="0 0 26 26"><circle cx="13" cy="13" r="11" fill="none" stroke="#273041" stroke-width="2.4"/>
    <circle cx="13" cy="13" r="11" fill="none" stroke="#ffd54f" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${(69.1 * (1 - frac)).toFixed(1)} 69.1"/></svg><span>${S.me.nextWave}s</span>`;
  const down = {};
  for (const q of squads) for (const k of UNIT_KEYS) down[k] = (down[k] || 0) + Math.max(0, q.mix[k] - (q.kinds[k] || 0));
  const lineup = UNIT_KEYS.filter((k) => down[k]);
  const nDown = lineup.reduce((n, k) => n + down[k], 0);
  $('wave-timer').dataset.tip = `<span class="t">Respawn in ${S.me.nextWave}s</span>${nDown ? `${nDown} fallen troop${nDown === 1 ? '' : 's'} will respawn and rejoin their squads.` : 'Every squad is at full strength.'} Every ${C.WAVE_INTERVAL} seconds, every fallen troop respawns at your core and barracks.`;
  const slotKey = lineup.map((k) => `${k}${down[k]}`).join(',') + `|${S.me.nextWave}`;
  const box = $('slots');
  if (box.dataset.key !== slotKey) {
    box.dataset.key = slotKey;
    box.innerHTML = lineup.length
      ? `<span class="nw-label">Respawning in ${S.me.nextWave}s</span>` + lineup.map((k) => `<span class="nw" style="--c:${C.UNITS[k].color}"><img src="${iconURL(k, 36)}" alt="">×${down[k]}</span>`).join('')
      : '<span class="nw-label">Every squad at full strength</span>';
  }
  $('alive').innerHTML = `Troops alive <b>${myTroops}</b> / ${armySize}`;

  const who = selUnits.size ? `${selUnits.size} picked troop${selUnits.size === 1 ? '' : 's'}` : squadsLabel();
  const orderHtml = selUnits.size
    ? `<span class="def">${who}</span><span class="hint">a number moves them to that squad · N makes a new squad · right-click sends them</span>`
    : `<span class="def">🎯 ${who}</span><span class="hint">right-click a target to send ${!S.allSquads && S.selSquads.size === 1 ? 'it' : 'them'}${S.allSquads ? ' · click a troop to pick its squad' : ' · Q for all squads'}</span>`;
  if ($('order-info').dataset.html !== orderHtml) {
    $('order-info').dataset.html = orderHtml;
    $('order-info').innerHTML = orderHtml;
  }

  updateBoards();
  updateDock(Math.max(0, armySize - used), (S.me.offersIn || []).length);
  updateTowerAndArmy(gold);
  updateSelectionPanel(gold);
  updateTips();
  refreshTip();
}

// The player card (built once; numbers updated in place so tooltips keep working).
function buildStats() {
  $('stats').innerHTML = `
    <span class="who"><span class="dot"></span><span class="name"></span><span class="rank" data-tip="Your place on the land leaderboard"></span></span>
    <span class="wood-row" data-tip="<span class='t'>Wood</span>Your workers chop it from forests next to your land and carry it to the core or a workshop. Towers, barracks, trade posts, workshops and walls need it.">🪵 <span class="wood"></span></span>
    <span class="gold-row" data-tip="<span class='t'>Gold</span>Earned from land (a trickle) and mostly from fighting: troop kills, jungle camps, towers and cores. Spend it on towers, barracks and troop levels.">
      <span class="coin"></span><span class="gold"></span><span class="income"></span></span>
    <span class="chip land" data-tip="Tiles you own. More land = more income and room for more troops.">🗺 <b></b> land</span>
    <span class="chip kills" data-tip="Enemy troops and monsters your side has killed">⚔ <b></b> kills</span>
    <span class="meter" data-tip="Your core. If it falls, you're out of the round and whoever broke it takes your gold and troops."><i></i><span></span></span>
    <span class="chip shield hidden" data-tip="Spawn protection: your core and buildings can't be damaged yet">🛡 <b></b></span>
    <span class="chip buff hidden" data-tip="Buff from defeating a barbarian Warlord: your troops deal +${Math.round(C.JUNGLE_BUFF_DAMAGE * 100)}% damage and take ${Math.round(C.JUNGLE_BUFF_ARMOR * 100)}% less">🔥 <b></b></span>`;
}

function updateStats(p, gold, rank, n) {
  const el = $('stats');
  el.querySelector('.who .dot').style.background = colorOf(p.id, 55);
  el.querySelector('.who .name').textContent = p.name;
  el.querySelector('.who .rank').textContent = `#${rank} of ${n}`;
  el.querySelector('.gold').textContent = gold.toLocaleString();
  el.querySelector('.wood').textContent = (S.me.wood || 0).toLocaleString();
  el.querySelector('.income').textContent = `+${C.income(p.territory).toFixed(1)}/s`;
  el.querySelector('.chip.land b').textContent = p.territory;
  el.querySelector('.chip.kills b').textContent = p.kills;
  const sh = el.querySelector('.chip.shield');
  sh.classList.toggle('hidden', !p.shield);
  sh.querySelector('b').textContent = `${p.shield}s`;
  const bf = el.querySelector('.chip.buff');
  bf.classList.toggle('hidden', !p.buff);
  bf.querySelector('b').textContent = `${p.buff}s`;
  const frac = p.hp / p.maxHp;
  const bar = el.querySelector('.meter i');
  bar.style.width = `${100 * frac}%`;
  bar.className = frac > 0.5 ? '' : frac > 0.25 ? 'mid' : 'low';
  el.querySelector('.meter span').textContent = `Core ${Math.round(100 * frac)}%`;
  el.querySelector('.meter').dataset.tip = `<span class='t'>Core ${p.hp.toLocaleString()} / ${p.maxHp.toLocaleString()}</span>If it falls, you're out of the round and whoever broke it takes your gold and troops.`;
}

// Who q is allied with, as coloured dots (everyone can see alliances).
function allyMarks(q) {
  if (!q.allies || !q.allies.length) return '';
  return ` <span class="allied" data-tip="Allied with ${escapeHtml(q.allies.map((id) => players.get(id)?.name || '?').join(', '))}">🤝${q.allies.map((id) => `<i style="background:${colorOf(id, 55)}"></i>`).join('')}</span>`;
}

// Player list (in the top bar), the Diplomacy drawer and the kill feed (shown to players and spectators).
const TOP_PLAYERS = 8;
function updateBoards() {
  const sorted = [...players.values()].sort((a, b) => b.territory - a.territory);
  const focus = S.spectating ? S.specTarget : S.myId;
  const shown = sorted.slice(0, TOP_PLAYERS);
  if (focus && !shown.some((q) => q.id === focus)) {
    const f = sorted.find((q) => q.id === focus);
    if (f) shown[shown.length - 1] = f;
  }
  const lb = shown.map((q) => {
    const pos = sorted.indexOf(q) + 1;
    const tip = `<span class='t'>#${pos} ${escapeHtml(q.name)}${q.isBot ? ' (bot)' : ''}</span>${q.territory} land${q.allies && q.allies.length ? ` · allied with ${escapeHtml(q.allies.map((id) => players.get(id)?.name || '?').join(', '))}` : ''}${q.buff ? ' · 🔥 empowered' : ''}${q.shield ? ' · 🛡 protected' : ''}`;
    return `<span class="pl${q.id === focus ? ' me' : ''}${isAlly(q.id) ? ' ally' : ''}" data-tip="${tip}"><span class="dot" style="background:${colorOf(q.id, 55)}"></span>`
      + `<span class="n">${q.id === S.myId ? 'You' : escapeHtml(q.name)}</span>${isAlly(q.id) ? '<span class="hs">🤝</span>' : ''}${q.buff ? '🔥' : ''}<span class="v">${q.territory}</span></span>`;
  }).join('') + (sorted.length > shown.length ? `<span class="pl more">+${sorted.length - shown.length}</span>` : '');
  const lbEl = $('leaderboard');
  if (lbEl.dataset.html !== lb) {
    lbEl.dataset.html = lb;
    lbEl.innerHTML = lb;
  }
  if (S.drawer === 'diplo') updateDiplomacy(sorted);
  const now = performance.now();
  $('feed').innerHTML = feed.filter((f) => now - f.born < 9000).map((f) =>
    `<div style="opacity:${Math.min(1, (9000 - (now - f.born)) / 1500)}">${escapeHtml(f.text)}</div>`).join('');
}

// The Diplomacy drawer: every player with their alliance button, and offers waiting for an answer.
function updateDiplomacy(sorted) {
  const top = Math.max(1, ...sorted.map((q) => q.territory));
  const mine = (players.get(S.myId)?.allies || []).length;
  $('diplo-hint').textContent = `${mine} of ${C.MAX_ALLIES} allies · allies don't fight and see each other's bases`;
  const html = offersHtml() + '<div class="rows">' + sorted.map((q, i) =>
    `<div class="row${q.id === S.myId ? ' me' : ''}"><span class="bg" style="width:${(100 * q.territory) / top}%;background:${colorOf(q.id, 55)}"></span>`
    + `<span class="pos">${i + 1}</span><span class="dot" style="background:${colorOf(q.id, 55)}"></span>`
    + `<span class="n">${escapeHtml(q.name)}${q.isBot ? ' <span class="muted">· bot</span>' : ''}${q.buff ? ' 🔥' : ''}${q.shield ? ' 🛡' : ''}${allyMarks(q)}</span>${allyButton(q)}<span class="v">${q.territory}</span></div>`).join('') + '</div>';
  const el = $('diplo');
  if (el.dataset.html !== html) {
    el.dataset.html = html;
    el.innerHTML = html;
  }
}

// Build buttons (tower, barracks, land), squads and the army panel.
function updateTowerAndArmy(gold) {
  updateSquadsUi();
  const wood = S.me.wood || 0;
  // a building tile: lit while placing it, dimmed when you can't afford it (or have the most)
  const tile = (id, kind, goldCost, woodCost, count, max) => {
    const el = $(id);
    const maxed = max !== undefined && count >= max;
    el.classList.toggle('active', S.buildKind === kind);
    el.classList.toggle('poor', maxed || gold < goldCost || wood < woodCost);
    const html = maxed ? 'max' : `${goldCost}g${woodCost ? ` <span class="wd${wood < woodCost ? ' short' : ''}">🪵${woodCost}</span>` : ''}`;
    const c = el.querySelector('.cost');
    if (c.innerHTML !== html) c.innerHTML = html;
    c.classList.toggle('max', maxed);
    if (max !== undefined) el.querySelector('.count').textContent = `${count}/${max}`;
  };
  const mine = (kind) => [...S.towers.values()].filter((t) => t.owner === S.myId && t.kind === kind).length;
  tile('tower-button', 'tower', C.TOWERS.tower.cost, C.TOWERS.tower.wood);
  const barracks = mine('barracks');
  tile('barracks-button', 'barracks', C.buildCost('barracks', barracks), C.TOWERS.barracks.wood, barracks, C.MAX_BARRACKS);
  tile('trade-button', 'trade', C.TOWERS.trade.cost, C.TOWERS.trade.wood, mine('trade'), C.MAX_TRADE_POSTS);
  tile('workshop-button', 'workshop', C.TOWERS.workshop.cost, C.TOWERS.workshop.wood, mine('workshop'), C.MAX_WORKSHOPS);
  tile('wall-button', 'wall', C.WALL_COST, 0);
  const lb = $('land-button');
  const hexCost = Math.round(C.landCost((players.get(S.myId) || { territory: 0 }).territory) * 2.598 * C.HEX_R * C.HEX_R);
  lb.classList.toggle('active', S.buildKind === 'land');
  lb.classList.toggle('poor', gold < hexCost);
  lb.querySelector('.cost').textContent = `~${hexCost}g/hex`;
  updateWorkersUi();
  // Troop cards: how many are in squads, level and its price.
  const inSquads = {};
  for (const q of allSquads()) for (const k of UNIT_KEYS) inSquads[k] = (inSquads[k] || 0) + q.mix[k];
  for (const card of document.querySelectorAll('#army .troop')) {
    const kind = card.dataset.kind;
    const n = inSquads[kind] || 0;
    const lvl = S.me.levels[kind];
    const upCost = lvl < C.MAX_LEVEL ? C.armyLevelCost(kind, lvl) : 0;
    card.classList.toggle('off', n === 0);
    card.classList.toggle('in', n > 0);
    card.style.setProperty('--c', C.UNITS[kind].color);
    card.querySelector('.lvl').textContent = `Lv ${lvl}`;
    const html = n ? `<b class="n">×${n}</b> <span class="muted">in your squads</span>` : 'none in your squads';
    const countEl = card.querySelector('.count');
    if (countEl.innerHTML !== html) countEl.innerHTML = html;
    const up = card.querySelector('.up');
    up.textContent = lvl < C.MAX_LEVEL ? `▲ Level up ${upCost}g` : 'MAX';
    up.disabled = lvl >= C.MAX_LEVEL || gold < upCost;
    const s1 = C.towerStats(kind, lvl);
    const s2 = lvl < C.MAX_LEVEL ? C.towerStats(kind, lvl + 1) : null;
    up.dataset.tip = s2
      ? `<span class="t">Level ${C.UNITS[kind].name}s up to ${lvl + 1}: ${upCost}g</span>HP ${s1.hp} → <b>${s2.hp}</b>${s1.damage ? ` · damage ${Math.round(s1.damage)} → <b>${Math.round(s2.damage)}</b>` : ''}${s1.heal ? ` · healing ${Math.round(s1.heal)} → <b>${Math.round(s2.heal)}</b>` : ''}<br><span class="m">Applies to troops that respawn after.</span>`
      : 'Max level';
  }
}

// ---- the Workers drawer: how many workers, and each job's priority (off / low / high).
const JOBS = [
  ['build', '🔨', 'Build', 'Put up building sites and walls you place'],
  ['repair', '🔧', 'Repair', `Fix damaged buildings, walls and your core (${C.REPAIR_GOLD_PER_HP}g per HP)`],
  ['gather', '🪓', 'Chop wood', 'Chop forests anywhere on the map (the nearest first) and carry the wood to your core or a workshop'],
  ['farm', '🌾', 'Farm', `Work open hexes of your land: +${C.FARM_GOLD}g/s each`],
  ['scout', '🔭', 'Scout', `Run off exploring the fog: fast, seeing ${C.SCOUT_SIGHT} tiles, keeping clear of enemy guns (at most ${C.SCOUT_WORKERS})`],
];
const LEVELS = ['Off', 'Low', 'High'];
let jobsBound = false;
function updateWorkersUi() {
  const [cap, prio] = S.me.workers || [0, [0, 0, 0, 0, 0]];
  const mine = [...S.units.values()].filter((u) => u.owner === S.myId && u.kind === 'worker');
  const busy = [0, 0, 0, 0, 0, 0];
  for (const u of mine) busy[u.job]++;
  $('workers-badge').textContent = busy[0] && mine.length ? String(busy[0]) : '';
  $('workers-badge').dataset.tip = 'Idle workers';
  if (S.drawer !== 'workers') return;
  tipDone('workers');
  const hint = `${mine.length} / ${cap} workers · ${busy[0]} idle · +${C.WORKSHOP_WORKERS} per workshop`;
  if ($('workers-hint').textContent !== hint) $('workers-hint').textContent = hint;
  const box = $('jobs');
  const key = `${prio.join(',')}|${busy.join(',')}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = JOBS.map(([job, ic, name, what], i) => `<div class="job" data-tip="<span class='t'>${name}</span>${what}">
    <span class="ic">${ic}</span><b>${name}</b><span class="n">${busy[i + 1]} working</span>
    <span class="lv">${LEVELS.map((l, lv) => `<button data-job="${job}" data-lv="${lv}" class="${prio[i] === lv ? 'on' : ''}">${l}</button>`).join('')}</span></div>`).join('');
  if (!jobsBound) {
    jobsBound = true;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-job]');
      if (b) sendMsg({ t: 'jobs', job: b.dataset.job, level: Number(b.dataset.lv) });
    });
  }
}

function updateSelectionPanel(gold) {
  const panel = $('selection');
  if (selUnits.size) {
    panel.classList.remove('hidden');
    const list = [...selUnits].map((id) => S.units.get(id)).filter(Boolean);
    const key = `u:${list.map((u) => u.id).join(',')}`;
    if (panel.dataset.key !== key) {
      panel.dataset.key = key;
      const counts = {};
      for (const u of list) counts[u.kind] = (counts[u.kind] || 0) + 1;
      const first = list[0] ? list[0].kind : 'soldier';
      panel.innerHTML = `<h4><img src="${iconURL(first)}" alt="">${list.length} troop${list.length === 1 ? "" : "s"} picked</h4>
        <div class="muted">${Object.entries(counts).map(([k, c]) => `${c}× ${C.UNITS[k].name}`).join(' · ')}</div>
        <div id="sel-info" class="stats"></div>
        <div class="muted">Press a squad's number (or click its chip) to move them into it, <kbd>N</kbd> to make them a new squad, or right-click to send just these as a new squad. <kbd>Esc</kbd> to cancel.</div>`;
    }
    if (list.length === 1) {
      const u = list[0];
      const st = C.towerStats(u.kind, u.level);
      const d = C.UNITS[u.kind];
      $('sel-info').innerHTML = `<div>Level <b>${u.level}</b></div><div>HP <b>${u.hp}/${u.maxHp}</b></div>
        <div>${d.heal ? `Heals <b>${st.heal.toFixed(0)}/s</b>` : d.scout ? `Sight <b>${d.sight}</b>` : `Damage <b>${st.damage.toFixed(0)}</b>`}</div>
        <div>${u.attack ? `⚔ ${escapeHtml(targetName(u.attack))}` : '🛡 defending'}</div>`;
    } else {
      $('sel-info').innerHTML = '';
    }
    return;
  }
  if (S.selWorker && S.units.has(S.selWorker)) {
    const u = S.units.get(S.selWorker);
    panel.classList.remove('hidden');
    const job = ['Idle', 'Building', 'Repairing', 'Chopping wood', 'Farming', 'Scouting'][u.job] + (u.carry ? ' (carrying wood home)' : '');
    const key = `wk:${u.id}:${job}`;
    if (panel.dataset.key !== key) {
      panel.dataset.key = key;
      panel.innerHTML = `<h4><img src="${iconURL('worker')}" alt="">Your worker</h4><div class="stats"><div style="grid-column:span 2">${job}</div></div>
        <div class="muted">Right-click a building site, a damaged building or wall, a forest, or an open hex of your land to send it there. <kbd>Esc</kbd> to let it choose.</div>`;
    }
    return;
  }
  if (S.selWall && wallPanel(panel, gold)) return;
  const t = S.selectedId && S.towers.get(S.selectedId);
  if (!t) {
    panel.classList.add('hidden');
    panel.dataset.key = '';
    return;
  }
  panel.classList.remove('hidden');
  const d = C.TOWERS[t.kind];
  const ruined = t.ruin || !t.owner;
  const key = `${t.id}:${t.level}:${t.owner}:${t.partner || 0}`;
  const img = `<img src="${iconURL(t.kind)}" alt="">`;
  if (panel.dataset.key !== key) {
    panel.dataset.key = key;
    if (ruined) {
      panel.innerHTML = `<h4>${img}Ruined ${d.name}</h4>
        <div class="muted">Once owned by ${escapeHtml(t.ruinOf || 'someone')} · level ${t.level}</div>
        <div id="sel-info" class="muted"></div>
        <div class="btns"><button id="sel-capture" class="primary">Rebuild for ${C.RUIN_CAPTURE_COST}g</button></div>`;
      $('sel-capture').onclick = () => sendMsg({ t: 'capture', id: t.id });
    } else if (t.owner === S.myId) {
      const st = C.towerStats(t.kind, t.level);
      const maxed = t.level >= C.maxLevel(t.kind);
      const isB = t.kind === 'barracks';
      const isT = t.kind === 'trade';
      const next = !maxed ? C.towerStats(t.kind, t.level + 1) : null;
      const upTip = !next ? 'Max level' : isT
        ? `Level ${t.level + 1}: +${Math.round(C.CARAVAN_LEVEL_CARGO * 100)}% cargo, tougher caravans and guards, ${next.hp} HP <kbd>U</kbd>`
        : `Level ${t.level + 1}: damage ${Math.round(next.damage)}, range ${next.range}, ${next.hp} HP <kbd>U</kbd>`;
      panel.innerHTML = `<h4>${img}Your ${d.name}${isB ? '' : ` · Lv ${t.level}`}</h4>
        <div id="sel-info" class="stats"></div>
        <div class="stats" id="sel-kind">${isB
          ? `<div style="grid-column:span 2">+<b>${C.BARRACKS_TROOPS}</b> troops every wave, from here</div>`
          : isT ? tradeInfo(t)
            : `<div>Damage <b>${st.damage.toFixed(0)}/s</b></div><div>Range <b>${st.range}</b></div>`}<div>Sight <b>${C.structSight(t.kind, t.level)}</b></div></div>
        <div class="btns">
          ${isB ? '' : `<button id="sel-up" class="primary" data-tip="${upTip}">${maxed ? 'Max level' : `▲ Upgrade ${C.upgradeCost(t.kind, t.level)}g`}</button>`}
          <button id="sel-sell" data-tip="Sell for ${C.sellValue(t.kind, t.level)}g. Its land goes too. <kbd>Del</kbd>">Sell +${C.sellValue(t.kind, t.level)}g</button>
        </div>
        <div class="btns"><button id="sel-defend">🛡 Defend here</button></div>`;
      if (!isB) $('sel-up').onclick = () => sendMsg({ t: 'upgrade', id: t.id });
      if (isT) bindTradePanel(t);
      $('sel-sell').onclick = () => sendMsg({ t: 'sell', id: t.id });
      $('sel-defend').onclick = () => orderAt({ k: 't', id: t.id });
    } else {
      panel.innerHTML = `<h4>${img}${escapeHtml((players.get(t.owner) || { name: '?' }).name)}'s ${d.name}${t.kind === 'barracks' ? '' : ` · Lv ${t.level}`}</h4>
        <div id="sel-info" class="stats"></div>${t.kind === 'trade' && isAlly(t.owner) ? `<div class="stats">${tradeInfo(t)}</div>` : ''}<div class="muted">Right-click it to attack. Destroying it knocks it down for +${C.TOWER_BOUNTY}g; the land stays theirs.</div>`;
    }
  }
  if (ruined) {
    const inLand = terr[t.y * C.MAP_W + t.x] === S.myId;
    $('sel-info').textContent = inLand ? 'Inside your land: rebuild it!' : 'Grow your land over it to rebuild it.';
    $('sel-capture').disabled = !inLand || gold < C.RUIN_CAPTURE_COST;
  } else {
    const garrison = [...S.units.values()].filter((u) => u.owner === t.owner && u.anchor === t.id && !u.attack).length;
    $('sel-info').innerHTML = t.progress < 1
      ? `<div style="grid-column:span 2">🔨 Being built: <b>${Math.round(t.progress * 100)}%</b>${t.owner === S.myId ? ' · your workers put it up' : ''}</div>`
      : `<div>HP <b>${t.hp}/${t.maxHp}</b></div><div>Guards <b>${garrison}</b></div>`;
    if (t.owner === S.myId && t.kind !== 'barracks') $('sel-up').disabled = t.level >= C.maxLevel(t.kind) || gold < C.upgradeCost(t.kind, t.level);
  }
}

export { buildStats, updateHud };
