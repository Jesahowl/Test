// Screens and overlays: toasts, menu, death screen, round banner and scoreboard, spectating.

import { sendMsg } from './net.js';
import { clearSelection } from './overlay.js';
import { S, $, C, players } from './state.js';

let toastTimer = null;

function toast(text, good = false) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('good', good);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showMenu() {
  $('hud').classList.add('hidden');
  $('death').classList.add('hidden');
  $('lobby').classList.add('hidden');
  $('roundover').classList.add('hidden');
  $('conn').classList.remove('form-err');
  $('menu').classList.remove('hidden');
}

function showDeath(info) {
  $('hud').classList.add('hidden');
  $('death').classList.remove('hidden');
  S.lastKiller = info.killerId || 0;
  // With no other people left in the round, a new one starts straight away.
  // In a private room you go back to the lobby when the round ends (or can leave now).
  $('again').textContent = info.priv ? 'Leave room' : info.humansAlive ? 'Join next round' : 'New round';
  $('death-by').textContent = info.killer ? `Destroyed by ${info.killer}` : 'Your core fell';
  $('death-spoils').textContent = info.killer
    ? `${info.killer} took your ${info.goldTaken}g, ${info.troopsTaken} surviving troop${info.troopsTaken === 1 ? '' : 's'}, and turned your core into a tower.`
    : '';
  const mins = Math.floor(info.survived / 60);
  const secs = String(info.survived % 60).padStart(2, '0');
  $('death-stats').innerHTML = `
    <div><b>${mins}:${secs}</b><span>survived</span></div>
    <div><b>${info.peakTerritory}</b><span>peak land</span></div>
    <div><b>${info.kills}</b><span>kills</span></div>
    <div><b>${(info.towersDestroyed || 0) + info.coresDestroyed}</b><span>buildings taken</span></div>`;
  const e = info.earned || {};
  const total = Object.values(e).reduce((a, b) => a + b, 0);
  const parts = [['troops', 'troop kills', '#ff7b72'], ['camps', 'jungle', '#d7a86e'], ['towers', 'towers', '#ffd54f'], ['cores', 'cores', '#d2a8ff'], ['income', 'land', '#3fb950']]
    .filter(([k]) => e[k]);
  $('death-gold').innerHTML = total ? `<b>${total.toLocaleString()}g earned</b>
    <div class="gbar">${parts.map(([k, , c]) => `<i style="width:${(100 * e[k]) / total}%;background:${c}"></i>`).join('')}</div>
    <div class="legend">${parts.map(([k, name, c]) => `<span><i style="background:${c}"></i>${name} ${Math.round((100 * e[k]) / total)}%</span>`).join('')}</div>` : '';
}

S.lastKiller = 0;

const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`;

// Round banner: cores left, round clock, join window / sudden death.
function updateRound() {
  const el = $('round');
  if (!S.round) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  let sub = '';
  if (S.round.join > 0) sub = `<div class="sub">Joining open for ${fmtTime(S.round.join)} · last core standing wins</div>`;
  else if (S.round.t < C.CORE_FORTIFY_TIME) sub = `<div class="sub">🛡 Cores fortified for ${fmtTime(C.CORE_FORTIFY_TIME - S.round.t)} (${Math.round(C.CORE_FORTIFY * 100)}% less damage)</div>`;
  else if (S.round.t >= C.SIEGE_RAMP_START && S.round.sd > 120) sub = `<div class="sub">⚔ Siege power ×${(1 + (S.round.t - C.SIEGE_RAMP_START) / 60 * C.SIEGE_RAMP_PER_MIN).toFixed(1)} · sudden death in ${fmtTime(S.round.sd)}</div>`;
  else if (S.round.sd <= 0) sub = '<div class="sd">☠ Sudden death: cores crumble · troops hit buildings ×2 · no home turf</div>';
  else if (S.round.sd <= 120) sub = `<div class="sd">Sudden death in ${fmtTime(S.round.sd)}</div>`;
  el.innerHTML = `${S.round.code ? `🔒 Room <b>${S.round.code}</b> · ` : ''}Round <b>${S.round.n}</b> · <b>${players.size}</b> core${players.size === 1 ? '' : 's'} left · ${fmtTime(S.round.t)}${sub}`;
}

let roundTimer = null;

function showRoundOver(msg) {
  if (!S.myId && !S.spectating && !S.queued && $('death').classList.contains('hidden')) return; // still on the menu
  $('death').classList.add('hidden');
  const w = msg.winner;
  $('ro-title').textContent = !w ? `Round ${msg.round} is over` : w.id === S.myId ? 'Victory! You are the last core standing' : `${w.name} wins round ${msg.round}`;
  $('ro-sub').textContent = w ? 'Last core standing' : 'No cores survived';
  const rows = msg.standings.map((r) => `<tr class="${r.id === S.myId ? 'me' : ''}${r.place === 1 ? ' win' : ''}">
    <td>${r.left ? '–' : r.place === 1 ? '🏆' : `#${r.place}`}</td>
    <td class="n"><span class="dot" style="background:hsl(${r.hue},75%,55%)"></span>${escapeHtml(r.name)}${r.isBot ? ' 🤖' : ''}${r.left ? ' <span style="color:#8b949e">(left)</span>' : ''}</td>
    <td>${fmtTime(r.survived)}</td><td>${r.coresDestroyed}</td><td>${r.towersDestroyed}</td><td>${r.kills}</td><td>${r.gold}g</td></tr>`).join('');
  $('ro-table').innerHTML = `<tr><th></th><th class="n">Player</th><th>Lasted</th><th>Cores</th><th>Towers</th><th>Kills</th><th>Gold</th></tr>${rows}`;
  $('roundover').classList.remove('hidden');
  let left = msg.next;
  const tick = () => {
    $('ro-next').textContent = msg.priv
      ? (left > 0 ? `Back to the lobby in ${left}s…` : 'Back to the lobby…')
      : (left > 0 ? `Next round starts in ${left}s on a fresh map…` : 'Starting…');
    left--;
  };
  tick();
  clearInterval(roundTimer);
  roundTimer = setInterval(() => {
    if ($('roundover').classList.contains('hidden')) clearInterval(roundTimer);
    else tick();
  }, 1000);
}

function startSpectating() {
  S.spectating = true;
  $('menu').classList.add('hidden');
  clearSelection();
  S.buildKind = null;
  S.specTarget = players.has(S.lastKiller) ? S.lastKiller : 0;
  S.specFollow = true;
  $('death').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('hud').classList.add('spectating');
}

function stopSpectating() {
  S.spectating = false;
  $('hud').classList.remove('spectating');
}

// Follow the next player on the leaderboard (Tab).
function specNext() {
  const list = [...players.values()].sort((a, b) => b.territory - a.territory);
  if (!list.length) return;
  const i = list.findIndex((p) => p.id === S.specTarget);
  S.specTarget = list[(i + 1) % list.length].id;
  S.specFollow = true;
}

function join() {
  S.lastName = $('name').value.trim() || 'Player';
  try { localStorage.setItem('ts-name', S.lastName); } catch { /* ignore */ }
  sendMsg({ t: 'join', name: S.lastName });
}

export { escapeHtml, join, showDeath, showMenu, showRoundOver, specNext, startSpectating, stopSpectating, toast, updateRound };
