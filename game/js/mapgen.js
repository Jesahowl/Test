'use strict';
// World map generation: a single fictional continent made from fractal value noise.
// Plain script (no modules) so index.html works when opened straight from disk;
// also exports for Node so the simulation can be tested headless.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeValueNoise(rng) {
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rng(); }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const at = (ix, iy) => vals[perm[(ix & 255) + perm[iy & 255]]];
  const fade = t => t * t * (3 - 2 * t);
  return function (x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const sx = fade(x - ix), sy = fade(y - iy);
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    const top = a + (b - a) * sx, bot = c + (d - c) * sx;
    return top + (bot - top) * sy;
  };
}

// Label connected regions of cells where mask[i] === value. Returns {label, sizes}.
function labelComponents(W, H, mask, value) {
  const label = new Int32Array(W * H).fill(-1);
  const sizes = [];
  const queue = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (mask[s] !== value || label[s] !== -1) continue;
    const id = sizes.length;
    let head = 0, tail = 0, size = 0;
    queue[tail++] = s; label[s] = id;
    while (head < tail) {
      const i = queue[head++]; size++;
      const x = i % W;
      if (x > 0 && mask[i - 1] === value && label[i - 1] === -1) { label[i - 1] = id; queue[tail++] = i - 1; }
      if (x < W - 1 && mask[i + 1] === value && label[i + 1] === -1) { label[i + 1] = id; queue[tail++] = i + 1; }
      if (i >= W && mask[i - W] === value && label[i - W] === -1) { label[i - W] = id; queue[tail++] = i - W; }
      if (i < W * (H - 1) && mask[i + W] === value && label[i + W] === -1) { label[i + W] = id; queue[tail++] = i + W; }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

function generateMap(W, H, seed, landFraction = 0.46) {
  const rng = mulberry32(seed);
  const noise = makeValueNoise(rng);
  const ox = rng() * 512, oy = rng() * 512;
  const aspect = W / H;
  const n = W * H;
  const height = new Float32Array(n);

  const fbm = (x, y, octaves, freq) => {
    let v = 0, amp = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      v += amp * noise(x * freq + ox, y * freq + oy);
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return v / norm;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = x / W, ny = y / H;
      // Domain warp gives twisty peninsulas and bays instead of round blobs.
      const wx = (fbm(nx * aspect + 31.7, ny + 11.3, 4, 2.0) - 0.5) * 0.5;
      const wy = (fbm(nx * aspect + 77.1, ny + 53.9, 4, 2.0) - 0.5) * 0.5;
      const v = fbm(nx * aspect + wx, ny + wy, 7, 3.4);
      // Sink the land near the (warped) map edges so the noise shapes the coastline.
      const ex = nx + wx * 0.6, ey = ny + wy * 0.6;
      const e = Math.max(0, Math.min(ex, 1 - ex, ey, 1 - ey)) / 0.22;
      const edge = e >= 1 ? 1 : e * e * (3 - 2 * e);
      const dx = nx - 0.5, dy = ny - 0.5;
      height[y * W + x] = v - (1 - edge) * 0.35 - 0.12 * (dx * dx + dy * dy);
    }
  }

  // Pick the sea level so roughly `landFraction` of the map is land.
  const sorted = Float32Array.from(height).sort();
  const seaLevel = sorted[Math.floor((1 - landFraction) * n)];

  const land = new Uint8Array(n);
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      const i = y * W + x;
      if (height[i] > seaLevel) land[i] = 1;
    }
  }

  // Keep only the largest landmass for now (boats will open up islands later).
  const landComp = labelComponents(W, H, land, 1);
  let biggest = 0;
  for (let k = 1; k < landComp.sizes.length; k++) if (landComp.sizes[k] > landComp.sizes[biggest]) biggest = k;
  for (let i = 0; i < n; i++) if (land[i] && landComp.label[i] !== biggest) land[i] = 0;

  // Fill tiny lakes so the coast reads cleanly.
  const waterComp = labelComponents(W, H, land, 0);
  const ocean = waterComp.label[0];
  for (let i = 0; i < n; i++) {
    const c = waterComp.label[i];
    if (!land[i] && c !== ocean && waterComp.sizes[c] < 40) land[i] = 1;
  }

  // Shallow water ring around the coast (purely visual).
  const shallow = new Uint8Array(n);
  let landCount = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!land[y * W + x]) continue;
      landCount++;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (!land[j]) shallow[j] = 1;
        }
      }
    }
  }

  return { W, H, seed, land, shallow, landCount };
}

if (typeof module !== 'undefined') module.exports = { mulberry32, generateMap };
