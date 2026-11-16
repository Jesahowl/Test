// Contact sheets: several screenshots in a grid on one image, for looking over many at once.
//   node tools/sheet.js out.png a.png b.png c.png d.png [--cols=2 --w=2000]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { args } = require('./lib');
const o = args({ cols: 2, w: 2000 });
const [out, ...files] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: o.w, height: 400 } });
  const cells = files.map((f) => `<figure><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><figcaption>${path.basename(f)}</figcaption></figure>`).join('');
  await p.setContent(`<body style="margin:0;background:#111;color:#ccc;font:13px system-ui"><div style="display:grid;grid-template-columns:repeat(${o.cols},1fr);gap:6px;padding:6px">${cells}</div>
    <style>figure{margin:0}img{width:100%;display:block}figcaption{padding:2px 4px}</style></body>`);
  await p.screenshot({ path: out, fullPage: true });
  await b.close();
})();
