// The guided first game (the menu's Tutorial): a private game against one easy bot that keeps to
// itself at first, with a guide that walks you through the game a step at a time. Each step
// ticks off when you actually do it; the button or key to use glows, and an arrow on the map
// points at what to click.

import { sendMsg } from './net.js';
import { S, $, C, cam, ctx, players, scale, selUnits, toScreen } from './state.js';
import { playerName } from './lobby.js';
import { play } from './audio.js';

const mySquads = () => (S.me && S.me.squads) || [];
const myBuildings = (kind) => [...S.towers.values()].filter((t) => t.owner === S.myId && t.kind === kind && !t.ruin);
const enemies = () => [...players.values()].filter((p) => p.id !== S.myId && p.hp > 0);
const myTroops = () => [...S.units.values()].filter((u) => u.owner === S.myId && u.kind !== 'worker' && u.kind !== 'caravan');
const nearestCamp = () => {
  const me = players.get(S.myId);
  if (!me) return null;
  return (S.camps || []).filter((c) => c.alive).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0] || null;
};

let start = null; // where the camera was when the tutorial began

// Each step: what to do, how to tell it's done, what to make glow, and (optionally) where on the map to point.
const STEPS = [
  {
    title: 'Your base',
    text: 'The glowing crystal is your <b>core</b>: lose it and you\'re out; destroy your rival\'s to win. Have a look round: <b>drag with the right mouse button</b> or use <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>, and <b>scroll</b> to zoom. <kbd>Space</kbd> brings you back home.',
    done: () => start && (Math.hypot(cam.x - start.x, cam.y - start.y) > 8 || Math.abs(cam.zoom - start.zoom) > 0.15),
  },
  {
    title: 'Grow your land',
    text: 'Land means gold. Press <kbd>L</kbd> (or <b>Build</b> → <b>Land</b>) and <b>drag along the edge of your land</b> to buy the hexes beyond it. Your <b>first 5 hexes are half price</b>. Tip: double-click outside your land to buy a whole ring at once.',
    glow: ['.dock-btn[data-dr="build"]', '#land-button'],
    done: () => ((S.me && S.me.bought) || 0) >= 1,
  },
  {
    title: 'Build a barracks',
    text: 'Your core gives you <b>squad 1</b>: 5 soldiers guarding home (any that fall rejoin one by one; if the whole squad falls, it comes back after a cooldown). To make it bigger, press <kbd>R</kbd> (or <b>Build</b> → <b>Barracks</b>) and click a hex of your land: your first barracks adds <b>5 more troops</b> to squad 1.',
    glow: ['.dock-btn[data-dr="build"]', '#barracks-button'],
    done: () => myBuildings('barracks').length > 0,
  },
  {
    title: 'Workers build it',
    text: 'Your <b>workers</b> (hard hats) are putting it up. Open <b>Workers</b> (<kbd>J</kbd>) to choose how many build, chop wood, mine iron and farm. The icon over each worker shows its job.',
    glow: ['.dock-btn[data-dr="workers"]'],
    progress: () => {
      const b = myBuildings('barracks')[0];
      return b ? b.progress : 0;
    },
    target: () => {
      const b = myBuildings('barracks')[0];
      return b && b.progress < 1 ? { x: b.x + 0.5, y: b.y + 0.5 } : null;
    },
    done: () => myBuildings('barracks').some((b) => b.progress >= 1) && myTroops().length > 0,
  },
  {
    title: 'Pick your squad',
    text: 'Squad 1 now has room for 10 troops (the new ones arrive at the next respawn). <b>Click one of its troops</b> (or press <kbd>1</kbd>) to pick the squad. Its number floats above it.',
    target: () => {
      const list = myTroops();
      if (!list.length) return null;
      return { x: list.reduce((a, u) => a + u.rx, 0) / list.length, y: list.reduce((a, u) => a + u.ry, 0) / list.length - 0.6 };
    },
    done: () => S.selSquads.size > 0 || selUnits.size > 0,
  },
  {
    title: 'Send it somewhere',
    text: 'Now <b>right-click the ground</b> near your border: the squad marches there and forms up in <b>ranks</b> in that hex, soldiers in front. When enemies come near, it pushes up to the edge of its hex to meet them.',
    done: () => mySquads().some((q) => String(q[4]).startsWith('attack p:')),
  },
  {
    title: 'Build a tower',
    text: 'Towers zap enemies that come close and guard the land round them. Press <kbd>B</kbd> (or <b>Build</b> → <b>Tower</b>) and click your land, ideally on the side facing your rival.',
    glow: ['.dock-btn[data-dr="build"]', '#tower-button'],
    done: () => myBuildings('tower').length > 0,
  },
  {
    title: 'Level up your troops',
    text: 'Open <b>Army</b> (<kbd>X</kbd>) and press <b>Level up</b> on soldiers. Level-ups cost gold and <b>iron</b> ⛏, which your workers mine from the rust-red rocks.',
    glow: ['.dock-btn[data-dr="army"]'],
    done: () => S.me && S.me.levels && Object.values(S.me.levels).some((l) => l > 1),
  },
  {
    title: 'Raid a barbarian camp',
    text: 'Barbarian camps pay gold. Pick your squad and <b>right-click the camp</b> the arrow points at. Watch your squad\'s health: fallen troops rejoin one at a time, but if the whole squad is wiped out it takes a while to come back (see the rings by the dock).',
    target: () => {
      const c = nearestCamp();
      return c ? { x: c.x + 0.5, y: c.y + 0.5 } : null;
    },
    done: () => ((S.me && S.me.camps) || 0) > 0,
  },
  {
    title: 'Attack your rival',
    text: 'Ready? <b>Right-click your rival\'s land</b> (the arrow points at their base) to attack: your squad fights its way through their troops and buildings to the core. More barracks mean more squads, and more troops in each.',
    target: () => {
      const e = enemies()[0];
      return e ? { x: e.x + 0.5, y: e.y + 0.5 } : null;
    },
    done: () => mySquads().some((q) => /^attack (c|t):/.test(String(q[4])) && !String(q[4]).endsWith(`c:${S.myId}`)),
  },
  {
    title: 'Win the round',
    text: 'Destroy their <b>core</b> to win. Keep growing your land, add barracks (up to 4 squads), and send <b>workers</b> to build and repair. Stuck? Press <kbd>?</kbd> for every control.',
    target: () => {
      const e = enemies()[0];
      return e ? { x: e.x + 0.5, y: e.y + 0.5 } : null;
    },
    done: () => !enemies().length,
  },
];

