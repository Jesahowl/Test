// Client frame cost in a real browser (headless Chromium via Playwright): a private room with 10 bots
// run 9 minutes ahead, then fps and the top JS functions at base zoom and zoomed out.
//   node tools/profile-client.js     (GPU=1 for a software-GL canvas, closer to a real machine)
const { createServer } = require('../server/index');
const { chromium } = require('playwright');
(async () => {
  const srv = createServer({ port: 3102, botTarget: 0, dev: true });
  await new Promise((r) => srv.server.once('listening', r));
  const b = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : [] }); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://localhost:3102'); await p.waitForTimeout(800);
  await p.fill('#name', 'You'); await p.click('#create'); await p.waitForTimeout(800);
  const room = [...srv.rooms.values()][0]; const host = [...room.clients][0];
  room.setBots(host, 10); room.start(host);
  const g = room.game; const me = [...g.players.values()].find((q) => !q.isBot);
  for (let i = 0; i < 20 * 60 * 9; i++) { me.core.hp = me.core.maxHp; g.update(0.05); }
  await p.waitForTimeout(3000);
  await p.addStyleTag({ content: '#tips{display:none!important}' });
  const cdp = await p.context().newCDPSession(p);
  const measure = async (label, setup) => {
    await p.evaluate(setup);
    await p.waitForTimeout(800);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
    const r = await p.evaluate(() => new Promise((res) => { const ts = []; let last = performance.now(); const t0 = last; const f = (t) => { ts.push(t - last); last = t; if (t - t0 < 4000) requestAnimationFrame(f); else res(ts); }; requestAnimationFrame(f); }));
    const { profile } = await cdp.send('Profiler.stop');
    // self time per function
    const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const dt = profile.timeDeltas; for (let i = 0; i < profile.samples.length; i++) { const n = byId.get(profile.samples[i]); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000); }
    const total = [...self.values()].reduce((a, c) => a + c, 0);
    const top = [...self].filter(([k]) => !/^\(idle\)|^\(program\)|garbage/.test(k)).sort((a, c) => c[1] - a[1]).slice(0, 8);
    const sorted = [...r].sort((a, c) => a - c);
    console.log(`\n${label}: ${r.length / 4} fps, frame median ${sorted[sorted.length >> 1].toFixed(1)} ms, 95th ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} ms; JS busy ${(100 * top.reduce((a, c) => a + c[1], 0) / total).toFixed(0)}%+`);
    for (const [k, v] of top) console.log(`   ${(v / 4).toFixed(1)} ms/s  ${k}`);
  };
  await measure('zoom 1 at my base', `(async () => { const m = await import('/js/state.js'); const me = m.players.get(m.S.myId); m.cam.x = me.x; m.cam.y = me.y; m.cam.zoom = 1; })()`);
  await measure('whole map (zoomed out)', `(async () => { const m = await import('/js/state.js'); m.cam.x = 100; m.cam.y = 50; m.cam.zoom = 0.35; })()`);
  console.log('units', g.units.size); await b.close(); srv.close(); process.exit(0);
})();
