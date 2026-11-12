// HUD panels: player card, wave info, leaderboard, feed and selection panel.

import { orderAt, updateShareUi } from './bar.js';
import { sendMsg } from './net.js';
import { escapeHtml, updateRound } from './screens.js';
import { S, $, C, colorOf, feed, players, selUnits, terr, UNIT_KEYS } from './state.js';
import { targetName } from './targets.js';
import { updateTips } from './tips.js';
import { iconURL, refreshTip } from './ui.js';

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
  const myTroops = [...S.units.values()].filter((u) => u.owner === S.myId).reduce((n, u) => n + C.slotsOf(u.kind), 0);
  const perWave = S.me.waveSize;
  updateRound();
  updateStats(p, gold, rank, sorted.length);

  // wave: size, countdown ring, slot strip
  $('wave-size').textContent = `${perWave} troops every ${C.WAVE_INTERVAL}s`;
  const frac = Math.max(0, Math.min(1, S.me.nextWave / C.WAVE_INTERVAL));
  $('wave-timer').innerHTML = `<svg viewBox="0 0 26 26"><circle cx="13" cy="13" r="11" fill="none" stroke="#273041" stroke-width="3"/>
    <circle cx="13" cy="13" r="11" fill="none" stroke="#ffd54f" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(69.1 * (1 - frac)).toFixed(1)} 69.1"/></svg><span>${S.me.nextWave}</span>`;
  $('wave-timer').dataset.tip = `<span class="t">Next wave in ${S.me.nextWave}s</span>Every ${C.WAVE_INTERVAL} seconds your core (and each barracks) sends out a free wave.`;
  const list = waveListOf(S.me);
  const assignedOf = { ...S.me.army };
  const slotKey = list.join(',') + JSON.stringify(S.me.army);
  if ($('slots').dataset.key !== slotKey) {
    $('slots').dataset.key = slotKey;
    $('slots').innerHTML = list.map((k) => {
      const auto = !(assignedOf[k] > 0);
      if (!auto) assignedOf[k]--;
      return `<i class="${auto ? 'auto' : ''}" style="flex-grow:${C.slotsOf(k)};background:${C.UNITS[k].color}"></i>`;
    }).join('');
  }
  const cap = C.unitCap(p.territory, perWave);
  $('alive').innerHTML = `Troops alive <b>${myTroops}</b> / ${cap}`;

  const o = S.me.order;
  const orderHtml = o.type === 'attack' && o.target.startsWith('p:')
    ? `<span class="atk">🚩 Waves gathering at a rally point</span><span class="hint">press H to bring them home</span>`
    : o.type === 'attack'
    ? `<span class="atk">⚔ Waves attacking ${escapeHtml(targetName(o.target))}</span><span class="hint">press H to bring them home</span>`
    : `<span class="def">🛡 Waves defending ${escapeHtml(targetName(o.target))}</span><span class="hint">right-click an enemy to attack</span>`;
  if ($('order-info').dataset.html !== orderHtml) {
    $('order-info').dataset.html = orderHtml;
    $('order-info').innerHTML = orderHtml;
  }

  updateBoards();
  updateTowerAndArmy(gold, perWave);
  updateSelectionPanel(gold);
  updateTips();
  refreshTip();
}

// The player card (built once; numbers updated in place so tooltips keep working).
function buildStats() {
  $('stats').innerHTML = `
    <div class="who"><span class="dot"></span><span class="name"></span><span class="rank" data-tip="Your place on the land leaderboard"></span></div>
    <div class="gold-row" data-tip="<span class='t'>Gold</span>Earned from land (a trickle) and mostly from fighting: troop kills, jungle camps, towers and cores. Spend it on towers, barracks and troop levels.">
      <span class="coin"></span><span class="gold"></span><span class="income"></span></div>
    <div class="chips">
      <span class="chip land" data-tip="Tiles you own. More land = more income and room for more troops.">🗺 <b></b> land</span>
      <span class="chip kills" data-tip="Enemy troops and monsters your side has killed">⚔ <b></b> kills</span>
      <span class="chip shield hidden" data-tip="Spawn protection: your core and buildings can't be damaged yet">🛡 <b></b></span>
      <span class="chip buff hidden" data-tip="Buff from defeating a barbarian Warlord: your troops deal +${Math.round(C.JUNGLE_BUFF_DAMAGE * 100)}% damage and take ${Math.round(C.JUNGLE_BUFF_ARMOR * 100)}% less">🔥 <b></b></span>
    </div>
    <div class="meter" data-tip="Your core. If it falls, you're out of the round and whoever broke it takes your gold and troops."><i></i><span></span></div>`;
}

