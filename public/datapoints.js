/* Data points page (#/datapoints): every value you can push, with its endpoint, unit, range and example. */
(function () {
  'use strict';
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let root = null, cat = null, timer = null, open = new Set();

  const fmtVal = (v, d) => (v === null || v === undefined ? '—' : (typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toFixed(2)) : esc(v)) + (d.type === 'text' || d.type === 'enum' ? '' : ' (' + esc(d.unit) + ')'));
  const exTxt = (d) => (d.type === 'text' ? '"' + esc(d.example) + '"' : d.type === 'enum' ? esc(d.example) + ' (' + esc(d.unit) + ')' : esc(d.example) + ' (' + esc(d.unit) + ')');
  const pathHTML = (p) => esc(p).replace(/\{(.+?)\}/g, '<em>{$1}</em>');
  const srcChip = (s) => (s.live ? (s.stale ? '<span class="chip watch">STALE</span>' : '<span class="chip ok">LIVE</span>') : '<span class="chip mut">SIM</span>');

  function detail(d) {
    const ents = d.entities && d.entities.length
      ? '<table class="dt ents"><thead><tr><th>' + esc(d.entity) + '</th><th>Current</th><th>Endpoint</th></tr></thead><tbody>' +
        d.entities.map((e) => '<tr><td><b>' + esc(e.id) + '</b></td><td>' + fmtVal(e.value, d) + '</td><td><code>POST /api/value/' + esc(e.path) + '</code></td></tr>').join('') +
        '</tbody></table>' + (d.entityCount > d.entities.length ? '<p class="note">… and ' + (d.entityCount - d.entities.length) + ' more</p>' : '') +
        (d.createsEntity ? '<p class="note">An unknown ' + esc(d.entity) + ' id is <b>created</b> on first push.</p>' : '')
      : '';
    return '<div class="dpd"><div class="curlrow"><pre>' + esc(d.curl) + '</pre><button class="tbtn" data-copy="' + esc(d.curl) + '">Copy</button></div>' +
      '<p class="note">Valid: <b>' + esc(d.range) + '</b> ' + (d.type === 'number' ? '(' + esc(d.unit) + ')' : '') + '. Body can be the bare value (<code>' + esc(d.type === 'text' ? d.example : d.example) + '</code>) or <code>{"value": ' + esc(JSON.stringify(d.example)) + '}</code>.</p>' + ents + '</div>';
  }

  function build() {
    const base = cat.base || location.origin;
    const rows = [];
    let group = null;
    cat.inputs.forEach((d) => {
      if (d.group !== group) { group = d.group; rows.push('<tr class="grp" data-g="' + esc(group) + '"><td colspan="7">' + esc(group) + '</td></tr>'); }
      const cur = d.entity ? '<span class="mut">' + d.entityCount + ' ' + esc(d.entity) + (d.entityCount === 1 ? '' : 's') + ' ▾</span>' : fmtVal(d.current, d);
      rows.push('<tr class="dpr" data-path="' + esc(d.path) + '" data-g="' + esc(group) + '"><td><code>POST /api/value/' + pathHTML(d.path) + '</code></td><td>' + esc(d.label) + '</td><td>' + (d.type === 'number' ? '(' + esc(d.unit) + ')' : esc(d.unit)) + '</td>' +
        '<td class="mut">' + esc(d.range) + '</td><td><b>' + exTxt(d) + '</b></td><td data-cur="' + esc(d.path) + '">' + cur + '</td><td data-src="' + esc(d.path) + '">' + srcChip(d.source) + '</td></tr>');
      rows.push('<tr class="dpx" data-for="' + esc(d.path) + '" hidden><td colspan="7">' + detail(d) + '</td></tr>');
    });
    const derived = cat.derived.map((x) => '<tr><td><b>' + esc(x.value) + '</b></td><td>' + esc(x.how) + '</td></tr>').join('');
    return '<div class="dpintro"><p class="note"><b>Push one value per call.</b> The body is just the number: ' +
      '<code>POST ' + esc(base) + '/api/value/build/actual</code> with body <code>766</code> (units in brackets below; out-of-range or wrong-unit values are rejected with a message). ' +
      (cat.tokenRequired ? 'Send <code>Authorization: Bearer $INGEST_TOKEN</code>. ' : 'No token is required on this server (set <code>INGEST_TOKEN</code> to require one). ') +
      'Several at once, all-or-nothing: <code>POST ' + esc(base) + '/api/values</code> with <code>{"build/actual": 766, "shops/press/buf": 82}</code>. Read back: <code>GET /api/value/&lt;path&gt;</code>. ' +
      'A group turns LIVE on its first valid push; until then it stays simulated. Paths in <em>{braces}</em> take an id (a shop, JV name, part number…): click a row for the list.</p>' +
      '<pre class="dpsample">curl -X POST ' + esc(base) + '/api/value/build/actual ' + (cat.tokenRequired ? '-H "Authorization: Bearer $INGEST_TOKEN" ' : '') + '-d 766</pre></div>' +
      '<div class="filters"><input id="dp-filter" placeholder="Filter: e.g. buffer, %, parts, yard…" style="width:340px"><span class="mut" id="dp-count" style="font-size:12px"></span></div>' +
      '<table class="dt dpt"><thead><tr><th>Endpoint</th><th>What it is</th><th>Unit</th><th>Valid range</th><th>Example</th><th>Current</th><th>Source</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
      '<section class="dsec" style="margin-top:16px"><h3>Calculated on the dashboard — not pushable (' + cat.derived.length + ')</h3><p class="note">These are derived from the values above, so there is nothing to send. If one looks wrong, fix the input it comes from.</p>' +
      '<table class="dt"><thead><tr><th>Value on the dashboard</th><th>How it is calculated</th></tr></thead><tbody>' + derived + '</tbody></table></section>';
  }

  function applyFilter() {
    const q = (root.querySelector('#dp-filter').value || '').toLowerCase().trim(), seen = {};
    let n = 0;
    cat.inputs.forEach((d) => {
      const hit = !q || (d.path + ' ' + d.label + ' ' + d.unit + ' ' + d.group).toLowerCase().indexOf(q) >= 0;
      const r = root.querySelector('.dpr[data-path="' + CSS.escape(d.path) + '"]'), x = root.querySelector('.dpx[data-for="' + CSS.escape(d.path) + '"]');
      r.hidden = !hit; x.hidden = !hit || !open.has(d.path);
      if (hit) { seen[d.group] = true; n++; }
    });
    root.querySelectorAll('tr.grp').forEach((g) => { g.hidden = !seen[g.dataset.g]; });
    root.querySelector('#dp-count').textContent = n + ' of ' + cat.inputs.length + ' endpoints';
  }

  async function load(first) {
    const r = await fetch('/api/values');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const body = await r.json();
    if (first) { cat = body; return; }
    // refresh only current values / source chips so filter text and open rows are untouched
    body.inputs.forEach((d) => {
      const c = root.querySelector('[data-cur="' + CSS.escape(d.path) + '"]'), s = root.querySelector('[data-src="' + CSS.escape(d.path) + '"]');
      if (c && !d.entity) c.innerHTML = fmtVal(d.current, d);
      if (s) s.innerHTML = srcChip(d.source);
    });
    cat = body;
  }

  function mount(el, state, opts) {
    root = el; open = new Set(); clearInterval(timer);
    const shell = (inner) => window.FFPages.frame('datapoints', 'Data Points — one endpoint per value', 'Every number you can push, with unit, range and example', '<div id="dpc">' + inner + '</div>');
    if (!opts.server) { root.innerHTML = shell('<div class="ifgate"><h3>Server required</h3><p class="note">Run <code>node server.js</code> and open <code>http://localhost:8080</code> — the endpoints live on the server.</p></div>'); return; }
    root.innerHTML = shell('<p class="note">Loading…</p>');
    if (!root._dpBound) {
      root._dpBound = true;
      root.addEventListener('input', (e) => { if (e.target.id === 'dp-filter' && cat) applyFilter(); });
      root.addEventListener('click', (e) => {
        const cp = e.target.closest('button[data-copy]');
        if (cp) { navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copy); cp.textContent = 'Copied ✓'; setTimeout(() => { cp.textContent = 'Copy'; }, 1200); return; }
        const tr = e.target.closest('tr.dpr');
        if (tr) { const p = tr.dataset.path, x = root.querySelector('.dpx[data-for="' + CSS.escape(p) + '"]'); if (open.has(p)) open.delete(p); else open.add(p); x.hidden = !open.has(p); }
      });
    }
    load(true).then(() => { root.querySelector('#dpc').innerHTML = build(); applyFilter(); timer = setInterval(() => { if (root.querySelector('.dpt')) load(false).catch(() => {}); }, 3000); })
      .catch((e) => { root.querySelector('#dpc').innerHTML = '<p class="note low">Could not load the catalogue: ' + esc(e.message) + '</p>'; });
  }
  function update() { /* refreshed by its own 3 s poll; the page is never re-rendered (keeps filter + open rows) */ }
  function unmount() { clearInterval(timer); }
  window.FFDatapoints = { mount, update, unmount };
})();
