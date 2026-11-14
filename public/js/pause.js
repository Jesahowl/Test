// The in-game menu: Resume, How to play, Leave game. Opened with Esc (when there's nothing else to
// cancel) or the ☰ button. It's a multiplayer game, so the round keeps running behind it.

import { sendMsg } from './net.js';
import { S, $ } from './state.js';
import { hideTip } from './ui.js';

function pauseOpen() {
  return !$('pause').classList.contains('hidden');
}

function openPause() {
  if (!S.myId && !S.spectating) return;
  $('pause').classList.remove('hidden');
  hideTip();
  $('pause-resume').focus();
}

function closePause() {
  $('pause').classList.add('hidden');
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

export { closePause, openPause, pauseOpen };
