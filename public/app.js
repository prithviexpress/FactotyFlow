/* FactoryFlow control-tower renderer. Pure function of the state object (see sim.js). */
(function () {
  'use strict';
  const Sim = window.FactorySim;
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  let SERVER = false;   // true when state comes from the Node server (auto-detected, see detectServer())
  const COL = { ok: '#22e07a', watch: '#ffc83d', low: '#ff4d4d', cy: '#29b6ff' };
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
  const mi = (n, x, y, s, c) => '<use href="#i-' + n + '" x="' + x + '" y="' + y + '" width="' + s + '" height="' + s + '" style="color:' + (c || '#7fb2f0') + '"/>';
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
    if (o.target != null) extra += '<line x1="0" x2="' + w + '" y1="' + y(o.target) + '" y2="' + y(o.target) + '" stroke="#9fb4d6" stroke-dasharray="4 4" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    if (o.grid) for (const g of o.grid) extra += '<line x1="0" x2="' + w + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="#16294a" stroke-width="1" vector-effect="non-scaling-stroke"/>';
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
  function renderHeader() {
    const d = new Date();
    const shift = S.clock >= 360 && S.clock < 840 ? 'A' : S.clock >= 840 && S.clock < 1320 ? 'B' : 'C';
    const date = DAYS[d.getDay()] + ', ' + String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    const stale = (S.stale || []).length;
    let badge = S.demo !== false && !S.mixed
      ? '<span class="badge" data-href="#/sources"' + tipA('Values are simulated. Click for data sources / how to connect real feeds.') + '>DEMO DATA</span>'
      : S.mixed ? '<span class="badge mixed" data-href="#/sources"' + tipA('Some domains are fed by real systems, the rest are still simulated. Click for details.') + '>MIXED DATA</span>'
      : '<span class="badge live" data-href="#/sources"' + tipA('All domains are fed by real systems.') + '>LIVE</span>';
    if (stale) badge += '<span class="badge stale" data-href="#/sources"' + tipA('No recent data for: ' + S.stale.join(', ') + ' (showing last known values)') + '>STALE: ' + S.stale.join(', ') + '</span>';
    setHTML($('#hdr'),
      '<span class="logo">' + ico('bars') + '</span><h1>AUTOMOTIVE LOGISTICS CONTROL TOWER</h1>' +
      '<div class="meta"><span>' + S.plant + '</span><i></i><span>Shift ' + shift + '</span><i></i><span>' + Sim.fmtClock(S.clock) + ' IST</span><i></i></div>' +
      badge + '<span class="sp"></span>' +
      '<a class="more cfg" data-href="#/settings"' + tipA('Configure where each data point comes from') + '>\u2699 Interfaces</a>' +
      '<div class="env">' + ico('sun') + '<span>' + f0(S.weather) + '°C</span></div>' +
      '<div class="env">' + ico('cal') + '<span>' + date + '</span></div>');
  }

  function kpi(icon, color, label, sub, val, extra, o) {
    o = o || {};
    return '<div class="kpi' + (o.alert ? ' alert' : '') + (o.href ? ' link' : '') + '"' + (o.href ? ' data-href="' + o.href + '"' : '') + tipA(o.tip || label) + '>' +
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
    const jc = kcls(S.kpi.jis, 98, 95), sc = kcls(S.kpi.stockAcc, 98, 95);
    const html = [
      kpi('car', '#8fd0ff', 'TODAY BUILD', '(Plan vs Actual)', f0(b.actual) + ' | ' + b.plan,
        '<div style="display:flex;align-items:center;gap:6px"><div class="mini"><b style="width:' + pct.toFixed(1) + '%"></b></div><span class="ok" style="font-size:14px;font-weight:700">' + f0(pct) + '%</span></div>',
        { chev: false, href: '#/shop/assembly', tip: 'Vehicles completed vs shift plan. ' + (S.line.stopped ? 'LINE STOPPED: ' + S.line.reason : 'Line running.') }),
      kpi('warn', COL.low, 'PARTS AT RISK', '(next 120 min)', '<span class="low">' + pad2(risk) + '</span><small>(of ' + S.parts.length + ' total)</small>', '',
        { href: '#/parts', tip: 'Parts whose usable stock covers less than ' + Sim.RISK_MIN + ' min of consumption at the current line rate.' }),
      kpi('truck', COL.cy, 'ON-SITE TRUCKS', '(at plant)', pad2(onSite), '<div class="sub">(' + Math.min(4, Math.max(0, y.expected - y.arrived)) + ' expected)</div>',
        { href: '#/inbound', tip: 'Trucks arrived at gate and not yet received.' }),
      kpi('forklift', COL.cy, 'INTERNAL DELIVERIES', 'ON TIME', '<span class="' + kcls(delPct, 92, 85) + '">' + f0(delPct) + '%</span>', '<div class="sub">(' + del.onTime + ' / ' + del.total + ')</div>',
        { href: '#/transfers', tip: 'Cumulative on-time internal deliveries this shift.' }),
      kpi('target', COL.cy, T('jis').toUpperCase(), '(last 2 hrs)', '<span class="' + jc + '">' + f1(S.kpi.jis) + '%</span>', '', { href: '#/quality', tip: T('jis') + ' over the last 2 hours. JIS = Just-In-Sequence: parts delivered in the exact order of the vehicles on the line (not merely on time).' }),
      kpi('stop', COL.low, 'LOGISTICS LINE STOPS', '(today)', '<span class="' + (S.line.stops ? 'low' : 'ok') + '">' + pad2(S.line.stops) + '</span>',
        S.line.stopped ? '<div class="sub low">' + S.line.reason + '</div>' : '',
        { alert: S.line.stopped, href: '#/events', tip: S.line.stopped ? 'LINE STOPPED — ' + S.line.reason : 'Line stops caused by logistics (shortages) today. Stopped time: ' + f1(S.line.stoppedMin) + ' min' }),
      kpi('clock', COL.cy, T('bay').toUpperCase() + ' TURNAROUND', '(avg. truck)', f0(y.g2d) + '<small>min</small>', '', { href: '#/inbound', tip: 'Average gate-to-' + T('bay').toLowerCase() + ' time per truck.' }),
      kpi('db', COL.cy, 'STOCK ACCURACY', '(cycle count)', '<span class="' + sc + '">' + f1(S.kpi.stockAcc) + '%</span>', '', { href: '#/lineside', tip: 'Cycle-count accuracy of system vs physical stock.' })
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

  /* ---------- plant map ---------- */
  function nd(id, x, y, w, h, st, inner, shop) {
    const sel = shop && ui.shop === shop;
    const dim = shop && ui.shop !== 'all' && ui.shop !== shop;
    const dot = st ? '<circle cx="' + (x + w - 10) + '" cy="' + (y + 10) + '" r="4.5" fill="' + COL[st] + '" class="' + (st === 'low' ? 'dot-low' : '') + '"/>' : '';
    const href = { gate: '#/inbound', docks: '#/inbound', finished: '#/inventory', ship: '#/shop/assembly' }[id] || (/^jv\d/.test(id) ? '#/amr' : '');
    const fleetAttr = /^jv\d/.test(id) ? ' data-fleet="jv"' : '';
    return '<g class="nd' + (sel ? ' sel' : '') + (dim ? ' dim' : '') + '" data-node="' + id + '" data-href="' + href + '"' + fleetAttr + ' data-shop="' + (shop || '') + '">' +
      '<rect class="box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="7"/>' + dot + inner + '</g>';
  }
  const tx = (x, y, s, cls, extra) => '<text x="' + x + '" y="' + y + '" class="' + (cls || '') + '" ' + (extra || '') + '>' + s + '</text>';
  function bar(x, y, w, pct, color) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="6" rx="3" fill="#10264a"/><rect x="' + x + '" y="' + y + '" width="' + Math.max(0, Math.min(w, (w * pct) / 100)).toFixed(1) + '" height="6" rx="3" fill="' + color + '"/>';
  }
  function shopNode(id, key, x, y, w, h, icon, title, shopKey, hrsLabel) {
    const buf = S.shops[key].buf, st = Sim.bufferStatus(buf);
    return nd(id, x, y, w, h, st,
      mi(icon, x + 10, y + 26, 36, '#8fb8ee') + tx(x + 54, y + 20, title, 't1') +
      tx(x + 54, y + 48, f0(buf) + '%', 'big ' + st) + tx(x + 54, y + 63, 'Buffer' + (hrsLabel || ''), 'sm') +
      bar(x + 10, y + h - 11, w - 20, buf, COL[st]), shopKey);
  }

  // JV nodes share the top row right of the bays; their number/names come from the plant setup (Interfaces page)
  function jvLayout() {
    const n = S.jvSites.length, gap = 8, w = Math.floor((655 - (n - 1) * gap) / n);
    return S.jvSites.map((j, i) => ({ i, x: 497 + i * (w + gap), w }));
  }
  const jvRoute = (name) => S.jv.routes.find((r) => (r.key || '').toLowerCase() === name.toLowerCase() || r.name.toLowerCase().indexOf(name.toLowerCase() + ' ') === 0);

  function mapNodes() {
    const y = S.yard, b = S.build, pct = (b.actual / b.plan) * 100;
    const IV = Sim.inventoryView(S), wipH = {}; IV.wip.forEach((w) => { wipH[w.id] = w.hours; });
    const hh = (h) => (h === null || h === undefined ? '' : ' \u00b7 ' + (h < 10 ? h.toFixed(1) : Math.round(h)) + ' h');
    const dockSt = y.occupied / y.docks > 0.92 ? 'watch' : 'ok';
    const out = [];
    out.push('<g class="nd" data-node="entrance"><rect class="box" x="0" y="193" width="72" height="46" rx="6"/>' +
      tx(36, 212, 'PLANT', 't1', 'text-anchor="middle"') + tx(36, 227, 'ENTRANCE', 't1', 'text-anchor="middle"') + '</g>');
    out.push(nd('gate', 87, 13, 195, 125, y.arrived >= y.docked + 8 ? 'watch' : 'ok',
      mi('car', 97, 40, 40, '#8fb8ee') + tx(150, 31, T('parking').toUpperCase(), 't1') + tx(150, 44, '(Gate \u2022 Inbound Trucks)', 't2') +
      [['parked', y.expected], ['arrived', y.arrived], [T('atBay').toLowerCase(), y.docked], ['received', y.received]].map((r, i) =>
        tx(150, 66 + i * 18, r[1], 'num') + tx(178, 66 + i * 18, r[0], 'sm')).join('')));
    out.push(nd('docks', 302, 20, 175, 78, dockSt,
      tx(314, 40, 'RECEIVING ' + T('bays').toUpperCase(), 't1') + mi('truck', 314, 48, 44, '#8fb8ee') +
      tx(366, 72, y.occupied + ' / ' + y.docks, 'big') + tx(366, 88, T('atBay'), 'sm')));
    jvLayout().forEach((L) => {
      const site = S.jvSites[L.i], r = jvRoute(site.name), rp = r ? r.ema * 100 : null, rst = rp === null ? 'ok' : Sim.routeStatus(rp), bst = Sim.bufferStatus(site.buf);
      const st = rst === 'low' || bst === 'low' ? 'low' : rst === 'watch' || bst === 'watch' ? 'watch' : 'ok';
      const narrow = L.w < 130;
      const max = Math.max(4, Math.floor((L.w - (narrow ? 52 : 28)) / 7.2)), nm = site.name.length > max ? site.name.slice(0, max - 1) + '\u2026' : site.name;
      out.push(nd('jv' + L.i, L.x, 20, L.w, 78, st,
        tx(L.x + 12, 40, nm, 't1') + tx(L.x + 12, 68, f0(site.buf) + '%', 'big ' + bst) +
        tx(L.x + 12, 86, 'Buffer' + hh(wipH['jv:' + site.name]), 'sm') +
        (narrow && rp !== null ? tx(L.x + L.w - 10, 40, f0(rp) + '%', 'num', 'text-anchor="end" style="fill:' + COL[rst] + ';font-size:12px"') : '') +
        (!narrow && rp !== null ? tx(L.x + L.w - 12, 62, f0(rp) + '%', 'num', 'text-anchor="end" style="fill:' + COL[rst] + '"') + tx(L.x + L.w - 12, 78, 'on time', 'sm', 'text-anchor="end"') : '')));
    });
    out.push(shopNode('press', 'press', 140, 198, 134, 82, 'press', 'PRESS', 'press', hh(wipH.press)));
    out.push(shopNode('weld', 'weld', 285, 198, 144, 82, 'weld', 'WELD', 'weld', hh(wipH.weld)));
    out.push(shopNode('paint', 'paint', 442, 198, 112, 82, 'paint', 'PAINT', 'paint', hh(wipH.paint)));
    out.push(shopNode('engine', 'engine', 157, 303, 190, 77, 'engine', 'ENGINE SHOP', 'engine', hh(wipH.engine)));
    out.push(shopNode('bumper', 'bumper', 362, 303, 165, 77, 'bumper', 'BUMPER SHOP', 'bumper', hh(wipH.bumper)));
    const stop = S.line.stopped, ast = stop ? 'low' : 'ok';
    out.push(nd('assembly', 640, 173, 170, 170, ast,
      mi('car', 700, 182, 52, '#bfe0ff') + tx(725, 258, 'ASSEMBLY', 'big', 'text-anchor="middle" style="font-size:23px"') +
      tx(725, 277, stop ? 'LINE STOPPED' : 'Line running', 'sm', 'text-anchor="middle" style="' + (stop ? 'fill:#ff4d4d;font-weight:700;font-size:13px' : 'font-size:13px') + '"') +
      tx(725, 303, f0(b.actual) + ' / ' + b.plan, 'big', 'text-anchor="middle"') +
      bar(654, 318, 100, pct, COL[ast]) + tx(762, 325, f0(pct) + '%', 'num ' + ast), 'assembly'));
    const fo = S.finished.onTime, fst = fo >= 90 ? 'ok' : fo >= 85 ? 'watch' : 'low';
    out.push(nd('finished', 897, 193, 130, 108, fst,
      tx(908, 213, T('motorpool').toUpperCase(), 't1') + tx(908, 226, '(to dispatch)', 't2') + mi('car', 906, 238, 36, '#8fb8ee') +
      tx(950, 252, 'On-time', 'sm') + tx(950, 280, f0(fo) + '%', 'big ' + fst)));
    const so = S.finished.shipOnTime, sst = so >= 90 ? 'ok' : so >= 85 ? 'watch' : 'low';
    out.push(nd('ship', 1040, 258, 102, 95, sst,
      tx(1050, 278, 'SHIPMENT', 't1') + tx(1050, 291, '(On-time)', 't2') + mi('truck', 1050, 296, 26, '#8fb8ee') +
      tx(1086, 340, f0(so) + '%', 'big ' + sst, 'text-anchor="middle"')));
    return out.join('');
  }

  function mapFlows() {
    const stop = S.line.stopped ? ' stopped' : '';
    const bmp = S.transfers[1], bst = (bmp.q.reduce((a, c) => a + c, 0) / bmp.q.length) * 100 < 78 ? 'red' : 'blue';
    const f = (cls, d) => '<path class="flow ' + cls + stop + '" d="' + d + '" marker-end="url(#ah-' + cls + ')"/>';
    return [
      f('blue', 'M36,193 V100 H87'), f('blue', 'M282,62 H300'), f('blue', 'M390,98 V140 H620 V258 H638'),
      f('blue', 'M274,239 H283'), f('blue', 'M429,239 H440'), f('blue', 'M554,239 H638'),
      f('blue', 'M347,341 H360'), f(bst, 'M527,341 H600 V312 H638'),
      f('blue', 'M810,247 H895'), f('blue', 'M1027,285 H1038')
    ].concat(jvLayout().map((L) => {            // each JV feeds the assembly line top; own lane so lines do not overlap
      const r = jvRoute(S.jvSites[L.i].name), st = r ? Sim.routeStatus(r.ema * 100) : 'ok', n = S.jvSites.length;
      const lane = 106 + L.i * 5, entry = n > 1 ? 660 + (L.i * 130) / (n - 1) : 725;
      return f(st === 'low' ? 'red' : st === 'watch' ? 'amber' : 'green', 'M' + (L.x + L.w / 2) + ',98 V' + lane + ' H' + entry.toFixed(0) + ' V171');
    })).join('');
  }
  const ROADS = '<path class="road" d="M0,291 H630"/><path class="road" d="M820,291 H1152"/>';
  function renderMapLegend() {
    setHTML($('#map-legend'),
      '<span><i class="bg-ok"></i>Normal</span><span><i class="bg-watch"></i>Watch</span><span><i class="bg-low"></i>Low / Risk</span>' +
      '<span><svg viewBox="0 0 34 10"><path d="M0 5H28" stroke="#29b6ff" stroke-width="2.4" stroke-dasharray="5 4"/><path d="M26 1l7 4-7 4z" fill="#29b6ff"/></svg>Material Flow</span>' +
      '<span><svg viewBox="0 0 34 10"><path d="M0 5H28" stroke="#22e07a" stroke-width="2.4" stroke-dasharray="5 4"/><path d="M26 1l7 4-7 4z" fill="#22e07a"/></svg>AMR Flow (Auto Transfer)</span>' +
      '<span><svg viewBox="0 0 34 10"><path d="M0 5H34" stroke="#8aa0c4" stroke-width="2" stroke-dasharray="2 4"/></svg>Internal Road</span>');
  }
  function renderMap() {
    setHTML($('#roads'), ROADS);
    setHTML($('#flows'), mapFlows());
    setHTML($('#nodes'), mapNodes());
  }

  /* ---------- risk panel ---------- */
  function partRows(list) {
    return list.map((p, i) => {
      const c = Sim.coverage(p), st = Sim.partStatus(c), a = Sim.nextAction(S, p);
      return '<tr' + tipA(p.name + ' — ' + f0(p.stock) + ' pcs at ' + p.rate + ' pcs/min. ' + (p.pending ? 'Inbound ' + p.pending.ref + ' ETA ' + Sim.fmtClock(S.clock + p.pending.eta) : 'No inbound planned')) + '>' +
        '<td class="rk">' + (i + 1) + '</td>' +
        '<td><div class="pn">' + ico(p.icon, '') + '<span>' + p.name.replace(' (', '<br>(') + '</span></div></td>' +
        '<td>' + p.loc + '</td><td><b style="font-size:15px">' + f0(p.stock) + '</b> pcs</td>' +
        '<td><span class="cov ' + st + '">' + f0(c) + ' min</span></td>' +
        '<td class="act">' + a.text + '<small>(Owner: ' + a.owner + ')</small></td></tr>';
    }).join('');
  }
  function sortedParts() {
    return S.parts.filter((p) => ui.shop === 'all' || p.shop === ui.shop).sort((a, b) => Sim.coverage(a) - Sim.coverage(b));
  }
  function renderRisk() {
    const list = sortedParts();
    const top = list.slice(0, 4);
    const m = top.length ? Sim.coverage(top[0]) : 9999;
    const st = Sim.partStatus(m);
    const el = $('#p-risk');
    el.className = 'panel risk ' + (st === 'low' ? '' : st);
    const scope = ui.shop === 'all' ? '' : ' • ' + ui.shop.toUpperCase();
    setHTML(el,
      '<div class="head"><b>NEXT 120 MIN | LINE RISK' + scope + ' <a class="more" data-href="' + (ui.shop === 'all' ? '#/parts' : '#/shop/' + ui.shop) + '">All parts \u203a</a></b><span>Based on live VIN build sequence<br>+ applicable BOM + usable stock</span></div>' +
      '<div class="banner ' + (st === 'low' ? '' : st) + '"><span style="color:' + COL[st] + '">' + ico(st === 'ok' ? 'target' : 'warn') + '</span>' +
      '<b>EARLIEST SHORTAGE: <em style="color:' + COL[st] + '">' + (m < 9000 ? f0(m) + ' MIN' : '—') + '</em></b></div>' +
      (top.length ? '<table class="rt"><thead><tr><th>#</th><th>Part / Material</th><th>Location</th><th>Current<br>usable stock</th><th>Coverage<br>(at current rate)</th><th>Next action / Owner</th></tr></thead><tbody>' + partRows(top) + '</tbody></table>'
        : '<div class="empty">No tracked parts for this shop.</div>'));
  }

  /* ---------- inbound ---------- */
  function renderInbound() {
    const y = S.yard, h = S.hist;
    const pc = (n) => f0((n / y.expected) * 100) + '%';
    const mc = (ic, lab, val, key, arr, col) =>
      '<div class="mc">' + ico(ic) + '<div class="tx">' + lab + '<b>' + f0(val) + ' min</b></div><div class="sc">' +
      spark(key, arr, { color: col, unit: ' min', h: 40 }) + xlabels(h.t, true) + '</div></div>';
    setHTML($('#p-inbound'),
      '<div class="ptitle"><h2>INBOUND TRUCK FLOW <small>(Today)</small></h2><a class="more" data-href="#/inbound">Details \u203a</a></div>' +
      '<div class="funnel">' + ico('truck') +
      '<div class="fs"' + tipA('Trucks scheduled today (grows with ad-hoc loads)') + '><small>Expected</small><b>' + y.expected + '</b></div><span class="arr">▶</span>' +
      '<div class="fs"><small>Arrived</small><b>' + y.arrived + '</b><i>(' + pc(y.arrived) + ')</i></div><span class="arr">▶</span>' +
      '<div class="fs"><small>' + T('atBay') + '</small><b>' + y.docked + '</b><i>(' + pc(y.docked) + ')</i></div><span class="arr">▶</span>' +
      '<div class="fs"><small>Received</small><b>' + y.received + '</b><i>(' + pc(y.received) + ')</i></div></div>' +
      '<div class="minis">' + mc('clock', 'Gate to ' + T('bay') + ' Time<br>(avg.)', y.g2d, 'g2d', h.g2d, '#29b6ff') +
      mc('truck', 'Truck Turnaround Time (avg.)', y.turn, 'turn', h.turn, '#29b6ff') + '</div>');
  }

  /* ---------- transfers ---------- */
  function renderTransfers() {
    const rows = S.transfers.map((t) => {
      const ok = t.q.reduce((a, c) => a + c, 0), n = t.q.length, pct = (ok / n) * 100;
      const delayed = pct < 78, st = delayed ? 'low' : 'ok', barC = pct >= 95 ? COL.ok : pct >= 85 ? COL.ok : pct >= 78 ? COL.watch : COL.watch;
      return '<tr' + tipA(t.name + ': ' + ok + ' of the last ' + n + ' jobs on time') + '><td>' + ico(t.icon) + '</td><td>' + t.name + '</td>' +
        '<td><span class="chip ' + st + '">' + (delayed ? 'DELAYED' : 'ON TIME') + '</span></td>' +
        '<td style="text-align:center">' + ok + ' / ' + n + '</td>' +
        '<td><div class="pb"><div class="tr"><b style="width:' + pct + '%;background:' + barC + '"></b></div><span>' + f0(pct) + '%</span></div></td></tr>';
    }).join('');
    setHTML($('#p-transfers'),
      '<div class="ptitle"><h2>IN-PLANT TRANSFERS <small>(Current Shift)</small></h2><a class="more" data-href="#/transfers">Details \u203a</a></div>' +
      '<table class="tr"><thead><tr><th></th><th>Route</th><th>Status</th><th style="text-align:center">On time / Total</th><th>Progress</th></tr></thead><tbody>' + rows + '</tbody></table>');
  }

  /* ---------- line-side ---------- */
  function renderLineside() {
    const rows = S.lineside.map((l) => {
      const st = Sim.linesideStatus(l), w = Math.min(100, (l.usable / l.max) * 100), sp = (l.safety / l.max) * 100;
      return '<tr' + tipA(l.name + ': ' + f0(l.usable) + ' usable vs safety stock ' + l.safety + (l.pend ? '. Replenishment due in ' + f0(l.pend.eta) + ' min' : '')) + '><td>' + ico(l.icon) + '</td><td class="nm">' + l.name + '</td>' +
        '<td style="width:290px"><span class="lv">' + f0(l.usable) + ' / ' + l.safety + '</span><div class="lb"><b style="width:' + w + '%;background:' + COL[st] + '"></b><s style="left:' + sp + '%"></s></div></td>' +
        '<td><span class="chip ' + st + '">' + statusLabel[st] + '</span></td></tr>';
    }).join('');
    setHTML($('#p-lineside'),
      '<div class="ptitle"><h2>LINE SIDE STOCK <small>(Key Materials)</small></h2><a class="more" data-href="#/lineside">Details \u203a</a>' +
      '<div class="legend"><span><i style="background:#22e07a;height:7px;width:16px"></i>Usable Stock</span><span><svg viewBox="0 0 34 10"><path d="M0 5H34" stroke="#dbe8ff" stroke-width="2" stroke-dasharray="2 3"/></svg>Safety Stock (Min)</span></div></div>' +
      '<table class="ls"><thead><tr><th></th><th>Part / Material</th><th>Usable / Safety (pcs)</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>');
  }

  /* ---------- quality ---------- */
  function renderQuality() {
    const q = S.quality, h = S.hist;
    const spfSt = q.spf >= 95 ? 'ok' : q.spf >= 90 ? 'watch' : 'low';
    setHTML($('#p-quality'),
      '<div class="ptitle"><h2>QUALITY, SINGLE-PIECE FLOW &amp; REJECTIONS <small>(Today)</small></h2><a class="more" data-href="#/quality">Details \u203a</a></div>' +
      '<div class="qrow">' +
      '<div class="qb"' + tipA('Parts rejected at line / inspection today') + '><svg class="ic low" style="font-size:40px"><use href="#i-x"/></svg><div class="tx">Rejected Parts<b class="low">' + q.rejected + ' pcs</b>(' + f1((q.rejected / S.build.actual) * 100) + '% of build)</div>' +
      spark('rej', h.rej, { color: '#ff4d4d', unit: ' pcs / 5 min', h: 60 }) + '</div>' +
      '<div class="qb"' + tipA('Parts on hold in quarantine pending investigation') + '><svg class="ic watch" style="font-size:40px"><use href="#i-warn"/></svg><div class="tx">Quarantined Parts<b class="watch">' + q.quarantined + ' pcs</b>(Under investigation)</div></div>' +
      '<div class="qb"><svg class="ic cy" style="font-size:34px"><use href="#i-forklift"/></svg><div class="tx">Single-Piece Flow Adherence<b class="' + spfSt + '">' + f0(q.spf) + '%<span class="mut" style="font-size:11.5px;font-weight:400"> (Target 95%)</span></b></div>' +
      '<div class="sc2"><div class="yl"><span>100%</span><span>80%</span><span>60%</span></div><div class="sc">' +
      spark('spf', h.spf, { color: COL[spfSt], unit: '%', min: 60, max: 100, target: 95, grid: [60, 80, 100], h: 60 }) + xlabels(h.t, true) + '</div></div></div>' +
      '</div>');
  }

  /* ---------- AMR ---------- */
  function fleetBlock(title, sub, icon, F, scope) {
    const v = Sim.fleetView(F);
    const bc = v.battery >= 50 ? COL.ok : v.battery >= 30 ? COL.watch : COL.low;
    return '<div class="am" style="width:' + (scope === 'in' ? 262 : 252) + 'px"><h3>' + ico(icon) + title + ' <small>' + sub + '</small></h3>' +
      '<div class="st"><div>Total AMRs<b>' + v.total + '</b></div><div>Available<b class="ok">' + v.avail + '</b></div><div>Busy<b class="cy">' + v.busy + '</b></div><div>Charging<b class="watch">' + v.charging + '</b></div></div>' +
      '<div class="sec"' + tipA('Utilization = share of dispatchable AMRs on a mission (1-hour rolling). Battery colour: green ≥50%, amber ≥30%.') + '><div>Utilization<b>' + f0(v.util) + '%</b></div>' +
      '<div>Avg Battery<div class="batt"><svg class="ic" style="color:' + bc + '"><use href="#i-batt"/></svg><b style="color:' + bc + '">' + f0(v.battery) + '%</b></div></div>' +
      '<div>Low Battery<b class="' + (v.low ? 'low' : 'ok') + '"><span style="font-size:12px">■</span> ' + v.low + '</b></div>' +
      '<div>Missions<b>' + v.done + ' / ' + v.planned + '</b></div></div></div>';
  }
  function routeBlock(title, F, w, short) {
    return '<div class="am" style="width:' + w + 'px"><table class="rl"><thead><tr><th>' + title + '</th><th></th><th></th></tr></thead><tbody>' +
      F.routes.map((r) => {
        const p = r.ema * 100;
        return '<tr><td><span style="color:#6ec1ff">▸</span> ' + (short ? r.name.replace(/ \u2192 Assembly$/, '') : r.name) + '</td><td>' + r.n + '</td><td style="color:' + COL[Sim.routeStatus(p)] + '">(' + f0(p) + '%)</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function renderAmr() {
    setHTML($('#p-amr'),
      '<div class="ptitle"><h2>AMR TRANSFERS &amp; HEALTH</h2><a class="more" data-href="#/amr">Details \u203a</a></div><div class="amrrow">' +
      fleetBlock('INDOOR / IN-HOUSE', '(Plant)', 'amr', S.amr, 'in') + routeBlock('Routes (Missions Today)', S.amr, 190) +
      fleetBlock('ADJACENT JVs', '(Off-site)', 'stack', S.jv, 'jv') + routeBlock('JV Routes (Today)', S.jv, 190, true) + '</div>');
  }

  /* ---------- footer ---------- */
  function renderFoot() {
    const sp = [1, 30, 120, 600];
    const ev = S.events[0];
    const col = ev ? (ev.lvl === 'low' ? COL.low : ev.lvl === 'watch' ? COL.watch : ev.lvl === 'ok' ? COL.ok : '#9fb4d6') : '#9fb4d6';
    const demo = S.demo !== false && !S.mixed;
    let left;
    if (demo) {
      left = (SERVER ? '' : '<button data-act="pause">' + (S.paused ? '▶ Resume' : '⏸ Pause') + '</button>') +
        '<span>Sim speed</span>' + sp.map((s) => '<button data-speed="' + s + '" class="' + (S.speed === s ? 'on' : '') + '">' + s + '×</button>').join('') +
        '<span class="sep"></span><span>Inject demo scenario:</span>' +
        [['truckDelay', 'Truck delay'], ['bumperJam', 'Bumper slowdown'], ['shortage', 'Engine mount shortage'], ['amrFault', 'AMR battery fault'], ['jvDelay', S.setup.jvs[Math.min(2, S.setup.jvs.length - 1)] + ' delay']]
          .map((b) => '<button data-inject="' + b[0] + '">' + b[1] + '</button>').join('') +
        (SERVER ? '' : '<button data-act="reset">Reset</button>');
    } else {
      left = '<span>Real-time data — simulation controls disabled</span><button data-href="#/sources">Data sources ›</button>';
    }
    setHTML($('#foot'), left + '<span class="ev" style="color:' + col + '">' + (ev ? Sim.fmtClock(ev.t) + '  ' + ev.msg : '') + '</span>');
  }

  /* ---------- render all ---------- */
  const route = () => location.hash.replace(/^#\/?/, '');
  const H = { spark, xlabels, ico, f0, f1, pad2, COL, statusLabel };
  let lastRoute = null;
  function render() {
    if (!S) return;
    const r = route();
    const FORM = { settings: window.FFSettings, datapoints: window.FFDatapoints };
    if (lastRoute && FORM[lastRoute] && lastRoute !== r && FORM[lastRoute].unmount) FORM[lastRoute].unmount();
    if (FORM[r]) {                                // form pages: mounted once, only status cells update (never re-rendered, or typing would be lost)
      $('#stage').classList.add('paged'); renderHeader();
      if (lastRoute !== r) { cache.delete($('#page')); $('#page').scrollTop = 0; lastRoute = r; FORM[r].mount($('#page'), S, { server: SERVER }); }
      else FORM[r].update(S);
      renderFoot(); return;
    }
    const page = r ? window.FFPages.render(r, S, H, ui) : null;
    $('#stage').classList.toggle('paged', page !== null);
    renderHeader();
    if (page !== null) {
      if (lastRoute !== r) { cache.delete($('#page')); $('#page').scrollTop = 0; lastRoute = r; }
      setHTML($('#page'), page);
      renderFoot();
      return;
    }
    lastRoute = null;
    renderKpis(); renderTabs(); renderMap(); renderRisk();
    renderInbound(); renderTransfers(); renderLineside(); renderQuality(); renderAmr(); renderFoot();
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
