'use strict';
/*
 * Ingest layer: turns external data (REST / MQTT / webhook) into the dashboard state.
 * Each *domain* that receives data is flipped to "live"; the simulator stops driving it
 * (see `L = S.live` guards in public/sim.js). Domains with no feed keep simulating (MIXED mode).
 * Payload shapes are documented in docs/DATA-CONTRACT.md.
 */
const Sim = require('../public/sim.js');
const DOMAINS = ['build', 'line', 'shops', 'parts', 'yard', 'trucks', 'transfers', 'lineside', 'amr', 'jv', 'jvstock', 'quality', 'kpi', 'finished', 'deliveries', 'kanban', 'seqflows', 'production', 'utility', 'safety'];
const SHOP_KEYS = ['press', 'weld', 'paint', 'engine', 'bumper', 'assembly'];
const BUFFER_KEYS = ['press', 'weldA', 'weldB', 'paintA', 'paintB', 'engine', 'bumper', 'ip', 'tm'];
const BUFFER_ALIAS = { weld: ['weldA', 'weldB'], paint: ['paintA', 'paintB'] };   // older feeds send one buffer for both lines

class IngestError extends Error { constructor(m) { super(m); this.status = 400; } }

const num = (v, d) => { const n = Number(v); return v !== null && v !== '' && v !== undefined && Number.isFinite(n) ? n : d; };
const need = (v, what) => { const n = Number(v); if (v === null || v === undefined || v === '' || !Number.isFinite(n)) throw new IngestError(what + ' must be a number'); return n; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const str = (v, d) => (v === undefined || v === null ? d : String(v));
const asArray = (p, what) => { if (!Array.isArray(p)) throw new IngestError(what + ' must be an array'); return p; };
const asObj = (p, what) => { if (!p || typeof p !== 'object' || Array.isArray(p)) throw new IngestError(what + ' must be an object'); return p; };

/** minutes from "now" until an ISO timestamp / or a plain number of minutes */
function etaMinutes(o) {
  if (o.eta !== undefined && o.eta !== null) return num(o.eta, 30);
  if (o.etaAt) { const t = Date.parse(o.etaAt); if (!isNaN(t)) return (t - Date.now()) / 60000; }
  return 30;
}
/** ISO timestamp (or minutes-of-day number) -> minutes-of-day on the dashboard clock */
function clockOf(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return v;
  const t = Date.parse(v); if (isNaN(t)) return null;
  const d = new Date(t); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function normPart(p, old) {
  asObj(p, 'part');
  if (p.id === undefined || p.id === null) throw new IngestError('part.id is required');
  old = old || {};
  const out = {
    id: String(p.id), name: str(p.name, old.name || String(p.id)), loc: str(p.loc, old.loc || '—'),
    shop: SHOP_KEYS.includes(p.shop) ? p.shop : (old.shop || 'assembly'),
    stock: Math.max(0, num(p.stock, old.stock !== undefined ? old.stock : 0)),
    rate: Math.max(0, num(p.rate, old.rate !== undefined ? old.rate : 0)),
    icon: str(p.icon, old.icon || 'box'), pending: old.pending || null,
    critical: p.critical !== undefined ? !!p.critical : (old.critical !== undefined ? old.critical : true)
  };
  // optional per-position stock (pcs): { bay, lineside } ('dock' is accepted as an alias of 'bay'). usable stock = bay + lineside
  if (p.inv && typeof p.inv === 'object') {
    const oi = old.inv || {};
    out.inv = { bay: Math.max(0, num(p.inv.bay !== undefined ? p.inv.bay : p.inv.dock, oi.bay || 0)), lineside: Math.max(0, num(p.inv.lineside, oi.lineside || 0)) };
    if (p.stock === undefined) out.stock = out.inv.bay + out.inv.lineside;
  } else out.inv = p.stock !== undefined ? null : (old.inv || null);
  if (p.pending === null) out.pending = null;
  else if (p.pending) {                          // partial update keeps the fields not sent
    const op = old.pending || {};
    out.pending = { ref: str(p.pending.ref, op.ref || '—'), eta: p.pending.eta !== undefined || p.pending.etaAt ? etaMinutes(p.pending) : (op.eta !== undefined ? op.eta : 30), qty: num(p.pending.qty, op.qty || 0) };
  }
  return out;
}

function fleetStats(F) {
  const n = F.amrs.length, busy = F.amrs.filter((a) => a.s === 'busy').length, ch = F.amrs.filter((a) => a.s === 'charging').length;
  return { busy, util: busy / Math.max(1, n - ch) };
}
function normUnit(u, F) {
  asObj(u, 'unit');
  if (u.id === undefined) throw new IngestError('unit.id is required');
  const ri = F.routes.findIndex((r) => r.name === u.route);
  return {
    id: String(u.id), b: clamp(num(u.battery, 50), 0, 100),
    s: ['idle', 'busy', 'charging'].includes(u.state) ? u.state : 'idle', t: num(u.taskMin, 0), r: ri >= 0 ? ri : 0
  };
}

const nn = (v, n) => { const x = need(v, n); if (x < 0) throw new IngestError(n + ' must be 0 or more'); return x; };
const pc = (v, n) => { const x = need(v, n); if (x < 0 || x > 100) throw new IngestError(n + ' must be between 0 and 100'); return x; };
function eachDept(src, dst, dom, fn) {
  asObj(src, dom + '.depts');
  for (const k of Object.keys(src)) { if (!dst[k]) throw new IngestError('unknown department "' + k + '". Valid: ' + Object.keys(dst).join(', ')); asObj(src[k], dom + '.depts.' + k); fn(src[k], dst[k], k); }
}
/** { "name": number, ... } -> [[name, number]], sorted by the number, largest first */
function keyed(o, name, max) {
  asObj(o, name);
  const ks = Object.keys(o);
  if (ks.length > max || ks.some((k) => !k.trim() || k.length > 40)) throw new IngestError(name + ': up to ' + max + ' entries, names of 1 to 40 characters');
  return ks.map((k) => [k.trim(), o[k]]).sort((a, b) => Number(b[1]) - Number(a[1]));
}
const BAY_STATES = ['available', 'occupied', 'blocked', 'outOfService'];
const APPLY = {
  build(S, p) {
    asObj(p, 'build');
    if (p.plan !== undefined) S.build.plan = need(p.plan, 'plan');
    if (p.actual !== undefined) S.build.actual = need(p.actual, 'actual');
    if (p.rate !== undefined) S.build.rate = need(p.rate, 'rate');
    // per assembly line: { lineA: {plan, actual}, lineB: {plan, actual} } (each line is controlled on its own; the total is only a fallback)
    for (const L of ['A', 'B']) {
      const k = 'line' + L, o = p[k];
      if (o === undefined) continue;
      asObj(o, 'build.' + k);
      const cur = Object.assign({}, S.build[k] || { plan: Math.ceil(S.build.plan / 2), actual: Math.floor(S.build.actual / 2) });
      if (o.plan !== undefined) cur.plan = need(o.plan, k + '.plan');
      if (o.actual !== undefined) cur.actual = need(o.actual, k + '.actual');
      if (cur.plan < 1 || cur.actual < 0) throw new IngestError(k + ': plan must be at least 1 and actual at least 0');
      S.build[k] = cur;
    }
    if (p.plan === undefined && p.actual === undefined && S.build.lineA && S.build.lineB) { S.build.plan = S.build.lineA.plan + S.build.lineB.plan; S.build.actual = S.build.lineA.actual + S.build.lineB.actual; }
  },
  line(S, p) {
    asObj(p, 'line');
    if (p.stopped !== undefined) S.line.stopped = !!p.stopped;
    S.line.reason = S.line.stopped ? str(p.reason, S.line.reason || 'Line stopped') : null;
    if (p.stops !== undefined) S.line.stops = need(p.stops, 'stops');
    if (p.stoppedMin !== undefined) S.line.stoppedMin = need(p.stoppedMin, 'stoppedMin');
    if (p.runWithoutMin !== undefined) S.line.runWithoutMin = need(p.runWithoutMin, 'runWithoutMin');
    if (p.missing !== undefined) S.line.missing = need(p.missing, 'missing');
  },
  shops(S, p) {
    asObj(p, 'shops');
    p = Object.assign({}, p);
    for (const a of Object.keys(BUFFER_ALIAS)) if (p[a] !== undefined) for (const t of BUFFER_ALIAS[a]) if (p[t] === undefined) p[t] = p[a];
    for (const k of BUFFER_KEYS) {
      if (p[k] === undefined) continue;
      const o = p[k] !== null && typeof p[k] === 'object' ? p[k] : { buf: p[k] };
      S.shops[k].buf = clamp(need(o.buf, k + '.buf'), 0, 100);
      if (o.running !== undefined) S.shops[k].running = o.running === true || o.running === 1 || o.running === '1' || o.running === 'true';
      for (const f of ['units', 'hours', 'cap']) { if (o[f] !== undefined) S.shops[k][f] = need(o[f], k + '.' + f); else if (f !== 'cap') delete S.shops[k][f]; }
    }
  },
  parts(S, p) {
    const old = new Map(S.parts.map((x) => [x.id, x]));
    S.parts = asArray(p, 'parts').map((x) => normPart(x, old.get(String(x && x.id))));
  },
  'parts.item'(S, p) {
    for (const x of Array.isArray(p) ? p : [p]) {
      const i = S.parts.findIndex((q) => q.id === String(x && x.id)), n = normPart(x, S.parts[i]);
      if (i >= 0) S.parts[i] = n; else S.parts.push(n);
    }
  },
  yard(S, p) {
    asObj(p, 'yard');
    for (const k of ['expected', 'arrived', 'docked', 'received', 'occupied', 'docks', 'g2d', 'turn', 'unloadLimitMin', 'turnTarget']) if (p[k] !== undefined) S.yard[k] = need(p[k], k);
    if (p.unloadLimitMin !== undefined && !(S.yard.unloadLimitMin > 0)) throw new IngestError('yard.unloadLimitMin must be greater than 0');
    if (p.explain !== undefined) {     // where every waiting trip and every occupied bay is: { trips: {parking, toBay, ...}, bays: {unloading, unloaded, notOnPlan, unidentified} }
      asObj(p.explain, 'yard.explain');
      const ex = {};
      for (const [g, keys] of [['trips', Sim.EXPLAIN_TRIPS], ['bays', Sim.EXPLAIN_BAYS]]) {
        if (p.explain[g] === undefined) continue;
        asObj(p.explain[g], 'yard.explain.' + g); ex[g] = {};
        for (const k of Object.keys(p.explain[g])) {
          if (!keys.some((d) => d[0] === k)) throw new IngestError('yard.explain.' + g + '.' + k + ' is not known. Valid: ' + keys.map((d) => d[0]).join(', '));
          ex[g][k] = nn(p.explain[g][k], 'explain.' + g + '.' + k);
        }
      }
      S.yard.explain = ex;
    }
    if (p.bayStatus !== undefined) {   // { "AB-14": "blocked", ... }: only the bays you send change; send "available" to clear one
      asObj(p.bayStatus, 'yard.bayStatus');
      const next = Object.assign({}, S.yard.bayStatus || {});
      for (const id of Object.keys(p.bayStatus)) {
        const v = String(p.bayStatus[id]).trim();
        if (!BAY_STATES.includes(v)) throw new IngestError('yard.bayStatus.' + id + ' must be one of: ' + BAY_STATES.join(', '));
        if (!id || id.length > 24) throw new IngestError('yard.bayStatus: bay ids are 1 to 24 characters');
        if (v === 'available') delete next[id]; else next[id] = v;
      }
      S.yard.bayStatus = next;
    }
    if (p.bays !== undefined) {   // the bays' own ids, in display order: the grid then shows these instead of 1..docks
      const ids = asArray(p.bays, 'yard.bays').map((b) => String(b).trim());
      if (ids.length > 2000 || ids.some((b) => !b || b.length > 24)) throw new IngestError('yard.bays: up to 2000 ids, each 1 to 24 characters');
      if (new Set(ids).size !== ids.length) throw new IngestError('yard.bays: ids must be unique');
      S.yard.bays = ids;
      if (p.docks === undefined) S.yard.docks = ids.length;
    }
  },
  trucks(S, p) { S.trucks = asArray(p, 'trucks').map((t) => normTruck(t)); },
  'trucks.item'(S, p) {
    for (const x of Array.isArray(p) ? p : [p]) {
      const t = normTruck(x), i = S.trucks.findIndex((q) => q.id === t.id);
      if (i >= 0) {                                // partial update keeps the fields not sent
        const sent = (...ks) => ks.some((k) => x[k] !== undefined);
        const o = S.trucks[i];
        if (!sent('supplier', 'sup')) t.sup = o.sup; if (!sent('material', 'mat')) t.mat = o.mat; if (!sent('status')) t.status = o.status;
        if (!sent('assignedBay')) t.assignedBay = o.assignedBay; if (!sent('planned')) t.planned = o.planned !== false; if (!sent('place')) t.place = o.place === undefined ? null : o.place;
        if (!sent('dock')) t.dock = o.dock; if (!sent('schedAt', 'sched')) t.sched = o.sched; if (!sent('arrivedAt')) t.arrivedAt = o.arrivedAt;
        if (!sent('dockedAt')) t.dockedAt = o.dockedAt; if (!sent('doneAt')) t.doneAt = o.doneAt;
        S.trucks[i] = t;
      } else S.trucks.push(t);
    }
    if (S.trucks.length > 200) S.trucks.splice(0, S.trucks.length - 200);
  },
  transfers(S, p) {
    for (const x of asArray(p, 'transfers')) {
      asObj(x, 'transfer');
      const t = S.transfers.find((q) => q.id === x.id);
      if (!t) throw new IngestError('unknown transfer id ' + x.id + ' (expected one of ' + S.transfers.map((q) => q.id).join(', ') + ')');
      if (Array.isArray(x.q)) t.q = x.q.map((v) => (v ? 1 : 0));
      else if (x.total !== undefined) {
        const total = Math.max(1, need(x.total, 'total')), ok = clamp(need(x.onTime, 'onTime'), 0, total);
        t.q = Array.from({ length: Math.round(total) }, (_, i) => (i < ok ? 1 : 0));
      }
    }
  },
  lineside(S, p) {
    const old = new Map(S.lineside.map((l) => [l.name, l]));
    S.lineside = asArray(p, 'lineside').map((x) => normLine(x, old.get(String(x && x.name))));
  },
  'lineside.item'(S, p) {
    for (const x of Array.isArray(p) ? p : [p]) {
      const i = S.lineside.findIndex((l) => l.name === String(x && x.name)), n = normLine(x, S.lineside[i]);
      if (i >= 0) S.lineside[i] = n; else S.lineside.push(n);
    }
  },
  amr(S, p) { fleet(S.amr, p); },
  jv(S, p) { fleet(S.jv, p); },
  'amr.unit'(S, p) { unit(S.amr, p); },
  'jv.unit'(S, p) { unit(S.jv, p); },
  jvstock(S, p) {
    asObj(p, 'jvstock');
    const names = S.jvSites.map((j) => j.name);
    for (const k of Object.keys(p)) {
      const site = S.jvSites.find((j) => j.name.toLowerCase() === k.toLowerCase());
      if (!site) throw new IngestError('unknown JV "' + k + '" (configured JVs: ' + names.join(', ') + ')');
      const o = p[k] !== null && typeof p[k] === 'object' ? p[k] : { buf: p[k] };
      site.buf = clamp(need(o.buf, k + '.buf'), 0, 100);
      for (const f of ['units', 'hours', 'cap']) { if (o[f] !== undefined) site[f] = need(o[f], k + '.' + f); else if (f !== 'cap') delete site[f]; }
    }
  },
  quality(S, p) {
    asObj(p, 'quality');
    const M = JSON.parse(JSON.stringify(S.quality));
    for (const k of ['rejected', 'quarantined', 'spf']) if (p[k] !== undefined) M[k] = need(p[k], k);
    if (p.fourM !== undefined) { asObj(p.fourM, 'quality.fourM'); for (const f of ['man', 'machine', 'material', 'method', 'target']) if (p.fourM[f] !== undefined) M.fourM[f] = pc(p.fourM[f], 'fourM.' + f); }
    if (p.targets !== undefined) { asObj(p.targets, 'quality.targets'); for (const f of ['rejection', 'invAcc', 'fpy']) if (p.targets[f] !== undefined) M.targets[f] = pc(p.targets[f], 'targets.' + f); }
    if (p.depts !== undefined) eachDept(p.depts, M.depts, 'quality', (o, d, k) => { for (const f of ['inspected', 'defects']) if (o[f] !== undefined) d[f] = nn(o[f], k + '.' + f); if (d.defects > d.inspected) throw new IngestError(k + ': defects cannot exceed inspected'); });
    if (p.defects !== undefined) M.defects = keyed(p.defects, 'quality.defects', 12).map((x) => ({ type: x[0], count: nn(x[1], 'defects.' + x[0]) }));
    S.quality = M;
  },
  kpi(S, p) {
    asObj(p, 'kpi');
    if (p.jis !== undefined && p.jit === undefined) p = Object.assign({}, p, { jit: p.jis });        // older feeds call it jis
    for (const k of ['jit', 'stockAcc']) if (p[k] !== undefined) S.kpi[k] = need(p[k], k);
  },
  finished(S, p) { asObj(p, 'finished'); for (const k of ['onTime', 'shipOnTime', 'units', 'shipRate']) if (p[k] !== undefined) S.finished[k] = need(p[k], k); },
  deliveries(S, p) { asObj(p, 'deliveries'); for (const k of ['total', 'onTime']) if (p[k] !== undefined) S.deliveries[k] = need(p[k], k); },
  /* topic towers. Partial posts change only what they carry; everything is validated on a copy before anything is applied */
  production(S, p) {
    asObj(p, 'production');
    const M = JSON.parse(JSON.stringify(S.production));
    if (p.depts !== undefined) eachDept(p.depts, M.depts, 'production', (o, d, k) => {
      for (const f of ['plan', 'actual', 'downMin']) if (o[f] !== undefined) d[f] = nn(o[f], k + '.' + f);
      for (const f of ['oee', 'avail', 'perf', 'qual']) if (o[f] !== undefined) d[f] = pc(o[f], k + '.' + f);
      if (o.oee === undefined && (o.avail !== undefined || o.perf !== undefined || o.qual !== undefined)) d.oee = (d.avail * d.perf * d.qual) / 10000;
      if (o.name !== undefined) { const nm = String(o.name).trim(); if (!nm || nm.length > 24) throw new IngestError(k + '.name: 1 to 24 characters'); d.name = nm; }
    });
    if (p.losses !== undefined) M.losses = keyed(p.losses, 'production.losses', 12).map((x) => ({ reason: x[0], min: nn(x[1], 'losses.' + x[0]) }));
    if (p.shift !== undefined) {
      asObj(p.shift, 'production.shift');
      const hm = (v, n) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim()); if (!m || +m[1] > 23 || +m[2] > 59) throw new IngestError(n + ' must be HH:MM'); return +m[1] * 60 + +m[2]; };
      if (p.shift.start !== undefined) M.shift.start = hm(p.shift.start, 'shift.start');
      if (p.shift.end !== undefined) M.shift.end = hm(p.shift.end, 'shift.end');
      if (!(M.shift.end > M.shift.start)) throw new IngestError('shift.end must be after shift.start');
    }
    S.production = M;
  },
  utility(S, p) {
    asObj(p, 'utility');
    const M = JSON.parse(JSON.stringify(S.utility));
    if (p.depts !== undefined) eachDept(p.depts, M.depts, 'utility', (o, d, k) => { for (const f of ['energy', 'energyTarget']) if (o[f] !== undefined) d[f] = nn(o[f], k + '.' + f); });
    for (const [g, fs] of [['power', ['kw', 'peakKw', 'contractKw']], ['water', ['m3', 'target']], ['air', ['bar', 'minBar']]]) if (p[g] !== undefined) { asObj(p[g], 'utility.' + g); for (const f of fs) if (p[g][f] !== undefined) M[g][f] = nn(p[g][f], g + '.' + f); }
    if (p.power && p.power.kw !== undefined && p.power.peakKw === undefined) M.power.peakKw = Math.max(M.power.peakKw, M.power.kw);
    S.utility = M;
  },
  safety(S, p) {
    asObj(p, 'safety');
    const M = JSON.parse(JSON.stringify(S.safety));
    for (const f of ['lti', 'trir', 'trirTarget', 'daysSinceLti', 'nearMiss']) if (p[f] !== undefined) M[f] = nn(p[f], f);
    for (const f of ['compliance', 'complianceTarget']) if (p[f] !== undefined) M[f] = pc(p[f], f);
    for (const g of ['observations', 'permits']) if (p[g] !== undefined) { asObj(p[g], 'safety.' + g); for (const f of ['open', 'overdue']) if (p[g][f] !== undefined) M[g][f] = nn(p[g][f], g + '.' + f); }
    if (p.depts !== undefined) { asObj(p.depts, 'safety.depts'); for (const k of Object.keys(p.depts)) { if (M.depts[k] === undefined) throw new IngestError('unknown department "' + k + '". Valid: ' + Object.keys(M.depts).join(', ')); M.depts[k] = pc(p.depts[k], 'depts.' + k); } }
    if (p.incidents !== undefined) {                      // keyed by incident id; send status "closed" to close one, null to remove it
      asObj(p.incidents, 'safety.incidents');
      for (const id of Object.keys(p.incidents)) {
        const x = p.incidents[id], i = M.incidents.findIndex((q) => q.id === id);
        if (x === null) { if (i >= 0) M.incidents.splice(i, 1); continue; }
        asObj(x, 'incident ' + id);
        const cur = i >= 0 ? M.incidents[i] : { id, at: S.clock % 1440, dept: '', type: 'Incident', sev: 'low', status: 'open' };
        if (x.dept !== undefined) cur.dept = String(x.dept).trim().slice(0, 24);
        if (x.type !== undefined) cur.type = String(x.type).trim().slice(0, 80);
        if (x.sev !== undefined) { if (!['low', 'med', 'high'].includes(x.sev)) throw new IngestError('incident ' + id + ': sev must be low, med or high'); cur.sev = x.sev; }
        if (x.status !== undefined) { if (!['open', 'closed'].includes(x.status)) throw new IngestError('incident ' + id + ': status must be open or closed'); cur.status = x.status; }
        if (x.at !== undefined) { const c = clockOf(x.at); if (c !== null) cur.at = c; }
        if (i < 0) M.incidents.unshift(cur);
      }
      if (M.incidents.length > 50) M.incidents.length = 50;
    }
    S.safety = M;
  },
  kanban(S, p) {
    asObj(p, 'kanban');
    const v = {};
    for (const k of ['cards', 'open', 'overdue', 'avgWaitMin', 'onTimePct']) if (p[k] !== undefined) v[k] = need(p[k], k);    // validate everything before changing anything
    if (v.onTimePct !== undefined && (v.onTimePct < 0 || v.onTimePct > 100)) throw new IngestError('onTimePct must be between 0 and 100');
    Object.assign(S.kanban, v);
  },
  seqflows(S, p) {
    asObj(p, 'seqflows');
    const ids = Object.keys(S.seqflows), upd = {};
    for (const id of Object.keys(p)) {                 // validate everything first
      if (!S.seqflows[id]) throw new IngestError('unknown flow "' + id + '" (valid: ' + ids.join(', ') + ')');
      const o = asObj(p[id], id), v = {};
      if (o.active !== undefined) { v.active = need(o.active, id + '.active'); if (v.active < 0 || v.active > 20 || !Number.isInteger(v.active)) throw new IngestError(id + '.active must be a whole number 0-20'); }
      if (o.missions !== undefined) { v.missions = need(o.missions, id + '.missions'); if (v.missions < 0) throw new IngestError(id + '.missions must be 0 or more'); }
      if (o.onTimePct !== undefined) { v.onTimePct = need(o.onTimePct, id + '.onTimePct'); if (v.onTimePct < 0 || v.onTimePct > 100) throw new IngestError(id + '.onTimePct must be between 0 and 100'); }
      upd[id] = v;
    }
    for (const id of Object.keys(upd)) Object.assign(S.seqflows[id], upd[id], { _a: undefined });
  },
  event(S, p) {
    asObj(p, 'event');
    S.events.unshift({ t: S.clock, msg: str(p.msg, '(no message)'), lvl: ['info', 'ok', 'watch', 'low'].includes(p.lvl) ? p.lvl : 'info' });
    if (S.events.length > 40) S.events.pop();
  }
};

