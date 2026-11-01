/* Interfaces page (#/settings): one row per data point -> choose source, enter endpoint, test, save & apply. */
(function () {
  'use strict';
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MODE_LABEL = { auto: 'Simulated (accepts push)', sim: 'Simulated only', push: 'Push (webhook)', rest: 'REST poll', mqtt: 'MQTT subscribe' };
  let root = null, st = null, serverMode = false, S = null, dirty = false;
  const tok = () => sessionStorage.getItem('ff_admin') || '';

  async function api(method, path, body) {
    const h = { 'Content-Type': 'application/json' };
    if (tok()) h.Authorization = 'Bearer ' + tok();
    const r = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) { /* empty */ }
    return { status: r.status, ok: r.ok, body: j || {} };
  }

  /* contract field hints from the sample payload, e.g. id, stock, pending.ref */
  function fieldsOf(sample) {
    let o = Array.isArray(sample) ? sample[0] : sample;
    if (o && Array.isArray(o.units)) o = Object.assign({}, o.units[0], { 'routes[].name': 1 });
    const out = [];
    (function walk(x, p, d) { for (const k of Object.keys(x || {})) { const v = x[k]; if (v && typeof v === 'object' && !Array.isArray(v) && d < 2) walk(v, p + k + '.', d + 1); else out.push(p + k); } })(o, '', 0);
    return out;
  }

  function gateHTML(msg) {
    return '<div class="ifgate"><h3>Admin access required</h3><p class="note">' + esc(msg) + '</p>' +
      '<div class="ifrow"><input type="password" id="if-token" placeholder="ADMIN_TOKEN" value="' + esc(tok()) + '"><button class="pbtn" data-act="unlock">Unlock</button></div></div>';
  }

  function rowHTML(info, d) {
    const id = info.id, s = info.sample, sampleStr = JSON.stringify(s, null, 2);
    const hdrs = Object.keys(d.headers || {}).map((k) => k + ': ' + d.headers[k]).join('\n');
    const modes = st.meta.modes.map((m) => '<option value="' + m + '"' + (d.mode === m ? ' selected' : '') + '>' + MODE_LABEL[m] + '</option>').join('');
    const mappers = st.meta.mappers.map((m) => '<option' + (d.mapper === m ? ' selected' : '') + '>' + m + '</option>').join('');
    return '<div class="ifr m-' + d.mode + '" data-id="' + id + '">' +
      '<div class="ifh"><span class="sdot" data-st="' + id + '"></span>' +
      '<div class="ifn"><b>' + id + '</b><small>' + esc(info.label) + '</small><em>Typical source: ' + esc(info.source) + '</em></div>' +
      '<select data-f="mode">' + modes + '</select>' +
      '<input data-f="url" class="u-rest wide" placeholder="https://host/api/endpoint" value="' + esc(d.url) + '">' +
      '<select data-f="method" class="u-rest narrow"><option' + (d.method === 'GET' ? ' selected' : '') + '>GET</option><option' + (d.method === 'POST' ? ' selected' : '') + '>POST</option></select>' +
      '<label class="u-rest ivl"><input data-f="intervalSec" type="number" min="1" max="3600" value="' + esc(d.intervalSec) + '"> s</label>' +
      '<input data-f="topic" class="u-mqtt wide" placeholder="plant01/amr/+/state" value="' + esc(d.topic) + '">' +
      '<span class="u-push u-auto wide pushhint">POST <code>' + esc(location.origin) + '/api/ingest/' + (d.item ? esc(info.item) : id) + '</code></span>' +
      '<span class="u-sim wide pushhint mut">Demo data — pushes are refused</span>' +
      '<button class="tbtn" data-act="test">Test</button><button class="tbtn" data-act="more">Details ▾</button></div>' +
      '<div class="ifd" hidden>' +
      '<div class="ifg">' +
      '<label class="u-rest">Headers <small>one per line — <code>Name: value</code>; use <code>${ENV_VAR}</code> for secrets</small><textarea data-f="headers" rows="3" spellcheck="false">' + esc(hdrs) + '</textarea></label>' +
      '<div><label class="u-rest u-mqtt">Named mapper <small>built-in vendor translators</small><select data-f="mapper">' + mappers + '</select></label>' +
      '<label class="u-rest u-mqtt">Root path <small>where the data sits in the response, e.g. <code>data.items</code></small><input data-f="root" value="' + esc(d.root) + '" placeholder="(whole response)"></label></div>' +
      '<label class="u-rest u-mqtt">Field map <small>JSON: dashboard field → your field (or <code>{"path":"perHour","div":60}</code>)</small><textarea data-f="fields" rows="4" spellcheck="false" placeholder=\'{"id":"material","stock":"onHand"}\'>' + esc(Object.keys(d.fields || {}).length ? JSON.stringify(d.fields, null, 1) : '') + '</textarea></label>' +
      (info.item ? '<div class="u-rest u-mqtt u-push"><label class="chk"><input type="checkbox" data-f="item"' + (d.item ? ' checked' : '') + '> One message per item (upsert by id) → <code>' + esc(info.item) + '</code></label>' +
        '<label class="u-mqtt">Topic segment holding the id <small>0-based; used if the payload has no id</small><input data-f="idIndex" type="number" min="0" value="' + (d.idIndex === null || d.idIndex === undefined ? '' : esc(d.idIndex)) + '" placeholder="e.g. 3"></label></div>' : '<div></div>') +
      '</div>' +
      '<div class="contract"><b>Dashboard fields for <code>' + id + '</code>:</b> ' + fieldsOf(s).map((f) => '<code>' + f + '</code>').join(' ') + '</div>' +
      '<details class="smp"><summary>Expected payload (sample)</summary><pre>' + esc(sampleStr) + '</pre><pre class="curl">curl -X POST ' + esc(location.origin) + '/api/ingest/' + (d.item ? esc(info.item) : id) + ' \\\n  -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \\\n  -d \'' + esc(JSON.stringify(Array.isArray(s) ? s[0] : s)) + '\'</pre></details>' +
      '<div class="tres"></div></div></div>';
  }

  function formHTML() {
    const c = st.config, m = c.mqtt;
    return '<div class="ifbar"><div class="ifb">' +
      '<h3>MQTT broker <small>used by every row set to MQTT' + (st.mqttInstalled ? '' : ' — <span class="low">mqtt package not installed on server: run <code>npm i mqtt</code></span>') + '</small></h3>' +
      '<div class="ifrow"><input data-b="url" placeholder="mqtt://broker:1883" value="' + esc(m.url) + '"><input data-b="username" placeholder="username or ${MQTT_USER}" value="' + esc(m.username) + '">' +
      '<input data-b="password" type="password" placeholder="password or ${MQTT_PASS}" value="' + esc(m.password) + '"><select data-b="qos"><option value="0"' + (+m.qos === 0 ? ' selected' : '') + '>QoS 0</option><option value="1"' + (+m.qos === 1 ? ' selected' : '') + '>QoS 1</option></select></div></div>' +
      '<div class="ifb narrowb"><h3>Freshness</h3><div class="ifrow"><label>STALE after <input data-b="staleSec" type="number" min="5" value="' + esc(c.staleSec) + '"> s</label></div></div>' +
      '<div class="ifb act"><button class="pbtn" data-act="save">Save &amp; apply</button><button class="tbtn" data-act="reload">Discard changes</button><span class="smsg" id="if-msg"></span></div></div>' +
      '<p class="note">Every data point on the dashboard is listed below. <b>Simulated</b> rows show demo data. Set a row to <b>REST poll</b> or <b>MQTT</b>, enter the endpoint, press <b>Test</b> to see the raw response and whether the dashboard accepts it, then <b>Save &amp; apply</b>. ' +
      'Config is stored on the server in <code>' + esc(st.meta.file || '(memory only)') + '</code>; secrets typed here are stored there and never sent back to the browser (use <code>${ENV_VAR}</code> to keep them out of the file).</p>' +
      '<div class="ifrows">' + st.meta.domains.map((i) => rowHTML(i, c.domains[i.id])).join('') + '</div>';
  }

  /* ---------- read form ---------- */
  function readRow(id) {
    const r = root.querySelector('.ifr[data-id="' + id + '"]'), g = (f) => r.querySelector('[data-f="' + f + '"]');
    const val = (f) => (g(f) ? g(f).value : '');
    const headers = {};
    val('headers').split('\n').forEach((l) => { const i = l.indexOf(':'); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
    let fields = {};
    if (val('fields').trim()) { try { fields = JSON.parse(val('fields')); } catch (e) { throw new Error(id + ': field map is not valid JSON (' + e.message + ')'); } }
    const idx = val('idIndex');
    return {
      mode: val('mode'), url: val('url').trim(), method: val('method') || 'GET', intervalSec: Number(val('intervalSec')) || 15, headers,
      topic: val('topic').trim(), idIndex: idx === '' ? null : Number(idx), mapper: val('mapper') || 'identity', root: val('root').trim(), fields,
      item: g('item') ? g('item').checked : false
    };
  }
  function readBroker() {
    const b = (f) => root.querySelector('[data-b="' + f + '"]').value;
    return { url: b('url').trim(), username: b('username').trim(), password: b('password'), qos: Number(b('qos')) || 0 };
  }
  function readAll() {
    const domains = {};
    st.meta.domains.forEach((i) => { domains[i.id] = readRow(i.id); });
    return { staleSec: Number(root.querySelector('[data-b="staleSec"]').value) || 60, mqtt: readBroker(), domains };
  }

  const msg = (t, cls) => { const m = root.querySelector('#if-msg'); if (m) { m.textContent = t; m.className = 'smsg ' + (cls || ''); } };

  /* ---------- actions ---------- */
  async function load() {
    const r = await api('GET', '/api/config');
    const box = root.querySelector('#ifc');
    if (r.status === 401) { box.innerHTML = gateHTML(r.body.error || 'unauthorized'); return; }
    if (!r.ok) { box.innerHTML = '<p class="note low">Could not load configuration: ' + esc(r.body.error || r.status) + '</p>'; return; }
    st = r.body; dirty = false;
    box.innerHTML = formHTML();
    if (S) update(S);
  }
  async function save() {
    let cfg; try { cfg = readAll(); } catch (e) { return msg(e.message, 'low'); }
    msg('Saving…');
    const r = await api('PUT', '/api/config', { config: cfg });
    if (!r.ok) return msg(r.body.error || ('HTTP ' + r.status), 'low');
    st = r.body; dirty = false;
    root.querySelector('#ifc').innerHTML = formHTML();
    const n = st.meta.domains.filter((i) => ['rest', 'mqtt'].indexOf(st.config.domains[i.id].mode) >= 0).length;
    msg('Saved and applied ✓ — ' + n + ' polled/subscribed feed' + (n === 1 ? '' : 's') + ' running', 'ok');
    if (S) update(S);
  }
  async function testRow(id, btn) {
    const row = root.querySelector('.ifr[data-id="' + id + '"]'), out = row.querySelector('.tres'), d = row.querySelector('.ifd');
    let spec; try { spec = readRow(id); } catch (e) { d.hidden = false; out.innerHTML = '<span class="chip low">ERROR</span> ' + esc(e.message); return; }
    if (spec.mode !== 'rest' && spec.mode !== 'mqtt') { d.hidden = false; out.innerHTML = '<span class="chip mut">NOTHING TO TEST</span> Mode "' + esc(MODE_LABEL[spec.mode]) + '" has no endpoint. Use the curl example below to send a sample.'; return; }
    d.hidden = false; btn.disabled = true; const old = btn.textContent;
    btn.textContent = spec.mode === 'mqtt' ? 'Waiting…' : 'Testing…';
    out.innerHTML = '<span class="mut">' + (spec.mode === 'mqtt' ? 'Connecting and waiting up to 8 s for a message on the topic…' : 'Calling endpoint…') + '</span>';
    const r = await api('POST', '/api/config/test', { domain: id, spec, broker: readBroker() });
    btn.disabled = false; btn.textContent = old;
    const b = r.body;
    if (!r.ok) { out.innerHTML = '<span class="chip low">ERROR</span> ' + esc(b.error || 'HTTP ' + r.status); return; }
    let h = '';
    h += b.ok ? '<span class="chip ok">REACHED</span>' : '<span class="chip low">FAILED</span>';
    if (b.status) h += ' <span class="mut">HTTP ' + b.status + '</span>';
    if (b.ms !== undefined) h += ' <span class="mut">' + b.ms + ' ms</span>';
    if (b.topic) h += ' <span class="mut">topic ' + esc(b.topic) + '</span>';
    if (b.valid === true) h += ' <span class="chip ok">ACCEPTED BY DASHBOARD</span>';
    if (b.valid === false) h += ' <span class="chip low">REJECTED</span>';
    if (b.error) h += '<div class="low terr">' + esc(b.error) + '</div>';
    if (b.raw) h += '<details open><summary>Raw response</summary><pre>' + esc(b.raw) + '</pre></details>';
    if (b.mapped) h += '<details open><summary>After mapping (what the dashboard receives)</summary><pre>' + esc(b.mapped) + '</pre></details>';
    out.innerHTML = h;
  }

  function bind() {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'save') save();
      else if (act === 'reload') load().then(() => msg('Changes discarded', ''));
      else if (act === 'unlock') { sessionStorage.setItem('ff_admin', root.querySelector('#if-token').value); load(); }
      else if (act === 'more') { const d = b.closest('.ifr').querySelector('.ifd'); d.hidden = !d.hidden; }
      else if (act === 'test') testRow(b.closest('.ifr').dataset.id, b);
    });
    const touch = (e) => {
      const r = e.target.closest('.ifr');
      if (e.target.dataset.f === 'mode' && r) r.className = 'ifr m-' + e.target.value + (r.classList.contains('dirty') ? ' dirty' : '');
      if (r) r.classList.add('dirty');
      if (e.target.closest('.ifbar') || r) { dirty = true; if (e.target.dataset.f !== 'mode' || true) msg('Unsaved changes', 'watch'); }
    };
    root.addEventListener('input', touch);
    root.addEventListener('change', touch);
  }

  /* status dots: driven by the live SSE state, never re-render the form (would eat what you are typing) */
  function update(state) {
    S = state;
    if (!root || !st) return;
    st.meta.domains.forEach((i) => {
      const el = root.querySelector('[data-st="' + i.id + '"]'); if (!el) return;
      const saved = st.config.domains[i.id].mode, live = state.live && state.live[i.id], src = (state.src || {})[i.id] || {};
      let cls = 'sim', tip = 'Simulated';
      if (src.error && (saved === 'rest' || saved === 'mqtt')) { cls = 'low'; tip = 'Error: ' + src.error; }
      else if (live && src.status === 'stale') { cls = 'watch'; tip = 'STALE — last data ' + src.age + ' s ago'; }
      else if (live) { cls = 'ok'; tip = 'LIVE via ' + (src.via || 'push') + ' — ' + src.count + ' messages, last ' + (src.age === null || src.age === undefined ? 'just now' : src.age + ' s ago'); }
      else if (saved === 'rest' || saved === 'mqtt') { cls = 'watch'; tip = 'Configured — waiting for first data'; }
      el.className = 'sdot ' + cls; el.dataset.tip = tip;
      el.textContent = cls === 'ok' ? 'LIVE' : cls === 'low' ? 'ERROR' : cls === 'watch' ? (live ? 'STALE' : 'WAITING') : 'SIM';
    });
  }

  function mount(el, state, opts) {
    root = el; S = state; st = null; serverMode = !!opts.server; dirty = false;
    const body = '<div id="ifc"><p class="note">Loading…</p></div>';
    root.innerHTML = window.FFPages.frame('settings', 'Interfaces', 'Where each data point on the dashboard comes from', body);
    if (!serverMode) {
      root.querySelector('#ifc').innerHTML = '<div class="ifgate"><h3>Server required</h3><p class="note">You are in browser-only demo mode (no server), so there is nowhere to store endpoints or poll them from. ' +
        'Run <code>node server.js</code> and open <code>http://localhost:8080</code> — this page will then let you configure every data point.</p></div>';
      return;
    }
    if (!root._ffBound) { root._ffBound = true; bind(); }
    load();
  }
  window.FFSettings = { mount, update };
})();
