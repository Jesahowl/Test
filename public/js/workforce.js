// Workers, the easy way: the Workers drawer (plans, who's doing what, exact counts under
// "Customise", switches, the build queue), job icons over your workers (idle ones pulse), "." to jump to the next idle worker,
// a card when hovering a forest or ore deposit (who's on it, how long it lasts), dragging a box
// round workers to pick them, and the "workers fall back" warning.

import { sendMsg } from './net.js';
import { toast } from './screens.js';
import { S, $, C, HEX, cam, ctx, hexSpot, mouse, scale, toScreen, toWorld } from './state.js';
import { touchOnly } from './touch.js';
import { tipDone } from './tips.js';

// [job, icon, name, what] in the server's order (C.WORKER_JOBS); job codes as the server sends them
const JOBS = {
  build: ['🔨', 'Build', 'Put up the building sites and walls you place'],
  repair: ['🔧', 'Repair', `Fix damaged buildings, walls and your core once the fighting there is over (${C.REPAIR_GOLD_PER_HP}g per HP)`],
  gather: ['🪓', 'Chop wood', 'Chop forests (the nearest first) and carry the wood to your core or a workshop. Spare workers chop wood too'],
  mine: ['⛏', 'Mine iron', 'Mine iron ore deposits (rust-red rocks), the nearest first, and carry the iron home. Troop level-ups need iron'],
  farm: ['🌾', 'Farm', `Work open hexes of your land: +${C.FARM_GOLD}g/s each, or a gold vein on your land: +${C.VEIN_GOLD}g/s each (veins first)`],
  scout: ['🔭', 'Scout', `Explore the fog: fast, seeing ${C.SCOUT_SIGHT} tiles, keeping clear of enemy guns (at most ${C.SCOUT_WORKERS})`],
};
const CODE = { build: 1, repair: 2, gather: 3, farm: 4, scout: 5, mine: 6 };
const ICON_BY_CODE = ['', '🔨', '🔧', '🪓', '🌾', '🔭', '⛏'];
const COL_BY_CODE = ['#f2c14e', '#f2c14e', '#58a6ff', '#7ee787', '#e3b341', '#d2a8ff', '#d6894e'];
// one click sets every job
// [key, label, one line on the card, tooltip, jobs]
const PRESETS = [
  ['eco', '⚒ Economy', 'chop wood and mine iron', 'Build and repair, then 3 chop wood, 2 mine iron and 1 farms', { build: 1, repair: 1, gather: 3, mine: 2, farm: 1, scout: 0 }],
  ['build', '🏗 Build up', 'everyone on building sites', 'Everyone builds while there are sites; otherwise they chop wood', { build: 1, repair: 1, gather: 1, mine: 0, farm: 0, scout: 0 }],
  ['repair', '🛠 Fix up', 'everyone repairing damage', 'Everyone repairs damage once the fighting stops; otherwise they chop wood', { build: 0, repair: 1, gather: 1, mine: 0, farm: 0, scout: 0 }],
  ['farm', '🌾 Farm', 'work your land for gold', 'Build and repair, then 4 farm gold and the rest chop wood', { build: 1, repair: 1, gather: 1, mine: 0, farm: 4, scout: 0 }],
];
// (the exact count per job opens under "Customise"; remembered in this browser)
let custom = false;
try { custom = localStorage.getItem('ts-wcustom') === '1'; } catch { /* ignore */ }
const DOING = { build: 'building', repair: 'repairing', gather: 'chopping', mine: 'mining', farm: 'farming', scout: 'scouting' };

const plan = () => {
  const w = (S.me && S.me.workers) || [0, [0, 0, 0, 0, 0, 0], 1, 0, []];
  const jobs = {};
  C.WORKER_JOBS.forEach((j, i) => { jobs[j] = w[1][i] || 0; });
  return { cap: w[0], jobs, flee: !!w[2], keep: !!w[3], order: w[4] || [] };
};
const myWorkers = () => [...S.units.values()].filter((u) => u.owner === S.myId && u.kind === 'worker');

