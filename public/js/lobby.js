// Lobbies: the public lobby players gather in before a game (with its countdown and Ready), private
// rooms (creating and joining by code or invite link), and the menu's list of public games.

import { S, $ } from './state.js';
import { sendMsg } from './net.js';
import { escapeHtml, showMenu, stopSpectating } from './screens.js';

const playerName = () => {
  S.lastName = $('name').value.trim() || 'Player';
  try { localStorage.setItem('ts-name', S.lastName); } catch { /* ignore */ }
  return S.lastName;
};

const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

function inviteUrl(code) {
  return `${location.origin}${location.pathname}?room=${code}`;
}

// Keep the address bar in step, so a refresh (or sharing the URL) leads back to the room.
function setUrlRoom(code) {
  const url = code ? `${location.pathname}?room=${code}` : location.pathname;
  // (remember rooms I've been in: arriving back at one isn't an invitation)
  if (code) {
    try {
      const mine = JSON.parse(localStorage.getItem('ts-my-rooms') || '[]').filter((c) => c !== code);
      localStorage.setItem('ts-my-rooms', JSON.stringify([code, ...mine].slice(0, 10)));
    } catch { /* ignore */ }
  }
  try { history.replaceState(null, '', url); } catch { /* ignore */ }
}

// Show an error on whichever screen is up (the in-game toast is hidden on the menu and lobby).
function formError(text) {
  if (!$('lobby').classList.contains('hidden')) {
    $('lobby-err').textContent = text;
    return true;
  }
  if (!$('menu').classList.contains('hidden')) {
    $('conn').textContent = text;
    $('conn').classList.add('form-err');
    return true;
  }
  return false;
}

// The server's view of my room: lobby (show this screen) or playing (the game takes over).
// A private room's settings: [key, label, [[value, text], ...], what it does].
const RULES = [
  ['difficulty', 'Bot difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], 'Easy bots think slower, earn less and wait for a full army; hard ones are quick, earn 30% more and attack sooner'],
  ['startGold', 'Starting gold', [[100, '100'], [200, '200'], [400, '400'], [800, '800']], 'Gold everyone starts with'],
  ['fortify', 'Peace time', [[0, 'None'], [240, '4 min'], [480, '8 min'], [720, '12 min']], 'Cores take 80% less damage until then, and siege power starts building after it'],
  ['suddenDeath', 'Sudden death', [[780, '13 min'], [1140, '19 min'], [1500, '25 min']], 'When cores start crumbling and troops hit buildings twice as hard: how long rounds last'],
  ['rivers', 'Rivers', [[true, 'On'], [false, 'Off']], 'Rivers across the map, crossed only at bridges'],
  ['fog', 'Fog of war', [[true, 'On'], [false, 'Off']], 'Off: everyone sees the whole map'],
];

function rulesHtml(rules, host) {
  return RULES.map(([key, label, opts, what]) => `<div class="rule"><span class="rl" data-tip="${what}">${label}</span><span class="seg">${opts.map(([v, t]) => `<button class="${rules[key] === v ? 'on' : ''}" data-rule="${key}" data-v='${JSON.stringify(v)}'${host ? '' : ' disabled'}>${t}</button>`).join('')}</span></div>`).join('');
}

$('lobby-rules').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-rule]');
  if (!b || b.disabled || b.classList.contains('on')) return;
  sendMsg({ t: 'rule', key: b.dataset.rule, value: JSON.parse(b.dataset.v) });
});

const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// The public lobby's countdown, ticking locally between the server's updates.
let lobbyTimer = null;
function tickLobby() {
  const r = S.room;
  if (!r || !r.pub || r.phase !== 'lobby' || $('lobby').classList.contains('hidden')) {
    clearInterval(lobbyTimer);
    lobbyTimer = null;
    return;
  }
  const left = r.startAt ? Math.max(0, (r.startAt - performance.now()) / 1000) : null;
  $('lobby-timer').textContent = left === null ? 'Waiting for players…' : left < 0.5 ? 'Starting…' : `Starts in ${fmtClock(Math.ceil(left))}`;
  const full = r.span || 1;
  $('lobby-bar').firstElementChild.style.width = `${left === null ? 0 : Math.max(0, Math.min(100, 100 * (1 - left / full)))}%`;
}

