/* Overall dashboard (management view). Mounted once into #page; only the inner sections are refreshed.
 * The plant layout is the same live SVG as on the logistics tower: it is moved in here while this page is open. */
(function () {
  'use strict';
  const Sim = window.FactorySim;
  let root = null, ctx = null, cache = {};
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n0 = (v) => Math.round(v).toLocaleString('en-US'), p1 = (v) => (v === null || v === undefined ? '—' : v.toFixed(1) + '%');
  const tip = (t) => ' data-tip="' + esc(t) + '"';
  const put = (id, html) => { if (cache[id] !== html) { cache[id] = html; const el = root.querySelector('#' + id); if (el) el.innerHTML = html; } };
  const atLeast = (v, t, band) => (v === null ? 'mut' : v >= t ? 'ok' : v >= t - band ? 'watch' : 'low');
  const atMost = (v, t, band) => (v === null ? 'mut' : v <= t ? 'ok' : v <= t + band ? 'watch' : 'low');
  const clk = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0');
  const arrow = (v, goodDown) => (v === 0 ? '' : (v < 0 ? '▼' : '▲'));
  const COL = { ok: 'var(--ok)', watch: 'var(--watch)', low: 'var(--low)', mut: 'var(--ink3)' };

  /* ---- small SVG charts ---- */
  function lineChart(vals, o) {
    const W = o.w || 300, H = o.h || 110, L = 30, R = 8, T = 8, B = 16, n = vals.length;
    if (!n) return '<div class="empty">no data yet</div>';
    let mn = Math.min.apply(null, vals.concat(o.target !== undefined ? [o.target] : [])), mx = Math.max.apply(null, vals.concat(o.target !== undefined ? [o.target] : []));
    const pad = Math.max((mx - mn) * 0.2, o.minSpan || 1); mn = Math.max(0, mn - pad); mx = mx + pad;
    const x = (i) => L + (i / Math.max(1, n - 1)) * (W - L - R), y = (v) => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
    const pts = vals.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
    const grid = [0, 0.5, 1].map((f) => { const v = mn + (mx - mn) * f, yy = y(v); return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" class="gl"/><text x="' + (L - 4) + '" y="' + (yy + 3) + '" class="ax" text-anchor="end">' + (o.dec ? v.toFixed(o.dec) : Math.round(v)) + '</text>'; }).join('');
    const tl = o.t && o.t.length ? '<text x="' + L + '" y="' + (H - 3) + '" class="ax">' + clk(o.t[0]) + '</text><text x="' + (W - R) + '" y="' + (H - 3) + '" class="ax" text-anchor="end">' + clk(o.t[o.t.length - 1]) + '</text>' : '';
    const tg = o.target !== undefined ? '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(o.target) + '" y2="' + y(o.target) + '" class="tg"/>' : '';
    return '<svg class="ch" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + grid + tg + '<polyline points="' + pts + '" fill="none" style="stroke:' + o.color + '" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + x(n - 1) + '" cy="' + y(vals[n - 1]) + '" r="3" style="fill:' + o.color + '"/>' + tl + '</svg>';
  }
  function trendChart(S, V) {
    const M = S.mgmt, W = 640, H = 230, L = 46, R = 14, T = 12, B = 22, t0 = M.shift.start, t1 = M.shift.end;
    const mx = Math.max(V.plan, V.forecast || 0, 1) * 1.08, x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), y = (v) => T + (1 - v / mx) * (H - T - B);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = (mx / 4) * i; g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="gl"/><text x="' + (L - 5) + '" y="' + (y(v) + 3) + '" class="ax" text-anchor="end">' + (v >= 1000 ? Math.round(v / 1000) + 'K' : Math.round(v)) + '</text>'; }
    for (let i = 0; i <= 5; i++) { const t = t0 + ((t1 - t0) / 5) * i; g += '<text x="' + x(t) + '" y="' + (H - 5) + '" class="ax" text-anchor="middle">' + clk(t) + '</text>'; }
    const pts = M.trend.filter((p) => p[0] >= t0 && p[0] <= t1), now = Math.min(t1, Math.max(t0, S.clock % 1440));
    const last = pts.length ? pts[pts.length - 1] : [now, V.actual];
    const line = pts.map((p) => x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1)).join(' ');
    const area = pts.length > 1 ? '<polygon points="' + x(pts[0][0]).toFixed(1) + ',' + y(0) + ' ' + line + ' ' + x(last[0]).toFixed(1) + ',' + y(0) + '" class="ar"/>' : '';
    const fc = V.forecast !== null ? '<line x1="' + x(last[0]) + '" y1="' + y(last[1]) + '" x2="' + x(t1) + '" y2="' + y(V.forecast) + '" class="fc"/><circle cx="' + x(t1) + '" cy="' + y(V.forecast) + '" r="4" class="fcd"/>' : '';
    return '<svg class="ch" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' + g + '<line x1="' + x(t0) + '" y1="' + y(0) + '" x2="' + x(t1) + '" y2="' + y(V.plan) + '" class="pl"/>' + area +
      (pts.length > 1 ? '<polyline points="' + line + '" fill="none" class="ac"/>' : '') + fc + '<circle cx="' + x(last[0]) + '" cy="' + y(last[1]) + '" r="4.5" class="acd"/></svg>';
  }
  function donut(fm) {
    const ks = [['man', 'Man', 'var(--ok)'], ['machine', 'Machine', 'var(--cyan)'], ['material', 'Material', '#8f7bff'], ['method', 'Method', 'var(--watch)']], r = 40, C = 2 * Math.PI * r, q = C / 4;
    const avg = (fm.man + fm.machine + fm.material + fm.method) / 4;
    const arcs = ks.map((k, i) => '<circle cx="55" cy="55" r="' + r + '" fill="none" style="stroke:var(--track)" stroke-width="13" stroke-dasharray="' + (q - 3).toFixed(1) + ' ' + (C - q + 3).toFixed(1) + '" transform="rotate(' + (i * 90 - 90) + ' 55 55)"/>' +
      '<circle cx="55" cy="55" r="' + r + '" fill="none" style="stroke:' + k[2] + '" stroke-width="13" stroke-dasharray="' + (((q - 3) * Math.max(0, (fm[k[0]] - 90) / 10))).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(' + (i * 90 - 90) + ' 55 55)"/>').join('');
    return '<div class="dn"><svg viewBox="0 0 110 110">' + arcs + '<text x="55" y="53" text-anchor="middle" class="dv">' + avg.toFixed(1) + '%</text><text x="55" y="66" text-anchor="middle" class="dc">compliance</text></svg>' +
      '<div class="dl">' + ks.map((k) => '<div><i style="background:' + k[2] + '"></i><span>' + k[1] + '</span><b class="' + atLeast(fm[k[0]], fm.target, 1) + '">' + fm[k[0]].toFixed(1) + '%</b></div>').join('') + '<small>each arc shows 90 to 100%</small></div></div>';
  }

  function render(S) {
    const V = Sim.mgmtView(S), M = S.mgmt, T = M.targets, sf = M.safety, fm = M.fourM;
    const stProd = atLeast(V.attain, 97, 7), stE = V.eVarPct === null ? 'mut' : atMost(V.eVarPct, 0, 3), stTat = atMost(V.tat, T.tat, T.tat * 0.1), st4 = atLeast(V.fmAvg, fm.target, 1),
      stAcc = atLeast(V.invAcc, T.invAcc, 3), stRej = atMost(V.rej, T.rejection, 0.5), stMat = stAcc === 'low' || stRej === 'low' ? 'low' : stAcc === 'watch' || stRej === 'watch' ? 'watch' : 'ok',
      stTrir = atMost(sf.trir, sf.trirTarget, sf.trirTarget * 0.2), stSafe = sf.lti > 0 ? 'low' : stTrir;
    const tile = (k, icon, name, st, cols, href, hint) => '<div class="otile t-' + k + ' ' + st + '"' + (href ? ' data-href="' + href + '"' : '') + tip(hint) + '><div class="oth"><svg class="ic"><use href="#i-' + icon + '"/></svg><b>' + name + '</b><i class="sd ' + (st === 'mut' ? '' : st) + '"></i></div><div class="otb">' +
      cols.map((c) => '<div><small>' + c[0] + '</small><b class="' + (c[2] || '') + '">' + c[1] + '</b></div>').join('') + '</div></div>';
    const tatVar = V.tat - T.tat;
    put('ov-tiles',
      tile('prod', 'bars', 'Production', stProd, [['Actual', n0(V.actual)], ['Plan to now', n0(V.due)], ['Attain.', p1(V.attain), stProd]], null, 'All departments. Plan to now = shift plan × share of the shift elapsed. Production tower: not built yet.') +
      tile('util', 'sun', 'Utility', stE, [['Energy (kWh)', n0(V.energy)], ['Target to now', n0(V.eDue)], ['Var.', V.eVarPct === null ? '—' : arrow(V.eVarPct) + Math.abs(V.eVarPct).toFixed(1) + '%', stE]], null, 'Energy used vs the target for the elapsed part of the shift. Utility tower: not built yet.') +
      tile('logi', 'truck', 'Logistics', stTat, [['TAT', n0(V.tat) + ' min'], ['Target', '≤ ' + n0(T.tat) + ' min'], ['Var.', arrow(tatVar) + Math.abs(Math.round(tatVar)) + ' min', stTat]], '#/', 'Average truck turnaround. Click for the logistics control tower.') +
      tile('fm', 'target', '4M', st4, [['Compliance', p1(V.fmAvg)], ['Target', '≥ ' + fm.target + '%'], ['Var.', arrow(V.fmAvg - fm.target) + Math.abs(V.fmAvg - fm.target).toFixed(1) + ' pp', st4]], null, 'Average of man, machine, material and method compliance.') +
      tile('mat', 'box', 'Material', stMat, [['Inventory acc.', p1(V.invAcc), stAcc], ['Rejection', V.rej.toFixed(1) + '%', stRej], ['Target', '≤ ' + T.rejection + '%']], '#/', 'Stock accuracy (cycle count) and rejected share of the build. Quality tower: not built yet.') +
      tile('safe', 'warn', 'Safety', stSafe, [['Lost time injury', String(sf.lti), sf.lti > 0 ? 'low' : 'ok'], ['TRIR', sf.trir.toFixed(2), stTrir], ['Target', '≤ ' + sf.trirTarget.toFixed(2)]], null, 'Lost time injuries and total recordable incident rate. Safety tower: not built yet.'));

    put('ov-table', '<table class="ovt"><thead><tr><th>Department</th><th>Plan (shift)</th><th>Plan to now</th><th>Actual</th><th>Variance</th><th>Attainment</th><th>OEE</th></tr></thead><tbody>' +
      V.rows.map((r) => { const a = atLeast(r.attain, 97, 7), o = atLeast(r.oee, 90, 5); return '<tr><td><i class="sd ' + (a === 'mut' ? '' : a) + '"></i><b>' + esc(r.name) + '</b></td><td>' + n0(r.plan) + '</td><td>' + n0(r.due) + '</td><td>' + n0(r.actual) + '</td><td class="' + (r.variance < 0 ? a : 'ok') + '">' + (r.variance > 0 ? '+' : '') + n0(r.variance) + '</td><td class="' + a + '">' + p1(r.attain) + '</td><td class="' + o + '">' + p1(r.oee) + '</td></tr>'; }).join('') +
      '<tr class="tot"><td><b>Total</b></td><td>' + n0(V.plan) + '</td><td>' + n0(V.due) + '</td><td>' + n0(V.actual) + '</td><td class="' + stProd + '">' + (V.actual - V.due > 0 ? '+' : '') + n0(V.actual - V.due) + '</td><td class="' + stProd + '">' + p1(V.attain) + '</td><td></td></tr></tbody></table>');

    const fcSt = V.forecast === null ? 'mut' : atLeast((V.forecast / V.plan) * 100, 99, 4);
    put('ov-trend', '<div class="tlg"><span><i class="l-ac"></i>Actual</span><span><i class="l-pl"></i>Plan</span><span><i class="l-fc"></i>Forecast</span><span class="proj ' + fcSt + '"' + tip('Run-rate forecast: output so far ÷ elapsed shift time × shift length') + '>Projected output <b>' + (V.forecast === null ? '—' : n0(V.forecast)) + '</b>' +
      (V.forecast === null ? '' : ' <em>(' + ((V.forecast / V.plan - 1) * 100 >= 0 ? '+' : '') + ((V.forecast / V.plan - 1) * 100).toFixed(1) + '% vs plan)</em>') + '</span></div>' + trendChart(S, V));

    const fr = V.len ? V.elapsed / V.len : 0;
    put('ov-prod', V.rows.map((r) => { const st = atLeast(r.attain, 97, 7); return '<div class="hb"' + tip(r.name + ': ' + n0(r.actual) + ' of ' + n0(r.plan) + ' planned for the shift. The mark is where the plan is now.') + '><span>' + esc(r.name.replace(/ Shop$/, '').replace('Vehicle Inspection', 'Insp.')) + '</span><div class="tr"><i></i><b class="bg-' + (st === 'mut' ? 'ok' : st) + '" style="width:' + Math.min(100, (r.actual / Math.max(1, r.plan)) * 100).toFixed(1) + '%"></b><u style="left:' + (fr * 100).toFixed(1) + '%"></u></div><em>' + n0(r.actual) + '</em></div>'; }).join(''));

    const short = { press: 'P', weld: 'W', paint: 'Pa', engine: 'E', assembly: 'A', im: 'IM', inspection: 'In' };
    put('ov-util', '<div class="vbars">' + V.rows.map((r) => { const due = r.energyTarget * fr, st = due > 0 ? atMost(((r.energy - due) / due) * 100, 0, 3) : 'ok';
      return '<div' + tip(r.name + ': ' + n0(r.energy) + ' kWh used, shift target ' + n0(r.energyTarget) + ' kWh. The dashed mark is the target to now.') + '><div class="col"><u style="bottom:' + (fr * 100).toFixed(1) + '%"></u><b class="bg-' + st + '" style="height:' + Math.min(100, (r.energy / Math.max(1, r.energyTarget)) * 100).toFixed(1) + '%"></b></div><small>' + (short[r.id] || esc(r.name.slice(0, 2))) + '</small></div>'; }).join('') + '</div>' +
      '<div class="foot3"><span><b>' + n0(V.energy) + '</b> kWh</span><span class="' + stE + '">' + (V.eVarPct === null ? '—' : arrow(V.eVarPct) + Math.abs(V.eVarPct).toFixed(1) + '%') + '</span><span><b>' + n0(V.eTarget) + '</b> shift target</span></div>');

    put('ov-logi', lineChart(S.hist.turn, { color: 'var(--watch)', target: T.tat, t: S.hist.t, minSpan: 4 }) + '<div class="foot3"><span><b>' + n0(V.tat) + ' min</b> actual</span><span class="' + stTat + '">' + arrow(tatVar) + Math.abs(Math.round(tatVar)) + ' min</span><span><b>≤ ' + n0(T.tat) + ' min</b> target</span></div>');
    put('ov-fm', donut(fm));
    put('ov-mat', '<div class="kv"><span>Inventory accuracy <small>(≥ ' + T.invAcc + '%)</small></span><b class="' + stAcc + '">' + p1(V.invAcc) + '</b></div><div class="kv"><span>Material rejection <small>(≤ ' + T.rejection + '%)</small></span><b class="' + stRej + '">' + V.rej.toFixed(1) + '%</b></div>' +
      lineChart(S.hist.rejPct, { color: 'var(--low)', target: T.rejection, t: S.hist.t, dec: 1, minSpan: 0.4, h: 84 }));
    put('ov-safe', '<div class="kv big"><span>Lost time injury (LTI)</span><b class="' + (sf.lti > 0 ? 'low' : 'ok') + '">' + sf.lti + '</b></div><div class="kv big"><span>TRIR <small>(≤ ' + sf.trirTarget.toFixed(2) + ')</small></span><b class="' + stTrir + '">' + sf.trir.toFixed(2) + '</b></div>' +
      '<div class="kv big"><span>Safety compliance <small>(≥ ' + sf.complianceTarget + '%)</small></span><b class="' + atLeast(sf.compliance, sf.complianceTarget, 1) + '">' + p1(sf.compliance) + '</b></div>');

    const acts = ctx && ctx.actions ? ctx.actions() : null;
    const tw = (name, who, state, href, st, note) => '<div class="tw ' + (href ? 'live' : 'todo') + '"' + (href ? ' data-href="' + href + '"' : '') + '><i class="sd ' + (st || '') + '"></i><span><b>' + name + '</b><small>' + who + '</small></span><em class="' + (st || 'mut') + '">' + state + '</em>' + (note ? '<u>' + note + '</u>' : '') + '</div>';
    put('ov-towers', tw('Logistics control tower', 'operators · inbound, JV, in-house, plant flow', acts ? (acts.total ? acts.total + ' open items' : 'all clear') : 'open', '#/', acts ? (acts.red ? 'low' : acts.total ? 'watch' : 'ok') : 'ok', '›') +
      tw('Production', 'operators', 'not built yet', null) + tw('Quality', 'operators', 'not built yet', null) + tw('Utility', 'operators', 'not built yet', null) + tw('Safety', 'operators', 'not built yet', null));
  }

  const box = (letter, cls, title, sub, body, extra) => '<div class="vbox ' + (extra || '') + '"><div class="vh"><span class="vb ' + cls + '">' + letter + '</span><h2>' + title + '</h2>' + (sub ? '<span class="vsub">' + sub + '</span>' : '') + '</div><div class="vbody" id="' + body + '"></div></div>';
  function mount(el, S, c) {
    root = el; ctx = c || {}; cache = {};
    el.innerHTML = '<div class="ov"><div class="ov-tiles" id="ov-tiles"></div>' +
      '<div class="ov-mid">' + box('▤', '', 'PLAN VS ACTUAL', 'by department · variance and attainment against plan to now', 'ov-table') + box('↗', 'flow', 'PRODUCTION TREND &amp; FORECAST', 'cumulative, this shift', 'ov-trend') + '</div>' +
      '<div class="ov-cards">' + box('P', 'c-prod', 'PRODUCTION', 'actual vs plan', 'ov-prod') + box('U', 'c-util', 'UTILITY', 'energy by department (kWh)', 'ov-util') + box('L', 'c-logi', 'LOGISTICS', 'truck turnaround trend (min)', 'ov-logi') +
      box('4', 'c-fm', '4M', 'compliance', 'ov-fm') + box('M', 'c-mat', 'MATERIAL', 'accuracy and rejection', 'ov-mat') + box('S', 'c-safe', 'SAFETY', 'performance', 'ov-safe') + '</div>' +
      '<div class="ov-bot"><div class="vbox" id="ov-mapbox"><div class="vh"><span class="vb flow">&#9658;</span><h2>PLANT LAYOUT</h2><span class="vsub">live buffers and material flow · click a block for details</span></div><div class="ov-map" id="ov-map"></div></div>' +
      box('⌂', '', 'CONTROL TOWERS', 'operator boards by topic', 'ov-towers') + '</div></div>';
    const map = document.getElementById('map'); if (map) el.querySelector('#ov-map').appendChild(map);
    update(S);
  }
  function update(S) { if (!root) return; if (ctx.renderMap) ctx.renderMap(); render(S); }
  function unmount() {
    const map = document.getElementById('map'), home = document.getElementById('p-map');
    if (map && home) home.appendChild(map);
    root = null; cache = {};
  }
  window.FFOverall = { mount, update, unmount };
})();
