'use strict';
// Draws the map: one pixel per cell into an offscreen canvas, scaled up with
// nearest-neighbour filtering, then nation labels on top.

const COLOR_WATER = [27, 54, 84];
const COLOR_SHALLOW = [40, 76, 112];
const COLOR_NEUTRAL = [214, 205, 176];

class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.off = document.createElement('canvas');
    this.off.width = game.W;
    this.off.height = game.H;
    this.offCtx = this.off.getContext('2d');
    this.img = this.offCtx.createImageData(game.W, game.H);
    this.data = this.img.data;
    this.dirty = true;
    this.cam = { scale: 1, x: 0, y: 0, minScale: 0.5, maxScale: 40 };
    this.highlight = 0;   // nation id under the cursor
    game.onCellChange = i => this.cellChanged(i);
    for (let i = 0; i < game.W * game.H; i++) this.colorCell(i);
    this.resize();
    this.fit();
  }

  colorCell(i) {
    const g = this.game, W = g.W, own = g.owner, d = this.data, p = i * 4;
    let c;
    if (!g.map.land[i]) {
      c = g.map.shallow[i] ? COLOR_SHALLOW : COLOR_WATER;
    } else {
      const o = own[i];
      if (!o) {
        c = COLOR_NEUTRAL;
      } else {
        const n = g.nations[o], x = i % W;
        const border = x === 0 || x === W - 1 || i < W || i >= W * (g.H - 1) ||
          own[i - 1] !== o || own[i + 1] !== o || own[i - W] !== o || own[i + W] !== o;
        c = border ? n.dark : n.rgb;
      }
    }
    d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
  }

  cellChanged(i) {
    const W = this.game.W, H = this.game.H, x = i % W;
    this.colorCell(i);
    if (x > 0) this.colorCell(i - 1);
    if (x < W - 1) this.colorCell(i + 1);
    if (i >= W) this.colorCell(i - W);
    if (i < W * (H - 1)) this.colorCell(i + W);
    this.dirty = true;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.dpr = dpr;
    this.viewW = w; this.viewH = h;
  }

  fit() {
    const { W, H } = this.game;
    const s = Math.min(this.viewW / W, this.viewH / H) * 0.96;
    this.cam.scale = s;
    this.cam.minScale = s * 0.7;
    this.cam.maxScale = s * 16;
    this.cam.x = (this.viewW - W * s) / 2;
    this.cam.y = (this.viewH - H * s) / 2;
  }

  screenToCell(sx, sy) {
    const x = Math.floor((sx - this.cam.x) / this.cam.scale);
    const y = Math.floor((sy - this.cam.y) / this.cam.scale);
    if (x < 0 || y < 0 || x >= this.game.W || y >= this.game.H) return null;
    return { x, y, i: y * this.game.W + x };
  }

  zoomAt(sx, sy, factor) {
    const c = this.cam;
    const ns = Math.max(c.minScale, Math.min(c.maxScale, c.scale * factor));
    const f = ns / c.scale;
    c.x = sx - (sx - c.x) * f;
    c.y = sy - (sy - c.y) * f;
    c.scale = ns;
    this.clampCam();
  }

  pan(dx, dy) {
    this.cam.x += dx; this.cam.y += dy;
    this.clampCam();
  }

  clampCam() {
    const c = this.cam, mw = this.game.W * c.scale, mh = this.game.H * c.scale;
    const margin = 0.5;
    c.x = Math.min(this.viewW * margin, Math.max(this.viewW * (1 - margin) - mw, c.x));
    c.y = Math.min(this.viewH * margin, Math.max(this.viewH * (1 - margin) - mh, c.y));
  }

  draw(spawnPreview) {
    this.resize();
    const ctx = this.ctx, c = this.cam, g = this.game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = `rgb(${COLOR_WATER.join(',')})`;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    if (this.dirty) { this.offCtx.putImageData(this.img, 0, 0); this.dirty = false; }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, c.x, c.y, g.W * c.scale, g.H * c.scale);

    if (spawnPreview) {
      const r = (CFG.startRadius + 0.5) * c.scale;
      ctx.beginPath();
      ctx.arc(c.x + (spawnPreview.x + 0.5) * c.scale, c.y + (spawnPreview.y + 0.5) * c.scale, r, 0, Math.PI * 2);
      ctx.fillStyle = spawnPreview.ok ? 'rgba(58,134,255,0.55)' : 'rgba(230,57,70,0.45)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = spawnPreview.ok ? '#fff' : '#e63946';
      ctx.stroke();
    }

    this.drawLabels();
  }

  drawLabels() {
    const ctx = this.ctx, c = this.cam;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const n of this.game.nations) {
      if (!n || !n.alive || n.tiles <= 0) continue;
      let fs = Math.sqrt(n.tiles) * 0.3 * c.scale;
      if (fs < 8) continue;
      fs = Math.min(fs, 30);
      const sx = c.x + (n.lx + 0.5) * c.scale, sy = c.y + (n.ly + 0.5) * c.scale;
      const name = n.isPlayer ? `${n.name} (you)` : n.name;
      ctx.font = `700 ${fs}px system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.lineWidth = Math.max(2, fs / 5);
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.fillStyle = '#fff';
      ctx.strokeText(name, sx, sy - fs * 0.45);
      ctx.fillText(name, sx, sy - fs * 0.45);
      ctx.font = `600 ${fs * 0.8}px system-ui, -apple-system, Segoe UI, sans-serif`;
      const t = formatNum(n.troops);
      ctx.strokeText(t, sx, sy + fs * 0.55);
      ctx.fillText(t, sx, sy + fs * 0.55);
    }
  }
}

function formatNum(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e4) return Math.round(v / 1e3) + 'k';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(Math.floor(v));
}
