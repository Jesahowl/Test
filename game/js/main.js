'use strict';
// Browser glue: menu, input, HUD, leaderboard, messages and the game loop.

(function () {
  const $ = id => document.getElementById(id);
  const canvas = $('map');

  const MAP_W = 480, MAP_H = 300;
  const PLAYER_MIN_SPAWN_DIST = 12;

  let game = null, renderer = null, player = null;
  let phase = 'menu';          // menu | spawn | play | over
  let spectating = false;
  let ratio = 0.5;
  let spawnPreview = null;
  let acc = 0, last = performance.now(), hudTimer = 0, eventIdx = 0;

  // ---- setup -------------------------------------------------------------

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startGame() {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const aiCount = parseInt($('opt-ai').value, 10);
    const name = $('opt-name').value.trim() || 'Your Nation';
    const map = generateMap(MAP_W, MAP_H, seed);
    game = new Game(map, seed);

    const rng = mulberry32(seed + 1);
    const names = shuffle(NATION_NAMES, rng);
    const colors = shuffle(NATION_COLORS, rng);
    const kinds = Object.keys(PERSONALITIES);
    const minDist = Math.sqrt(map.landCount / (aiCount + 1)) * 0.8;
    for (let k = 0; k < aiCount; k++) {
      const kind = kinds[Math.floor(rng() * kinds.length)];
      const n = game.addNation(names[k], colors[k], false, PERSONALITIES[kind]);
      const s = game.findSpawn(minDist);
      if (s) game.spawnNation(n, s.x, s.y);
    }
    player = game.addNation(name, PLAYER_COLOR, true, null);

    renderer = new Renderer(canvas, game);
    phase = 'spawn';
    spectating = false;
    eventIdx = 0;
    acc = 0;
    $('log').innerHTML = '';
    $('menu').classList.add('hidden');
    $('end').classList.add('hidden');
    $('hud').classList.add('hidden');
    $('leaderboard').classList.remove('hidden');
    showHint('Tap the map to choose where your nation starts', true);
    $('hud-name').textContent = name;
    $('hud-swatch').style.background = PLAYER_COLOR;
    updateLeaderboard();
  }

  function trySpawn(cell) {
    if (!game.canSpawnAt(cell.x, cell.y, PLAYER_MIN_SPAWN_DIST)) {
      toast(game.map.land[cell.i] ? 'Too close to another nation. Pick somewhere else.' : 'You can\'t start in the ocean.', 'danger');
      return;
    }
    game.spawnNation(player, cell.x, cell.y);
    game.stats();
    phase = 'play';
    spawnPreview = null;
    $('hud').classList.remove('hidden');
    showHint('Tap free land or a neighbour to attack · 1–9 set troop %');
    setTimeout(() => { if (phase === 'play') hideHint(); }, 8000);
    toast(`${player.name} is founded. Expand into the free land around you!`, 'good');
  }

  // ---- player actions --------------------------------------------------

  function attackCell(cell) {
    if (!player.alive) return;
    if (!game.map.land[cell.i]) { toast('Boats aren\'t in the game yet, so you can only attack over land.'); return; }
    const target = game.owner[cell.i];
    if (target === player.id) return;
    const r = game.launchAttack(player.id, target, player.troops * ratio, cell.x, cell.y);
    if (typeof r === 'string') toast(r, 'danger');
    updateHud();
  }

  function setRatio(r) {
    ratio = Math.max(0.05, Math.min(1, r));
    $('ratio').value = Math.round(ratio * 100);
    $('ratio-value').textContent = Math.round(ratio * 100) + '%';
  }

  // ---- input -----------------------------------------------------------

  const pointers = new Map();
  let dragStart = null, dragging = false, pinchDist = 0;

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  canvas.addEventListener('pointerdown', e => {
    if (!renderer) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, canvasPoint(e));
    if (pointers.size === 1) { dragStart = canvasPoint(e); dragging = false; }
    else if (pointers.size === 2) { pinchDist = pinchInfo().d; dragging = true; }
  });

  canvas.addEventListener('pointermove', e => {
    if (!renderer) return;
    const p = canvasPoint(e);
    if (e.pointerType === 'mouse') updateTooltip(e, p);
    if (phase === 'spawn') {
      const cell = renderer.screenToCell(p.x, p.y);
      spawnPreview = cell ? { x: cell.x, y: cell.y, ok: game.canSpawnAt(cell.x, cell.y, PLAYER_MIN_SPAWN_DIST) } : null;
    }
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      if (!dragging && Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > 6) dragging = true;
      if (dragging) renderer.pan(p.x - prev.x, p.y - prev.y);
    } else if (pointers.size === 2) {
      const info = pinchInfo();
      if (pinchDist > 0) renderer.zoomAt(info.cx, info.cy, info.d / pinchDist);
      pinchDist = info.d;
    }
  });

  function pointerEnd(e, cancelled) {
    if (!pointers.has(e.pointerId)) return;
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (!cancelled && wasSingle && !dragging) {
      const p = canvasPoint(e);
      const cell = renderer.screenToCell(p.x, p.y);
      if (cell) {
        if (phase === 'spawn') trySpawn(cell);
        else if (phase === 'play') attackCell(cell);
      }
    }
    if (pointers.size === 0) dragging = false;
  }
  canvas.addEventListener('pointerup', e => pointerEnd(e, false));
  canvas.addEventListener('pointercancel', e => pointerEnd(e, true));
  canvas.addEventListener('pointerleave', () => $('tooltip').classList.add('hidden'));

  canvas.addEventListener('wheel', e => {
    if (!renderer) return;
    e.preventDefault();
    const p = canvasPoint(e);
    renderer.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key >= '1' && e.key <= '9') setRatio(parseInt(e.key, 10) / 10);
    else if (e.key === '0') setRatio(1);
  });

  window.addEventListener('resize', () => { if (renderer) { renderer.resize(); renderer.clampCam(); } });

  $('ratio').addEventListener('input', e => setRatio(e.target.value / 100));
  $('btn-start').addEventListener('click', startGame);
  $('opt-name').addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });
  $('btn-again').addEventListener('click', () => {
    $('end').classList.add('hidden');
    $('menu').classList.remove('hidden');
    phase = 'menu';
  });
  $('btn-watch').addEventListener('click', () => { spectating = true; $('end').classList.add('hidden'); });

  $('attacks').addEventListener('click', e => {
    const id = e.target.dataset && e.target.dataset.retreat;
    if (id) { game.retreat(parseInt(id, 10)); updateHud(); }
  });

  // ---- UI updates ------------------------------------------------------

  function updateTooltip(e, p) {
    const tip = $('tooltip');
    const cell = renderer.screenToCell(p.x, p.y);
    if (!cell || phase === 'menu') { tip.classList.add('hidden'); return; }
    let html;
    if (!game.map.land[cell.i]) html = '<span class="muted">Ocean</span>';
    else {
      const o = game.owner[cell.i];
      if (!o) html = '<b>Free land</b><br><span class="muted">Costs a few troops per tile</span>';
      else {
        const n = game.nations[o];
        const pct = (100 * n.tiles / game.map.landCount).toFixed(1);
        html = `<b>${escapeHtml(n.name)}${n.isPlayer ? ' (you)' : ''}</b><br>` +
          `${formatNum(n.troops)} troops · ${pct}% land` +
          (n.personality ? `<br><span class="muted">${n.personality.label}</span>` : '');
      }
    }
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    const y = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function updateHud() {
    if (!player || !player.spawned) return;
    $('hud-troops').textContent = formatNum(player.troops);
    $('hud-max').textContent = 'of ' + formatNum(player.maxTroops);
    $('hud-growth').textContent = '+' + formatNum(player.growth);
    $('hud-land').textContent = (100 * player.tiles / game.map.landCount).toFixed(1) + '%';

    const rows = [];
    for (const a of game.attacks) {
      if (a.done) continue;
      if (a.attacker === player.id) {
        const t = a.target ? escapeHtml(game.nations[a.target].name) : 'free land';
        rows.push(`<div class="atk"><span class="who">⚔ Attacking ${t}</span><span class="num">${formatNum(a.troops)}</span>` +
          `<button data-retreat="${a.id}">Retreat</button></div>`);
      } else if (a.target === player.id) {
        rows.push(`<div class="atk incoming"><span class="who">⚠ ${escapeHtml(game.nations[a.attacker].name)} is attacking you</span>` +
          `<span class="num">${formatNum(a.troops)}</span></div>`);
      }
    }
    $('attacks').innerHTML = rows.join('');
  }

  function updateLeaderboard() {
    const list = game.nations.filter(n => n && (n.spawned || n.isPlayer))
      .sort((a, b) => (b.alive - a.alive) || (b.tiles - a.tiles));
    $('lb-list').innerHTML = list.slice(0, 10).map(n =>
      `<li class="${n.isPlayer ? 'me' : ''} ${n.alive ? '' : 'dead'}">` +
      `<span class="swatch" style="background:${n.color}"></span>` +
      `<span class="nm">${escapeHtml(n.name)}</span>` +
      `<span class="pct">${(100 * n.tiles / game.map.landCount).toFixed(1)}%</span>` +
      `<span class="tr">${formatNum(n.troops)}</span></li>`).join('');
  }

  function drainEvents() {
    while (eventIdx < game.events.length) {
      const ev = game.events[eventIdx++];
      toast(ev.text, ev.type);
    }
  }

  function toast(text, type = 'info') {
    const log = $('log');
    const el = document.createElement('div');
    el.className = 'msg ' + type;
    el.textContent = text;
    log.appendChild(el);
    while (log.children.length > 5) log.removeChild(log.firstChild);
    setTimeout(() => el.classList.add('fade'), 5000);
    setTimeout(() => el.remove(), 5700);
  }

  function showHint(text, big) {
    const h = $('hint');
    h.textContent = text;
    h.classList.toggle('big', !!big);
    h.classList.remove('hidden');
  }
  function hideHint() { $('hint').classList.add('hidden'); }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function checkEnd() {
    if (phase !== 'play') return;
    if (game.winner) {
      phase = 'over';
      const won = game.winner.isPlayer;
      $('end-title').textContent = won ? 'Victory!' : 'Defeat';
      $('end-text').textContent = won
        ? `${player.name} controls the continent. Your rivals are finished.`
        : `${game.winner.name} has taken control of the continent.`;
      $('btn-watch').classList.add('hidden');
      $('end').classList.remove('hidden');
    } else if (!player.alive && !spectating && $('end').classList.contains('hidden')) {
      $('end-title').textContent = 'Your nation has fallen';
      $('end-text').textContent = 'You can keep watching to see who wins, or start a new game.';
      $('btn-watch').classList.remove('hidden');
      $('end').classList.remove('hidden');
    }
  }

  // ---- main loop ---------------------------------------------------------

  function frame(now) {
    const dt = Math.min(250, now - last);
    last = now;
    if (game && phase === 'play') {
      acc += dt;
      while (acc >= TICK_MS) { game.update(); acc -= TICK_MS; }
      drainEvents();
      checkEnd();
    }
    if (renderer) renderer.draw(phase === 'spawn' ? spawnPreview : null);
    hudTimer += dt;
    if (game && hudTimer > 200) {
      hudTimer = 0;
      updateHud();
      updateLeaderboard();
    }
    requestAnimationFrame(frame);
  }

  // A decorative map behind the start menu.
  (function preview() {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    game = new Game(generateMap(MAP_W, MAP_H, seed), seed);
    renderer = new Renderer(canvas, game);
  })();

  setRatio(0.5);
  requestAnimationFrame(frame);

  // Expose for debugging in the console.
  window.__game = () => ({ game, player, phase });
})();