function normTruck(t) {
  asObj(t, 'truck');
  if (t.id === undefined) throw new IngestError('truck.id is required');
  const status = ['scheduled', 'arrived', 'docked', 'received'].includes(t.status) ? t.status : 'scheduled';
  return {
    id: String(t.id), sup: str(t.supplier !== undefined ? t.supplier : t.sup, '—'), mat: str(t.material !== undefined ? t.material : t.mat, '—'),
    status, dock: normDock(t.dock), assignedBay: normDock(t.assignedBay), planned: !(t.planned === false || t.planned === 'false' || t.planned === 0), place: t.place === undefined || t.place === null ? null : String(t.place).trim().slice(0, 24),
    sched: clockOf(t.schedAt !== undefined ? t.schedAt : t.sched), arrivedAt: clockOf(t.arrivedAt), dockedAt: clockOf(t.dockedAt), doneAt: clockOf(t.doneAt)
  };
}
/** a bay: its number, or its own id such as "AA-12" (matched against yard.bays) */
function normDock(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return num(v, null);
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > 24) throw new IngestError('truck.dock: at most 24 characters');
  return /^\d+$/.test(s) ? Number(s) : s;
}
function normLine(x, old) {
  asObj(x, 'lineside item');
  if (!x.name) throw new IngestError('lineside item needs a name');
  old = old || {};
  const safety = Math.max(1, num(x.safety, old.safety || 100));
  const o = {
    name: String(x.name), icon: str(x.icon, old.icon || 'box'), usable: Math.max(0, num(x.usable, old.usable || 0)),
    safety, max: Math.max(safety, num(x.max, old.max || Math.round(safety * 1.3))), pend: old.pend || null
  };
  if (x.pending === null) o.pend = null;
  else if (x.pending) o.pend = { eta: etaMinutes(x.pending), qty: num(x.pending.qty, 0) };
  return o;
}
function fleet(F, p) {
  asObj(p, 'fleet');
  if (Array.isArray(p.routes)) {
    F.routes = p.routes.map((r) => ({ name: str(r.name, '?'), n: num(r.missions !== undefined ? r.missions : r.n, 0), ema: clamp(num(r.onTimePct, 90), 0, 100) / 100, p: 0.9, w: 1, key: r.key }));
  }
  if (Array.isArray(p.units)) F.amrs = p.units.map((u) => normUnit(u, F));
  if (p.planned !== undefined) F.planned = need(p.planned, 'planned');
  if (p.misc !== undefined) F.misc = need(p.misc, 'misc');
  if (p.chargers !== undefined) F.chargers = need(p.chargers, 'chargers');
  if (p.utilizationPct !== undefined) F.util = clamp(need(p.utilizationPct, 'utilizationPct'), 0, 100) / 100;
  else if (Array.isArray(p.units)) F.util = fleetStats(F).util;
}
function unit(F, p) {
  for (const u of Array.isArray(p) ? p : [p]) {
    asObj(u, 'unit');
    const i = F.amrs.findIndex((a) => a.id === String(u.id)), o = i >= 0 ? F.amrs[i] : null;
    const merged = o ? Object.assign({ battery: o.b, state: o.s, taskMin: o.t, route: F.routes[o.r] && F.routes[o.r].name }, u) : u;   // partial update keeps unsent fields
    const n = normUnit(merged, F);
    if (i >= 0) F.amrs[i] = n; else F.amrs.push(n);
  }
  F.util = fleetStats(F).util;
}