function onRoom(msg) {
  S.room = msg;
  if (msg.pub && msg.startIn !== null) {
    msg.startAt = performance.now() + msg.startIn * 1000;
    msg.span = Math.max(msg.startIn, (S.lastSpan && S.lastSpanRoom === msg.code ? S.lastSpan : 0));
    S.lastSpan = msg.span;
    S.lastSpanRoom = msg.code;
  }
  setUrlRoom(msg.pub ? null : msg.code);
  if (msg.phase !== 'lobby') {
    $('lobby').classList.add('hidden');
    return;
  }
  $('lobby').classList.toggle('pub', !!msg.pub);
  // back in the lobby: drop any game screens
  stopSpectating();
  S.myId = null;
  S.me = null;
  S.queued = false;
  for (const id of ['menu', 'hud', 'death', 'roundover']) $(id).classList.add('hidden');
  $('lobby').classList.remove('hidden');
  $('lobby-err').textContent = '';
  if (msg.pub) {
    onPublicLobby(msg);
    return;
  }
  $('lobby-tag').textContent = '🔒 Private room';
  $('lobby-leave').textContent = 'Leave room';
  $('lobby-code').textContent = msg.code;
  $('lobby-count').textContent = `(${msg.members.length})`;
  $('lobby-last').textContent = msg.round ? (msg.lastWinner ? `Round ${msg.round}: ${msg.lastWinner} won.` : `Round ${msg.round} is over.`) : 'Share the code or the invite link with your friends.';
  $('lobby-members').innerHTML = msg.members.map((m) => `<div class="${m.name === S.lastName ? 'me' : ''}">
    <span>${escapeHtml(m.name)}</span>${m.host ? '<span class="crown">👑 host</span>' : ''}</div>`).join('');
  $('lobby-bots').innerHTML = msg.host
    ? `<button class="secondary" id="bots-less" data-tip="Fewer bots">−</button><b>${msg.bots}</b><button class="secondary" id="bots-more" data-tip="More bots">+</button>`
    : `<b>${msg.bots}</b>`;
  if (msg.host) {
    $('bots-less').onclick = () => sendMsg({ t: 'bots', n: msg.bots - 1 });
    $('bots-more').onclick = () => sendMsg({ t: 'bots', n: msg.bots + 1 });
  }
  $('lobby-rules').innerHTML = rulesHtml(msg.rules || {}, msg.host);
  const total = msg.members.length + msg.bots;
  $('lobby-start').classList.toggle('hidden', !msg.host);
  $('lobby-start').disabled = total < 2;
  $('lobby-hint').textContent = msg.host
    ? (total < 2 ? 'Add a bot or wait for a friend to join.' : `${total} players: ${msg.members.length} human${msg.members.length === 1 ? '' : 's'} and ${msg.bots} bot${msg.bots === 1 ? '' : 's'}. Start when everyone's in.`)
    : 'Waiting for the host to start the round…';
}

// The public lobby: who's here (and ready), the countdown, and how it starts.
function onPublicLobby(msg) {
  $('lobby-tag').textContent = '🌐 Public lobby';
  $('lobby-leave').textContent = 'Leave lobby';
  $('lobby-count').textContent = `${msg.members.length}/${msg.max}`;
  $('lobby-last').textContent = '';
  const empty = Math.max(0, msg.max - msg.members.length);
  $('lobby-members').innerHTML = msg.members.map((m, i) => `<div class="${i === msg.me ? 'me' : ''}">
    <span>${escapeHtml(m.name)}</span><span class="rdy ${m.ready ? 'on' : ''}">${m.ready ? '✓ Ready' : 'not ready'}</span></div>`).join('')
    + (empty ? `<div class="open">${empty} open seat${empty === 1 ? '' : 's'}${msg.bots ? ` · ${Math.min(empty, msg.bots)} filled by bots if nobody joins` : ''}</div>` : '');
  $('lobby-ready').textContent = msg.ready ? '✓ Ready' : 'I\'m ready';
  $('lobby-ready').dataset.tip = msg.ready ? 'Click to take it back' : 'When everyone is ready, the game starts in a few seconds';
  $('lobby-ready').classList.toggle('secondary', msg.ready);
  const n = msg.members.length;
  $('lobby-hint').innerHTML = n >= msg.max ? 'The lobby is full: starting!'
    : n === 1 ? `Waiting for others to join. The game starts when the timer runs out, with bots in the empty seats. <b>Ready</b> starts it sooner.`
      : `Starts when the timer runs out, the lobby fills up (${msg.max}), or <b>everyone is ready</b>.`;
  tickLobby();
  if (!lobbyTimer) lobbyTimer = setInterval(tickLobby, 200);
}

$('lobby-ready').onclick = () => sendMsg({ t: 'ready', on: !(S.room && S.room.ready) });

