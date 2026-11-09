(() => {
  'use strict';

  const STORAGE_KEY = 'shopping-prices-v1';
  const STORES = {
    w: { name: 'Woolworths', short: 'Woolies', search: q => `https://www.woolworths.com.au/shop/search/products?searchTerm=${encodeURIComponent(q)}` },
    c: { name: 'Coles', short: 'Coles', search: q => `https://www.coles.com.au/search/products?q=${encodeURIComponent(q)}` },
  };

  const $ = sel => document.querySelector(sel);
  const money = n => '$' + n.toFixed(2);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

  let state = load();
  let filter = 'all';

  // ---------- persistence ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) return parsed;
      }
    } catch (e) { /* storage unavailable or corrupt */ }
    return { items: [] };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---------- price helpers ----------
  const current = (item, s) => {
    const h = item.history[s];
    return h.length ? h[h.length - 1].p : null;
  };
  const previous = (item, s) => {
    const h = item.history[s];
    return h.length > 1 ? h[h.length - 2].p : null;
  };

  function setPrice(item, s, value) {
    const h = item.history[s];
    if (value === null) return false;
    const last = h[h.length - 1];
    if (last && last.p === value) return false;
    const d = today();
    // Same-day corrections overwrite rather than add a new point.
    if (last && last.d === d) {
      last.p = value;
      // Drop it entirely if the correction lands back on the previous price.
      const prev = h[h.length - 2];
      if (prev && prev.p === value) h.pop();
    } else {
      h.push({ d, p: value });
    }
    return true;
  }

  function parsePrice(str) {
    if (str === '' || str == null) return null;
    const n = Math.round(parseFloat(str) * 100) / 100;
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function newItem(name, qty, w, c) {
    const item = { id: uid(), name, qty, done: false, history: { w: [], c: [] } };
    if (w !== null) item.history.w.push({ d: today(), p: w });
    if (c !== null) item.history.c.push({ d: today(), p: c });
    return item;
  }

  // ---------- totals ----------
  function renderStats() {
    const todo = state.items.filter(i => !i.done);
    let tw = 0, tc = 0, best = 0, missW = 0, missC = 0, nW = 0, nC = 0, unpriced = 0;
    for (const i of todo) {
      const w = current(i, 'w'), c = current(i, 'c');
      if (w !== null) tw += w * i.qty; else missW++;
      if (c !== null) tc += c * i.qty; else missC++;
      if (w === null && c === null) { unpriced++; continue; }
      if (c === null || (w !== null && w <= c)) { best += w * i.qty; nW++; }
      else { best += c * i.qty; nC++; }
    }
    $('#totalW').textContent = money(tw);
    $('#totalC').textContent = money(tc);
    $('#totalBest').textContent = money(best);
    $('#countLeft').textContent = todo.length;

    $('#noteW').textContent = missW ? `${missW} item${missW > 1 ? 's' : ''} without a price` : (todo.length ? 'All items priced' : '');
    $('#noteC').textContent = missC ? `${missC} item${missC > 1 ? 's' : ''} without a price` : (todo.length ? 'All items priced' : '');

    let bestNote = '';
    if (todo.length) {
      bestNote = `${nW} at Woolies · ${nC} at Coles`;
      if (!missW && !missC) {
        const saving = Math.min(tw, tc) - best;
        if (saving > 0.004) bestNote += ` · saves ${money(saving)}`;
      }
    }
    $('#noteBest').textContent = bestNote;

    const bought = state.items.length - todo.length;
    $('#noteCount').textContent = state.items.length
      ? `${bought} bought${unpriced ? ` · ${unpriced} unpriced` : ''}`
      : '';
  }

  // ---------- sparkline ----------
  function series(item) {
    const pts = [];
    for (const s of ['w', 'c']) for (const e of item.history[s]) pts.push({ s, t: Date.parse(e.d), p: e.p });
    return pts;
  }

  function drawLines(svg, item, W, H, pad, withAxes) {
    const NS = 'http://www.w3.org/2000/svg';
    svg.replaceChildren();
    const pts = series(item);
    if (!pts.length) return;
    const ts = pts.map(p => p.t), ps = pts.map(p => p.p);
    let t0 = Math.min(...ts), t1 = Math.max(...ts);
    let p0 = Math.min(...ps), p1 = Math.max(...ps);
    const now = Date.parse(today());
    t1 = Math.max(t1, now);
    if (t1 === t0) t0 -= 86400000;
    if (p1 === p0) { p0 -= 0.5; p1 += 0.5; }
    const span = p1 - p0; p0 -= span * 0.1; p1 += span * 0.1;
    const x = t => pad.l + (t - t0) / (t1 - t0) * (W - pad.l - pad.r);
    const y = p => pad.t + (1 - (p - p0) / (p1 - p0)) * (H - pad.t - pad.b);
    const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

    if (withAxes) {
      for (let k = 0; k <= 3; k++) {
        const pv = p0 + (p1 - p0) * k / 3, yy = y(pv);
        svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, stroke: 'var(--line)' }));
        const lbl = el('text', { x: pad.l - 6, y: yy + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' });
        lbl.textContent = money(pv); svg.append(lbl);
      }
      for (const [tv, anchor] of [[t0, 'start'], [t1, 'end']]) {
        const lbl = el('text', { x: x(tv), y: H - 4, 'text-anchor': anchor, 'font-size': 11, fill: 'var(--muted)' });
        lbl.textContent = fmtDate(new Date(tv).toISOString().slice(0, 10)); svg.append(lbl);
      }
    }

    for (const s of ['w', 'c']) {
      const h = item.history[s];
      if (!h.length) continue;
      const color = s === 'w' ? 'var(--woolies)' : 'var(--coles)';
      // Step line: a price holds until it changes, and the latest holds until today.
      let d = '';
      h.forEach((e, idx) => {
        const xx = x(Date.parse(e.d)), yy = y(e.p);
        d += idx === 0 ? `M${xx},${yy}` : `H${xx}V${yy}`;
      });
      d += `H${x(now)}`;
      svg.append(el('path', { d, fill: 'none', stroke: color, 'stroke-width': withAxes ? 2.5 : 2, 'stroke-linejoin': 'round' }));
      const r = withAxes ? 4 : 2.5;
      for (const e of withAxes ? h : h.slice(-1)) {
        svg.append(el('circle', { cx: x(Date.parse(e.d)), cy: y(e.p), r, fill: color }));
      }
    }
  }

  // ---------- list ----------
  function priceCell(item, s, cheapest) {
    const td = document.createElement('td');
    td.className = 'num';
    const wrap = document.createElement('div');
    wrap.className = `price-cell ${s === 'w' ? 'woolies' : 'coles'}-col` + (cheapest ? ' cheapest' : '');
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.step = '0.01'; input.inputMode = 'decimal';
    input.className = 'price-in'; input.placeholder = '—';
    input.setAttribute('aria-label', `${STORES[s].name} price for ${item.name}`);
    const cur = current(item, s);
    input.value = cur === null ? '' : cur.toFixed(2);
    input.addEventListener('change', () => {
      const v = parsePrice(input.value);
      if (v === null) { input.value = cur === null ? '' : cur.toFixed(2); return; }
      if (setPrice(item, s, v)) { save(); render(); }
      else input.value = v.toFixed(2);
    });
    const delta = document.createElement('span');
    delta.className = 'delta';
    const prev = previous(item, s);
    if (cur !== null && prev !== null) {
      const diff = cur - prev;
      if (Math.abs(diff) < 0.005) { delta.classList.add('flat'); delta.textContent = 'no change'; }
      else {
        delta.classList.add(diff > 0 ? 'up' : 'down');
        const pct = prev ? ` (${Math.abs(diff / prev * 100).toFixed(0)}%)` : '';
        delta.textContent = `${diff > 0 ? '▲' : '▼'} ${money(Math.abs(diff))}${pct}`;
        delta.title = `was ${money(prev)}`;
      }
    }
    wrap.append(input, delta);
    td.append(wrap);
    return td;
  }

  function row(item) {
    const tr = document.createElement('tr');
    if (item.done) tr.classList.add('done');
    const w = current(item, 'w'), c = current(item, 'c');
    const cheaper = (w !== null && c !== null) ? (w < c ? 'w' : c < w ? 'c' : 'eq') : null;

    const tdCheck = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = item.done;
    cb.setAttribute('aria-label', `Mark ${item.name} as bought`);
    cb.addEventListener('change', () => { item.done = cb.checked; save(); render(); });
    tdCheck.append(cb);

    const tdName = document.createElement('td');
    const name = document.createElement('div');
    name.className = 'item-name'; name.textContent = item.name;
    name.title = 'Double-click to rename';
    name.addEventListener('dblclick', () => {
      const n = prompt('Rename item', item.name);
      if (n && n.trim()) { item.name = n.trim(); save(); render(); }
    });
    const links = document.createElement('div');
    links.className = 'item-links';
    for (const s of ['w', 'c']) {
      const a = document.createElement('a');
      a.href = STORES[s].search(item.name); a.target = '_blank'; a.rel = 'noopener';
      a.className = s; a.textContent = `Search ${STORES[s].short}`;
      links.append(a);
    }
    tdName.append(name, links);

    const tdQty = document.createElement('td');
    tdQty.className = 'num';
    const q = document.createElement('input');
    q.type = 'number'; q.min = '1'; q.step = '1'; q.className = 'qty-in'; q.value = item.qty;
    q.setAttribute('aria-label', `Quantity of ${item.name}`);
    q.addEventListener('change', () => {
      const n = Math.max(1, Math.round(Number(q.value) || 1));
      item.qty = n; save(); render();
    });
    tdQty.append(q);

    const tdTrend = document.createElement('td');
    const trend = document.createElement('div');
    trend.className = 'trend';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 96 28');
    svg.setAttribute('aria-label', `Price history for ${item.name}, click for details`);
    svg.addEventListener('click', () => openHistory(item));
    drawLines(svg, item, 96, 28, { l: 3, r: 4, t: 4, b: 4 }, false);
    trend.append(svg);
    if (cheaper) {
      const b = document.createElement('span');
      if (cheaper === 'eq') { b.className = 'badge eq'; b.textContent = 'Same'; }
      else {
        b.className = `badge ${cheaper}`;
        b.textContent = `${STORES[cheaper].short} −${money(Math.abs(w - c))}`;
        b.title = `${STORES[cheaper].name} is cheaper by ${money(Math.abs(w - c))} each`;
      }
      trend.append(b);
    }
    tdTrend.append(trend);

    const tdAct = document.createElement('td');
    tdAct.className = 'c-act';
    const hist = document.createElement('button');
    hist.type = 'button'; hist.className = 'icon-btn'; hist.textContent = 'History';
    hist.addEventListener('click', () => openHistory(item));
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'icon-btn del'; del.textContent = '✕';
    del.setAttribute('aria-label', `Remove ${item.name}`);
    del.addEventListener('click', () => {
      if (confirm(`Remove "${item.name}" and its price history?`)) {
        state.items = state.items.filter(i => i !== item); save(); render();
      }
    });
    tdAct.append(hist, ' ', del);

    tr.append(tdCheck, tdName, tdQty,
      priceCell(item, 'w', cheaper === 'w'),
      priceCell(item, 'c', cheaper === 'c'),
      tdTrend, tdAct);
    return tr;
  }

  function render() {
    const tbody = $('#rows');
    const items = state.items
      .filter(i => filter === 'all' || (filter === 'todo' ? !i.done : i.done))
      .sort((a, b) => a.done - b.done);
    tbody.replaceChildren(...items.map(row));

    const empty = $('#empty');
    empty.hidden = items.length > 0;
    if (!state.items.length) {
      empty.innerHTML = 'Your list is empty. Add an item above to start tracking prices, or <button type="button" class="ghost" id="sampleBtn">load an example list</button>.';
      $('#sampleBtn').addEventListener('click', loadSample);
    } else {
      empty.textContent = filter === 'done' ? 'Nothing marked as bought yet.' : 'Everything on your list is bought.';
    }
    renderStats();
  }

  // ---------- history dialog ----------
  const dlg = $('#historyDlg');
  let dlgItem = null;
  function openHistory(item) {
    dlgItem = item;
    renderHistory();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function renderHistory() {
    const item = dlgItem;
    $('#histTitle').textContent = `Price history — ${item.name}`;
    drawLines($('#histChart'), item, 600, 220, { l: 58, r: 12, t: 12, b: 24 }, true);
    const entries = [];
    for (const s of ['w', 'c']) item.history[s].forEach((e, idx) => entries.push({ s, idx, ...e }));
    entries.sort((a, b) => b.d.localeCompare(a.d) || a.s.localeCompare(b.s));
    const tbody = $('#histRows');
    tbody.replaceChildren(...entries.map(e => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${fmtDate(e.d)}</td><td></td><td class="num">${money(e.p)}</td><td class="num"></td>`;
      tr.children[1].textContent = STORES[e.s].name;
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'icon-btn del'; rm.textContent = '✕';
      rm.setAttribute('aria-label', 'Delete this price entry');
      rm.addEventListener('click', () => {
        item.history[e.s].splice(e.idx, 1); save(); renderHistory(); render();
      });
      tr.children[3].append(rm);
      return tr;
    }));
    if (!entries.length) tbody.innerHTML = '<tr><td colspan="4">No prices recorded yet.</td></tr>';
  }

  // ---------- sample data ----------
  function loadSample() {
    const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const mk = (name, qty, w, c) => ({
      id: uid(), name, qty, done: false,
      history: {
        w: w.map(([n, p]) => ({ d: daysAgo(n), p })),
        c: c.map(([n, p]) => ({ d: daysAgo(n), p })),
      },
    });
    state.items = [
      mk('Full cream milk 2L', 2, [[42, 3.10], [14, 3.20]], [[42, 3.10], [14, 3.20]]),
      mk('Free range eggs 12pk', 1, [[42, 6.90], [21, 7.50]], [[42, 7.00], [7, 6.60]]),
      mk('Wholemeal bread 700g', 1, [[42, 4.20]], [[42, 4.00], [28, 4.50], [3, 3.80]]),
      mk('Bananas 1kg', 1, [[35, 3.90], [10, 4.50]], [[35, 4.40], [10, 3.90]]),
      mk('Chicken breast fillets 1kg', 1, [[30, 13.00], [5, 11.50]], [[30, 12.50]]),
      mk('Cheddar block 500g', 1, [[40, 9.00], [20, 7.00], [6, 9.50]], [[40, 9.20], [12, 8.00]]),
      mk('Pasta 500g', 3, [[20, 1.90]], []),
    ];
    save(); render();
  }

  // ---------- events ----------
  $('#addForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const f = ev.target;
    const name = f.name.value.trim();
    if (!name) return;
    const qty = Math.max(1, Math.round(Number(f.qty.value) || 1));
    state.items.push(newItem(name, qty, parsePrice(f.w.value), parsePrice(f.c.value)));
    save(); render();
    f.reset(); f.qty.value = 1; f.name.focus();
  });

  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    render();
  }));

  $('#clearDone').addEventListener('click', () => {
    const n = state.items.filter(i => i.done).length;
    if (!n) return;
    if (confirm(`Remove ${n} bought item${n > 1 ? 's' : ''} from the list?`)) {
      state.items = state.items.filter(i => !i.done); save(); render();
    }
  });

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shopping-prices-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#importInput').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.items)) throw new Error('missing items');
      for (const i of data.items) {
        if (typeof i.name !== 'string' || !i.history) throw new Error('bad item');
        i.id ||= uid(); i.qty = Math.max(1, Number(i.qty) || 1); i.done = !!i.done;
        i.history.w ||= []; i.history.c ||= [];
      }
      if (state.items.length && !confirm('Replace your current list with the imported one?')) return;
      state = data; save(); render();
    } catch (e) {
      alert('That file is not a valid shopping list export.');
    }
  });

  render();
})();
