// The in-game menu: Resume, How to play, Leave game. Opened with Esc (when there's nothing else to
// cancel) or the ☰ button. It's a multiplayer game, so the round keeps running behind it.

import { sendMsg } from './net.js';
import { S, $ } from './state.js';
import { hideTip } from './ui.js';

let leaveArmed = false;

function pauseOpen() {
  return !$('pause').classList.contains('hidden');
}

function resetLeave() {
  leaveArmed = false;
  $('pause-leave').textContent = 'Leave game';
  $('pause-note').classList.add('hidden');
}

function openPause() {
  if (!S.myId && !S.spectating) return;
  resetLeave();
  $('pause').classList.remove('hidden');
  hideTip();
  $('pause-resume').focus();
}

function closePause() {
  $('pause').classList.add('hidden');
  resetLeave();
}

$('pause-resume').onclick = closePause;
$('pause-help').onclick = () => {
  closePause();
  $('help').classList.remove('hidden');
};
// Leaving takes a second click: the first says what happens to your base.
$('pause-leave').onclick = () => {
  if (!leaveArmed && S.myId) {
    leaveArmed = true;
    $('pause-leave').textContent = 'Leave: a bot takes over';
    $('pause-note').textContent = 'A bot plays on with your core, land, gold and troops. You go back to the main menu.';
    $('pause-note').classList.remove('hidden');
    return;
  }
  closePause();
  sendMsg({ t: 'leave' });
};
$('pause').addEventListener('mousedown', (e) => {
  if (e.target === $('pause')) closePause();
});
$('menu-toggle').onclick = openPause;

export { closePause, openPause, pauseOpen };