// ---- the menu's list of public games (asked for every few seconds while the menu is up)
function onPublicList(msg) {
  const rows = [];
  for (const l of msg.lobbies) {
    rows.push(`<div class="pub-row"><span class="st lobby">Gathering</span><span class="who">${l.players}/${l.max} players</span>
      <span class="when">${l.startIn === null ? '' : `starts in ${fmtClock(Math.ceil(l.startIn))}`}</span><button data-join="${l.code}">Join</button></div>`);
  }
  for (const g of msg.games) {
    rows.push(`<div class="pub-row"><span class="st live">In progress</span><span class="who">${g.players} player${g.players === 1 ? '' : 's'} · ${g.alive} cores left</span>
      <span class="when">${fmtClock(g.time)}</span><button class="secondary" data-watch="${g.code}">👁 Watch</button></div>`);
  }
  $('pub-rows').innerHTML = rows.length ? rows.join('') : '<div class="muted pub-empty">No games yet: press <b>Play</b> to open a lobby.</div>';
  const online = msg.lobbies.reduce((n, l) => n + l.players, 0) + msg.games.reduce((n, g) => n + g.players, 0);
  $('pub-online').textContent = online ? `${online} playing` : '';
}

$('pub-rows').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.join) sendMsg({ t: 'join', name: playerName(), room: b.dataset.join });
  else if (b.dataset.watch) sendMsg({ t: 'watch', name: playerName(), room: b.dataset.watch });
});

setInterval(() => {
  if (!$('menu').classList.contains('hidden')) sendMsg({ t: 'list' });
}, 2500);

function onLeft() {
  S.room = null;
  setUrlRoom(null);
  $('lobby').classList.add('hidden');
  stopSpectating();
  S.myId = null;
  showMenu();
}

function leaveRoom() {
  sendMsg({ t: 'leave' });
}

// ---- menu buttons
$('create').onclick = () => sendMsg({ t: 'create', name: playerName() });
$('test-game').onclick = () => sendMsg({ t: 'test', name: playerName() }); // (unless the server turned test mode off)
const joinByCode = () => {
  const code = cleanCode($('code').value);
  if (code.length !== 5) {
    formError('Room codes have 5 letters/numbers');
    return;
  }
  sendMsg({ t: 'join', name: playerName(), room: code });
};
$('join-code').onclick = joinByCode;
$('code').addEventListener('input', () => { $('code').value = cleanCode($('code').value); });
$('code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinByCode();
});

// ---- lobby buttons
$('lobby-leave').onclick = leaveRoom;
$('lobby-start').onclick = () => sendMsg({ t: 'start' });
$('copy-link').onclick = async () => {
  const url = inviteUrl(S.room.code);
  try {
    await navigator.clipboard.writeText(url);
    $('copy-link').textContent = '✓ Link copied';
  } catch {
    $('copy-link').textContent = url; // no clipboard access: show it to copy by hand
  }
  setTimeout(() => { $('copy-link').textContent = '🔗 Copy invite link'; }, 2500);
};

// ---- arriving through an invite link (?room=CODE)
const invited = cleanCode(new URLSearchParams(location.search).get('room'));
let myRoom = false;
try { myRoom = JSON.parse(localStorage.getItem('ts-my-rooms') || '[]').includes(invited); } catch { /* ignore */ }
if (invited.length === 5 && myRoom) {
  $('code').value = invited; // (back at a room of my own, e.g. after a refresh: just the code, no invitation)
} else if (invited.length === 5) {
  $('code').value = invited;
  $('invite').innerHTML = `You're invited to private room <b>${invited}</b>. Enter your name and press Join.`;
  $('invite').classList.remove('hidden');
  $('join-code').classList.remove('secondary');
}

// ---- the menu card fits the window with no scroll bar: when it's taller than the window, it
// first drops the how-to cards (they're in the ? window too), then scales down a little.
function fitMenu() {
  const card = document.querySelector('.menu-card');
  if (!card) return;
  card.style.zoom = '';
  card.classList.remove('short');
  const room = window.innerHeight * 0.94;
  if (card.scrollHeight <= room) return;
  card.classList.add('short');
  if (card.scrollHeight <= room) return;
  card.style.zoom = String(Math.max(0.7, room / card.scrollHeight));
}
window.addEventListener('resize', fitMenu);
if (window.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(fitMenu)).observe(document.querySelector('.menu-card'));
fitMenu();

export { formError, leaveRoom, onLeft, onPublicList, onRoom, playerName };