// ---- the drawer

// My building sites, in the order they'll be built (the build order first, then the rest).
function mySites(order) {
  const sites = [...S.towers.values()].filter((t) => t.owner === S.myId && t.progress < 1 && !t.ruin);
  const pos = (t) => (order.includes(t.id) ? order.indexOf(t.id) : 1000 + t.id);
  return sites.sort((a, b) => pos(a) - pos(b));
}
const SITE_ICON = { tower: '🗼', barracks: '🏰', trade: '🏪', workshop: '🛠' };

let bound = false;
function updateWorkersPanel() {
  const { cap, jobs, flee, keep, order } = plan();
  const mine = myWorkers();
  const busy = [0, 0, 0, 0, 0, 0, 0];
  for (const u of mine) busy[u.job]++;
  const idle = busy[0];
  $('workers-badge').textContent = idle && mine.length ? String(idle) : '';
  $('workers-badge').dataset.tip = `${idle} idle worker${idle === 1 ? '' : 's'}: press <kbd>.</kbd> to jump to the next`;
  if (S.drawer !== 'workers') return;
  const hint = `${mine.length} / ${cap} · +${C.WORKSHOP_WORKERS} per workshop`;
  if ($('workers-hint').textContent !== hint) $('workers-hint').textContent = hint;
  const sites = mySites(order);
  const onSite = (t) => {
    const at = hexSpot(t.x, t.y);
    return mine.filter((u) => u.job === CODE.build && Math.hypot(u.rx - at.x, u.ry - at.y) < 2.6).length;
  };
  const box = $('jobs');
  const key = JSON.stringify([jobs, flee, keep, busy, custom, sites.map((t) => [t.id, Math.round(t.progress * 20), onSite(t)])]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const cur = PRESETS.find(([, , , , p]) => C.WORKER_JOBS.every((jb) => p[jb] === jobs[jb]));
  const row = (job) => {
    const [ic, name, what] = JOBS[job];
    const n = busy[CODE[job]];
    const ctl = job === 'build'
      ? `<button class="tg ${jobs.build ? 'on' : ''}" data-act="build">${jobs.build ? 'All free hands' : 'Off'}</button>`
      : `<span class="step"><button data-act="cnt" data-job="${job}" data-d="-1" ${jobs[job] ? '' : 'disabled'}>−</button><b>${jobs[job]}</b><button data-act="cnt" data-job="${job}" data-d="1">+</button></span>`;
    return `<div class="wrow" data-tip="<span class='t'>${name}</span>${what}"><span class="ic">${ic}</span><b>${name}</b><span class="nw">${n} working</span>${ctl}</div>`;
  };
  // who's doing what, in one line
  const doing = C.WORKER_JOBS.filter((jb) => busy[CODE[jb]]).map((jb) => `<span>${JOBS[jb][0]} <b>${busy[CODE[jb]]}</b> ${DOING[jb]}</span>`).join('')
    || '<span class="muted">nobody at work yet</span>';
  const how = touchOnly ? 'Tap a worker, then press &amp; hold a site, forest or ore to send it there.' : 'Pick a worker and right-click a site, forest or ore to send it there.';
  box.innerHTML = `
    <div class="presets">${PRESETS.map(([k, label, line, what]) => `<button data-act="preset" data-p="${k}" class="${cur && cur[0] === k ? 'on' : ''}" data-tip="${what}"><b>${label}</b><span>${line}</span></button>`).join('')}</div>
    <div class="doing">${doing}${idle ? `<button class="idlepill" data-act="idle" data-tip="Jump to the next idle worker <kbd>.</kbd>">Zz ${idle} idle · jump <kbd>.</kbd></button>` : ''}<button class="cust" data-act="custom">${custom ? 'Customise ▾' : 'Customise ▸'}</button></div>
    ${custom ? ['build', 'gather', 'mine', 'farm', 'scout'].map(row).join('') : ''}
    <div class="switches">
      <button class="sw ${flee ? 'on' : ''}" data-act="sw" data-sw="flee" data-tip="Workers run back to your core when enemy troops come close, then go back to work"><i></i>Run from raiders</button>
      <button class="sw ${jobs.repair ? 'on' : ''}" data-act="sw" data-sw="repair" data-tip="${JOBS.repair[2]}"><i></i>Repair damage</button>
      <button class="sw ${keep ? 'on' : ''}" data-act="sw" data-sw="keep" data-tip="Leave the forests near your core standing (cover, and wood for later)"><i></i>Keep forests near the core</button>
    </div>
    ${sites.length ? `<div class="bq"><div class="bq-head"><span>Build queue${sites.length > 1 ? ' · drag to reorder' : ''}</span><span>${sites.length} site${sites.length === 1 ? '' : 's'}</span></div>
      ${sites.map((t, i) => `<div class="qi" draggable="true" data-id="${t.id}"><span class="h">⋮⋮</span><span>${SITE_ICON[t.kind] || '🏗'}</span><b>${C.TOWERS[t.kind]?.name || t.kind}</b><span class="p"><i style="width:${Math.round(t.progress * 100)}%"></i></span><span class="w">${onSite(t) ? `${onSite(t)} 👷` : i === 0 ? 'next' : ''}</span></div>`).join('')}
    </div>` : ''}
    <div class="muted how">${how} <kbd>.</kbd> jumps to an idle one.</div>`;
  if (bound) return;
  bound = true;
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const { jobs: j } = plan();
    const act = b.dataset.act;
    if (act === 'custom') {
      custom = !custom;
      try { localStorage.setItem('ts-wcustom', custom ? '1' : '0'); } catch { /* ignore */ }
      box.dataset.key = '';
      updateWorkersPanel();
    } else if (act === 'preset') {
      tipDone('workers');
      const p = PRESETS.find(([k]) => k === b.dataset.p)[4];
      for (const job of C.WORKER_JOBS) if (p[job] !== j[job]) sendMsg({ t: 'jobs', job, level: p[job] });
    } else if (act === 'cnt') {
      const job = b.dataset.job;
      const max = job === 'scout' ? C.SCOUT_WORKERS : C.WORKER_COUNT_MAX;
      sendMsg({ t: 'jobs', job, level: Math.max(0, Math.min(max, j[job] + Number(b.dataset.d))) });
    } else if (act === 'build') sendMsg({ t: 'jobs', job: 'build', level: j.build ? 0 : 1 });
    else if (act === 'sw') {
      const sw = b.dataset.sw;
      if (sw === 'repair') sendMsg({ t: 'jobs', job: 'repair', level: j.repair ? 0 : 1 });
      else if (sw === 'flee') sendMsg({ t: 'wplan', flee: !plan().flee });
      else sendMsg({ t: 'wplan', keepForest: !plan().keep });
    } else if (act === 'idle') jumpIdle();
  });
  // the build queue: drag a site up or down
  let dragId = 0;
  box.addEventListener('dragstart', (e) => {
    const r = e.target.closest('.qi');
    if (!r) return;
    dragId = Number(r.dataset.id);
    r.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  box.addEventListener('dragover', (e) => {
    if (dragId && e.target.closest('.qi')) e.preventDefault();
  });
  box.addEventListener('drop', (e) => {
    const r = e.target.closest('.qi');
    if (!dragId || !r) return;
    e.preventDefault();
    const ids = mySites(plan().order).map((t) => t.id).filter((id) => id !== dragId);
    const at = ids.indexOf(Number(r.dataset.id));
    const rect = r.getBoundingClientRect();
    ids.splice(at + (e.clientY > rect.top + rect.height / 2 ? 1 : 0), 0, dragId);
    sendMsg({ t: 'buildq', ids });
    dragId = 0;
  });
  box.addEventListener('dragend', () => {
    dragId = 0;
    box.dataset.key = '';
  });
}

// ---- idle workers

let idleTurn = 0;
// "." : pick the next idle worker and look at it.
function jumpIdle() {
  const idle = myWorkers().filter((u) => u.job === 0).sort((a, b) => a.id - b.id);
  if (!idle.length) {
    toast('No idle workers', true);
    return;
  }
  const u = idle[idleTurn++ % idle.length];
  S.selWorkers.clear();
  S.selWorkers.add(u.id);
  S.selWorker = u.id;
  cam.x = u.rx;
  cam.y = u.ry;
}

// ---- on the map

// A small bubble over each of my workers with its job's icon; idle ones pulse gold.
function drawWorkerIcons() {
  if (!S.myId) return;
  const s = scale();
  if (s < 9) return; // (zoomed right out: too small to read)
  const now = performance.now();
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const r = Math.max(7, Math.min(11, s * 0.3));
  for (const u of S.units.values()) {
    if (u.owner !== S.myId || u.kind !== 'worker') continue;
    const [x, y0] = toScreen(u.rx, u.ry);
    const y = y0 - s * 0.95 - r;
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    const idle = u.job === 0;
    const col = u.flee ? '#f85149' : COL_BY_CODE[u.job];
    if (idle) {
      const t = (now / 1200) % 1;
      ctx.strokeStyle = `rgba(242, 193, 78, ${0.5 * (1 - t)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 2 + t * 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(13, 17, 23, 0.88)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (u.flee) {
      ctx.fillStyle = col;
      ctx.font = `800 ${Math.round(r * 1.2)}px system-ui, sans-serif`;
      ctx.fillText('!', x, y + 0.5);
    } else if (idle) {
      ctx.fillStyle = '#f2c14e';
      ctx.font = `800 ${Math.round(r * 0.85)}px system-ui, sans-serif`;
      ctx.fillText('Zz', x, y + 0.5);
    } else {
      ctx.font = `${Math.round(r * 1.1)}px system-ui, sans-serif`;
      ctx.fillText(ICON_BY_CODE[u.job], x, y + 1);
    }
  }
}

// Hovering a forest or an iron ore deposit: a card saying who's on it and how long it will last.
function drawWorkHover() {
  if (document.body.classList.contains('touch')) return; // (no hovering on a touch screen)
  if (!S.myId || S.buildKind || !S.round || mouse.wx < 0 || mouse.wy < 0 || mouse.wx >= C.MAP_W || mouse.wy >= C.MAP_H) return;
  const i = HEX.tileHex[Math.floor(mouse.wy) * C.MAP_W + Math.floor(mouse.wx)];
  const L = window.TD_TERRAIN.mapTerrain(S.round.seed, HEX, C.MAP_W, C.MAP_H, { rivers: S.round.rivers !== false });
  const forest = L.forest.has(i);
  const ore = L.iron.has(i);
  if (!forest && !ore) return;
  const h = HEX.hexes[i];
  const left = (forest ? S.forestLeft : S.oreLeft).has(i) ? (forest ? S.forestLeft : S.oreLeft).get(i) : 5; // fifths
  const full = forest ? C.FOREST_WOOD : C.IRON_ORE;
  const amount = Math.round((left / 5) * full);
  const code = forest ? CODE.gather : CODE.mine;
  const n = myWorkers().filter((u) => u.job === code && Math.hypot(u.rx - h.cx, u.ry - h.cy) < C.HEX_R + 1).length;
  const rate = n * (forest ? C.CHOP_RATE : C.MINE_RATE);
  const secs = rate > 0 ? amount / rate : 0;
  const when = secs >= 60 ? `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s` : `${Math.round(secs)}s`;
  const title = forest ? '🪓 Forest' : '⛏ Iron ore';
  const sub = `${n ? `${n} ${forest ? 'chopping' : 'mining'}` : 'nobody on it'}`;
  const line2 = left <= 0 ? (forest ? 'chopped bare: growing back' : 'mined out: building back up') : `${amount} ${forest ? 'wood' : 'iron'} left${n ? ` · gone in ~${when}` : ''}`;
  const [cx, cy] = toScreen(h.cx, h.cy);
  ctx.font = '700 12.5px system-ui, sans-serif';
  const w = Math.max(ctx.measureText(`${title} · ${sub}`).width, (ctx.font = '12px system-ui, sans-serif', ctx.measureText(line2).width)) + 24;
  const x = Math.min(ctx.canvas.width - w - 8, cx + scale() * C.HEX_R * 0.9);
  const y = Math.max(50, cy - 52);
  ctx.fillStyle = 'rgba(14, 18, 25, 0.95)';
  ctx.strokeStyle = '#273041';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 58, 9);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 12.5px system-ui, sans-serif';
  ctx.fillStyle = '#e6edf3';
  ctx.fillText(title, x + 12, y + 20);
  const tw = ctx.measureText(title).width;
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = '#8b949e';
  ctx.fillText(` · ${sub}`, x + 12 + tw, y + 20);
  ctx.fillText(line2, x + 12, y + 37);
  ctx.fillStyle = '#273041';
  ctx.fillRect(x + 12, y + 45, w - 24, 5);
  ctx.fillStyle = forest ? '#7ee787' : '#d6894e';
  ctx.fillRect(x + 12, y + 45, (w - 24) * (left / 5), 5);
}

// ---- picking workers with a box

// Left-drag on the map from empty ground: a box; let go to pick every worker of mine inside it.
function startBox(sx, sy) {
  S.workerBox = { x0: sx, y0: sy, x1: sx, y1: sy, on: false };
}
function moveBox(sx, sy) {
  const b = S.workerBox;
  if (!b) return;
  b.x1 = sx;
  b.y1 = sy;
  if (Math.abs(b.x1 - b.x0) + Math.abs(b.y1 - b.y0) > 8) b.on = true;
}
// Ends the box. True if it was a real drag (it picked workers), so the click does nothing else.
function endBox(add) {
  const b = S.workerBox;
  S.workerBox = null;
  if (!b || !b.on) return false;
  const [ax, ay] = toWorld(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
  const [bx, by] = toWorld(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
  const inside = myWorkers().filter((u) => u.rx >= ax && u.rx <= bx && u.ry >= ay - 0.6 && u.ry <= by + 0.6);
  if (!add) S.selWorkers.clear();
  for (const u of inside) S.selWorkers.add(u.id);
  S.selWorker = S.selWorkers.size ? [...S.selWorkers][0] : null;
  if (inside.length) toast(`${S.selWorkers.size} worker${S.selWorkers.size === 1 ? '' : 's'} picked · right-click to send them (Shift: queue it)`, true);
  return true;
}
function drawBox() {
  const b = S.workerBox;
  if (!b || !b.on) return;
  ctx.strokeStyle = '#7ee787';
  ctx.fillStyle = 'rgba(126, 231, 135, 0.07)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  const x = Math.min(b.x0, b.x1);
  const y = Math.min(b.y0, b.y1);
  ctx.fillRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
  ctx.strokeRect(x, y, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
  ctx.setLineDash([]);
}

// The server: some of my workers ran from raiders.
function onFlee(f) {
  if (f.o !== S.myId) return;
  toast(`⚠ Raiders near your workers: ${f.n} fall${f.n === 1 ? 's' : ''} back to your core`);
}

export { drawBox, drawWorkerIcons, drawWorkHover, endBox, jumpIdle, moveBox, onFlee, startBox, updateWorkersPanel };