/** Apply `payload` for `domain` onto state S. Throws IngestError on bad input. */
function ingest(S, domain, payload) {
  const fn = APPLY[domain];
  if (!fn) throw new IngestError('unknown domain "' + domain + '". Valid: ' + Object.keys(APPLY).join(', '));
  const base = domain.split('.')[0];
  if (domain !== base && !S.live[base]) {      // first per-item message: drop simulated items so real and fake never mix
    if (base === 'parts') S.parts = []; else if (base === 'trucks') S.trucks = []; else if (base === 'lineside') S.lineside = [];
    else if (base === 'amr') S.amr.amrs = []; else if (base === 'jv') S.jv.amrs = [];
  }
  fn(S, payload);
  if (domain === 'event') return;
  touch(S, base);
}
/** Mark a domain as live (fed by a real source) and record the update time. */
function touch(S, base) {
  if (S._batch) { S._batch.add(base); return; }       // inside an atomic post: counted once per domain when the post completes
  S.live[base] = true;
  const rec = S.src[base] || (S.src[base] = { count: 0 });
  rec.last = Date.now(); rec.count++; rec.error = null; rec.status = 'fresh'; rec.via = rec.via || 'push';
}
function markError(S, domain, msg) {
  const base = domain.split('.')[0];
  const rec = S.src[base] || (S.src[base] = { count: 0, last: 0 });
  rec.error = msg;
}
/** Recompute freshness + demo/mixed flags. Stale domains keep their last value but are flagged. */
function health(S, staleSec) {
  const now = Date.now(), stale = [];
  for (const d in S.src) {
    const r = S.src[d];
    r.age = r.last ? Math.round((now - r.last) / 1000) : null;
    r.status = !r.last || r.age > staleSec ? 'stale' : 'fresh';
    if (r.status === 'stale') stale.push(d);
  }
  for (const n in (S.sources || {})) { const r = S.sources[n]; r.age = r.last ? Math.round((now - r.last) / 1000) : null; r.stale = !r.last || r.age > (r.staleSec || staleSec); }
  const live = Object.keys(S.live).filter((d) => S.live[d] && d !== 'weather');
  S.demo = live.length === 0;
  S.mixed = live.length > 0 && live.length < DOMAINS.length;
  S.stale = stale;
  return S;
}

module.exports = { ingest, touch, health, markError, IngestError, DOMAINS, APPLY };