function updateStats(p, gold, rank, n) {
  const el = $('stats');
  el.querySelector('.who .dot').style.background = colorOf(p.id, 55);
  el.querySelector('.who .name').textContent = p.name;
  el.querySelector('.who .rank').textContent = `#${rank} of ${n}`;
  el.querySelector('.gold').textContent = gold.toLocaleString();
  el.querySelector('.income').textContent = `+${C.income(p.territory).toFixed(1)}/s`;
  el.querySelector('.chip.land b').textContent = p.territory;
  el.querySelector('.chip.kills b').textContent = p.kills;
  const sh = el.querySelector('.chip.shield');
  sh.classList.toggle('hidden', !p.shield);
  sh.querySelector('b').textContent = `Protected ${p.shield}s`;
  const bf = el.querySelector('.chip.buff');
  bf.classList.toggle('hidden', !p.buff);
  bf.querySelector('b').textContent = `Empowered ${p.buff}s`;
  const frac = p.hp / p.maxHp;
  const bar = el.querySelector('.meter i');
  bar.style.width = `${100 * frac}%`;
  bar.className = frac > 0.5 ? '' : frac > 0.25 ? 'mid' : 'low';
  el.querySelector('.meter span').textContent = `Core ${p.hp.toLocaleString()} / ${p.maxHp.toLocaleString()}`;
}

// Leaderboard and kill feed (shown to players and spectators).
function updateBoards() {
  const sorted = [...players.values()].sort((a, b) => b.territory - a.territory);
  const focus = S.spectating ? S.specTarget : S.myId;
  const top = Math.max(1, ...sorted.map((q) => q.territory));
  $('leaderboard').innerHTML = `<h3><span>Players</span><span>land</span></h3>` + sorted.slice(0, 10).map((q, i) =>
    `<div class="row${q.id === focus ? ' me' : ''}"><span class="bg" style="width:${(100 * q.territory) / top}%;background:${colorOf(q.id, 55)}"></span>`
    + `<span class="pos">${i + 1}</span><span class="dot" style="background:${colorOf(q.id, 55)}"></span>`
    + `<span class="n">${escapeHtml(q.name)}${q.isBot ? ' <span class="muted">· bot</span>' : ''}${q.buff ? ' 🔥' : ''}${q.shield ? ' 🛡' : ''}</span><span class="v">${q.territory}</span></div>`).join('');
  const now = performance.now();
  $('feed').innerHTML = feed.filter((f) => now - f.born < 9000).map((f) =>
    `<div style="opacity:${Math.min(1, (9000 - (now - f.born)) / 1500)}">${escapeHtml(f.text)}</div>`).join('');
}

// Same as the server's waveList: assigned slots, then guards/archers.
function waveListOf(m) {
  const list = [];
  let used = 0;
  for (const kind of UNIT_KEYS) {
    for (let i = 0; i < m.army[kind] && used + C.slotsOf(kind) <= m.waveSize; i++) {
      list.push(kind);
      used += C.slotsOf(kind);
    }
  }
  for (; used < m.waveSize; used++) list.push('soldier');
  return list;
}

