// Private rooms: creating and joining from the menu, the lobby screen, and invite links.

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
function onRoom(msg) {
  S.room = msg;
  setUrlRoom(msg.code);
  if (msg.phase !== 'lobby') {
    $('lobby').classList.add('hidden');
    return;
  }
  // back in the lobby: drop any game screens
  stopSpectating();
  S.myId = null;
  S.me = null;
  S.queued = false;
  for (const id of ['menu', 'hud', 'death', 'roundover']) $(id).classList.add('hidden');
  $('lobby').classList.remove('hidden');
  $('lobby-err').textContent = '';
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
  const total = msg.members.length + msg.bots;
  $('lobby-start').classList.toggle('hidden', !msg.host);
  $('lobby-start').disabled = total < 2;
  $('lobby-hint').textContent = msg.host
    ? (total < 2 ? 'Add a bot or wait for a friend to join.' : `${total} players: ${msg.members.length} human${msg.members.length === 1 ? '' : 's'} and ${msg.bots} bot${msg.bots === 1 ? '' : 's'}. Start when everyone's in.`)
    : 'Waiting for the host to start the round…';
}

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
if (invited.length === 5) {
  $('code').value = invited;
  $('invite').innerHTML = `You're invited to private room <b>${invited}</b>. Enter your name and press Join.`;
  $('invite').classList.remove('hidden');
  $('join-code').classList.remove('secondary');
}

export { formError, leaveRoom, onLeft, onRoom };
