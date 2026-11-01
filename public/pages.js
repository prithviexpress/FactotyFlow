/* Detail pages (hash routes). Pure functions: (route, state, helpers, ui) -> html | null */
(function () {
  'use strict';
  const Sim = window.FactorySim;
  const SHOP_LABEL = { press: 'Press', weld: 'Weld', paint: 'Paint', engine: 'Engine', bumper: 'Bumper', assembly: 'Assembly' };
  const DOMAINS = [
    ['build', 'Build counters (plan / actual)'], ['line', 'Line status & stops'], ['shops', 'Shop & store buffers'], ['parts', 'Parts stock, rate, inbound'],
    ['yard', 'Truck parking / bay counters'], ['trucks', 'Inbound truck list'], ['transfers', 'In-plant transfer jobs'], ['lineside', 'Line-side stock'],
    ['amr', 'Indoor AMR fleet'], ['jv', 'JV AMR fleet'], ['jvstock', 'JV buffer stock'], ['quality', 'Rejections / quarantine / SPF'], ['kpi', 'JIS (just-in-sequence) & stock accuracy'],
    ['finished', 'Motorpool stock & shipment'], ['deliveries', 'Internal delivery totals']
  ];

  const TM = (S, k) => ((S.setup && S.setup.terms) || Sim.DEFAULT_TERMS)[k] || Sim.DEFAULT_TERMS[k];
  const chip = (st, t) => '<span class="chip ' + st + '">' + t + '</span>';
  const card = (l, v, cls, sub) => '<div class="dc"><small>' + l + '</small><b class="' + (cls || '') + '">' + v + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</div>';
  const cards = (arr) => '<div class="dcs">' + arr.join('') + '</div>';
  const sect = (t, body, cls) => '<section class="dsec ' + (cls || '') + '"><h3>' + t + '</h3>' + body + '</section>';
  const tbl = (heads, rows) => '<table class="dt"><thead><tr>' + heads.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  const bar = (pct, color, w) => '<span class="hb" style="width:' + (w || 110) + 'px"><b style="width:' + Math.max(0, Math.min(100, pct)).toFixed(0) + '%;background:' + color + '"></b></span>';
  const clk = (m) => (m === null || m === undefined ? '—' : Sim.fmtClock(m));

  function big(H, key, arr, t, o) {
    const hi = Math.max.apply(null, arr), lo = Math.min.apply(null, arr), last = arr[arr.length - 1];
    return '<div class="big"><div class="cap"><span>now <b>' + last.toFixed(1) + (o.unit || '') + '</b></span><span>min ' + lo.toFixed(1) + ' · max ' + hi.toFixed(1) + '</span></div>' +
      H.spark(key, arr, Object.assign({ h: 150, unit: o.unit }, o)) + H.xlabels(t) + '</div>';
  }

  const NAV = [['#/parts', 'Parts'], ['#/inventory', 'Inventory hrs'], ['#/inbound', 'Inbound'], ['#/transfers', 'Transfers'], ['#/lineside', 'Line side'], ['#/amr', 'AMR'], ['#/quality', 'Quality'], ['#/events', 'Events'], ['#/sources', 'Data sources'], ['#/datapoints', 'Data points'], ['#/settings', '\u2699 Interfaces']];
  function frame(route, title, sub, body) {
    const here = '#/' + route;
    return '<div class="pg"><div class="pgh"><a class="back" data-href="#/">‹ Control Tower</a><div class="ttl"><h2>' + title + '</h2>' + (sub ? '<span>' + sub + '</span>' : '') + '</div></div>' +
      '<div class="pgn">' + NAV.map((n) => '<a data-href="' + n[0] + '" class="' + (here === n[0] ? 'on' : '') + '">' + n[1] + '</a>').join('') + '<i></i>' +
      Object.keys(SHOP_LABEL).map((k) => '<a data-href="#/shop/' + k + '" class="' + (here === '#/shop/' + k ? 'on' : '') + '">' + SHOP_LABEL[k] + '</a>').join('') + '</div>' +
      '<div class="pgb">' + body + '</div></div>';
  }

  /* ---------- parts ---------- */
  function partsTable(S, H, list) {
    return tbl(['#', 'Part', 'Shop', 'Location', 'Stock', 'Rate / min', 'Coverage', 'Inbound', 'Next action / owner'], list.map((p, i) => {
      const c = Sim.coverage(p), st = Sim.partStatus(c), a = Sim.nextAction(S, p);
      return '<tr><td>' + (i + 1) + '</td><td><b>' + p.name + '</b><small>' + p.id + '</small></td><td>' + SHOP_LABEL[p.shop] + '</td><td>' + p.loc + '</td><td>' + H.f0(p.stock) + '</td><td>' + p.rate + '</td>' +
        '<td><span class="cov ' + st + '">' + (c > 9000 ? '∞' : H.f0(c) + ' min') + '</span></td>' +
        '<td>' + (p.pending ? p.pending.ref + '<small>ETA ' + clk(S.clock + p.pending.eta) + ' · ' + H.f0(p.pending.qty) + ' pcs</small>' : '<span class="mut">none</span>') + '</td>' +
        '<td>' + a.text + '<small>Owner: ' + a.owner + '</small></td></tr>';
    }));
  }
  function parts(S, H, ui) {
    const f = ui.pshop || 'all';
    const all = S.parts.slice().sort((a, b) => Sim.coverage(a) - Sim.coverage(b));
    const list = all.filter((p) => f === 'all' || p.shop === f);
    const b = [0, 0, 0, 0];
    all.forEach((p) => { const c = Sim.coverage(p); b[c < 30 ? 0 : c < 60 ? 1 : c < 120 ? 2 : 3]++; });
    const chips = ['all'].concat(Object.keys(SHOP_LABEL)).map((k) => '<button data-pshop="' + k + '" class="' + (f === k ? 'on' : '') + '">' + (k === 'all' ? 'All shops' : SHOP_LABEL[k]) + '</button>').join('');
    return frame('parts', 'Parts & Material Coverage', S.parts.length + ' tracked parts · coverage = usable stock ÷ consumption rate',
      cards([card('Critical (&lt;30 min)', b[0], b[0] ? 'low' : 'ok'), card('At risk (30–60 min)', b[1], b[1] ? 'watch' : 'ok'), card('Watch (60–120 min)', b[2], ''), card('Healthy (&gt;120 min)', b[3], 'ok')]) +
      '<div class="filters">' + chips + '</div>' + sect('Parts ranked by shortest coverage (' + list.length + ')', partsTable(S, H, list)));
  }

  /* ---------- inventory hours by position ---------- */
  const fh = (h) => (h === null || h === undefined ? '\u2014' : (h < 10 ? h.toFixed(1) : String(Math.round(h))) + ' h');
  const POS_COLS = ['inbound', 'bay', 'lineside'];
  function invRows(S, ui) {
    const V = Sim.inventoryView(S), f = ui.pshop || 'all', sort = ui.invSort || 'total';
    const rows = V.rows.filter((r) => f === 'all' || r.shop === f);
    const key = (r) => (r.h[sort] === null || r.h[sort] === undefined ? 1e9 : r.h[sort]);
    rows.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : key(a) - key(b)));
    return { V, rows, f, sort };
  }
  function inventory(S, H, ui) {
    const { V, rows, f, sort } = invRows(S, ui), T = V.targets, bays = TM(S, 'bays');
    const cell = (r, k) => {
      const h = r.h[k];
      if (h === null || h === undefined) return '<td class="hc none" data-tip="' + (k !== 'inbound' && !r.detail ? 'The feed gives no per-position split for this part' : 'nothing at this position') + '">—</td>';
      const st = Sim.hourStatus(h, T[k]);
      return '<td class="hc ' + st + '" data-tip="' + H.f0(r.pcs[k]) + ' pcs ÷ ' + (r.rate * 60).toFixed(0) + ' pcs/h">' + fh(h) + '</td>';
    };
    const strip = V.positions.map((p) => '<div class="pos ' + p.status + '"><small>' + p.label + '</small><b>' + (p.median === null ? '—' : fh(p.median)) + '</b>' +
      '<i>median' + (p.target !== null ? ' · target ≥ ' + p.target + ' h' : '') + '</i>' +
      '<em>' + (p.min ? 'lowest ' + fh(p.min.h) + ' — ' + p.min.name : 'no data') + (p.target !== null && p.count ? '<br>' + p.below + ' of ' + p.count + ' parts below target' : '') + '</em></div>').join('<span class="pa">›</span>');
    const wip = V.wip.map((w) => '<div class="pos ' + w.status + '"><small>' + w.label + '</small><b>' + fh(w.hours) + '</b><i>' + H.f0(w.units) + ' / ' + w.cap + ' vehicle sets · ' + H.f0(w.buf) + '%</i><em>target ≥ ' + w.target + ' h</em></div>').join('') +
      '<div class="pos none"><small>' + V.finished.label + '</small><b>' + fh(V.finished.hours) + '</b><i>' + H.f0(V.finished.units || 0) + ' vehicles ÷ ' + (V.finished.shipRate || 0).toFixed(1) + ' / min dispatch</i><em>awaiting dispatch</em></div>';
    const sorts = [['total', 'Total'], ['lineside', 'Line-side'], ['bay', bays], ['inbound', 'Inbound'], ['name', 'Name']]
      .map((x) => '<button data-invsort="' + x[0] + '" class="' + (sort === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('');
    const chips = ['all'].concat(Object.keys(SHOP_LABEL)).map((k) => '<button data-pshop="' + k + '" class="' + (f === k ? 'on' : '') + '">' + (k === 'all' ? 'All shops' : SHOP_LABEL[k]) + '</button>').join('');
    const sm = V.summary;
    const body = tbl(['Part', 'Shop', 'Rate / h', 'Inbound', bays, 'Line-side', 'Total usable'], rows.map((r) => {
      const tst = r.h.total === null ? 'none' : Sim.partStatus(r.h.total * 60);
      return '<tr><td><b>' + r.name + '</b><small>' + r.id + ' · ' + r.loc + '</small></td><td>' + SHOP_LABEL[r.shop] + '</td><td>' + H.f0(r.rate * 60) + '</td>' +
        POS_COLS.map((k) => cell(r, k)).join('') + '<td class="hc tot ' + tst + '" data-tip="' + H.f0(r.pcs.total) + ' pcs usable (' + bays.toLowerCase() + ' + line-side)">' + fh(r.h.total) + '</td></tr>';
    }));
    return frame('inventory', 'Hours of Inventory by Position', 'Stock ÷ consumption rate at every point along the flow',
      cards([card('Parts tracked', sm.count), card('Median usable', fh(sm.median), ''), card('Lowest part', fh(sm.min), sm.min !== null && sm.min < 1 ? 'low' : sm.min < 2 ? 'watch' : 'ok'),
        card('Under 1 h', sm.under1h, sm.under1h ? 'low' : 'ok'), card('Under 4 h', sm.under4h, sm.under4h ? 'watch' : 'ok')]) +
      sect('Material flow — median hours per position', '<div class="posrow">' + strip + '</div>') +
      sect('Shop & JV buffers, ' + V.finished.label.toLowerCase(), '<div class="posrow">' + wip + '</div>') +
      '<div class="filters">' + chips + '<span class="fsep"></span><span class="mut" style="font-size:12px">Sort</span>' + sorts + '<button class="csv" data-act="invcsv">⤓ CSV</button></div>' +
      sect('Parts × positions (' + rows.length + ')', body +
        '<p class="note">Hours = pcs at the position ÷ consumption per hour. Colour = against target (line-side ≥ ' + T.lineside + ' h): green at/above, amber ≥ 50%, red below. ' +
        'Usable = ' + bays.toLowerCase() + ' + line-side. Shop and JV buffer hours = buffer vehicle-sets ÷ line rate (' + (S.build.rate * 60).toFixed(0) + ' veh/h; targets ≥ ' + T.wip + ' h shops, ≥ ' + T.jv + ' h JVs). Parts whose feed gives no per-position split show only the total.</p>'));
  }

  /* ---------- inbound ---------- */
  function inbound(S, H) {
    const y = S.yard, bay = TM(S, 'bay'), bays = TM(S, 'bays'), atBay = TM(S, 'atBay'), order = { docked: 0, arrived: 1, scheduled: 2, received: 3 };
    const trucks = S.trucks.slice().sort((a, b) => order[a.status] - order[b.status] || (a.status === 'received' ? (b.doneAt || 0) - (a.doneAt || 0) : (a.sched || 0) - (b.sched || 0)));
    const recvShown = trucks.filter((t) => t.status === 'received').slice(0, 8);
    const rows = trucks.filter((t) => t.status !== 'received').concat(recvShown).map((t) => {
      const st = { docked: 'cy', arrived: 'watch', scheduled: 'mut', received: 'ok' }[t.status];
      const late = t.arrivedAt !== null && t.sched !== null && t.arrivedAt - t.sched > 20 ? '<small class="watch">late +' + H.f0(t.arrivedAt - t.sched) + ' min</small>' : '';
      const dwell = t.arrivedAt !== null && t.status !== 'received' && t.status !== 'scheduled' ? H.f0(S.clock - t.arrivedAt) + ' min' : t.doneAt && t.arrivedAt ? H.f0(t.doneAt - t.arrivedAt) + ' min' : '—';
      const overdue = t.status === 'scheduled' && t.sched !== null && S.clock - t.sched > 15 ? '<small class="low">overdue ' + H.f0(S.clock - t.sched) + ' min</small>' : '';
      return '<tr><td><b>' + t.id + '</b></td><td>' + t.sup + '</td><td>' + t.mat + '</td><td><span class="chip ' + st + '">' + (t.status === 'docked' ? atBay : t.status).toUpperCase() + '</span></td><td>' + (t.dock || '—') + '</td>' +
        '<td>' + clk(t.sched) + overdue + '</td><td>' + clk(t.arrivedAt) + late + '</td><td>' + dwell + '</td></tr>';
    });
    const occ = new Set(S.trucks.filter((t) => t.status === 'docked' && t.dock).map((t) => t.dock));
    let grid = '';
    for (let i = 1; i <= y.docks; i++) grid += '<span class="dk ' + (occ.has(i) ? 'busy' : '') + '" data-tip="' + bay + ' ' + i + (occ.has(i) ? ' — occupied' : ' — free') + '">' + i + '</span>';
    return frame('inbound', 'Inbound Truck Flow — ' + TM(S, 'parking'), 'Gate → ' + bay.toLowerCase() + ' → received · today',
      cards([card('Expected', y.expected), card('Arrived', y.arrived, '', H.f0((y.arrived / y.expected) * 100) + '%'), card(atBay, y.docked, '', H.f0((y.docked / y.expected) * 100) + '%'),
        card('Received', y.received, 'ok', H.f0((y.received / y.expected) * 100) + '%'), card('At plant now', Math.max(0, y.arrived - y.received), 'cy'),
        card('Gate → ' + bay.toLowerCase() + ' (avg)', H.f0(y.g2d) + ' min', y.g2d > 45 ? 'watch' : ''), card('Truck turnaround (avg)', H.f0(y.turn) + ' min', y.turn > 90 ? 'watch' : '')]) +
      '<div class="two">' + sect('Gate to ' + bay.toLowerCase() + ' time', big(H, 'g2d', S.hist.g2d, S.hist.t, { color: '#29b6ff', unit: ' min' })) +
      sect('Truck turnaround time', big(H, 'turn', S.hist.turn, S.hist.t, { color: '#29b6ff', unit: ' min' })) + '</div>' +
      sect(bay + ' occupancy — ' + y.occupied + ' / ' + y.docks, '<div class="dockgrid">' + grid + '</div>') +
      sect('Trucks (' + S.trucks.length + ')', tbl(['Truck', 'Supplier', 'Material', 'Status', bay, 'Scheduled', 'Arrived', 'Dwell'], rows)));
  }

  /* ---------- transfers ---------- */
  function transfers(S, H) {
    const d = S.deliveries;
    const cs = S.transfers.map((t) => {
      const ok = t.q.reduce((a, c) => a + c, 0), n = t.q.length, pct = (ok / n) * 100, st = pct < 78 ? 'low' : 'ok';
      return '<div class="dc wide"><small>' + t.name + '</small><b class="' + st + '">' + H.f0(pct) + '%</b><i>' + ok + ' of last ' + n + ' jobs on time</i>' +
        '<div class="dots">' + t.q.map((v, i) => '<span class="' + (v ? 'ok' : 'low') + '" data-tip="Job ' + (i + 1) + ' (oldest first): ' + (v ? 'on time' : 'late') + '"></span>').join('') + '</div>' +
        chip(st, pct < 78 ? 'DELAYED' : 'ON TIME') + '</div>';
    }).join('');
    return frame('transfers', 'In-Plant Transfers', 'Rolling window of the most recent jobs per route',
      cards([card('Deliveries today', d.total), card('On time', d.onTime, 'ok'), card('On-time rate', H.f0((d.onTime / d.total) * 100) + '%', d.onTime / d.total < 0.9 ? 'watch' : 'ok'),
        card('Line-side restocks pending', S.lineside.filter((l) => l.pend).length, '')]) +
      '<div class="dcs four">' + cs + '</div>' +
      sect('How status is derived', '<p class="note">A route is <b>DELAYED</b> when fewer than 78% of its latest jobs met their due time. Each square is one job (green on time, red late), oldest on the left. ' +
        'Bumper → Assembly turns red when the bumper shop buffer falls or a slowdown is injected; the same state colours the flow arrow on the plant map.</p>'));
  }

  /* ---------- line side ---------- */
  function lineside(S, H) {
    const rate = S.line.stopped ? 0 : S.build.rate;
    const rows = S.lineside.map((l) => {
      const st = Sim.linesideStatus(l), run = rate > 0 ? l.usable / rate : null;
      return '<tr><td><b>' + l.name + '</b></td><td>' + H.f0(l.usable) + '</td><td>' + l.safety + '</td><td>' + l.max + '</td>' +
        '<td>' + bar((l.usable / l.max) * 100, H.COL[st], 150) + '</td><td>' + (run === null ? 'stopped' : H.f0(run) + ' min') + '</td>' +
        '<td>' + (l.pend ? H.f0(l.pend.eta) + ' min<small>' + H.f0(l.pend.qty) + ' pcs</small>' : '<span class="mut">none</span>') + '</td><td>' + chip(st, H.statusLabel[st]) + '</td></tr>';
    });
    const cnt = { low: 0, watch: 0, ok: 0 }; S.lineside.forEach((l) => cnt[Sim.linesideStatus(l)]++);
    return frame('lineside', 'Line-Side Stock', 'Usable stock vs safety stock at the assembly line',
      cards([card('Low', cnt.low, cnt.low ? 'low' : 'ok'), card('Watch', cnt.watch, cnt.watch ? 'watch' : 'ok'), card('OK', cnt.ok, 'ok'), card('Line rate', H.f1(S.build.rate) + ' veh/min', '', S.line.stopped ? 'line stopped' : '')]) +
      sect('Key materials', tbl(['Material', 'Usable', 'Safety', 'Max', 'Fill', 'Runway at line rate', 'Next replenishment', 'Status'], rows)) +
      sect('Rules', '<p class="note">Status: <b>LOW</b> below 50% of safety stock, <b>WATCH</b> below 75%. Runway = usable ÷ line rate. A replenishment is triggered below 65% of safety.</p>'));
  }

  /* ---------- AMR ---------- */
  function amr(S, H, ui) {
    const which = ui.fleet === 'jv' ? 'jv' : 'amr', F = S[which], v = Sim.fleetView(F);
    const bc = v.battery >= 50 ? 'ok' : v.battery >= 30 ? 'watch' : 'low';
    const buckets = [0, 0, 0, 0, 0]; F.amrs.forEach((a) => buckets[Math.min(4, Math.floor(a.b / 20))]++);
    const mx = Math.max.apply(null, buckets) || 1;
    const hist = '<div class="hist">' + buckets.map((c, i) => '<div data-tip="' + c + ' units at ' + i * 20 + '–' + (i * 20 + 20) + '% battery"><b style="height:' + (c / mx) * 100 + '%;background:' + (i === 0 ? H.COL.low : i === 1 ? H.COL.watch : H.COL.ok) + '"></b><span>' + i * 20 + '–' + (i * 20 + 20) + '%</span><em>' + c + '</em></div>').join('') + '</div>';
    const units = F.amrs.slice().sort((a, b) => a.b - b.b).map((a) => {
      const st = a.s === 'busy' ? 'cy' : a.s === 'charging' ? 'watch' : 'ok', bs = a.b < 25 ? 'low' : a.b < 50 ? 'watch' : 'ok';
      const r = F.routes[a.r];
      return '<tr><td><b>' + a.id + '</b></td><td><span class="chip ' + st + '">' + a.s.toUpperCase() + '</span></td><td>' + bar(a.b, H.COL[bs], 110) + ' ' + H.f0(a.b) + '%</td><td>' + (a.s === 'busy' && r ? r.name : '—') + '</td><td>' + (a.s === 'busy' ? H.f0(Math.max(0, a.t)) + ' min' : '—') + '</td></tr>';
    });
    const routes = F.routes.map((r) => { const p = r.ema * 100, st = Sim.routeStatus(p); return '<tr><td>' + r.name + '</td><td>' + r.n + '</td><td>' + bar(p, H.COL[st], 120) + ' ' + H.f0(p) + '%</td><td>' + chip(st, st === 'ok' ? 'ON TIME' : st === 'watch' ? 'WATCH' : 'LATE') + '</td></tr>'; });
    return frame('amr', 'AMR Transfers & Health', which === 'amr' ? 'Indoor / in-house fleet' : 'Adjacent JV fleet (off-site)',
      '<div class="filters"><button data-fleet="amr" class="' + (which === 'amr' ? 'on' : '') + '">Indoor / In-house</button><button data-fleet="jv" class="' + (which === 'jv' ? 'on' : '') + '">Adjacent JVs</button></div>' +
      cards([card('Total AMRs', v.total), card('Available', v.avail, 'ok'), card('Busy', v.busy, 'cy'), card('Charging', v.charging, 'watch'), card('Utilization', H.f0(v.util) + '%'),
        card('Avg battery', H.f0(v.battery) + '%', bc), card('Low battery', v.low, v.low ? 'low' : 'ok'), card('Missions', v.done + ' / ' + v.planned)]) +
      '<div class="two">' + sect('Routes (missions today)', tbl(['Route', 'Missions', 'On-time', 'Status'], routes)) + sect('Battery distribution', hist) + '</div>' +
      sect('Units (lowest battery first)', tbl(['Unit', 'State', 'Battery', 'Current route', 'Task left'], units)));
  }

  /* ---------- quality ---------- */
  function quality(S, H) {
    const q = S.quality, spfSt = q.spf >= 95 ? 'ok' : q.spf >= 90 ? 'watch' : 'low';
    return frame('quality', 'Quality, Single-Piece Flow & Rejections', 'Today',
      cards([card('Rejected parts', q.rejected, 'low', H.f1((q.rejected / Math.max(1, S.build.actual)) * 100) + '% of build'), card('Quarantined', q.quarantined, 'watch', 'under investigation'),
        card('SPF adherence', H.f0(q.spf) + '%', spfSt, 'target 95%'), card(TM(S, 'jis') + ' (2 h)', H.f1(S.kpi.jis) + '%', S.kpi.jis >= 98 ? 'ok' : 'watch'), card('Stock accuracy', H.f1(S.kpi.stockAcc) + '%', S.kpi.stockAcc >= 98 ? 'ok' : 'watch')]) +
      '<div class="two">' + sect('Rejections per 5 min', big(H, 'rej', S.hist.rej, S.hist.t, { color: '#ff4d4d', unit: ' pcs' })) +
      sect('Single-piece flow adherence', big(H, 'spf', S.hist.spf, S.hist.t, { color: H.COL[spfSt], unit: '%', min: 60, max: 100, target: 95, grid: [60, 80, 100] })) + '</div>');
  }

  /* ---------- shop ---------- */
  function shop(S, H, key) {
    if (!SHOP_LABEL[key]) return null;
    const list = S.parts.filter((p) => p.shop === key).sort((a, b) => Sim.coverage(a) - Sim.coverage(b));
    const risk = list.filter((p) => Sim.coverage(p) < Sim.RISK_MIN).length, earliest = list.length ? Sim.coverage(list[0]) : null;
    const rel = { engine: 'eng', bumper: 'bmp' }[key], rt = rel && S.transfers.find((t) => t.id === rel);
    let top, charts = '';
    if (key === 'assembly') {
      const b = S.build, pct = (b.actual / b.plan) * 100, eta = b.rate > 0 ? (b.plan - b.actual) / b.rate : null;
      top = cards([card('Built', H.f0(b.actual) + ' / ' + b.plan, 'ok', H.f0(pct) + '% of plan'), card('Line', S.line.stopped ? 'STOPPED' : 'RUNNING', S.line.stopped ? 'low' : 'ok', S.line.reason || ''),
        card('Line rate', H.f1(b.rate) + ' veh/min'), card('Plan complete in', eta === null ? '—' : H.f0(eta) + ' min'), card('Logistics line stops', S.line.stops, S.line.stops ? 'low' : 'ok', H.f1(S.line.stoppedMin) + ' min lost'),
        card('Parts at risk', risk, risk ? 'low' : 'ok')]);
    } else {
      const s = S.shops[key], st = Sim.bufferStatus(s.buf);
      top = cards([card('Buffer', H.f0(s.buf) + '%', st, 'normal ≥ 66 · watch ≥ 50'), card('Status', H.statusLabel[st], st), card('Tracked parts', list.length), card('Parts at risk', risk, risk ? 'low' : 'ok'),
        card('Earliest shortage', earliest === null ? '—' : H.f0(earliest) + ' min', earliest !== null && earliest < 30 ? 'low' : earliest !== null && earliest < 60 ? 'watch' : 'ok')]);
      charts = sect('Buffer level (last ' + (S.hist.t.length * 5 / 60).toFixed(1) + ' h)', big(H, 'shop:' + key, S.hist.shops[key], S.hist.t, { color: H.COL[st], unit: '%', min: 0, max: 100, grid: [0, 50, 100] }));
    }
    const extra = rt ? sect('Transfer route: ' + rt.name, '<div class="dots">' + rt.q.map((v) => '<span class="' + (v ? 'ok' : 'low') + '"></span>').join('') + '</div><p class="note">' + rt.q.reduce((a, c) => a + c, 0) + ' of last ' + rt.q.length + ' jobs on time.</p>') : '';
    return frame('shop/' + key, SHOP_LABEL[key] + (key === 'assembly' ? '' : ' Shop'), 'Buffer, parts and transfers', top + charts + extra +
      sect('Parts for this shop (' + list.length + ')', list.length ? partsTable(S, H, list) : '<p class="note">No tracked parts.</p>'));
  }

  /* ---------- events & sources ---------- */
  function events(S) {
    const cls = { info: 'mut', ok: 'ok', watch: 'watch', low: 'low' };
    return frame('events', 'Event Log', 'Latest ' + S.events.length + ' events',
      sect('Events', tbl(['Time', 'Level', 'Message'], S.events.map((e) => '<tr><td>' + clk(e.t) + '</td><td><span class="chip ' + cls[e.lvl] + '">' + e.lvl.toUpperCase() + '</span></td><td>' + e.msg + '</td></tr>'))));
  }
  function sources(S) {
    const live = DOMAINS.filter((d) => S.live && S.live[d[0]]).length, stale = (S.stale || []).length;
    const rows = DOMAINS.map((d) => {
      const r = (S.src || {})[d[0]], isLive = S.live && S.live[d[0]];
      return '<tr><td><b>' + d[0] + '</b><small>' + d[1] + '</small></td><td>' + (isLive ? chip('ok', 'LIVE') : chip('mut', 'SIMULATED')) + '</td>' +
        '<td>' + (r && r.last ? (r.age !== null && r.age !== undefined ? r.age + ' s ago' : 'now') : '—') + '</td><td>' + (r ? r.count : 0) + '</td>' +
        '<td>' + (r ? (r.status === 'stale' ? chip('low', 'STALE') : chip('ok', 'FRESH')) : '—') + '</td><td class="' + (r && r.error ? 'low' : 'mut') + '">' + (r && r.error ? r.error : '') + '</td></tr>';
    });
    return frame('sources', 'Data Sources', 'Which parts of this dashboard are driven by real feeds',
      cards([card('Mode', S.demo ? 'DEMO' : S.mixed ? 'MIXED' : 'LIVE', S.demo ? 'low' : S.mixed ? 'watch' : 'ok'), card('Live domains', live + ' / ' + DOMAINS.length), card('Stale feeds', stale, stale ? 'low' : 'ok')]) +
      sect('Source systems (one POST per system)', (() => {
        const names = Object.keys(S.sources || {});
        if (!names.length) return '<p class="note">No source systems defined yet. Add one under <a data-href="#/settings" style="color:#9bd1ff;cursor:pointer">Interfaces \u2192 Sources</a>: each gets its own token and endpoint <code>POST /api/source/&lt;name&gt;</code>.</p>';
        return tbl(['Source', 'Endpoint', 'Owns', 'Last post', 'Posts', 'Values / post', 'Rejected', 'State', 'Last error'], names.map((n) => {
          const r = S.sources[n], st = !r.last ? chip('mut', 'NO POSTS YET') : r.stale ? chip('low', 'STALE') : chip('ok', 'FRESH');
          return '<tr><td><b>' + n + '</b><small>' + (r.label || '') + '</small></td><td><code>POST /api/source/' + n + '</code></td><td>' + ((r.owns || []).join(', ') || '\u2014') + '</td><td>' + (r.last ? r.age + ' s ago' : '\u2014') + '</td>' +
            '<td>' + (r.count || 0) + '</td><td>' + (r.paths || '\u2014') + '</td><td class="' + (r.rejected ? 'watch' : '') + '">' + (r.rejected || 0) + '</td><td>' + st + '</td><td class="' + (r.error ? 'low' : 'mut') + '">' + (r.error ? String(r.error).split('\n')[0] : '') + '</td></tr>';
        }));
      })()) +
      sect('Domains', tbl(['Domain', 'Source', 'Last update', 'Messages', 'Freshness', 'Last error'], rows)) +
      sect('Send data', '<p class="note">Push: <code>POST /api/ingest/&lt;domain&gt;</code> (JSON, <code>Authorization: Bearer $INGEST_TOKEN</code>), or <code>POST /api/ingest/batch</code> with <code>[{domain, payload}]</code>. ' +
        'Endpoints are entered per data point on the <a data-href="#/settings" style="color:#9bd1ff;cursor:pointer">Interfaces page</a>. Payload shapes: <code>docs/DATA-CONTRACT.md</code>. ' +
        'A domain flips from SIMULATED to LIVE on its first valid message; a feed older than <code>staleSec</code> (default 60) is flagged STALE and keeps its last value.</p>'));
  }

  window.FFPages = {
    frame, invRows,
    render(route, S, H, ui) {
      const seg = route.split('/');
      switch (seg[0]) {
        case 'parts': return parts(S, H, ui);
        case 'inventory': return inventory(S, H, ui);
        case 'inbound': return inbound(S, H);
        case 'transfers': return transfers(S, H);
        case 'lineside': return lineside(S, H);
        case 'amr': return amr(S, H, ui);
        case 'quality': return quality(S, H);
        case 'shop': return shop(S, H, seg[1]);
        case 'events': return events(S);
        case 'sources': return sources(S);
      }
      return null;
    }
  };
})();