// Tower button, send-% buttons and the army panel.
function updateTowerAndArmy(gold, perWave) {
  updateShareUi();
  const tb = $('tower-button');
  tb.classList.toggle('active', S.buildKind === 'tower');
  tb.classList.toggle('poor', gold < C.TOWERS.tower.cost);
  const bb = $('barracks-button');
  const owned = [...S.towers.values()].filter((t) => t.owner === S.myId && t.kind === 'barracks').length;
  const bCost = C.buildCost('barracks', owned);
  const maxed = owned >= C.MAX_BARRACKS;
  bb.classList.toggle('active', S.buildKind === 'barracks');
  bb.classList.toggle('poor', maxed || gold < bCost);
  const costEl = bb.querySelector('.cost');
  costEl.textContent = maxed ? 'max' : `${bCost}g`;
  costEl.classList.toggle('max', maxed);
  bb.querySelector('.count').textContent = `${owned}/${C.MAX_BARRACKS}`;
  // Troop cards: how many per wave, how many were picked vs auto-filled, level and its price.
  const assigned = UNIT_KEYS.reduce((n, k) => n + S.me.army[k] * C.slotsOf(k), 0);
  const list = waveListOf(S.me);
  for (const card of document.querySelectorAll('#army .troop')) {
    const kind = card.dataset.kind;
    const n = list.filter((k) => k === kind).length;
    const set = S.me.army[kind];
    const lvl = S.me.levels[kind];
    const upCost = lvl < C.MAX_LEVEL ? C.armyLevelCost(kind, lvl) : 0;
    card.classList.toggle('off', n === 0);
    card.querySelector('.lvl').textContent = `Lv ${lvl}`;
    const slots = C.slotsOf(kind);
    const auto = Math.max(0, n - set);
    const html = n
      ? `<b>×${n}</b> <span class="muted">${auto ? (auto === n ? 'auto-filled' : `· ${auto} auto`) : 'per wave'}</span>`
      : slots > 1 ? `none · ${slots} slots each` : 'none in waves';
    const countEl = card.querySelector('.count');
    if (countEl.innerHTML !== html) countEl.innerHTML = html;
    card.querySelector('.add').disabled = assigned + slots > S.me.waveSize;
    const up = card.querySelector('.up');
    up.textContent = lvl < C.MAX_LEVEL ? `▲ ${upCost}g` : 'MAX';
    up.disabled = lvl >= C.MAX_LEVEL || gold < upCost;
    const s1 = C.towerStats(kind, lvl);
    const s2 = lvl < C.MAX_LEVEL ? C.towerStats(kind, lvl + 1) : null;
    up.dataset.tip = s2
      ? `<span class="t">Level ${C.UNITS[kind].name}s up to ${lvl + 1}: ${upCost}g</span>HP ${s1.hp} → <b>${s2.hp}</b>${s1.damage ? ` · damage ${Math.round(s1.damage)} → <b>${Math.round(s2.damage)}</b>` : ''}${s1.heal ? ` · healing ${Math.round(s1.heal)} → <b>${Math.round(s2.heal)}</b>` : ''}<br><span class="m">Applies to troops from the next wave. <kbd>Shift</kbd>+<kbd>${C.UNITS[kind].key}</kbd></span>`
      : 'Max level';
    card.querySelector('.rem').disabled = set === 0;
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
      panel.innerHTML = `<h4><img src="${iconURL(first)}" alt="">${list.length} troop${list.length === 1 ? '' : 's'} selected</h4>
        <div class="muted">${Object.entries(counts).map(([k, c]) => `${c}× ${C.UNITS[k].name}`).join(' · ')}</div>
        <div id="sel-info" class="stats"></div>
        <div class="muted">Right-click a target to command just these. <kbd>Esc</kbd> to deselect.</div>`;
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
  const t = S.selectedId && S.towers.get(S.selectedId);
  if (!t) {
    panel.classList.add('hidden');
    panel.dataset.key = '';
    return;
  }
  panel.classList.remove('hidden');
  const d = C.TOWERS[t.kind];
  const ruined = t.ruin || !t.owner;
  const key = `${t.id}:${t.level}:${t.owner}`;
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
      const next = !maxed ? C.towerStats(t.kind, t.level + 1) : null;
      panel.innerHTML = `<h4>${img}Your ${d.name}${isB ? '' : ` · Lv ${t.level}`}</h4>
        <div id="sel-info" class="stats"></div>
        <div class="stats">${isB
          ? `<div style="grid-column:span 2">+<b>${C.BARRACKS_TROOPS}</b> troops every wave, from here</div>`
          : `<div>Damage <b>${st.damage.toFixed(0)}/s</b></div><div>Range <b>${st.range}</b></div>`}<div>Claims <b>${st.claim}</b></div><div>Sight <b>${C.structSight(t.kind, t.level)}</b></div></div>
        <div class="btns">
          ${isB ? '' : `<button id="sel-up" class="primary" data-tip="${next ? `Level ${t.level + 1}: damage ${Math.round(next.damage)}, range ${next.range}, claims ${next.claim}, ${next.hp} HP <kbd>U</kbd>` : 'Max level'}">${maxed ? 'Max level' : `▲ Upgrade ${C.upgradeCost(t.kind, t.level)}g`}</button>`}
          <button id="sel-sell" data-tip="Sell for ${C.sellValue(t.kind, t.level)}g. Its land goes too. <kbd>Del</kbd>">Sell +${C.sellValue(t.kind, t.level)}g</button>
        </div>
        <div class="btns"><button id="sel-defend">🛡 Defend here</button></div>`;
      if (!isB) $('sel-up').onclick = () => sendMsg({ t: 'upgrade', id: t.id });
      $('sel-sell').onclick = () => sendMsg({ t: 'sell', id: t.id });
      $('sel-defend').onclick = () => orderAt({ k: 't', id: t.id });
    } else {
      panel.innerHTML = `<h4>${img}${escapeHtml((players.get(t.owner) || { name: '?' }).name)}'s ${d.name}${t.kind === 'barracks' ? '' : ` · Lv ${t.level}`}</h4>
        <div id="sel-info" class="stats"></div><div class="muted">Right-click it to attack. Destroy it and it becomes yours.</div>`;
    }
  }
  if (ruined) {
    const inLand = terr[t.y * C.MAP_W + t.x] === S.myId;
    $('sel-info').textContent = inLand ? 'Inside your land: rebuild it!' : 'Grow your land over it to rebuild it.';
    $('sel-capture').disabled = !inLand || gold < C.RUIN_CAPTURE_COST;
  } else {
    const garrison = [...S.units.values()].filter((u) => u.owner === t.owner && u.anchor === t.id && !u.attack).length;
    $('sel-info').innerHTML = `<div>HP <b>${t.hp}/${t.maxHp}</b></div><div>Guards <b>${garrison}</b></div>`;
    if (t.owner === S.myId && t.kind !== 'barracks') $('sel-up').disabled = t.level >= C.maxLevel(t.kind) || gold < C.upgradeCost(t.kind, t.level);
  }
}

export { buildStats, updateHud };
