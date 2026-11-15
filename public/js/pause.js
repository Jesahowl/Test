// The in-game menu: Resume, How to play, Leave game. Opened with Esc (when there's nothing else to
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

function openPause() {
  if (!S.myId && !S.spectating) return;
  $('pause').classList.remove('hidden');
  syncSound();
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
