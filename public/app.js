/* FactoryFlow control-tower renderer. Pure function of the state object (see sim.js). */
(function () {
  'use strict';
  const Sim = window.FactorySim;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  let SERVER = false;   // true when state comes from the Node server (auto-detected, see detectServer())
  const COL = { ok: 'var(--ok)', watch: 'var(--watch)', low: 'var(--low)', cy: 'var(--cyan)' };
  const SHOPS = ['press', 'weld', 'paint', 'engine', 'bumper', 'assembly'];
  const ui = { shop: 'all', modal: false };
  let S = null;

  /* ---------- tiny helpers ---------- */
  const cache = new Map();
  function setHTML(el, html) {
    if (cache.get(el) === html) return;
    cache.set(el, html);
    el.innerHTML = html;
  }
  const ico = (n, cls) => '<svg class="ic ' + (cls || '') + '"><use href="#i-' + n + '"/></svg>';
  const mi = (n, x, y, s, c) => '<use href="#i-' + n + '" x="' + x + '" y="' + y + '" width="' + s + '" height="' + s + '" style="color:' + (c || 'var(--iconmap)') + '"/>';
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));   // alert text comes from outside: always escape
  const pad2 = (n) => String(Math.max(0, Math.round(n))).padStart(2, '0');
  const f0 = (n) => Math.round(n);
  const f1 = (n) => n.toFixed(1);
  const tipA = (t) => ' data-tip="' + String(t).replace(/"/g, '&quot;') + '"';
  const T = (k) => ((S && S.setup && S.setup.terms) || Sim.DEFAULT_TERMS)[k] || Sim.DEFAULT_TERMS[k];
  const statusLabel = { ok: 'OK', watch: 'WATCH', low: 'LOW' };
  const jvLabel = { ok: 'On time', watch: 'Watch', low: 'Late' };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- sparkline ---------- */
  function spark(key, vals, o) {
    const w = 200, h = o.h || 56, n = vals.length;
    let lo = o.min != null ? o.min : Math.min.apply(null, vals);
    let hi = o.max != null ? o.max : Math.max.apply(null, vals);
    if (hi - lo < 1e-6) { hi = lo + 1; }
    const y = (v) => h - 4 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (h - 8);
    const pts = vals.map((v, i) => [1 + (i / (n - 1)) * (w - 2), y(v)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const area = line + 'L' + (w - 1) + ' ' + h + 'L1 ' + h + 'Z';
    let extra = '';
    if (o.target != null) extra += '<line x1="0" x2="' + w + '" y1="' + y(o.target) + '" y2="' + y(o.target) + '" stroke="var(--ink2)" stroke-dasharray="4 4" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    if (o.grid) for (const g of o.grid) extra += '<line x1="0" x2="' + w + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="var(--line2)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    const last = pts[n - 1];
    return '<svg class="sp" data-spark="' + key + '" data-unit="' + (o.unit || '') + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      extra + '<path d="' + area + '" fill="' + o.color + '" opacity=".16"/>' +
      '<path d="' + line + '" fill="none" stroke="' + o.color + '" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.6" fill="' + o.color + '" vector-effect="non-scaling-stroke"/></svg>';
  }
  function xlabels(t, few) {
    const n = t.length, idx = few ? [0, n - 1] : [0, Math.round(n / 3), Math.round((2 * n) / 3), n - 1];
    return '<div class="xl">' + idx.map((i) => '<span>' + Sim.fmtClock(t[i]) + '</span>').join('') + '</div>';
  }

  /* ---------- header & KPIs ---------- */
  /* ---------- theme, logo, weather, alerts (header) ---------- */
  const theme = () => document.documentElement.dataset.theme || 'dark';
  function toggleTheme() {
    const t = theme() === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('ff_theme', t); } catch (e) { /* private mode */ }
    cache.clear(); render();
  }
  const LOGO_MAX = 1024 * 1024;
  function logoSrc() {
    if (S && S.branding && S.branding.logo) return '/logo?v=' + S.branding.ver;
    try { return localStorage.getItem('ff_logo') || null; } catch (e) { return null; }
  }
  function logoHTML() {
    const src = logoSrc();
    return '<span class="logobox" data-act="logo"' + tipA(src ? 'Click to change the logo' : 'Click to add your logo (PNG, JPG, SVG or WEBP, max 1 MB)') + '>' +
      (src ? '<img src="' + src.replace(/"/g, '&quot;') + '" alt="logo">' : '<span class="lph">' + ico('bars') + '<b>LOGO</b></span>') + '</span>';
  }
  function pickLogo() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      if (f.size > LOGO_MAX) return alert('That image is ' + Math.round(f.size / 1024) + ' KB. The limit is 1024 KB: please use a smaller file.');
      if (!/^image\/(png|jpeg|svg\+xml|webp|gif)$/.test(f.type)) return alert('Please choose a PNG, JPG, SVG, WEBP or GIF image.');
      if (SERVER) {
        const h = { 'Content-Type': f.type }, t = sessionStorage.getItem('ff_admin'); if (t) h.Authorization = 'Bearer ' + t;
        const r = await fetch('/api/logo', { method: 'POST', headers: h, body: f });
        if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch (e) { /* none */ } return alert('Logo upload failed: ' + (m || 'HTTP ' + r.status)); }
      } else {
        const rd = new FileReader();
        rd.onload = () => { try { localStorage.setItem('ff_logo', rd.result); } catch (e) { alert('Could not store the logo in this browser.'); } cache.clear(); render(); };
        rd.readAsDataURL(f);
      }
    };
    inp.click();
  }
  async function removeLogo() {
    try { localStorage.removeItem('ff_logo'); } catch (e) { /* ignore */ }
    if (SERVER) { const h = {}, t = sessionStorage.getItem('ff_admin'); if (t) h.Authorization = 'Bearer ' + t; await fetch('/api/logo', { method: 'DELETE', headers: h }); }
    cache.clear(); render();
  }
  window.FFApp = { pickLogo, removeLogo, logoSrc: () => logoSrc(), isServer: () => SERVER };

  const WX_ICON = { storm: 'storm', rain: 'storm' };
  function weatherHTML() {
    const wi = S.weatherInfo || {}, bad = (S.alerts || []).some((a) => a.kind === 'weather' && a.level !== 'info');
    return '<div class="env' + (bad ? ' problem' : '') + '"' + tipA(wi.text ? esc(wi.text) + (wi.detail ? '<br>' + esc(wi.detail) : '') : 'Outside temperature') + '>' + ico(WX_ICON[wi.icon] || 'sun') + '<span>' + f0(S.weather) + '\u00b0C' + (wi.text ? ' \u00b7 ' + esc(wi.text) : '') + '</span></div>';
  }
  const ago = (ts) => { const m = Math.max(0, Math.round((Date.now() - ts) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min ago'; };
  const ackKey = (a) => a.id + ':' + a.level;                  // an escalation (watch -> critical) shows the bar again
  const acked = () => { try { return new Set(JSON.parse(localStorage.getItem('ff_acked') || '[]')); } catch (e) { return new Set(); } };
  function ackAlert(key) { const s = acked(); s.add(key); try { localStorage.setItem('ff_acked', JSON.stringify(Array.from(s).slice(-200))); } catch (e) { /* ignore */ } renderAlertBar(); }
  const KIND_ICON = { weather: 'storm', traffic: 'road', system: 'warn' };
  function renderAlertBar() {
    const ak = acked();
    const list = activeAlerts().filter((a) => a.level !== 'info' && !ak.has(ackKey(a))).sort((a, b) => (b.level === 'critical') - (a.level === 'critical') || b.ts - a.ts);
    const more = list.length - 2;
    setHTML($('#alertbar'), list.slice(0, 2).map((a, i) => '<div class="abar ' + a.level + '"><svg class="ic"><use href="#i-' + (KIND_ICON[a.kind] || 'warn') + '"/></svg><b>' + esc(a.title) + '</b><span>' + esc(a.msg) + '</span><small>' + ago(a.ts) + ' \u00b7 ' + esc(a.source) + '</small>' +
      '<button data-ack="' + esc(ackKey(a)) + '">Acknowledge</button><button data-href="#/alerts">' + (i === 1 && more > 0 ? '+' + more + ' more' : 'All alerts') + '</button></div>').join(''));
  }
  function activeAlerts() { return (S.alerts || []).filter((a) => !a.cleared); }
  function bellHTML() {
    const al = activeAlerts(), crit = al.some((a) => a.level === 'critical'), n = al.filter((a) => a.level !== 'info').length;
    return '<a class="bell' + (crit ? ' crit' : n ? ' warn' : '') + '" data-href="#/alerts"' + tipA(n ? n + ' active alert' + (n > 1 ? 's' : '') : 'No active alerts') + '>' + ico('bell') + (n ? '<b>' + n + '</b>' : '') + '</a>';
  }
  function renderHeader() {
    try { if (document.title !== T('title')) document.title = T('title'); } catch (e) { /* ignore */ }
    const d = new Date();
    const shift = S.clock >= 360 && S.clock < 840 ? 'A' : S.clock >= 840 && S.clock < 1320 ? 'B' : 'C';
    const date = DAYS[d.getDay()] + ', ' + String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    const stale = (S.stale || []).length;
    const demoOnly = S.demo !== false && !S.mixed;       // pure simulation: no badge in the top bar (the footer says "Simulated data")
    let badge = demoOnly ? ''
      : S.mixed ? '<span class="badge mixed" data-href="#/sources"' + tipA('Some domains are fed by real systems, the rest are still simulated. Click for details.') + '>MIXED DATA</span>'
      : '<span class="badge live" data-href="#/sources"' + tipA('All domains are fed by real systems.') + '>LIVE</span>';
    if (stale) badge += '<span class="badge stale" data-href="#/sources"' + tipA('No recent data for: ' + S.stale.join(', ') + ' (showing last known values)') + '>STALE: ' + S.stale.join(', ') + '</span>';
    setHTML($('#hdr'),
      logoHTML() + '<h1>' + esc(T('title')) + '</h1>' +
      '<div class="meta"><span>' + S.plant + '</span><i></i><span>Shift ' + shift + '</span><i></i><span>' + Sim.fmtClock(S.clock) + ' IST</span><i></i></div>' +
      badge + '<span class="sp"></span>' +
      '<a class="more cfg" data-href="#/settings"' + tipA('Interfaces: endpoints, sources, alerts, plant setup, logo') + '>\u2699</a>' +
      bellHTML() + '<button class="thm" data-act="theme"' + tipA('Switch dark / light theme') + '>' + ico(theme() === 'light' ? 'moon' : 'sun') + '</button>' +
      weatherHTML() +
      '<div class="env">' + ico('cal') + '<span>' + date + '</span></div>');
  }

  function kpi(icon, color, label, sub, val, extra, o) {
    o = o || {};
    return '<div class="kpi' + (o.alert ? ' alert' : '') + (o.href ? ' link' : '') + '"' + (o.href ? ' data-href="' + o.href + '"' : '') + tipA((o.alert ? '\u26a0 ' + o.alert + '<br>' : '') + (o.tip || label)) + '>' +
      '<svg class="ic" style="color:' + color + '"><use href="#i-' + icon + '"/></svg>' +
      '<div class="col"><div class="l">' + label + (sub ? '<small>' + sub + '</small>' : '') + '</div>' +
      '<div class="v">' + val + '</div>' + (extra || '') + '</div>' + (o.chev === false ? '' : '<span class="chev">›</span>') + '</div>';
  }
  const kcls = (v, okMin, watchMin) => (v >= okMin ? 'ok' : v >= watchMin ? 'watch' : 'low');

  function atRiskCount() { return S.parts.filter((p) => Sim.coverage(p) < Sim.RISK_MIN).length; }

  function renderKpis() {
    const b = S.build, y = S.yard;
    const pct = (b.actual / b.plan) * 100;
    const risk = atRiskCount();
    const onSite = Math.max(0, y.arrived - y.received);
    const del = S.deliveries, delPct = (del.onTime / del.total) * 100;
    const jc = kcls(S.kpi.jit, 98, 95), sc = kcls(S.kpi.stockAcc, 98, 95);
    const html = [
      kpi('car', 'var(--iconmap)', 'TODAY BUILD', '(Plan vs Actual)', f0(b.actual) + ' | ' + b.plan,
        '<div style="display:flex;align-items:center;gap:6px"><div class="mini"><b style="width:' + pct.toFixed(1) + '%"></b></div><span class="ok" style="font-size:14px;font-weight:700">' + f0(pct) + '%</span></div>',
        { alert: PROB.build, chev: false, href: '#/shop/assembly', tip: 'Vehicles completed vs shift plan. ' + (S.line.stopped ? 'LINE STOPPED: ' + S.line.reason : 'Line running.') }),
      kpi('warn', COL.low, 'PARTS AT RISK', '(next 120 min)', '<span class="low">' + pad2(risk) + '</span><small>(of ' + S.parts.length + ' total)</small>', '',
        { alert: PROB.risk, href: '#/parts', tip: 'Parts whose usable stock covers less than ' + Sim.RISK_MIN + ' min of consumption at the current line rate.' }),
      kpi('truck', COL.cy, 'ON-SITE TRUCKS', '(at plant)', pad2(onSite), '<div class="sub">(' + Math.min(4, Math.max(0, y.expected - y.arrived)) + ' expected)</div>',
        { alert: PROB.trucks, href: '#/inbound', tip: 'Trucks arrived at gate and not yet received.' }),
      kpi('forklift', COL.cy, 'DELIVERIES', 'ON TIME', '<span class="' + kcls(delPct, 92, 85) + '">' + f0(delPct) + '%</span>', '<div class="sub">(' + del.onTime + ' / ' + del.total + ')</div>',
        { alert: PROB.deliveries, href: '#/transfers', tip: 'Cumulative on-time internal deliveries this shift.' }),
      kpi('target', COL.cy, T('jit').toUpperCase(), '(last 2 hrs)', '<span class="' + jc + '">' + f1(S.kpi.jit) + '%</span>', '', { alert: PROB.jit, href: '#/quality', tip: T('jit') + ' over the last 2 hours. JIT = Just-In-Time: share of deliveries that arrived within their delivery window (not early, not late).' }),
      kpi('stop', COL.low, 'LINE STOP', '(no component)', '<span class="' + (S.line.stoppedMin > 0 ? 'low' : 'ok') + '">' + f0(S.line.stoppedMin) + '</span><small>min</small>',
        S.line.stopped ? '<div class="sub low">' + esc(S.line.reason) + '</div>' : '<div class="sub">' + S.line.stops + ' stop' + (S.line.stops === 1 ? '' : 's') + ' today</div>',
        { alert: PROB.stops, href: '#/events', tip: 'Minutes the line was stopped because a critical component was missing, today. ' + (S.line.stopped ? 'STOPPED NOW: ' + esc(S.line.reason) : 'Line is running.') }),
      kpi('warn', COL.watch, 'LINE RUN', '(no components)', '<span class="' + (S.line.runWithoutMin > 0 ? 'watch' : 'ok') + '">' + f0(S.line.runWithoutMin) + '</span><small>min</small>',
        '<div class="sub' + (S.line.missing ? ' watch' : '') + '">' + (S.line.missing ? S.line.missing + ' component' + (S.line.missing === 1 ? '' : 's') + ' missing now' : 'none missing now') + '</div>',
        { alert: PROB.run, href: '#/parts', tip: 'Minutes the line kept building while a non-critical component was missing, today (vehicles are completed later). Missing now: ' + S.line.missing }),
      kpi('clock', COL.cy, T('bay').toUpperCase() + ' TURNAROUND', '(avg. truck)', f0(y.g2d) + '<small>min</small>', '', { alert: PROB.bay, href: '#/inbound', tip: 'Average gate-to-' + T('bay').toLowerCase() + ' time per truck.' }),
      kpi('db', COL.cy, 'STOCK ACCURACY', '(cycle count)', '<span class="' + sc + '">' + f1(S.kpi.stockAcc) + '%</span>', '', { alert: PROB.stock, href: '#/lineside', tip: 'Cycle-count accuracy of system vs physical stock.' })
    ].join('');
    setHTML($('#kpis'), html);
  }

  /* ---------- tabs ---------- */
  function renderTabs() {
    const tabs = [['all', 'ALL SHOPS']].concat(SHOPS.map((s) => [s, s.toUpperCase()]));
    setHTML($('#tabs'),
      tabs.map((t) => '<button data-shop="' + t[0] + '" class="' + (ui.shop === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') +
      '<span class="gap"></span><button class="drill" data-href="' + (ui.shop === 'all' ? '#/parts' : '#/shop/' + ui.shop) + '">' + ico('bars') + '  Drill down to ' + (ui.shop === 'all' ? 'parts / shop / line' : ui.shop + ' shop') + ' \u203a</button>');
  }

  /* ---------- plant map: block layout + sequenced material flows (see map.js) ---------- */
  function renderMapLegend() {
    setHTML($('#map-legend'),
      '<span><i class="bg-ok"></i>Normal</span><span><i class="bg-watch"></i>Watch</span><span><i class="bg-low"></i>Low / Risk</span>' +
      '<span><svg viewBox="0 0 40 10"><path d="M0 5H34" stroke="var(--seq)" stroke-width="2.2" stroke-dasharray="2 4" stroke-linecap="round"/><path d="M32 1l7 4-7 4z" fill="var(--seq)"/></svg>Sequenced flow</span>' +
      '<span><i class="asm"></i>Assumed</span>' +
      '<span><i class="ov"></i>Overlay (not a shop)</span>' +
      '<span><svg viewBox="0 0 12 10"><circle cx="6" cy="5" r="4" class="cr"/><circle cx="6" cy="5" r="1.5" class="cr2"/></svg>AMR</span>' +
      '<span><svg viewBox="0 0 16 10"><rect x="1" y="2" width="8" height="6" rx="1.5" class="cr"/><rect x="9.5" y="3" width="5.5" height="4.4" rx="1.2" class="cr2"/></svg>Tow</span>');
  }
  function renderMap() {
    const r = window.FFMap.render(S, { T, f0, ui, IV: Sim.inventoryView(S) });
    setHTML($('#roads'), '');
    setHTML($('#flows'), r.flows);
    setHTML($('#nodes'), r.nodes);
  }

  /* ---------- the three verticals + the (small) line-risk tile ---------- */
  const worst = (...st) => (st.indexOf('low') >= 0 ? 'low' : st.indexOf('watch') >= 0 ? 'watch' : 'ok');
  const vband = (letter, title, right, rightSt) => '<div class="vh"><span class="vb">' + letter + '</span><h2>' + title + '</h2><span class="vr' + (rightSt ? ' ' + rightSt : '') + '">' + right + '</span></div>';
  const sortedParts = () => S.parts.filter((p) => ui.shop === 'all' || p.shop === ui.shop).sort((a, b) => Sim.coverage(a) - Sim.coverage(b));
  const clockOf = (m) => Sim.fmtClock(m);

  /* A. Inbound trucks */
  function renderVA() {
    const y = S.yard, h = S.hist, waiting = Math.max(0, y.arrived - y.docked), full = y.occupied >= y.docks;
    const st = full ? 'low' : waiting >= 6 || y.occupied / y.docks > 0.92 ? 'watch' : 'ok';
    const cell = (lab, val, sub) => '<div class="vc"><small>' + lab + '</small><b>' + val + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</div>';
    const pc = (n) => f0((n / Math.max(1, y.expected)) * 100) + '%';
    const mini = (lab, val, key, arr) => '<div class="vm"><div class="vt"><small>' + lab + '</small><b>' + f0(val) + ' min</b></div>' + spark(key, arr, { color: 'var(--cyan)', unit: ' min', h: 30 }) + '</div>';
    const next = S.trucks.filter((t) => t.status === 'docked' || t.status === 'arrived').slice(0, 2).concat(S.trucks.filter((t) => t.status === 'scheduled').slice(0, 2)).slice(0, 4);
    const chip = (t) => t.status === 'docked' ? '<span class="chip cy">' + esc(T('atBay').toUpperCase()) + (t.dock ? ' ' + t.dock : '') + '</span>' : t.status === 'arrived' ? '<span class="chip watch">WAITING</span>' : '<span class="chip mut">ETA ' + (t.sched !== null && t.sched !== undefined ? clockOf(t.sched) : '—') + '</span>';
    setHTML($('#v-a'),
      vband('A', 'INBOUND TRUCKS', waiting + ' waiting', waiting >= 6 ? 'low' : waiting >= 3 ? 'watch' : 'ok') +
      '<div class="vbody">' +
      '<div class="vcs">' + cell('Expected', y.expected) + cell('Arrived', y.arrived, pc(y.arrived)) + cell(T('atBay'), y.docked, pc(y.docked)) + cell('Received', y.received, pc(y.received)) + '</div>' +
      '<div class="vbays"' + tipA(y.occupied + ' of ' + y.docks + ' ' + esc(T('bays').toLowerCase()) + ' in use') + '><span><b>' + y.occupied + ' / ' + y.docks + '</b> ' + esc(T('bays').toLowerCase()) + ' in use</span><div class="vbar"><b class="' + st + '" style="width:' + Math.min(100, (y.occupied / Math.max(1, y.docks)) * 100).toFixed(0) + '%"></b></div></div>' +
      '<div class="vms">' + mini('Gate → ' + esc(T('bay').toLowerCase()), y.g2d, 'g2d', h.g2d) + mini('Truck turnaround', y.turn, 'turn', h.turn) + '</div>' +
      '<div class="vtl">' + next.map((t) => '<div class="vtr"><b>' + esc(t.id) + '</b><span>' + esc(fitStr(t.sup, 13)) + '</span><span class="mut">' + esc(fitStr(t.mat, 14)) + '</span>' + chip(t) + '</div>').join('') + '</div></div>');
    $('#v-a').dataset.href = '#/inbound';
  }
  const fitStr = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

  /* B. JV parts */
  function jvRows() {
    const IV = Sim.inventoryView(S), wip = {}; IV.wip.forEach((w) => { wip[w.id] = w; });
    return S.jvSites.map((j) => {
      const r = S.jv.routes.find((q) => (q.key || '').toLowerCase() === j.name.toLowerCase() || q.name.toLowerCase().indexOf(j.name.toLowerCase() + ' ') === 0);
      const rp = r ? r.ema * 100 : null, bst = Sim.bufferStatus(j.buf), rst = rp === null ? 'ok' : Sim.routeStatus(rp), w = wip['jv:' + j.name];
      return { name: j.name, buf: j.buf, hours: w ? w.hours : null, rp, bst, rst, st: worst(bst, rst) };
    });
  }
  function renderVB() {
    const rows = jvRows(), low = rows.filter((r) => r.st === 'low').length, watch = rows.filter((r) => r.st === 'watch').length;
    setHTML($('#v-b'),
      vband('B', 'JV PARTS', low ? low + ' at risk' : watch ? watch + ' watch' : 'all OK', low ? 'low' : watch ? 'watch' : 'ok') +
      '<div class="vbody"><div class="jh"><span></span><span>JV part</span><span>Buffer</span><span></span><span>Stock</span><span>On time</span></div>' +
      rows.map((r) => '<div class="jr" data-href="#/amr" data-fleet="jv"' + tipA(esc(r.name) + ' · buffer ' + f0(r.buf) + '%' + (r.hours !== null ? ', ' + r.hours.toFixed(1) + ' h of stock' : '') + (r.rp !== null ? ', route ' + f0(r.rp) + '% on time' : '')) + '>' +
        '<i class="sd ' + r.st + '"></i><span class="nm">' + esc(r.name) + '</span><span class="jb"><b class="' + r.bst + '" style="width:' + Math.max(2, Math.min(100, r.buf)).toFixed(0) + '%"></b></span><em class="' + r.bst + '">' + f0(r.buf) + '%</em>' +
        '<span class="hr">' + (r.hours !== null ? (r.hours < 10 ? r.hours.toFixed(1) : f0(r.hours)) + ' h' : '—') + '</span><span class="ot ' + r.rst + '">' + (r.rp !== null ? f0(r.rp) + '%' : '—') + '</span></div>').join('') + '</div>');
  }

  /* C. In-house parts: IP, Bumper, TM, Engine */
  function inhouseRows() {
    const IV = Sim.inventoryView(S), wip = {}; IV.wip.forEach((w) => { wip[w.id] = w; });
    const tr = (id) => S.transfers.find((t) => t.id === id), pc = (t) => (t ? (t.q.reduce((a, c) => a + c, 0) / t.q.length) * 100 : null);
    const ls = (kw) => S.lineside.find((l) => l.name.toLowerCase().indexOf(kw) >= 0);
    return [['ip', 'IP', 'ip', null], ['bumper', 'Bumper', 'bmp', 'bumper'], ['tm', 'TM', 'tm', null], ['engine', 'Engine', 'eng', 'engine']].map((d) => {
      const sh = S.shops[d[0]], t = tr(d[2]), p = pc(t), l = d[3] ? ls(d[3]) : null, bst = Sim.bufferStatus(sh.buf), rst = p === null ? 'ok' : p < 78 ? 'low' : p < 90 ? 'watch' : 'ok', lst = l ? Sim.linesideStatus(l) : null;
      return { id: d[0], name: d[1], buf: sh.buf, hours: wip[d[0]] ? wip[d[0]].hours : null, p, bst, rst, lst, ln: l ? l.name : null, st: worst(bst, rst, lst || 'ok') };
    });
  }
  function renderVC() {
    const rows = inhouseRows(), low = rows.filter((r) => r.st === 'low').length, watch = rows.filter((r) => r.st === 'watch').length;
    setHTML($('#v-c'),
      vband('C', 'INHOUSE PARTS', low ? low + ' at risk' : watch ? watch + ' watch' : 'all OK', low ? 'low' : watch ? 'watch' : 'ok') +
      '<div class="vbody">' + rows.map((r) => '<div class="ir ' + r.st + '" data-href="#/shop/' + (r.id === 'ip' || r.id === 'tm' ? 'assembly' : r.id) + '"' + tipA(esc(r.name) + ' · buffer ' + f0(r.buf) + '%' + (r.hours !== null ? ', ' + r.hours.toFixed(1) + ' h of stock' : '') + (r.p !== null ? ', ' + f0(r.p) + '% of deliveries to assembly on time' : '') + (r.ln ? ', line-side ' + esc(r.ln) + ': ' + statusLabel[r.lst] : '')) + '>' +
        '<div class="il"><i class="sd ' + r.st + '"></i><b>' + esc(r.name) + '</b><span class="jb"><b class="' + r.bst + '" style="width:' + Math.max(2, Math.min(100, r.buf)).toFixed(0) + '%"></b></span><em class="' + r.bst + '">' + f0(r.buf) + '%</em></div>' +
        '<div class="is"><span>' + (r.hours !== null ? (r.hours < 10 ? r.hours.toFixed(1) : f0(r.hours)) + ' h of stock' : 'stock —') + '</span><span class="' + r.rst + '">' + (r.p !== null ? f0(r.p) + '% on time to assembly' : 'no route data') + '</span>' + (r.ln ? '<span class="' + r.lst + '">line-side ' + statusLabel[r.lst] + '</span>' : '<span class="mut">line-side —</span>') + '</div></div>').join('') + '</div>');
  }

  /* line risk: the small tile */
  function renderRisk() {
    const list = sortedParts(), top = list.slice(0, 3), m = top.length ? Sim.coverage(top[0]) : 9999, st = Sim.partStatus(m), el = $('#p-risk');
    el.className = 'vbox risk ' + (st === 'low' ? '' : st);
    const scope = ui.shop === 'all' ? '' : ' · ' + ui.shop.toUpperCase();
    setHTML(el,
      '<div class="vh"><span class="vb">!</span><h2>LINE RISK' + scope + '</h2><span class="vr">next 120 min</span></div>' +
      '<div class="vbody"><div class="banner ' + (st === 'low' ? '' : st) + '"><span style="color:' + COL[st] + '">' + ico(st === 'ok' ? 'target' : 'warn') + '</span><b>EARLIEST SHORTAGE <em style="color:' + COL[st] + '">' + (m < 9000 ? f0(m) + ' MIN' : '—') + '</em></b></div>' +
      (top.length ? top.map((p) => { const c = Sim.coverage(p), ps = Sim.partStatus(c), a = Sim.nextAction(S, p);
        return '<div class="rr"' + tipA(esc(p.name) + ' — ' + f0(p.stock) + ' pcs at ' + p.rate + ' pcs/min. ' + (p.pending ? 'Inbound ' + esc(p.pending.ref) + ' ETA ' + clockOf(S.clock + p.pending.eta) : 'No inbound planned') + '. Owner: ' + esc(a.owner)) + '><span class="cov ' + ps + '">' + f0(c) + ' min</span><span class="rn"><b>' + esc(fitStr(p.name, 22)) + '</b><small>' + esc(fitStr(a.text, 30)) + '</small></span></div>'; }).join('')
        : '<div class="empty">No tracked parts for this shop.</div>') +
      '<a class="more" data-href="' + (ui.shop === 'all' ? '#/parts' : '#/shop/' + ui.shop) + '">All parts ›</a></div>');
  }

  /* ---------- footer ---------- */
  function renderFoot() {
    const sp = [1, 30, 120, 600];
    const ev = S.events[0];
    const col = ev ? (ev.lvl === 'low' ? COL.low : ev.lvl === 'watch' ? COL.watch : ev.lvl === 'ok' ? COL.ok : 'var(--ink2)') : 'var(--ink2)';
    const demo = S.demo !== false && !S.mixed;
    let left;
    if (demo) {
      left = '<span class="mut">Simulated data</span><span class="sep"></span>' + (SERVER ? '' : '<button data-act="pause">' + (S.paused ? '▶ Resume' : '⏸ Pause') + '</button>') +
        '<span>Sim speed</span>' + sp.map((s) => '<button data-speed="' + s + '" class="' + (S.speed === s ? 'on' : '') + '">' + s + '×</button>').join('') +
        '<span class="sep"></span><span>Demo:</span>' +
        [['missingPart', 'Missing part (line runs)'], ['trafficJam', 'Traffic jam'], ['stormWarning', 'Storm warning'], ['unusualEvent', 'Road blockade'], ['clearAlerts', 'Clear alerts'], ['truckDelay', 'Truck delay'], ['bumperJam', 'Bumper slowdown'], ['shortage', 'Engine mount shortage'], ['amrFault', 'AMR battery fault'], ['jvDelay', S.setup.jvs[Math.min(2, S.setup.jvs.length - 1)] + ' delay']]
          .map((b) => '<button data-inject="' + b[0] + '">' + b[1] + '</button>').join('') +
        (SERVER ? '' : '<button data-act="reset">Reset</button>');
    } else {
      left = '<span>Real-time data — simulation controls disabled</span><button data-href="#/sources">Data sources ›</button>';
    }
    setHTML($('#foot'), left + '<span class="ev" style="color:' + col + '">' + (ev ? Sim.fmtClock(ev.t) + '  ' + ev.msg : '') + '</span>');
  }

  /* ---------- what counts as a problem (red glow on tiles / panels / map nodes) ---------- */
  let PROB = {};
  function problems() {
    const y = S.yard, P = {}, wait = Math.max(0, y.arrived - y.docked), bays = T('bays').toLowerCase();
    const crit = S.parts.filter((p) => Sim.coverage(p) < 30).length;
    P.build = S.line.stopped ? 'Line stopped: ' + S.line.reason : null;
    P.stops = S.line.stopped ? 'Line stopped: ' + S.line.reason : S.line.stoppedMin > 0 ? f0(S.line.stoppedMin) + ' min stopped without a component today' : null;
    P.run = S.line.missing > 0 ? S.line.missing + ' component' + (S.line.missing > 1 ? 's' : '') + ' missing while the line runs' : null;
    const jvLow = jvRows().filter((r) => r.st === 'low').map((r) => r.name), ihLow = inhouseRows().filter((r) => r.st === 'low').map((r) => r.name);
    P.jv = jvLow.length ? 'JV parts at risk: ' + jvLow.join(', ') : null;
    P.inhouse = ihLow.length ? 'In-house parts at risk: ' + ihLow.join(', ') : null;
    P.risk = crit ? crit + ' part' + (crit > 1 ? 's' : '') + ' with under 30 min of cover' : null;
    P.trucks = wait >= 6 ? wait + ' trucks waiting for a ' + T('bay').toLowerCase() : y.occupied >= y.docks ? 'All ' + bays + ' occupied' : null;
    const dp = (S.deliveries.onTime / Math.max(1, S.deliveries.total)) * 100;
    P.deliveries = dp < 85 ? 'On-time rate ' + f0(dp) + '% (below 85%)' : null;
    P.jit = S.kpi.jit < 95 ? T('jit') + ' ' + f1(S.kpi.jit) + '% (below 95%)' : null;
    P.bay = y.g2d > 45 ? 'Gate-to-' + T('bay').toLowerCase() + ' time ' + f0(y.g2d) + ' min (above 45)' : null;
    P.stock = S.kpi.stockAcc < 95 ? 'Stock accuracy ' + f1(S.kpi.stockAcc) + '% (below 95%)' : null;
    P.inbound = P.trucks || P.bay || (y.turn > 90 ? 'Truck turnaround ' + f0(y.turn) + ' min (above 90)' : null);
    const late = S.transfers.filter((t) => (t.q.reduce((a, c) => a + c, 0) / t.q.length) * 100 < 78).map((t) => t.name);
    P.transfers = late.length ? 'Delayed: ' + late.join(', ') : null;
    const low = S.lineside.filter((l) => Sim.linesideStatus(l) === 'low').map((l) => l.name);
    P.lineside = low.length ? 'Low line-side stock: ' + low.join(', ') : null;
    P.quality = S.quality.spf < 90 ? 'Single-piece flow ' + f0(S.quality.spf) + '% (below 90%)' : null;
    const badRoute = S.amr.routes.concat(S.jv.routes).filter((r) => Sim.routeStatus(r.ema * 100) === 'low').length, lowB = Sim.fleetView(S.amr).low + Sim.fleetView(S.jv).low;
    P.amr = badRoute ? badRoute + ' AMR route' + (badRoute > 1 ? 's' : '') + ' running late' : lowB >= 3 ? lowB + ' AMRs with low battery' : null;
    return P;
  }
  const flagPanel = (sel, why) => { const el = $(sel); if (el) { el.classList.toggle('problem', !!why); } };

  /* ---------- render all ---------- */
  const route = () => location.hash.replace(/^#\/?/, '');
  const H = { spark, xlabels, ico, f0, f1, pad2, COL, statusLabel, esc, ago };
  let lastRoute = null;
  function render() {
    if (!S) return;
    const r = route();
    const FORM = { settings: window.FFSettings, datapoints: window.FFDatapoints };
    if (lastRoute && FORM[lastRoute] && lastRoute !== r && FORM[lastRoute].unmount) FORM[lastRoute].unmount();
    if (FORM[r]) {                                // form pages: mounted once, only status cells update (never re-rendered, or typing would be lost)
      $('#stage').classList.add('paged'); renderHeader(); renderAlertBar();
      if (lastRoute !== r) { cache.delete($('#page')); $('#page').scrollTop = 0; lastRoute = r; FORM[r].mount($('#page'), S, { server: SERVER }); }
      else FORM[r].update(S);
      renderFoot(); return;
    }
    const page = r ? window.FFPages.render(r, S, H, ui) : null;
    $('#stage').classList.toggle('paged', page !== null);
    renderHeader(); renderAlertBar();
    if (page !== null) {
      if (lastRoute !== r) { cache.delete($('#page')); $('#page').scrollTop = 0; lastRoute = r; }
      setHTML($('#page'), page);
      renderFoot();
      return;
    }
    lastRoute = null;
    PROB = problems();
    renderKpis(); renderTabs(); renderMap(); renderRisk(); renderVA(); renderVB(); renderVC(); renderFoot();
    flagPanel('#v-a', PROB.inbound); flagPanel('#v-b', PROB.jv); flagPanel('#v-c', PROB.inhouse);
  }
  addEventListener('hashchange', render);

  /* ---------- interaction ---------- */
  function post(path) { return fetch(path, { method: 'POST' }).catch(() => {}); }
  function setSpeed(n) { if (SERVER) post('/api/speed/' + n); else S.speed = n; render(); }
  const go = (h) => { if (h === '#/') { history.pushState(null, '', location.pathname + location.search); render(); } else location.hash = h; };
  // content is re-rendered every second, so navigation uses pointerdown (click needs the same element for down+up)
  function downloadInvCsv() {
    const { rows } = window.FFPages.invRows(S, ui), cols = ['inbound', 'bay', 'lineside', 'total'];
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"', n = (v) => (v === null || v === undefined ? '' : (+v).toFixed(2));
    const lines = [['part_id', 'part', 'shop', 'location', 'rate_per_min'].concat(cols.map((c) => c + '_hours'), cols.map((c) => c + '_pcs')).map(q).join(',')];
    rows.forEach((r) => lines.push([q(r.id), q(r.name), q(r.shop), q(r.loc), n(r.rate)].concat(cols.map((c) => n(r.h[c])), cols.map((c) => n(r.pcs[c]))).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'inventory-hours-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }
  document.addEventListener('pointerdown', (e) => {
    const th = e.target.closest && e.target.closest('[data-act="theme"]');
    if (th) { toggleTheme(); return; }
    const ak = e.target.closest && e.target.closest('[data-ack]');
    if (ak) { ackAlert(ak.dataset.ack); return; }
    const lg = e.target.closest && e.target.closest('[data-act="logo"]');
    if (lg) { pickLogo(); return; }
    const b = e.target.closest && e.target.closest('button');
    if (b && (b.dataset.invsort || b.dataset.pshop || b.dataset.fleet || b.dataset.act === 'invcsv')) {   // page re-renders every second: act on pointerdown
      if (b.dataset.invsort) ui.invSort = b.dataset.invsort;
      else if (b.dataset.pshop) ui.pshop = b.dataset.pshop;
      else if (b.dataset.fleet) ui.fleet = b.dataset.fleet;
      else downloadInvCsv();
      render(); return;
    }
    const l = e.target.closest && e.target.closest('[data-href]');
    if (!l || !l.dataset.href) return;
    const g = l.closest('.nd');
    if (l.dataset.fleet) ui.fleet = l.dataset.fleet;
    if (g && g.dataset.shop && ui.shop !== g.dataset.shop) return;      // first click on a shop node selects it (handled below)
    go(l.dataset.href);
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.shop) { ui.shop = t.dataset.shop; render(); }
    else if (t.dataset.pshop) { ui.pshop = t.dataset.pshop; render(); }
    else if (t.dataset.fleet) { ui.fleet = t.dataset.fleet; render(); }
    else if (t.dataset.href) go(t.dataset.href);
    else if (t.dataset.speed) setSpeed(+t.dataset.speed);
    else if (t.dataset.inject) { SERVER ? post('/api/inject/' + t.dataset.inject) : Sim.inject(S, t.dataset.inject); render(); }
    else if (t.dataset.act === 'pause') { S.paused = !S.paused; render(); }
    else if (t.dataset.act === 'reset') { const sp = S.speed; S = Sim.createState(); S.speed = sp; render(); }
  });
  // map nodes: first click selects a shop (filters risk table), clicking the selected shop opens its page
  $('#map').addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.nd');
    if (!g || !g.dataset.shop) return;
    if (ui.shop !== g.dataset.shop) { ui.shop = g.dataset.shop; render(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && route()) go('#/'); });

  const tip = $('#tip');
  document.addEventListener('mousemove', (e) => {
    let text = '';
    const sp = e.target.closest && e.target.closest('[data-spark]');
    if (sp && S) {
      const key = sp.dataset.spark;
      const arr = key.indexOf('shop:') === 0 ? S.hist.shops[key.slice(5)] : S.hist[key], r = sp.getBoundingClientRect();
      const i = Math.max(0, Math.min(arr.length - 1, Math.round(((e.clientX - r.left) / r.width) * (arr.length - 1))));
      text = '<b>' + Sim.fmtClock(S.hist.t[i]) + '</b> — ' + arr[i].toFixed(1) + sp.dataset.unit;
    } else {
      const d = e.target.closest && e.target.closest('[data-tip]');
      if (d) text = d.dataset.tip;
    }
    if (!text) { tip.hidden = true; return; }
    tip.innerHTML = text; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(innerWidth - w - 8, e.clientX + 14) + 'px';
    tip.style.top = Math.min(innerHeight - h - 8, e.clientY + 16) + 'px';
  });

  /* ---------- fit 1672x941 board to any screen ---------- */
  function fit() {
    const s = Math.min(innerWidth / 1672, innerHeight / 941), st = $('#stage');
    st.style.transform = 'scale(' + s + ')';
    st.style.left = (innerWidth - 1672 * s) / 2 + 'px';
    st.style.top = (innerHeight - 941 * s) / 2 + 'px';
  }
  addEventListener('resize', fit); fit();

  /* ---------- data source ---------- */
  // Served by our Node server -> use its stream (real feeds + Interfaces page). Opened as a file / static host -> local simulation.
  // ?source=server forces the server, ?source=local forces the in-browser simulation.
  async function detectServer() {
    const src = params.get('source');
    if (src === 'server') return true;
    if (src === 'local' || location.protocol === 'file:') return false;
    try { const r = await fetch('/api/health', { signal: AbortSignal.timeout(1500) }); return r.ok; } catch (e) { return false; }
  }
  renderMapLegend();
  detectServer().then((isServer) => {
    SERVER = isServer;
    if (SERVER) {
      const es = new EventSource('/events');
      es.onmessage = (e) => { S = JSON.parse(e.data); render(); };
    } else {
      S = Sim.createState();
      const sp = +params.get('speed'); if (sp) S.speed = sp;
      render();
      let last = performance.now();
      setInterval(() => {
        const now = performance.now(), dt = Math.min(5, (now - last) / 1000); last = now;
        Sim.step(S, dt * S.speed);
        render();
      }, 1000);
    }
  });
})();
