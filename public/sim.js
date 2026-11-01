/*
 * FactoryFlow simulation engine (demo data source).
 *
 * Pure state machine: createState() -> plain JSON object, step(S, simSeconds) mutates it.
 * Runs in the browser (default) or in Node (server.js streams the same state over SSE).
 * To use real data, replace this with an adapter that produces the same state shape
 * (see README "Connecting real data").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FactorySim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const R = Math.random;
  const rnd = (a, b) => a + R() * (b - a);
  const rint = (a, b) => Math.floor(rnd(a, b + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const HIST = 40;          // history points kept for sparklines
  const SAMPLE_MIN = 5;     // sim minutes between history samples

  const SHOP_NAMES = {
    press: 'Press', weld: 'Weld', paint: 'Paint', engine: 'Engine',
    bumper: 'Bumper', assembly: 'Assembly'
  };

  /* ---------- helpers shared with the UI ---------- */
  const coverage = (p) => (p.rate > 0 ? p.stock / p.rate : 9999);
  const fmtClock = (m) => {
    m = ((m % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0');
  };
  const bufferStatus = (v) => (v >= 66 ? 'ok' : v >= 50 ? 'watch' : 'low');
  const partStatus = (c) => (c < 30 ? 'low' : c < 60 ? 'watch' : 'ok');
  const linesideStatus = (it) => {
    const r = it.usable / it.safety;
    return r < 0.5 ? 'low' : r < 0.75 ? 'watch' : 'ok';
  };
  const routeStatus = (pct) => (pct >= 93 ? 'ok' : pct >= 85 ? 'watch' : 'low');
  const RISK_MIN = 60;   // a part is "at risk" when usable coverage is below this many minutes

  function nextAction(S, p) {
    const c = coverage(p);
    if (c < 30) {
      return p.pending
        ? { text: 'Expedite dock truck ' + p.pending.ref, owner: 'Logistics' }
        : { text: 'Raise emergency call-off', owner: 'Logistics' };
    }
    if (c < 50) return { text: 'Transfer from ' + SHOP_NAMES[p.shop] + ' Shop', owner: 'Material Ctrl' };
    if (c < 65) {
      return p.pending
        ? { text: 'Confirm truck ' + p.pending.ref + ' (ETA ' + fmtClock(S.clock + p.pending.eta) + ')', owner: 'Inbound' }
        : { text: 'Schedule inbound truck', owner: 'Inbound' };
    }
    return { text: 'Pick from Supermarket', owner: 'Production' };
  }

  /* ---------- AMR fleets ---------- */
  function makeFleet(n, o) {
    const amrs = [];
    for (let i = 0; i < n; i++) amrs.push({ id: (o.prefix || 'AMR-') + String(i + 1).padStart(2, '0'), b: rnd(o.bLo, o.bHi), s: 'idle', t: 0, r: 0 });
    let i = 0;
    for (let k = 0; k < o.busy; k++, i++) { amrs[i].s = 'busy'; amrs[i].t = rnd(1, 8); amrs[i].r = rint(0, o.routes.length - 1); }
    for (let k = 0; k < o.charging; k++, i++) { amrs[i].s = 'charging'; amrs[i].b = rnd(15, 40); }
    return {
      amrs, chargers: o.chargers, demand: o.demand, util: o.util,
      planned: o.planned, misc: o.misc, routes: o.routes.map((r) => Object.assign({ ema: r.pct / 100 }, r))
    };
  }
  function stepFleet(F, m, mods) {
    let charging = F.amrs.filter((a) => a.s === 'charging').length;
    for (const a of F.amrs) {
      if (a.s === 'charging') {
        a.b += 3 * m;
        if (a.b >= 88) { a.s = 'idle'; charging--; }
      } else if (a.s === 'busy') {
        a.b -= 0.35 * m; a.t -= m;
        if (a.t <= 0) {
          a.s = 'idle';
          const r = F.routes[a.r];
          r.n++;
          const okP = r.p - (mods && mods[r.mod] > 0 ? 0.3 : 0);
          const ok = R() < okP ? 1 : 0;
          r.ema += (ok - r.ema) * 0.08;
        }
      } else {
        a.b -= 0.03 * m;
      }
      if (a.s === 'idle' && a.b < 24 && charging < F.chargers) { a.s = 'charging'; charging++; }
      a.b = clamp(a.b, 3, 100);
    }
    // new demand
    let want = F.demand * m;
    while (want > 0) {
      if (want < 1 && R() > want) break;
      want--;
      const idle = F.amrs.filter((a) => a.s === 'idle' && a.b > 28);
      F.planned++;
      if (!idle.length) continue;
      const a = pick(idle);
      a.s = 'busy'; a.t = rnd(3, 9);
      // weighted route choice
      let tot = 0; for (const r of F.routes) tot += r.w;
      let x = R() * tot, idx = 0;
      for (let k = 0; k < F.routes.length; k++) { x -= F.routes[k].w; if (x <= 0) { idx = k; break; } }
      a.r = idx;
    }
    const busy = F.amrs.filter((a) => a.s === 'busy').length;
    const disp = Math.max(1, F.amrs.length - charging);
    F.util += (busy / disp - F.util) * clamp(m / 60, 0, 1);
  }
  function fleetView(F) {
    const n = F.amrs.length;
    const busy = F.amrs.filter((a) => a.s === 'busy').length;
    const charging = F.amrs.filter((a) => a.s === 'charging').length;
    const idle = n - busy - charging;
    const avgB = F.amrs.reduce((s, a) => s + a.b, 0) / n;
    const low = F.amrs.filter((a) => a.s !== 'charging' && a.b < 25).length;
    const done = F.routes.reduce((s, r) => s + r.n, 0) + F.misc;
    return {
      total: n, avail: idle, busy, charging, util: F.util * 100, battery: avgB, low,
      done, planned: Math.max(F.planned, done + busy)
    };
  }

  /* ---------- state ---------- */
  function seedSeries(base, spread, n) {
    const out = []; let v = base;
    for (let i = 0; i < n; i++) { v = clamp(v + (base - v) * 0.3 + (R() - 0.5) * spread, base - spread * 2, base + spread * 2); out.push(+v.toFixed(2)); }
    return out;
  }

  function createState() {
    const d = new Date();
    const clock = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    const S = {
      v: 1, demo: true, plant: 'Plant 01', clock, speed: 30, paused: false, weather: 28,
      build: { plan: 920, actual: 766, rate: 1.9 },
      line: { stopped: false, reason: null, stops: 0, stoppedMin: 0 },
      mods: { bumperJam: 0, jvDelay: 0 },
      shops: {
        press: { buf: 82, target: 80 }, weld: { buf: 78, target: 78 }, paint: { buf: 65, target: 64 },
        engine: { buf: 68, target: 68 }, bumper: { buf: 42, target: 46 },
        stores: { buf: 76, target: 75 }, kitting: { buf: 68, target: 68 }
      },
      yard: {
        expected: 34, arrived: 26, docked: 21, received: 18, occupied: 21, docks: 28,
        g2d: 32, turn: 68
      },
      finished: { onTime: 92, shipOnTime: 92, units: 176, shipRate: 1.8 },
      kpi: { jis: 98.4, stockAcc: 97.8 },
      deliveries: { total: 375, onTime: 345 },
      transfers: [
        { id: 'eng', name: 'Engine → Assembly', icon: 'engine', p: 0.97, q: seedQ(12, 12), win: 12, rate: 0.25 },
        { id: 'bmp', name: 'Bumper → Assembly', icon: 'bumper', p: 0.88, q: seedQ(8, 6), win: 8, rate: 0.15, mod: 'bumperJam' },
        { id: 'milk', name: 'Milk-run (Line side)', icon: 'truck', p: 0.92, q: seedQ(8, 7), win: 8, rate: 0.18 },
        { id: 'amr', name: 'AMR jobs (Materials)', icon: 'amr', p: 0.9, q: seedQ(10, 8), win: 10, rate: 0.2 }
      ],
      lineside: [
        { name: 'Bumper (B/H-LH)', icon: 'bumper', usable: 42, safety: 100, pend: null },
        { name: 'Engine (Complete)', icon: 'engine', usable: 86, safety: 120, pend: null },
        { name: 'Wiring Harness', icon: 'harness', usable: 120, safety: 150, pend: null },
        { name: 'Seat Set', icon: 'seat', usable: 48, safety: 60, pend: null },
        { name: 'Door Latch', icon: 'latch', usable: 64, safety: 80, pend: null }
      ],
      quality: { rejected: 16, quarantined: 24, spf: 91, rejAcc: 0 },
      amr: makeFleet(48, {
        bLo: 28, bHi: 72, busy: 8, charging: 4, chargers: 6, demand: 1.3, util: 0.45, planned: 212, misc: 38,
        routes: [
          { name: 'Engine → Assembly', n: 42, pct: 98, p: 0.98, w: 3 },
          { name: 'Kitting → Assembly', n: 31, pct: 91, p: 0.91, w: 2.3 },
          { name: 'Milk-run (Line side)', n: 56, pct: 90, p: 0.9, w: 4 },
          { name: 'Others', n: 19, pct: 86, p: 0.86, w: 1.4 }
        ]
      }),
      jv: makeFleet(12, {
        prefix: 'JV-', bLo: 45, bHi: 80, busy: 3, charging: 0, chargers: 2, demand: 0.5, util: 0.75, planned: 118, misc: 0,
        routes: [
          { name: 'JV A → Assembly', key: 'A', n: 32, pct: 97, p: 0.97, w: 2.4, mod: 'jvDelay0' },
          { name: 'JV B → Supermarket', key: 'B', n: 40, pct: 95, p: 0.95, w: 3, mod: 'jvDelay0' },
          { name: 'JV C → Assembly', key: 'C', n: 22, pct: 88, p: 0.88, w: 1.6, mod: 'jvDelay' }
        ]
      }),
      parts: makeParts(clock),
      hist: { t: [], g2d: [], turn: [], rej: [], spf: [] },
      sampleAcc: 0, rejMark: 16,
      live: {}, src: {}, trucks: [],
      events: []
    };
    // fix JV route 'mod' naming: only JV C reacts to the jvDelay injection
    S.jv.amrs.forEach((a) => (a.r = a.r % 3));
    for (let i = 0; i < HIST; i++) S.hist.t.push(+(clock - (HIST - 1 - i) * SAMPLE_MIN).toFixed(2));
    S.hist.g2d = seedSeries(32, 4, HIST);
    S.hist.turn = seedSeries(68, 6, HIST);
    S.hist.spf = seedSeries(91, 2, HIST);
    S.hist.rej = seedSeries(1.6, 1.4, HIST).map((v) => Math.max(0, +v.toFixed(1)));
    S.lineside.forEach((l) => { l.max = Math.round(l.safety * 1.3); });
    const CAP = { press: 300, weld: 240, paint: 200, engine: 180, bumper: 160 };
    for (const k in CAP) S.shops[k].cap = CAP[k];
    S.parts.forEach(initInv);
    S.hist.shops = {};
    for (const k in S.shops) S.hist.shops[k] = seedSeries(S.shops[k].target, 3, HIST);
    makeTrucks(S);
    event(S, 'Control tower online — demo data stream started', 'info');
    return S;
  }

  function seedQ(len, ok) {
    const q = [];
    for (let i = 0; i < len; i++) q.push(i < ok ? 1 : 0);
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
    return q;
  }

  function makeParts(clock) {
    const key = [
      { id: 'P-BMP-F', name: 'Bumper B/H (Front)', loc: 'ASY-08', shop: 'bumper', stock: 28, rate: 1.27, icon: 'bumper',
        pending: { ref: 'V-181', eta: 18, qty: 160 } },
      { id: 'P-ENG-M', name: 'Engine Mount', loc: 'ASY-12', shop: 'engine', stock: 52, rate: 1.27, icon: 'mount', pending: null },
      { id: 'P-WH', name: 'Wiring Harness', loc: 'ASY-04', shop: 'assembly', stock: 68, rate: 1.17, icon: 'harness',
        pending: { ref: 'V-27', eta: 98, qty: 140 } },
      { id: 'P-SEAT', name: 'Seat Set (Driver)', loc: 'ASY-02', shop: 'assembly', stock: 16, rate: 0.216, icon: 'seat', pending: null }
    ];
    const extra = [
      ['Door Panel', 'press'], ['Roof Panel', 'press'], ['Fender LH', 'press'], ['Fender RH', 'press'], ['Hood Outer', 'press'],
      ['Floor Pan', 'weld'], ['Side Frame LH', 'weld'], ['Side Frame RH', 'weld'], ['Cross Member', 'weld'], ['Weld Nut Set', 'weld'],
      ['Primer Kit', 'paint'], ['Clear Coat', 'paint'], ['Sealer Tube', 'paint'], ['Base Coat Red', 'paint'], ['Base Coat White', 'paint'],
      ['Crankshaft', 'engine'], ['Cylinder Head', 'engine'], ['Piston Set', 'engine'], ['Oil Pump', 'engine'], ['Gearbox', 'engine'],
      ['Bumper Rear', 'bumper'], ['Grille', 'bumper'], ['Fog Lamp Set', 'bumper'], ['Bumper Clip Kit', 'bumper'],
      ['Door Latch', 'assembly'], ['Hood Hinge', 'assembly'], ['Brake Disc', 'assembly'], ['Tail Lamp', 'assembly'],
      ['Headlamp', 'assembly'], ['Windshield', 'assembly'], ['Radiator', 'assembly'], ['Axle Shaft', 'assembly'],
      ['Fuel Tank', 'assembly'], ['Dash Panel', 'assembly'], ['Muffler', 'assembly'], ['Shock Absorber', 'assembly'],
      ['Wheel Nut Kit', 'assembly'], ['Wiper Motor', 'assembly']
    ];
    const parts = key.slice();
    extra.forEach((e, i) => {
      const rate = rnd(0.3, 1.9);
      parts.push({
        id: 'P-' + String(100 + i), name: e[0], loc: 'ASY-' + String(rint(1, 24)).padStart(2, '0'), shop: e[1],
        stock: Math.round(rate * rnd(240, 900)), rate: +rate.toFixed(2), icon: 'box', pending: null
      });
    });
    return parts;
  }

  /* ---------- inventory by position ---------- */
  // Usable stock = central stores + supermarket + line-side. 'dock' = unloaded but not yet put away; 'inbound' = pending truck qty.
  const usable = (p) => (p.inv ? p.inv.stores + p.inv.supermarket + p.inv.lineside : p.stock);
  function initInv(p) {
    const ls = rnd(0.15, 0.35), sm = rnd(0.2, 0.35);
    p.split = [ls, sm, 1 - ls - sm];                       // target share of usable stock: line-side, supermarket, stores
    p.inv = { dock: 0, lineside: p.stock * ls, supermarket: p.stock * sm, stores: p.stock * (1 - ls - sm) };
  }
  function consumeInv(p, m) {
    let need = p.rate * m;
    for (const k of ['lineside', 'supermarket', 'stores']) { const t = Math.min(need, p.inv[k]); p.inv[k] -= t; need -= t; }
  }
  function flowInv(p, m) {
    const v = p.inv, total = v.lineside + v.supermarket + v.stores;
    const move = (from, to, share) => {                    // pull a position back towards its target share of the total
      const gap = share * total - v[to];
      if (gap > 0) { const t = Math.min(gap * clamp(m * 0.35, 0, 1), v[from]); v[from] -= t; v[to] += t; }
    };
    move('supermarket', 'lineside', p.split[0]);
    move('stores', 'supermarket', p.split[1]);
    if (v.dock > 0) { const t = Math.min(v.dock, Math.max(1, v.dock) * clamp(m * 0.12, 0, 1) + 0.0001); v.dock -= t; v.stores += t; }   // put-away
    if (v.dock < 0.01) { v.stores += v.dock; v.dock = 0; }
  }
  function scaleInv(p, total) {
    const cur = usable(p) || 1, f = total / cur;
    for (const k of ['lineside', 'supermarket', 'stores']) p.inv[k] *= f;
    p.stock = usable(p);
  }
  const hrs = (pcs, rate) => (rate > 0 && pcs !== null && pcs !== undefined ? pcs / rate / 60 : null);
  const TARGET_H = { inbound: null, dock: null, stores: 3, supermarket: 1.5, lineside: 0.75, wip: 1, finished: null };
  const hourStatus = (h, target) => (h === null || target === null || target === undefined ? 'none' : h >= target ? 'ok' : h >= target * 0.5 ? 'watch' : 'low');
  const POSITIONS = [
    { id: 'inbound', label: 'Inbound (en route)', short: 'Inbound' }, { id: 'dock', label: 'Receiving docks', short: 'Dock' },
    { id: 'stores', label: 'Central stores', short: 'Stores' }, { id: 'supermarket', label: 'Kitting / supermarket', short: 'Supermkt' },
    { id: 'lineside', label: 'Line-side', short: 'Line-side' }
  ];
  const median = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };

  /** Hours of inventory (stock / consumption rate) at every position along the flow. */
  function inventoryView(S) {
    const rows = S.parts.map((p) => {
      const h = { total: hrs(p.stock, p.rate) }, pcs = { total: p.stock };
      if (p.inv) {
        pcs.dock = p.inv.dock; pcs.stores = p.inv.stores; pcs.supermarket = p.inv.supermarket; pcs.lineside = p.inv.lineside;
        for (const k of ['dock', 'stores', 'supermarket', 'lineside']) h[k] = hrs(p.inv[k], p.rate);
      }
      pcs.inbound = p.pending ? p.pending.qty : null; h.inbound = p.pending ? hrs(p.pending.qty, p.rate) : null;
      return { id: p.id, name: p.name, shop: p.shop, loc: p.loc, rate: p.rate, h, pcs, detail: !!p.inv };
    });
    const positions = POSITIONS.map((pos) => {
      const vals = rows.filter((r) => r.h[pos.id] !== null && r.h[pos.id] !== undefined && (pos.id === 'inbound' || r.detail));
      const t = TARGET_H[pos.id], med = median(vals.map((r) => r.h[pos.id]));
      let min = null; vals.forEach((r) => { if (!min || r.h[pos.id] < min.h) min = { h: r.h[pos.id], name: r.name }; });
      return Object.assign({}, pos, { target: t, median: med, min, count: vals.length, below: t === null ? 0 : vals.filter((r) => r.h[pos.id] < t).length, status: hourStatus(med, t) });
    });
    const tot = rows.map((r) => r.h.total).filter((v) => v !== null);
    const rate = S.build.rate * 60;
    const wip = Object.keys(S.shops).filter((k) => S.shops[k].cap).map((k) => {
      const s = S.shops[k], units = s.units !== undefined ? s.units : (s.buf / 100) * s.cap;
      const h = s.hours !== undefined ? s.hours : rate > 0 ? units / rate : null;
      return { id: k, label: SHOP_NAMES[k] + ' buffer', buf: s.buf, units, cap: s.cap, hours: h, target: TARGET_H.wip, status: hourStatus(h, TARGET_H.wip) };
    });
    const f = S.finished, fh = f.units !== undefined && f.shipRate > 0 ? f.units / (f.shipRate * 60) : null;
    return {
      rows, positions, wip, finished: { units: f.units, hours: fh, shipRate: f.shipRate }, targets: TARGET_H,
      summary: { count: rows.length, median: median(tot), min: tot.length ? Math.min.apply(null, tot) : null, under1h: tot.filter((v) => v < 1).length, under4h: tot.filter((v) => v < 4).length }
    };
  }

  /* ---------- inbound trucks ---------- */
  const SUPPLIERS = ['Bharat Forge', 'Sundram Fasteners', 'Motherson', 'Lumax', 'Minda', 'Bosch India', 'Varroc', 'Endurance', 'Gabriel', 'Subros'];
  const MATERIALS = ['Bumper B/H', 'Wiring Harness', 'Seat Set', 'Engine Mount', 'Door Latch', 'Brake Disc', 'Headlamp', 'Radiator', 'Fuel Tank', 'Grille', 'Axle Shaft', 'Windshield'];
  let truckSeq = 1000;
  function newTruck(sched, status) {
    return { id: 'TRK-' + (++truckSeq), sup: pick(SUPPLIERS), mat: pick(MATERIALS), status, dock: null, sched, arrivedAt: null, dockedAt: null, doneAt: null };
  }
  function makeTrucks(S) {
    const y = S.yard, list = [];
    const used = new Set();
    for (let i = 0; i < y.expected; i++) {
      const sched = S.clock - (y.arrived - i) * 13;
      const st = i < y.received ? 'received' : i < y.docked ? 'docked' : i < y.arrived ? 'arrived' : 'scheduled';
      const t = newTruck(sched, st);
      if (st !== 'scheduled') t.arrivedAt = sched + rnd(-6, 8);
      if (st === 'docked' || st === 'received') { t.dockedAt = t.arrivedAt + rnd(15, 45); }
      if (st === 'received') t.doneAt = t.dockedAt + rnd(40, 90);
      if (st === 'docked') { let d; do { d = rint(1, y.docks); } while (used.has(d)); used.add(d); t.dock = d; }
      list.push(t);
    }
    S.trucks = list;
  }
  function moveTruck(S, from, to) {
    const t = S.trucks.find((x) => x.status === from);
    if (!t) return;
    t.status = to;
    if (to === 'arrived') t.arrivedAt = S.clock;
    if (to === 'docked') {
      t.dockedAt = S.clock;
      const used = new Set(S.trucks.filter((x) => x.status === 'docked').map((x) => x.dock));
      for (let i = 0; i < 40; i++) { const d = rint(1, S.yard.docks); if (!used.has(d)) { t.dock = d; break; } }
    }
    if (to === 'received') { t.doneAt = S.clock; t.dock = null; }
    if (S.trucks.length > 80) { const i = S.trucks.findIndex((x) => x.status === 'received'); if (i >= 0) S.trucks.splice(i, 1); }
  }

  /* ---------- events ---------- */
  function event(S, msg, lvl) {
    S.events.unshift({ t: S.clock, msg, lvl: lvl || 'info' });
    if (S.events.length > 40) S.events.pop();
  }

  /* ---------- step ---------- */
  function step(S, simSec) {
    if (S.paused) return S;
    const m = simSec / 60;           // sim minutes
    if (m <= 0) return S;
    S.clock += m;
    S.weather = clamp(S.weather + (R() - 0.5) * 0.02 * m, 24, 33);
    for (const k in S.mods) S.mods[k] = Math.max(0, S.mods[k] - m);
    const running = !S.line.stopped;
    const L = S.live || {};
    const tick = clamp(m, 0, 2);     // noise scale so fast speeds don't explode

    /* build */
    if (L.build) { /* live feed owns build counters */ } else if (running) {
      const d = Math.min(S.build.rate * m * rnd(0.9, 1.05), S.build.plan - S.build.actual);
      if (d > 0) {
        S.build.actual += d;
        S.quality.rejAcc += d * 0.0209;
        if (!L.finished) S.finished.onTime = clamp(S.finished.onTime + (92 - S.finished.onTime) * 0.02 * tick + (R() - 0.5) * 0.6 * tick, 82, 99);
      }
    } else {
      S.line.stoppedMin += m;
    }
    if (!L.build && S.build.actual >= S.build.plan - 0.01) {   // shift plan achieved -> roll into the next shift's plan
      event(S, 'Shift plan of ' + S.build.plan + ' vehicles achieved \u2014 next plan started', 'ok');
      S.build.actual = 0; S.line.stops = 0; S.line.stoppedMin = 0; S.quality.rejected = 0; S.rejMark = 0;
      if (!L.yard) { S.yard.expected = 34; S.yard.arrived = S.yard.docked = S.yard.received = 0; makeTrucks(S); }
    }
    while (S.quality.rejAcc >= 1) { S.quality.rejAcc--; S.quality.rejected++; }

    /* shop buffers */
    for (const k in (L.shops ? {} : S.shops)) {
      const s = S.shops[k];
      s.buf = clamp(s.buf + (s.target - s.buf) * 0.03 * tick + (R() - 0.5) * 1.4 * tick, 8, 99);
      if (R() < 0.01 * tick) s.target = clamp(s.target + rnd(-8, 8), 30, 90);
    }
    S.shops.bumper.target = Math.max(S.shops.bumper.target, 36);

    /* parts / shortages */
    let blocking = null;
    for (const p of (L.parts ? [] : S.parts)) {
      if (running) consumeInv(p, m);
      flowInv(p, m);
      p.stock = usable(p);
      const c = coverage(p);
      if (!p.pending && c < 55) {
        const slow = p.shop === 'bumper' ? 1.3 : 1;
        const late = R() < 0.08 ? 2.2 : 1;
        p.pending = { ref: 'V-' + rint(20, 299), eta: rnd(10, 36) * slow * late, qty: Math.round(p.rate * rnd(240, 600)) };
      }
      if (p.pending) {
        p.pending.eta -= m;
        if (p.pending.eta <= 0) {
          const shop = S.shops[p.shop];
          const f = shop ? clamp(shop.buf / 70, 0.6, 1.2) : 1;
          p.inv.dock += Math.round(p.pending.qty * f);
          event(S, 'Truck ' + p.pending.ref + ' docked — ' + p.name + ' replenished', 'ok');
          if (shop) shop.buf = clamp(shop.buf + 6, 0, 99);
          p.pending = null;
        }
      }
      if (p.stock <= 0 && !blocking) blocking = p;
    }
    if (L.line || L.parts) { /* live feed owns line status */ } else if (blocking && S.line.stopped === false) {
      S.line.stopped = true; S.line.reason = 'Shortage: ' + blocking.name; S.line.stops++;
      S.kpi.jis = clamp(S.kpi.jis - 2.5, 80, 100);
      event(S, 'LINE STOP — ' + blocking.name + ' (' + blocking.loc + ') ran out', 'low');
    } else if (!blocking && S.line.stopped && S.line.reason && S.line.reason.indexOf('Shortage') === 0) {
      S.line.stopped = false;
      event(S, 'Line restarted — ' + S.line.reason.replace('Shortage: ', '') + ' restocked', 'ok');
      S.line.reason = null;
    }

    /* inbound trucks */
    const y = S.yard;
    if (L.yard) { /* live */ } else {
    if (y.arrived < y.expected && R() < 0.1 * m) { y.arrived++; moveTruck(S, 'scheduled', 'arrived'); }
    else if (y.arrived >= y.expected && R() < 0.035 * m) { y.expected++; S.trucks.push(newTruck(S.clock + rnd(5, 40), 'scheduled')); }
    if (y.arrived > y.docked && y.occupied < y.docks && R() < 0.12 * m) {
      y.docked++; y.occupied++; moveTruck(S, 'arrived', 'docked');
      y.g2d = clamp(y.g2d * 0.9 + rnd(20, 48) * 0.1, 15, 90);
    }
    if (y.docked > y.received && R() < 0.1 * m) {
      y.received++; y.occupied = Math.max(2, y.occupied - 1); moveTruck(S, 'docked', 'received');
      y.turn = clamp(y.turn * 0.9 + rnd(48, 90) * 0.1, 30, 140);
    }
    // unload & leave: occupied bay count drifts toward real queue
    if (y.occupied < 9 && R() < 0.2 * m) y.occupied++;
    }

    /* internal transfers */
    for (const t of (L.transfers ? [] : S.transfers)) {
      let n = t.rate * m, jobs = 0;
      while (n > 0) { if (n < 1 && R() > n) break; n--; jobs++; }
      for (let i = 0; i < jobs; i++) {
        const jam = t.mod && S.mods[t.mod] > 0;
        const ok = R() < (jam ? 0.35 : t.p) ? 1 : 0;
        t.q.push(ok); if (t.q.length > t.win) t.q.shift();
        S.deliveries.total++; if (ok) S.deliveries.onTime++;
      }
    }

    /* line-side stock */
    for (const l of (L.lineside ? [] : S.lineside)) {
      if (running) l.usable = Math.max(0, l.usable - S.build.rate * m);
      if (!l.pend && l.usable / l.safety < 0.65) {
        const jam = l.icon === 'bumper' && S.mods.bumperJam > 0;
        l.pend = { eta: rnd(4, 11) * (jam ? 3 : 1), qty: Math.round(l.safety * rnd(0.6, 0.95)) };
      }
      if (l.pend) {
        l.pend.eta -= m;
        if (l.pend.eta <= 0) { l.usable = Math.min(l.max, l.usable + l.pend.qty); l.pend = null; }
      }
      if (l.usable <= 0 && !S.line.stopped) {
        S.line.stopped = true; S.line.reason = 'Line-side empty: ' + l.name; S.line.stops++;
        event(S, 'LINE STOP — line-side ' + l.name + ' empty', 'low');
      }
      if (S.line.stopped && S.line.reason && S.line.reason.indexOf('Line-side') === 0 && l.usable > 0 &&
        S.line.reason.indexOf(l.name) > 0 && !S.parts.some((p) => p.stock <= 0)) {
        S.line.stopped = false; S.line.reason = null; event(S, 'Line restarted — line-side restocked', 'ok');
      }
    }

    /* AMRs */
    if (!L.amr) stepFleet(S.amr, m, null);
    if (!L.jv) stepFleet(S.jv, m, { jvDelay: S.mods.jvDelay });

    /* quality & KPIs */
    if (!L.quality) S.quality.spf = clamp(S.quality.spf + (91 - S.quality.spf) * 0.02 * tick + (R() - 0.5) * 0.7 * tick - (S.line.stopped ? 0.2 * tick : 0), 70, 99);
    if (!L.quality && R() < 0.04 * tick) S.quality.quarantined = Math.max(0, S.quality.quarantined + (R() < 0.55 ? 1 : -1));
    if (!L.kpi) S.kpi.jis = clamp(S.kpi.jis + (98.4 - S.kpi.jis) * 0.02 * tick + (R() - 0.5) * 0.12 * tick, 80, 100);
    if (!L.kpi) S.kpi.stockAcc = clamp(S.kpi.stockAcc + (97.8 - S.kpi.stockAcc) * 0.02 * tick + (R() - 0.5) * 0.06 * tick, 90, 100);
    if (!L.finished) S.finished.units = clamp(S.finished.units + (running ? S.build.rate * m * 0.5 : 0) - S.finished.shipRate * m * 0.5 + (176 - S.finished.units) * 0.03 * tick + (R() - 0.5) * 2 * tick, 20, 400);
    if (!L.finished) S.finished.shipOnTime = clamp(S.finished.shipOnTime + (92 - S.finished.shipOnTime) * 0.02 * tick + (R() - 0.5) * 0.5 * tick, 80, 100);

    /* history samples */
    S.sampleAcc += m;
    while (S.sampleAcc >= SAMPLE_MIN) {
      S.sampleAcc -= SAMPLE_MIN;
      const h = S.hist;
      const pushH = (a, v) => { a.push(+v.toFixed(2)); if (a.length > HIST) a.shift(); };
      pushH(h.t, S.clock); pushH(h.g2d, y.g2d); pushH(h.turn, y.turn); pushH(h.spf, S.quality.spf);
      pushH(h.rej, S.quality.rejected - S.rejMark); S.rejMark = S.quality.rejected;
      for (const k in S.shops) pushH(h.shops[k], S.shops[k].buf);
    }
    return S;
  }

  /* ---------- hand a domain back to the simulator (fresh simulated data) ---------- */
  const DOMAIN_KEYS = {
    build: ['build'], line: ['line'], shops: ['shops'], parts: ['parts'], yard: ['yard', 'trucks'], trucks: ['trucks'],
    transfers: ['transfers'], lineside: ['lineside'], amr: ['amr'], jv: ['jv'], quality: ['quality'], kpi: ['kpi'],
    finished: ['finished'], deliveries: ['deliveries']
  };
  function resetDomain(S, domain) {
    const keys = DOMAIN_KEYS[domain];
    if (!keys) return;
    const fresh = createState();
    for (const k of keys) S[k] = JSON.parse(JSON.stringify(fresh[k]));
    if (domain === 'shops') S.hist.shops = fresh.hist.shops;
    delete S.live[domain]; delete S.src[domain];
  }

  /* ---------- scenario injections (for demos) ---------- */
  function inject(S, name) {
    switch (name) {
      case 'truckDelay': {
        let n = 0;
        for (const p of S.parts) if (p.pending) { p.pending.eta += 20; n++; }
        const b = S.parts[0];
        if (!b.pending) b.pending = { ref: 'V-' + rint(20, 299), eta: 30, qty: 160 };
        event(S, 'Inbound congestion — ' + (n || 1) + ' trucks delayed by 20 min', 'watch');
        break;
      }
      case 'bumperJam':
        S.mods.bumperJam = 20; S.shops.bumper.buf = Math.max(10, S.shops.bumper.buf - 20); S.shops.bumper.target = 36;
        event(S, 'Bumper shop slowdown — buffer falling, transfers delayed', 'watch');
        break;
      case 'amrFault': {
        const idle = S.amr.amrs.filter((a) => a.s === 'idle');
        for (let i = 0; i < Math.min(8, idle.length); i++) idle[i].b = rnd(8, 18);
        event(S, 'AMR fleet fault — ' + Math.min(8, idle.length) + ' units reporting critical battery', 'watch');
        break;
      }
      case 'jvDelay':
        S.mods.jvDelay = 15;
        event(S, 'JV C route delayed — supplier gate congestion', 'watch');
        break;
      case 'shortage': {
        const p = S.parts[1]; scaleInv(p, Math.min(p.stock, p.rate * 6)); if (p.pending) p.pending.eta = 25;
        event(S, 'Engine Mount stock dropped — coverage 6 min', 'low');
        break;
      }
    }
    return S;
  }

  return {
    createState, step, inject, resetDomain, inventoryView, hourStatus, POSITIONS, TARGET_H, coverage, partStatus, bufferStatus, linesideStatus, routeStatus,
    nextAction, fleetView, fmtClock, makeTrucks, SHOP_NAMES, RISK_MIN
  };
});
