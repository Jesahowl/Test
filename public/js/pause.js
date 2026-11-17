// The in-game menu: the room (code to share; test mode and its fog switch), sound, Resume, How to
// play, Leave game. Opened with Esc (when there's nothing else to
// cancel) or the ☰ button. It's a multiplayer game, so the round keeps running behind it.

import { sendMsg } from './net.js';
import { S, $ } from './state.js';
import { hideTip } from './ui.js';
import { play, settings, setSetting } from './audio.js';

// Sound settings: three volume sliders and mute all (saved in this browser).
function syncSound() {
  for (const k of ['master', 'music', 'sfx']) {
    $(`snd-${k}`).value = Math.round(settings[k] * 100);
    $(`snd-${k}-v`).textContent = `${Math.round(settings[k] * 100)}%`;
  }
  $('snd-mute').checked = settings.muted;
  $('pause').classList.toggle('muted', settings.muted);
}
for (const k of ['master', 'music', 'sfx']) {
  $(`snd-${k}`).addEventListener('input', (e) => {
    setSetting(k, Number(e.target.value) / 100);
    syncSound();
  });
  if (k !== 'music') $(`snd-${k}`).addEventListener('change', () => play('ok')); // hear the new level
}
$('snd-mute').addEventListener('change', (e) => {
  setSetting('muted', e.target.checked);
  syncSound();
});
syncSound();

function pauseOpen() {
  return !$('pause').classList.contains('hidden');
}

// Which game this is: the room code to share (private rooms), and in test mode its fog switch.
function syncRoom() {
  const r = S.round || {};
  const fog = r.test && r.fog !== false && S.myId
    ? `<button class="test-fog secondary" data-tip="Test mode: show or hide the fog of war (for you only)">🌫 Fog of war: ${S.me && S.me.noFog ? 'off' : 'on'}</button>` : '';
  $('room-info').innerHTML = (r.code ? `<div>🔒 Private room <b class="code">${r.code}</b> <span class="muted">· share the code to invite friends</span></div>` : r.pub ? '<div>🌐 Public game</div>' : '')
    + (r.test ? `<div class="test-row"><span class="test-badge">🛠 TEST</span><span class="muted">gold and wood never run out</span>${fog}</div>` : '');
}
$('room-info').addEventListener('click', (e) => {
  if (!e.target.closest('.test-fog')) return;
  sendMsg({ t: 'fog', on: !!(S.me && S.me.noFog) });
  setTimeout(syncRoom, 300); // (the next snapshot says which way it went)
});

function openPause() {
  if (!S.myId && !S.spectating) return;
  $('pause').classList.remove('hidden');
  syncSound();
  syncRoom();
  hideTip();
  $('pause-resume').focus();
}

function closePause() {
  $('pause').classList.add('hidden');
  if ($('pause').contains(document.activeElement)) document.activeElement.blur(); // keys go back to the game
}

$('pause-resume').onclick = closePause;
$('pause-help').onclick = () => {
  closePause();
  $('help').classList.remove('hidden');
};
$('pause-leave').onclick = () => {
  closePause();
  sendMsg({ t: 'leave' });
};
$('pause').addEventListener('mousedown', (e) => {
  if (e.target === $('pause')) closePause();
});
$('menu-toggle').onclick = openPause;

export { closePause, openPause, pauseOpen, syncSound };