let step = 0;
let doneAt = 0; // when the current step was ticked off (it shows a tick for a moment)
let off = false; // the player closed the guide

const active = () => !off && S.myId && S.round && S.round.tutorial;

// Called with the HUD: moves the guide along and shows it.
function updateTutorial() {
  const el = $('tutorial');
  for (const g of document.querySelectorAll('.tut-glow')) g.classList.remove('tut-glow');
  if (!active()) {
    el.classList.add('hidden');
    return;
  }
  if (!start) start = { x: cam.x, y: cam.y, zoom: cam.zoom };
  const now = performance.now();
  if (step < STEPS.length && !doneAt && STEPS[step].done()) {
    doneAt = now;
    play(step === STEPS.length - 1 ? 'fanfare' : 'step');
  }
  if (doneAt && now - doneAt > 1200) {
    doneAt = 0;
    step++;
  }
  el.classList.remove('hidden');
  if (step >= STEPS.length) {
    const key = 'end';
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.innerHTML = `<div class="tut-head">🎓 Tutorial complete</div><p><b>Well played!</b> You know the basics. Press <kbd>?</kbd> any time for every control.</p>
        <div class="tut-foot"><span></span><button class="tut-btn" data-act="menu">Back to the menu</button></div>`;
    }
    return;
  }
  const s = STEPS[step];
  for (const sel of s.glow || []) for (const g of document.querySelectorAll(sel)) g.classList.add('tut-glow');
  const pr = s.progress ? Math.round(s.progress() * 100) : null;
  const key = `${step}:${doneAt ? 1 : 0}:${pr}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = `<div class="tut-head">🎓 Tutorial · step ${step + 1} of ${STEPS.length}<button class="x" data-act="close" data-tip="Close the guide (the game carries on)">×</button></div>
    <h4>${doneAt ? '✓ ' : ''}${s.title}</h4><p>${s.text}</p>
    ${pr !== null ? `<div class="tut-bar"><i style="width:${pr}%"></i></div>` : ''}
    <div class="tut-foot"><span class="dots">${STEPS.map((_, i) => `<i class="${i < step ? 'd' : i === step ? 'c' : ''}"></i>`).join('')}</span>
    <button class="tut-btn skip" data-act="skip">Skip step ›</button></div>`;
  el.classList.toggle('ticked', !!doneAt);
}

// An arrow on the map at what the current step is about (or at the screen's edge, pointing to it).
function drawTutorialArrow() {
  if (!active() || step >= STEPS.length || doneAt) return;
  const t = STEPS[step].target && STEPS[step].target();
  if (!t) return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const [x, y] = toScreen(t.x, t.y);
  const bob = Math.sin(performance.now() / 220) * 5;
  ctx.save();
  ctx.fillStyle = '#f2c14e';
  ctx.strokeStyle = 'rgba(13, 17, 23, 0.9)';
  ctx.lineWidth = 2;
  // (the part of the screen clear of the top bar and the dock)
  const box = { x0: 40, y0: 100, x1: W - 40, y1: H - 200 };
  if (x > box.x0 && y > box.y0 - 30 && x < box.x1 && y < box.y1 + 60) {
    // over it: a bobbing arrow pointing down at it
    const top = y - scale() * 1.3 - 34 + bob;
    ctx.beginPath();
    ctx.moveTo(x, top + 30);
    ctx.lineTo(x - 13, top + 12);
    ctx.lineTo(x - 5, top + 12);
    ctx.lineTo(x - 5, top);
    ctx.lineTo(x + 5, top);
    ctx.lineTo(x + 5, top + 12);
    ctx.lineTo(x + 13, top + 12);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  } else {
    // off screen: at the edge, pointing the way
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const a = Math.atan2(y - cy, x - cx);
    const k = Math.min((box.x1 - box.x0) / 2 / Math.abs(Math.cos(a) || 1e-6), (box.y1 - box.y0) / 2 / Math.abs(Math.sin(a) || 1e-6));
    const ex = cx + Math.cos(a) * (k + bob);
    const ey = cy + Math.sin(a) * (k + bob);
    ctx.translate(ex, ey);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-10, -14);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-10, 14);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }
  ctx.restore();
}

$('tutorial').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'skip') {
    doneAt = 0;
    step++;
  } else if (b.dataset.act === 'close') off = true;
  else if (b.dataset.act === 'menu') location.reload();
  $('tutorial').dataset.key = '';
});

// The menu's Tutorial button: a fresh guided game.
$('tutorial-game').onclick = () => {
  step = 0;
  doneAt = 0;
  off = false;
  start = null;
  sendMsg({ t: 'tutorial', name: playerName() });
};

export { drawTutorialArrow, updateTutorial };
