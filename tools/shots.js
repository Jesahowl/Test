// Screenshots for checking how things look (headless Chromium via Playwright). Output: shots/ (git-ignored).
//   node tools/shots.js map --seeds=777,4242 [--zoom=1.5 --at=125,22]   the menu's map (no game), whole or a spot
//   node tools/shots.js live [--mins=7]   a public game with 7 bots, run ahead: our base, the whole map
//                                         (from a watching tab), the two biggest bot bases, and fights
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { createServer } = require('../server/index');
const { args } = require('./lib');
const o = args({ seeds: '4242', mins: 7, zoom: 0, at: '', w: 1440, h: 810, scale: 2, port: 3490 });
const mode = process.argv[2];
const dir = path.join(__dirname, '..', 'shots');
fs.mkdirSync(dir, { recursive: true });
const errs = [];

async function page(b) {
  const p = await b.newPage({ viewport: { width: o.w, height: o.h }, deviceScaleFactor: o.scale });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  return p;
}
// take over the camera: window.__x/__y/__zoom win while set
const freeCam = (p) => p.evaluate(async () => {
  const m = await import('/js/state.js');
  m.S.specFollow = false;
  for (const k of ['x', 'y', 'zoom']) { let v = m.cam[k]; Object.defineProperty(m.cam, k, { get: () => window['__' + k] ?? v, set: (n) => { v = n; } }); }
});
async function look(p, x, y, zoom, name, wait = 1500) {
  await p.evaluate(([x, y, z]) => { window.__x = x; window.__y = y; window.__zoom = z; }, [x, y, zoom]);
  await p.waitForTimeout(wait);
  await p.screenshot({ path: path.join(dir, name) });
  console.log('  shots/' + name);
}
const whole = () => o.w / 200 / 28;

(async () => {
  const srv = createServer({ port: o.port, botTarget: 7, waits: { solo: 0.5, group: 0.5, ready: 0.5, full: 0.5, late: 0.5 } });
  await new Promise((r) => srv.server.once('listening', r));
  const b = await chromium.launch();
  const p = await page(b);
  await p.goto(`http://localhost:${o.port}`);
  await p.waitForTimeout(1000);
  if (mode === 'map') {
    await p.addStyleTag({ content: '.overlay,#hud,#tip{display:none!important}' });
    await freeCam(p);
    for (const s of String(o.seeds).split(',').map(Number)) {
      await p.evaluate(async (s) => { (await import('/js/state.js')).S.menuSeed = s; }, s);
      const [x, y] = o.at ? o.at.split(',').map(Number) : [100, 50];
      await look(p, x, y, o.zoom || whole(), `map-${s}${o.at ? '-' + o.at.replace(',', '_') : ''}.png`, 2500);
    }
  } else if (mode === 'live') {
    await p.fill('#name', 'You');
    await p.click('#play');
    for (let i = 0; i < 80 && !(srv.publicRoom && srv.publicRoom.phase === 'playing' && srv.game && srv.game.players.size >= 8); i++) await p.waitForTimeout(250);
    const g = srv.game;
    const me = [...g.players.values()].find((q) => !q.isBot);
    await p.waitForTimeout(1500);
    // run ahead with the bot brain playing our side too (our core kept standing, or the round ends)
    me.bot = { next: g.time + 1, nextOrder: g.time + 10 };
    for (let k = 0; k < o.mins * 60 * 20 && g.phase === 'playing'; k++) {
      me.core.hp = Math.max(me.core.hp, me.core.maxHp * 0.9);
      g.update(0.05);
      if (g.time >= me.bot.next) { me.bot.next = g.time + 1.5; g.botThink(me); }
      if (k % 200 === 0) await p.waitForTimeout(20);
    }
    me.bot = null;
    await p.waitForTimeout(2500);
    console.log(`t=${Math.round(g.time)}s, ${[...g.players.values()].filter((q) => q.alive).length} alive`);
    await p.evaluate(() => document.querySelectorAll('[id*=tip]').forEach((e) => { if (e.textContent.includes('TIP')) e.style.display = 'none'; }));
    await freeCam(p);
    await look(p, me.core.x, me.core.y, 1.0, 'live-base.png');
    // a watcher sees the whole map
    const w = await page(b);
    await w.goto(`http://localhost:${o.port}`);
    await w.waitForTimeout(1500);
    await w.click('[data-watch]');
    await w.waitForTimeout(2000);
    await freeCam(w);
    await look(w, 100, 50, whole(), 'live-map.png', 2500);
    const top = [...g.players.values()].filter((q) => q.alive && q.isBot).sort((a, c) => c.territory - a.territory);
    if (top[0]) await look(w, top[0].core.x, top[0].core.y, 1.0, 'live-bot-base.png');
    if (top[1]) await look(w, top[1].core.x, top[1].core.y, 0.7, 'live-bot-base-wide.png');
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 400; i++) g.update(0.05);
      const us = [...g.units.values()].filter((u) => !u.worker && u.owner > 0);
      let best = null, bn = 0;
      for (const u of us) { let n = 0; for (const v of us) if (v.owner !== u.owner && Math.hypot(u.x - v.x, u.y - v.y) < 6) n++; if (n > bn) { bn = n; best = u; } }
      if (best && bn >= 4) await look(w, best.x, best.y, 0.95, `live-fight-${k}.png`, 1200);
    }
  } else {
    console.log('usage: node tools/shots.js map|live [options]');
  }
  console.log('errors:', errs.slice(0, 8));
  await b.close();
  srv.close();
  process.exit(0);
})();
