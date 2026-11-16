// Flow-field pathfinding shared by the server (creep movement) and the client (path preview).
//
// A field is the cost-to-goal of every tile, computed with Dijkstra outward from the goal tile.
// Creeps simply step to the neighbour with the lowest cost. Structures are not impassable:
// entering one costs extra (proportional to its max HP), so creeps walk around walls when a
// reasonable detour exists, and chew through the weakest point when a base is sealed shut.
(function (root) {
  'use strict';

  const STEP = 10; // cost of an orthogonal move
  const DIAG = 14; // cost of a diagonal move
  const INF = 0x3fffffff;

  // dx, dy, cost
  const DIRS = [
    [1, 0, STEP], [-1, 0, STEP], [0, 1, STEP], [0, -1, STEP],
    [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG],
  ];

  // Extra cost of entering a structure tile with the given max HP.
  function structureCost(C, maxHp) {
    return Math.round(STEP * (C.PATH_STRUCT_BASE + maxHp * C.PATH_STRUCT_PER_HP));
  }

  // A diagonal move is only allowed through open ground (no clipping past structure corners).
  function canMove(extra, w, x, y, dx, dy) {
    if (dx === 0 || dy === 0) return true;
    return extra[y * w + x + dx] === 0 && extra[(y + dy) * w + x] === 0 && extra[(y + dy) * w + x + dx] === 0
      && extra[y * w + x] === 0;
  }

  // Min-heap over (key, value) pairs stored in parallel arrays.
  // A binary min-heap of (key, value) int pairs in typed arrays, reused between fields (one per
  // module: computeField isn't re-entrant), so building a field allocates nothing per step.
  class Heap {
    constructor(cap = 1 << 14) {
      this.keys = new Int32Array(cap);
      this.vals = new Int32Array(cap);
      this.size = 0;
      this.lastKey = 0;
    }

    clear() {
      this.size = 0;
    }

    push(k, v) {
      if (this.size === this.keys.length) {
        const keys = new Int32Array(this.size * 2);
        const vals = new Int32Array(this.size * 2);
        keys.set(this.keys);
        vals.set(this.vals);
        this.keys = keys;
        this.vals = vals;
      }
      const keys = this.keys;
      const vals = this.vals;
      let i = this.size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= k) break;
        keys[i] = keys[p];
        vals[i] = vals[p];
        i = p;
      }
      keys[i] = k;
      vals[i] = v;
    }

    pop() {
      const keys = this.keys;
      const vals = this.vals;
      const topV = vals[0];
      this.lastKey = keys[0];
      const n = --this.size;
      if (n > 0) {
        const k = keys[n];
        const v = vals[n];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && keys[c + 1] < keys[c]) c++;
          if (keys[c] >= k) break;
          keys[i] = keys[c];
          vals[i] = vals[c];
          i = c;
        }
        keys[i] = k;
        vals[i] = v;
      }
      return topV;
    }
  }
  const sharedHeap = new Heap();

  function edgeTable(w, h, edgeCost) {
    const t = new Int16Array(w * h * 8);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = y * w + x;
        for (let k = 0; k < 8; k++) {
          const nx = x + DIRS[k][0];
          const ny = y + DIRS[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          t[u * 8 + k] = edgeCost(u, ny * w + nx);
        }
      }
    }
    return t;
  }

  // extra: Int32Array of extra entry cost per tile (0 = open ground). Returns Int32Array of costs.
  // edgeCost (optional): (from tile, to tile) => extra cost of that step, or -1 if it's blocked
  // (walls between hexes).
  function computeField(w, h, extra, goal, edgeCost) {
    const table = edgeCost && edgeCost.table;
    const dist = new Int32Array(w * h).fill(INF);
    const heap = sharedHeap;
    heap.clear();
    dist[goal] = 0;
    heap.push(0, goal);
    while (heap.size) {
      const v = heap.pop();
      const d = heap.lastKey;
      if (d !== dist[v]) continue;
      const vx = v % w;
      const vy = (v - vx) / w;
      // Relax neighbours u: a creep at u stepping into v pays the step plus v's entry cost.
      const enter = v === goal ? 0 : extra[v];
      for (let k = 0; k < 8; k++) {
        const ux = vx - DIRS[k][0];
        const uy = vy - DIRS[k][1];
        if (ux < 0 || uy < 0 || ux >= w || uy >= h) continue;
        const u = uy * w + ux;
        // (no cutting a corner past a blocked or costly tile: as canMove, inlined)
        if (k >= 4 && (extra[u] !== 0 || extra[v] !== 0 || extra[uy * w + vx] !== 0 || extra[vy * w + ux] !== 0)) continue;
        let nd = d + DIRS[k][2] + enter;
        if (table) {
          const c = table[u * 8 + k];
          if (c < 0) continue;
          nd += c;
        } else if (edgeCost) {
          const c = edgeCost(u, v);
          if (c < 0) continue;
          nd += c;
        }
        if (nd < dist[u]) {
          dist[u] = nd;
          heap.push(nd, u);
        }
      }
    }
    return dist;
  }

  // The tile a creep on tile i should move to next, or -1 if it is at the goal.
  function nextStep(dist, w, h, extra, i, goal, edgeCost) {
    if (i === goal) return -1;
    const x = i % w;
    const y = (i - x) / w;
    let best = -1;
    let bestCost = dist[i];
    for (let k = 0; k < 8; k++) {
      const nx = x + DIRS[k][0];
      const ny = y + DIRS[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!canMove(extra, w, x, y, DIRS[k][0], DIRS[k][1])) continue;
      const n = ny * w + nx;
      let c = dist[n] + DIRS[k][2] + (n === goal ? 0 : extra[n]);
      if (edgeCost) {
        const e = edgeCost.table ? edgeCost.table[i * 8 + k] : edgeCost(i, n);
        if (e < 0) continue;
        c += e;
      }
      if (c <= bestCost && (best === -1 || c < bestCost)) {
        bestCost = c;
        best = n;
      }
    }
    return best;
  }

  // Follow the field from tile `start` to the goal; returns the list of tile indices visited.
  function tracePath(dist, w, h, extra, start, goal, maxSteps = 2000, edgeCost) {
    const path = [start];
    let i = start;
    for (let s = 0; s < maxSteps; s++) {
      const n = nextStep(dist, w, h, extra, i, goal, edgeCost);
      if (n < 0) break;
      path.push(n);
      i = n;
    }
    return path;
  }

  const api = { computeField, edgeTable, nextStep, tracePath, structureCost, INF, STEP, DIRS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.TD_PATH = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
