/* Topic control towers for operators: production, quality, utility, safety.
 * One shared layout (same as the logistics tower): KPI row, four boxes, actionable items on the right.
 * Each tower is a function of the state that returns { tiles, boxes, groups }. */
(function () {
  'use strict';
  const Sim = window.FactorySim, U = window.FFOverall.util;
  const { esc, n0, p1, tip, atLeast, atMost, clk, lineChart, trendChart, donut } = U;
  const SEV = { low: 0, watch: 1 };
  const it = (st, t, d, href) => ({ st, t, d: d || '', href: href || '' });
  const worst = (...a) => (a.indexOf('low') >= 0 ? 'low' : a.indexOf('watch') >= 0 ? 'watch' : 'ok');
  const c = (st) => (st === 'mut' ? '' : st);
  const tile = (label, val, st, sub, hint) => '<div class="tkp ' + c(st) + '"' + tip(hint || label) + '><small>' + label + '</small><b class="' + c(st) + '">' + val + '</b><i>' + (sub || '') + '</i></div>';
  const kv = (label, val, st, sub) => '<div class="kv big"><span>' + label + (sub ? ' <small>' + sub + '</small>' : '') + '</span><b class="' + c(st) + '">' + val + '</b></div>';
  const table = (heads, rows, cls) => '<table class="ovt ' + (cls || '') + '"><thead><tr>' + heads.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  const td = (v, st) => '<td' + (st ? ' class="' + c(st) + '"' : '') + '>' + v + '</td>';
  const name = (r, st) => '<td><i class="sd ' + c(st) + '"></i><b>' + esc(r.name) + '</b></td>';
  /** horizontal bars: rows [label, value, text, status, markPct?]; max = scale */
  const hbars = (rows, max) => rows.map((r) => '<div class="hb wide"' + tip(r[0] + ': ' + r[2]) + '><span>' + esc(r[0]) + '</span><div class="tr"><i></i><b class="bg-' + (r[3] === 'mut' ? 'ok' : r[3]) + '" style="width:' + Math.min(100, (r[1] / Math.max(1e-9, max)) * 100).toFixed(1) + '%"></b>' +
    (r[4] !== undefined ? '<u style="left:' + Math.min(100, r[4]).toFixed(1) + '%"></u>' : '') + '</div><em>' + r[2] + '</em></div>').join('');
  const empty = (t) => '<div class="empty">' + t + '</div>';

  /* ---------------- production ---------------- */
  function production(S) {
    const V = Sim.mgmtView(S), P = S.production, remain = Math.max(0, V.len - V.elapsed);
    const stA = atLeast(V.attain, 97, 7), stF = V.forecast === null ? 'mut' : atLeast((V.forecast / V.plan) * 100, 99, 4), stO = atLeast(V.oeeAvg, 90, 5), down = V.downMin, stD = atMost(down, 60, 60);
    const rateNow = V.elapsed > 0 ? (V.actual / V.elapsed) * 60 : null, rateNeed = remain > 0 ? (Math.max(0, V.plan - V.actual) / remain) * 60 : null;
    const tiles = tile('Attainment', p1(V.attain), stA, n0(V.actual) + ' of ' + n0(V.due) + ' planned to now', 'Output of all departments against the share of the shift plan that should be done by now') +
      tile('Projected output', V.forecast === null ? '—' : n0(V.forecast), stF, V.forecast === null ? 'needs 15 min of shift' : ((V.forecast / V.plan - 1) * 100 >= 0 ? '+' : '') + ((V.forecast / V.plan - 1) * 100).toFixed(1) + '% vs shift plan ' + n0(V.plan), 'Run-rate forecast: output so far ÷ elapsed shift time × shift length') +
      tile('Average OEE', p1(V.oeeAvg), stO, 'target ≥ 90%', 'Simple average of the departments. OEE = availability × performance × quality') +
      tile('Downtime', n0(down) + ' min', stD, 'all departments, this shift') +
      tile('Assembly line', S.line.stopped ? 'STOPPED' : 'RUNNING', S.line.stopped ? 'low' : 'ok', S.line.stopped ? esc(S.line.reason || 'line stopped') : n0(S.line.stoppedMin) + ' min stopped today');
    const rows = V.rows.map((r) => { const a = atLeast(r.attain, 97, 7), o = atLeast(r.oee, 90, 5);
      return '<tr>' + name(r, worst(a === 'mut' ? 'ok' : a, o)) + td(n0(r.due)) + td(n0(r.actual)) + td((r.variance > 0 ? '+' : '') + n0(r.variance), r.variance < 0 ? a : 'ok') + td(p1(r.attain), a) + td(p1(r.avail), atLeast(r.avail, 92, 4)) + td(p1(r.perf), atLeast(r.perf, 95, 4)) + td(p1(r.qual), atLeast(r.qual, 98, 2)) + td(p1(r.oee), o) + td(n0(r.downMin)) + '</tr>'; });
    /* hourly output from the cumulative trend */
    const hrs = []; const t0 = P.shift.start, perHour = (V.plan / V.len) * 60;
    for (let h = t0; h < P.shift.end; h += 60) { const a = P.trend.filter((q) => q[0] <= h).pop(), b = P.trend.filter((q) => q[0] <= Math.min(h + 60, P.shift.end)).pop(); const done = (S.clock % 1440) >= h; hrs.push({ h, v: done && b ? Math.max(0, b[1] - (a ? a[1] : 0)) : null, part: (S.clock % 1440) < h + 60 }); }
    const mxH = Math.max(perHour * 1.15, Math.max.apply(null, hrs.map((x) => x.v || 0)));
    const hourly = '<div class="vbars tall">' + hrs.map((x) => { const st = x.v === null ? 'mut' : x.part ? 'ok' : atLeast((x.v / perHour) * 100, 97, 7);
      return '<div' + tip(clk(x.h) + ': ' + (x.v === null ? 'not started' : n0(x.v) + ' units' + (x.part ? ' so far (hour in progress)' : '') + ', hourly plan ' + n0(perHour))) + '><em>' + (x.v === null ? '' : n0(x.v)) + '</em><div class="col"><u style="bottom:' + ((perHour / mxH) * 100).toFixed(1) + '%"></u><b class="bg-' + (st === 'mut' ? 'ok' : st) + (x.part ? ' part' : '') + '" style="height:' + (((x.v || 0) / mxH) * 100).toFixed(1) + '%"></b></div><small>' + clk(x.h) + '</small></div>'; }).join('') + '</div>';
    const lossTot = P.losses.reduce((a, l) => a + l.min, 0), mxL = Math.max.apply(null, P.losses.map((l) => l.min).concat([1]));
    const losses = P.losses.length ? hbars(P.losses.slice(0, 6).map((l) => [l.reason, l.min, n0(l.min) + ' min · ' + (lossTot ? ((l.min / lossTot) * 100).toFixed(0) : 0) + '%', l.min >= 45 ? 'low' : l.min >= 25 ? 'watch' : 'ok']), mxL) : empty('No losses reported');
    const boxes = [
      ['▤', '', 'PLAN VS ACTUAL AND OEE', 'against plan to now · availability × performance × quality', table(['Department', 'Plan now', 'Actual', 'Var.', 'Attain.', 'Avail.', 'Perf.', 'Qual.', 'OEE', 'Down'], rows)],
      ['H', 'c-prod', 'HOURLY OUTPUT', 'all departments · dashed line = hourly plan', hourly],
      ['↗', 'flow', 'TREND AND FORECAST', 'cumulative, this shift', '<div class="tlg"><span><i class="l-ac"></i>Actual</span><span><i class="l-pl"></i>Plan</span><span><i class="l-fc"></i>Forecast</span></div>' + trendChart(S, V)],
      ['!', 'c-mat', 'DOWNTIME BY REASON', 'minutes this shift, largest first', losses]];
    const g1 = V.rows.filter((r) => r.attain !== null && r.attain < 97).sort((a, b) => a.attain - b.attain).map((r) => it(r.attain < 90 ? 'low' : 'watch', r.name + ' · ' + p1(r.attain) + ' of plan to now', n0(r.variance) + ' units behind'));
    const g2 = V.rows.filter((r) => r.oee < 90).sort((a, b) => a.oee - b.oee).map((r) => { const parts = [['availability', r.avail], ['performance', r.perf], ['quality', r.qual]].sort((a, b) => a[1] - b[1])[0]; return it(r.oee < 85 ? 'low' : 'watch', r.name + ' · OEE ' + p1(r.oee), 'weakest part: ' + parts[0] + ' ' + p1(parts[1])); });
    const g3 = [];
    if (S.line.stopped) g3.push(it('low', 'Assembly line stopped', S.line.reason || 'line stopped', '#/events'));
    P.losses.filter((l) => l.min >= 25).forEach((l) => g3.push(it(l.min >= 45 ? 'low' : 'watch', l.reason + ' · ' + n0(l.min) + ' min lost', lossTot ? ((l.min / lossTot) * 100).toFixed(0) + '% of all downtime' : '')));
    const g4 = [];
    if (V.forecast !== null && V.forecast < V.plan * 0.99) g4.push(it(V.forecast < V.plan * 0.95 ? 'low' : 'watch', 'Shift forecast ' + n0(V.forecast - V.plan) + ' units short', 'projected ' + n0(V.forecast) + ' of ' + n0(V.plan)));
    if (rateNow !== null && rateNeed !== null && rateNeed > rateNow * 1.02) g4.push(it(rateNeed > rateNow * 1.08 ? 'low' : 'watch', 'Needs ' + n0(rateNeed) + ' units/h to recover', 'running at ' + n0(rateNow) + ' units/h'));
    return { title: 'PRODUCTION CONTROL TOWER', tiles, boxes, groups: [
      { title: 'DEPARTMENTS BEHIND PLAN', empty: 'Every department is on plan', items: g1 }, { title: 'LOW OEE', empty: 'All departments at or above 90%', items: g2 },
      { title: 'LINE AND DOWNTIME', empty: 'Line running, no large loss reason', items: g3 }, { title: 'SHIFT RECOVERY', empty: 'Forecast meets the shift plan', items: g4 }] };
  }

  /* ---------------- quality ---------------- */
  function quality(S) {
    const V = Sim.mgmtView(S), Q = S.quality, T = Q.targets, fm = Q.fourM;
    const stR = atMost(V.rej, T.rejection, 0.5), stF = atLeast(V.fpy, T.fpy, 2), stS = atLeast(Q.spf, 90, 3), st4 = atLeast(V.fmAvg, fm.target, 1), stI = atLeast(V.invAcc, T.invAcc, 3);
    const tiles = tile('Material rejection', V.rej.toFixed(1) + '%', stR, 'target ≤ ' + T.rejection + '% · ' + n0(Q.rejected) + ' rejected', 'Rejected parts ÷ vehicles built') +
      tile('First pass yield', p1(V.fpy), stF, 'target ≥ ' + T.fpy + '%', 'Units without a defect ÷ units inspected, all departments') +
      tile('Single-piece flow', p1(Q.spf), stS, 'target ≥ 90%') + tile('4M compliance', p1(V.fmAvg), st4, 'target ≥ ' + fm.target + '%', 'Average of man, machine, material and method') +
      tile('Inventory accuracy', p1(V.invAcc), stI, 'target ≥ ' + T.invAcc + '%', 'Cycle count: system stock vs physical stock');
    const rows = V.rows.map((r) => { const f = atLeast(r.fpy, T.fpy, 2); return '<tr>' + name(r, f === 'mut' ? 'ok' : f) + td(n0(r.inspected)) + td(n0(r.defects)) + td(p1(r.fpy), f) + '<td class="barc"><span class="jb"><b class="' + c(f) + '" style="width:' + Math.max(2, Math.min(100, ((r.fpy || 0) - 85) / 15 * 100)).toFixed(0) + '%"></b></span></td></tr>'; });
    const dTot = Q.defects.reduce((a, d) => a + d.count, 0), ds = Q.defects.slice().sort((a, b) => b.count - a.count); let cum = 0;
    const pareto = ds.length && dTot > 0 ? hbars(ds.slice(0, 6).map((d) => { cum += d.count; return [d.type, d.count, n0(d.count) + ' · cum. ' + ((cum / dTot) * 100).toFixed(0) + '%', cum - d.count < dTot * 0.5 ? 'low' : cum - d.count < dTot * 0.8 ? 'watch' : 'ok']; }), ds[0].count) : empty('No defects recorded');
    const boxes = [
      ['▤', '', 'FIRST PASS YIELD BY DEPARTMENT', 'this shift · bar shows 85 to 100%', table(['Department', 'Inspected', 'Defects', 'FPY', ''], rows)],
      ['P', 'c-mat', 'DEFECT PARETO', 'by type, with cumulative share', pareto],
      ['4', 'c-fm', '4M COMPLIANCE', 'man, machine, material, method', donut(fm)],
      ['R', 'c-mat', 'REJECTION TREND', 'rejected ÷ built (%) · dashed line = target', lineChart(S.hist.rejPct, { color: 'var(--hl)', target: T.rejection, t: S.hist.t, dec: 1, minSpan: 0.4, w: 470, h: 280 }) + '<div class="foot3"><span><b>' + n0(Q.rejected) + '</b> rejected</span><span><b>' + n0(Q.quarantined) + '</b> on hold</span><span><b>≤ ' + T.rejection + '%</b> target</span></div>']];
    const g1 = V.rows.filter((r) => r.fpy !== null && r.fpy < T.fpy).sort((a, b) => a.fpy - b.fpy).map((r) => it(r.fpy < T.fpy - 2 ? 'low' : 'watch', r.name + ' · FPY ' + p1(r.fpy), n0(r.defects) + ' defects in ' + n0(r.inspected) + ' inspected'));
    const g2 = ds.slice(0, 2).filter((d) => dTot > 0 && d.count / dTot >= 0.2).map((d) => it(d.count / dTot >= 0.3 ? 'low' : 'watch', d.type + ' · ' + ((d.count / dTot) * 100).toFixed(0) + '% of all defects', n0(d.count) + ' this shift'));
    const g3 = [['man', 'Man'], ['machine', 'Machine'], ['material', 'Material'], ['method', 'Method']].filter((k) => fm[k[0]] < fm.target).map((k) => it(fm[k[0]] < fm.target - 1 ? 'low' : 'watch', k[1] + ' compliance ' + p1(fm[k[0]]), 'target ≥ ' + fm.target + '%'));
    const g4 = [];
    if (V.rej > T.rejection) g4.push(it(V.rej > T.rejection + 0.5 ? 'low' : 'watch', 'Rejection ' + V.rej.toFixed(1) + '% above target', n0(Q.rejected) + ' rejected, target ≤ ' + T.rejection + '%'));
    if (Q.quarantined > 0) g4.push(it(Q.quarantined >= 40 ? 'low' : 'watch', n0(Q.quarantined) + ' parts on hold', 'under investigation, release or scrap'));
    if (V.invAcc < T.invAcc) g4.push(it(V.invAcc < T.invAcc - 3 ? 'low' : 'watch', 'Inventory accuracy ' + p1(V.invAcc), 'target ≥ ' + T.invAcc + '%'));
    return { title: 'QUALITY CONTROL TOWER', tiles, boxes, groups: [
      { title: 'YIELD BELOW TARGET', empty: 'Every department meets the FPY target', items: g1 }, { title: 'TOP DEFECTS', empty: 'No defect type dominates', items: g2 },
      { title: '4M GAPS', empty: 'Man, machine, material and method on target', items: g3 }, { title: 'REJECTION AND HOLDS', empty: 'Rejection on target, nothing on hold', items: g4 }] };
  }

  /* ---------------- utility ---------------- */
  function utility(S) {
    const V = Sim.mgmtView(S), Ut = S.utility, pw = Ut.power, fr = V.len ? V.elapsed / V.len : 0, load = (pw.kw / pw.contractKw) * 100, peak = (pw.peakKw / pw.contractKw) * 100, wDue = Ut.water.target * fr, wVar = wDue > 0 ? ((Ut.water.m3 - wDue) / wDue) * 100 : null;
    const stE = V.eVarPct === null ? 'mut' : atMost(V.eVarPct, 0, 3), stL = atMost(load, 90, 7), stP = atMost(peak, 90, 7), stW = wVar === null ? 'mut' : atMost(wVar, 0, 5), stAir = atLeast(Ut.air.bar, Ut.air.minBar + 0.2, 0.2);
    const sg = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    const tiles = tile('Energy vs target', V.eVarPct === null ? '—' : sg(V.eVarPct), stE, n0(V.energy) + ' of ' + n0(V.eDue) + ' kWh to now', 'Energy used against the shift target × share of the shift elapsed') +
      tile('Power demand', n0(pw.kw) + ' kW', stL, load.toFixed(0) + '% of contract ' + n0(pw.contractKw) + ' kW') + tile('Peak demand', n0(pw.peakKw) + ' kW', stP, peak.toFixed(0) + '% of contract, this shift') +
      tile('Water', n0(Ut.water.m3) + ' m³', stW, wVar === null ? 'shift target ' + n0(Ut.water.target) + ' m³' : sg(wVar) + ' vs target to now') + tile('Compressed air', Ut.air.bar.toFixed(1) + ' bar', stAir, 'minimum ' + Ut.air.minBar.toFixed(1) + ' bar');
    const drow = (r) => { const due = r.energyTarget * fr, v = due > 0 ? ((r.energy - due) / due) * 100 : null; return { r, due, v, st: v === null ? 'mut' : atMost(v, 0, 3) }; };
    const D = V.rows.map(drow);
    const rows = D.map((x) => '<tr>' + name(x.r, x.st === 'mut' ? 'ok' : x.st) + td(n0(x.r.energy)) + td(n0(x.due)) + td(x.v === null ? '—' : sg(x.v), x.st) + td(n0(x.r.energyTarget)) + td(x.r.actual > 0 ? (x.r.energy / x.r.actual).toFixed(2) : '—') + '</tr>');
    const short = { press: 'Press', weld: 'Weld', paint: 'Paint', engine: 'Engine', assembly: 'Assy', im: 'IM', inspection: 'Insp.' };
    const bars = '<div class="vbars tall">' + D.map((x) => '<div' + tip(x.r.name + ': ' + n0(x.r.energy) + ' kWh of ' + n0(x.r.energyTarget) + ' for the shift') + '><em>' + n0(x.r.energy) + '</em><div class="col"><u style="bottom:' + (fr * 100).toFixed(1) + '%"></u><b class="bg-' + (x.st === 'mut' ? 'ok' : x.st) + '" style="height:' + Math.min(100, (x.r.energy / Math.max(1, x.r.energyTarget)) * 100).toFixed(1) + '%"></b></div><small>' + short[x.r.id] + '</small></div>').join('') + '</div>';
    const boxes = [
      ['▤', '', 'ENERGY BY DEPARTMENT', 'kWh against target to now · kWh per unit produced', table(['Department', 'Used kWh', 'Target to now', 'Variance', 'Shift target', 'kWh / unit'], rows)],
      ['D', 'c-util', 'POWER DEMAND', 'kW · dashed line = contract demand', lineChart(Ut.kwHist, { color: 'var(--hl)', target: pw.contractKw, t: S.hist.t, minSpan: 100, w: 470, h: 300 }) + '<div class="foot3"><span><b>' + n0(pw.kw) + ' kW</b> now</span><span><b>' + n0(pw.peakKw) + ' kW</b> peak</span><span><b>' + n0(pw.contractKw) + ' kW</b> contract</span></div>'],
      ['E', 'c-util', 'ENERGY VS SHIFT TARGET', 'bar = used · dashed mark = where the target is now', bars],
      ['W', 'c-fm', 'WATER AND COMPRESSED AIR', 'this shift', kv('Water used', n0(Ut.water.m3) + ' m³', stW, '(shift target ' + n0(Ut.water.target) + ' m³)') + kv('Water vs target to now', wVar === null ? '—' : sg(wVar), stW) + kv('Air header pressure', Ut.air.bar.toFixed(2) + ' bar', stAir, '(min ' + Ut.air.minBar.toFixed(1) + ')')]];
    const g1 = D.filter((x) => x.v !== null && x.v > 0).sort((a, b) => b.v - a.v).map((x) => it(x.v > 3 ? 'low' : 'watch', x.r.name + ' · ' + sg(x.v) + ' over energy target', n0(x.r.energy - x.due) + ' kWh above target to now'));
    const g2 = [];
    if (load > 90) g2.push(it(load > 97 ? 'low' : 'watch', 'Demand at ' + load.toFixed(0) + '% of contract', n0(pw.kw) + ' kW of ' + n0(pw.contractKw) + ' · shed or stagger loads'));
    if (peak > 97 && load <= 97) g2.push(it('watch', 'Peak reached ' + peak.toFixed(0) + '% of contract this shift', n0(pw.peakKw) + ' kW'));
    const g3 = Ut.air.bar < Ut.air.minBar + 0.2 ? [it(Ut.air.bar < Ut.air.minBar ? 'low' : 'watch', 'Air pressure ' + Ut.air.bar.toFixed(2) + ' bar', 'minimum ' + Ut.air.minBar.toFixed(1) + ' bar · check compressors and leaks')] : [];
    const g4 = wVar !== null && wVar > 0 ? [it(wVar > 5 ? 'low' : 'watch', 'Water ' + sg(wVar) + ' over target to now', n0(Ut.water.m3) + ' m³ used')] : [];
    return { title: 'UTILITY CONTROL TOWER', tiles, boxes, groups: [
      { title: 'ENERGY OVER TARGET', empty: 'Every department within its energy target', items: g1 }, { title: 'POWER DEMAND', empty: 'Demand below 90% of contract', items: g2 },
      { title: 'COMPRESSED AIR', empty: 'Pressure above the minimum', items: g3 }, { title: 'WATER', empty: 'Water use within target', items: g4 }] };
  }

  /* ---------------- safety ---------------- */
  function safety(S) {
    const V = Sim.mgmtView(S), sf = S.safety, DN = {}; V.rows.forEach((r) => { DN[r.id] = r.name; });
    const stT = atMost(sf.trir, sf.trirTarget, sf.trirTarget * 0.2), stC = atLeast(sf.compliance, sf.complianceTarget, 1), open = sf.incidents.filter((x) => x.status === 'open');
    const tiles = tile('Days since last LTI', n0(sf.daysSinceLti), sf.daysSinceLti < 30 ? 'watch' : 'ok', 'lost time injury') + tile('Lost time injuries', n0(sf.lti), sf.lti > 0 ? 'low' : 'ok', 'this period') +
      tile('TRIR', sf.trir.toFixed(2), stT, 'target ≤ ' + sf.trirTarget.toFixed(2), 'Total recordable incident rate') + tile('Near misses', n0(sf.nearMiss), sf.nearMiss >= 6 ? 'watch' : 'ok', 'reported this month') +
      tile('Safety compliance', p1(sf.compliance), stC, 'target ≥ ' + sf.complianceTarget + '%');
    const sevSt = { high: 'low', med: 'watch', low: 'ok' };
    const rows = sf.incidents.slice(0, 7).map((x) => '<tr><td><i class="sd ' + (x.status === 'open' ? sevSt[x.sev] : '') + '"></i><b>' + esc(x.id) + '</b></td>' + td(clk(x.at)) + td(esc(DN[x.dept] || x.dept || '—')) + '<td class="lft">' + esc(x.type) + '</td>' + td(x.sev.toUpperCase(), sevSt[x.sev]) + td(x.status === 'open' ? 'OPEN' : 'closed', x.status === 'open' ? 'watch' : '') + '</tr>');
    const comp = hbars(V.rows.map((r) => { const st = atLeast(r.safety, sf.complianceTarget, 1); return [r.name.replace(/ Shop$/, '').replace('Vehicle Inspection', 'Inspection'), Math.max(0, r.safety - 90), p1(r.safety), st, (sf.complianceTarget - 90) * 10]; }), 10);
    const al = (S.alerts || []).slice(0, 5);
    const boxes = [
      ['▤', '', 'INCIDENT LOG', 'latest first', rows.length ? table(['Incident', 'Time', 'Department', 'What happened', 'Severity', 'Status'], rows, 'short') : empty('No incidents recorded')],
      ['C', 'c-safe', 'COMPLIANCE BY DEPARTMENT', 'bar shows 90 to 100% · mark = target', comp],
      ['O', 'c-logi', 'OBSERVATIONS AND PERMITS', 'open and overdue', kv('Unsafe observations open', n0(sf.observations.open), sf.observations.open >= 10 ? 'watch' : 'ok') + kv('Observations overdue', n0(sf.observations.overdue), sf.observations.overdue > 0 ? 'low' : 'ok') + kv('Work permits open', n0(sf.permits.open)) + kv('Permits overdue', n0(sf.permits.overdue), sf.permits.overdue > 0 ? 'low' : 'ok')],
      ['A', 'c-mat', 'ACTIVE SITE ALERTS', 'weather, roads and other alerts', al.length ? al.map((a) => { const st = a.level === 'critical' ? 'low' : a.level === 'watch' ? 'watch' : 'ok'; return '<div class="ai ' + st + '"><i class="sd ' + st + '"></i><span><b>' + esc(a.title || 'Alert') + '</b>' + (a.msg ? '<small>' + esc(a.msg) + '</small>' : '') + '</span></div>'; }).join('') : empty('No active alerts')]];
    const g1 = open.sort((a, b) => ['high', 'med', 'low'].indexOf(a.sev) - ['high', 'med', 'low'].indexOf(b.sev)).map((x) => it(x.sev === 'high' ? 'low' : 'watch', x.id + ' · ' + x.type, (DN[x.dept] || x.dept || '') + ' · ' + x.sev + ' severity · open since ' + clk(x.at)));
    const g2 = [];
    if (sf.observations.overdue > 0) g2.push(it('low', n0(sf.observations.overdue) + ' unsafe observation' + (sf.observations.overdue > 1 ? 's' : '') + ' overdue', n0(sf.observations.open) + ' open in total'));
    if (sf.permits.overdue > 0) g2.push(it('low', n0(sf.permits.overdue) + ' work permit' + (sf.permits.overdue > 1 ? 's' : '') + ' overdue', n0(sf.permits.open) + ' open in total'));
    const g3 = V.rows.filter((r) => r.safety < sf.complianceTarget).sort((a, b) => a.safety - b.safety).map((r) => it(r.safety < sf.complianceTarget - 1 ? 'low' : 'watch', r.name + ' · compliance ' + p1(r.safety), 'target ≥ ' + sf.complianceTarget + '%'));
    const g4 = [];
    if (sf.lti > 0) g4.push(it('low', n0(sf.lti) + ' lost time injur' + (sf.lti > 1 ? 'ies' : 'y'), 'investigate and report'));
    if (sf.trir > sf.trirTarget) g4.push(it(sf.trir > sf.trirTarget * 1.2 ? 'low' : 'watch', 'TRIR ' + sf.trir.toFixed(2) + ' above target', 'target ≤ ' + sf.trirTarget.toFixed(2)));
    return { title: 'SAFETY CONTROL TOWER', tiles, boxes, groups: [
      { title: 'OPEN INCIDENTS', empty: 'No open incidents', items: g1 }, { title: 'OVERDUE ACTIONS', empty: 'No observation or permit overdue', items: g2 },
      { title: 'COMPLIANCE BELOW TARGET', empty: 'Every department meets the target', items: g3 }, { title: 'INJURIES AND TRIR', empty: 'No lost time injury, TRIR on target', items: g4 }] };
  }

  const TOWERS = { production, quality, utility, safety }, ROW_BUDGET = 13;
  function actions(groups) {
    const total = groups.reduce((a, g) => a + g.items.length, 0), red = groups.some((g) => g.items.some((i) => i.st === 'low'));
    const shown = groups.map((g) => Math.min(1, g.items.length)); let spare = ROW_BUDGET - groups.length;
    for (let again = true; again && spare > 0;) { again = false; groups.forEach((g, i) => { if (spare > 0 && shown[i] < g.items.length) { shown[i]++; spare--; again = true; } }); }
    return '<aside class="vbox twr-a' + (red ? ' problem' : '') + '"><div class="vh"><span class="vb">!</span><h2>ACTIONABLE ITEMS</h2><span class="vr ' + (red ? 'low' : total ? 'watch' : 'ok') + '">' + (total ? total + ' open' : 'all clear') + '</span></div><div class="vbody ag">' +
      groups.map((g, i) => { g.items.sort((a, b) => SEV[a.st] - SEV[b.st]); const w = g.items.some((x) => x.st === 'low') ? 'low' : g.items.length ? 'watch' : 'ok', k = shown[i];
        return '<div class="agrp ' + w + '" style="flex-grow:' + (Math.max(1, k) + 0.7) + '"><div class="agh"><span class="gn">' + (i + 1) + '</span><b>' + esc(g.title) + '</b><span class="cnt ' + w + '"' + (g.items.length > k ? tip((g.items.length - k) + ' more not shown') : '') + '>' + (g.items.length || '✓') + '</span></div>' +
          (g.items.length ? g.items.slice(0, k).map((x) => '<div class="ai ' + x.st + '"' + (x.href ? ' data-href="' + x.href + '"' : '') + tip(x.t + (x.d ? ' — ' + x.d : '')) + '><i class="sd ' + x.st + '"></i><span><b>' + esc(x.t) + '</b>' + (x.d ? '<small>' + esc(x.d) + '</small>' : '') + '</span></div>').join('') : '<div class="ai none"><span>' + esc(g.empty) + '</span></div>') + '</div>'; }).join('') + '</div></aside>';
  }
  function render(id, S) {
    const t = TOWERS[id](S);
    return '<div class="twr"><div class="twr-k">' + t.tiles + '</div><div class="twr-m">' + t.boxes.map((b) => '<div class="vbox"><div class="vh"><span class="vb ' + b[1] + '">' + b[0] + '</span><h2>' + b[2] + '</h2><span class="vsub">' + b[3] + '</span></div><div class="vbody">' + b[4] + '</div></div>').join('') + '</div>' + actions(t.groups) + '</div>';
  }
  function summary(id, S) { const g = TOWERS[id](S).groups; return { total: g.reduce((a, x) => a + x.items.length, 0), red: g.some((x) => x.items.some((i) => i.st === 'low')) }; }
  const NAMES = { production: 'PRODUCTION CONTROL TOWER', quality: 'QUALITY CONTROL TOWER', utility: 'UTILITY CONTROL TOWER', safety: 'SAFETY CONTROL TOWER' };
  window.FFTowers = { has: (id) => !!TOWERS[id], render, summary, title: (id) => NAMES[id], ids: Object.keys(TOWERS) };
})();
