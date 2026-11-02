'use strict';
/*
 * Ingest layer: turns external data (REST / MQTT / webhook) into the dashboard state.
 * Each *domain* that receives data is flipped to "live"; the simulator stops driving it
 * (see `L = S.live` guards in public/sim.js). Domains with no feed keep simulating (MIXED mode).
 * Payload shapes are documented in docs/DATA-CONTRACT.md.
 */
const DOMAINS = ['build', 'line', 'shops', 'parts', 'yard', 'trucks', 'transfers', 'lineside', 'amr', 'jv', 'jvstock', 'quality', 'kpi', 'finished', 'deliveries', 'kanban', 'seqflows'];
const SHOP_KEYS = ['press', 'weld', 'paint', 'engine', 'bumper', 'assembly'];
const BUFFER_KEYS = ['press', 'weldA', 'weldB', 'paintA', 'paintB', 'engine', 'bumper'];
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
    icon: str(p.icon, old.icon || 'box'), pending: old.pending || null
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

const APPLY = {
  build(S, p) {
    asObj(p, 'build');
    if (p.plan !== undefined) S.build.plan = need(p.plan, 'plan');
    if (p.actual !== undefined) S.build.actual = need(p.actual, 'actual');
    if (p.rate !== undefined) S.build.rate = need(p.rate, 'rate');
  },
  line(S, p) {
    asObj(p, 'line');
    if (p.stopped !== undefined) S.line.stopped = !!p.stopped;
    S.line.reason = S.line.stopped ? str(p.reason, S.line.reason || 'Line stopped') : null;
    if (p.stops !== undefined) S.line.stops = need(p.stops, 'stops');
    if (p.stoppedMin !== undefined) S.line.stoppedMin = need(p.stoppedMin, 'stoppedMin');
  },
  shops(S, p) {
    asObj(p, 'shops');
    p = Object.assign({}, p);
    for (const a of Object.keys(BUFFER_ALIAS)) if (p[a] !== undefined) for (const t of BUFFER_ALIAS[a]) if (p[t] === undefined) p[t] = p[a];
    for (const k of BUFFER_KEYS) {
      if (p[k] === undefined) continue;
      const o = p[k] !== null && typeof p[k] === 'object' ? p[k] : { buf: p[k] };
      S.shops[k].buf = clamp(need(o.buf, k + '.buf'), 0, 100);
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
    for (const k of ['expected', 'arrived', 'docked', 'received', 'occupied', 'docks', 'g2d', 'turn']) if (p[k] !== undefined) S.yard[k] = need(p[k], k);
  },
  trucks(S, p) { S.trucks = asArray(p, 'trucks').map((t) => normTruck(t)); },
  'trucks.item'(S, p) {
    for (const x of Array.isArray(p) ? p : [p]) {
      const t = normTruck(x), i = S.trucks.findIndex((q) => q.id === t.id);
      if (i >= 0) {                                // partial update keeps the fields not sent
        const sent = (...ks) => ks.some((k) => x[k] !== undefined);
        const o = S.trucks[i];
        if (!sent('supplier', 'sup')) t.sup = o.sup; if (!sent('material', 'mat')) t.mat = o.mat; if (!sent('status')) t.status = o.status;
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
    for (const k of ['rejected', 'quarantined', 'spf']) if (p[k] !== undefined) S.quality[k] = need(p[k], k);
  },
  kpi(S, p) { asObj(p, 'kpi'); for (const k of ['jis', 'stockAcc']) if (p[k] !== undefined) S.kpi[k] = need(p[k], k); },
  finished(S, p) { asObj(p, 'finished'); for (const k of ['onTime', 'shipOnTime', 'units', 'shipRate']) if (p[k] !== undefined) S.finished[k] = need(p[k], k); },
  deliveries(S, p) { asObj(p, 'deliveries'); for (const k of ['total', 'onTime']) if (p[k] !== undefined) S.deliveries[k] = need(p[k], k); },
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
    status, dock: t.dock === undefined || t.dock === null ? null : num(t.dock, null),
    sched: clockOf(t.schedAt !== undefined ? t.schedAt : t.sched), arrivedAt: clockOf(t.arrivedAt), dockedAt: clockOf(t.dockedAt), doneAt: clockOf(t.doneAt)
  };
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
