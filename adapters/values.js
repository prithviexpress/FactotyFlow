'use strict';
/*
 * Per-value endpoints. Every number (or flag / label) you can push to the dashboard has its own path:
 *     POST /api/value/<path>      body:  766   |   {"value":766}   |   plain text
 *     GET  /api/value/<path>      current value
 *     POST /api/values            body:  { "build/actual": 766, "shops/press/buf": 82 }    (many at once)
 *     GET  /api/values            catalogue: path, unit, range, example, current value, source freshness
 * Paths with {x} take an entity id (a shop, a JV name, a part id, ...). Values are validated against unit and range.
 * Anything not listed here is DERIVED from these inputs (see DERIVED) and cannot be pushed.
 */
const Ing = require('./ingest');
const Sim = require('../public/sim.js');

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
class ValueError extends Ing.IngestError { constructor(m, status) { super(m); this.status = status || 400; } }

/* ---------- entity kinds ---------- */
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase() || slug(a) === slug(b);
const ENT = {
  shop: { list: (S) => Object.keys(S.shops).filter((k) => S.shops[k].cap), find: (S, id) => (S.shops[id] && S.shops[id].cap ? { id, o: S.shops[id] } : null) },
  jv: { list: (S) => S.setup.jvs.slice(), find: (S, id) => { const i = S.jvSites.findIndex((j) => same(j.name, id)); return i >= 0 ? { id: S.jvSites[i].name, o: S.jvSites[i] } : null; } },
  transfer: { list: (S) => S.transfers.map((t) => t.id), find: (S, id) => { const t = S.transfers.find((x) => x.id === id); return t ? { id, o: t } : null; } },
  lineside: { list: (S) => S.lineside.map((l) => slug(l.name)), find: (S, id) => { const l = S.lineside.find((x) => same(x.name, id)); return l ? { id: slug(l.name), o: l } : null; }, create: true },
  part: { list: (S) => S.parts.map((p) => p.id), find: (S, id) => { const p = S.parts.find((x) => x.id === id); return p ? { id, o: p } : null; }, create: true },
  truck: { list: (S) => S.trucks.map((t) => t.id), find: (S, id) => { const t = S.trucks.find((x) => x.id === id); return t ? { id, o: t } : null; }, create: true },
  amrUnit: { list: (S) => S.amr.amrs.map((a) => a.id), find: (S, id) => { const a = S.amr.amrs.find((x) => x.id === id); return a ? { id, o: a } : null; }, create: true },
  jvUnit: { list: (S) => S.jv.amrs.map((a) => a.id), find: (S, id) => { const a = S.jv.amrs.find((x) => x.id === id); return a ? { id, o: a } : null; }, create: true },
  flow: { list: (S) => Object.keys(S.seqflows), find: (S, id) => (S.seqflows[id] ? { id, o: S.seqflows[id] } : null) },
  amrRoute: { list: (S) => S.amr.routes.map((r) => slug(r.name)), find: (S, id) => { const r = S.amr.routes.find((x) => same(x.name, id)); return r ? { id: slug(r.name), o: r } : null; } },
  jvRoute: { list: (S) => S.jv.routes.map((r) => slug(r.key || r.name)), find: (S, id) => { const r = S.jv.routes.find((x) => same(x.key || x.name, id) || same(x.name, id)); return r ? { id: slug(r.key || r.name), o: r } : null; } }
};

/* ---------- registry ---------- */
const R = [];
function def(group, domain, path, label, unit, type, example, o) { R.push(Object.assign({ group, domain, path, label, unit, type, example }, o)); }
const NUM = 'number';
// simple numeric field of an object living at S[...]
const field = (get, key, o) => Object.assign({ get: (S, e) => get(S, e)[key], set: (S, v, e) => { get(S, e)[key] = v; } }, o);
const pct = { min: 0, max: 100 }, cnt = { min: 0, int: true }, pos = { min: 0 };

// -- build & line
def('Build & line', 'build', 'build/plan', 'Shift plan', 'vehicles', NUM, 920, field((S) => S.build, 'plan', { min: 1, int: true }));
def('Build & line', 'build', 'build/actual', 'Vehicles built so far', 'vehicles', NUM, 766, field((S) => S.build, 'actual', cnt));
def('Build & line', 'build', 'build/rate', 'Line rate', 'vehicles/min', NUM, 1.9, field((S) => S.build, 'rate', { min: 0, max: 20 }));
def('Build & line', 'line', 'line/stopped', 'Line stopped (1 = stopped, 0 = running)', 'flag 0/1', 'boolean', 0, {
  get: (S) => (S.line.stopped ? 1 : 0), set: (S, v) => { S.line.stopped = v; if (!v) S.line.reason = null; else if (!S.line.reason) S.line.reason = 'Line stopped'; } });
def('Build & line', 'line', 'line/reason', 'Reason shown while stopped', 'text', 'text', 'Andon: station ASY-08', { get: (S) => S.line.reason, set: (S, v) => { S.line.reason = v; } });
def('Build & line', 'line', 'line/stops', 'Logistics line stops today', 'count', NUM, 2, field((S) => S.line, 'stops', cnt));
def('Build & line', 'line', 'line/stoppedMin', 'Minutes lost to line stops today', 'min', NUM, 9, field((S) => S.line, 'stoppedMin', pos));

const LN = (L, k, label, ex) => def('Build & line', 'build', 'build/line' + L + '/' + k, label + ' — assembly line ' + L + ' (optional; else half of the total)', 'vehicles', NUM, ex, {
  min: k === 'plan' ? 1 : 0, int: true,
  get: (S) => { const l = S.build['line' + L]; return l ? l[k] : null; },
  set: (S, v) => { const key = 'line' + L, l = S.build[key] || (S.build[key] = { plan: Math.ceil(S.build.plan / 2), actual: Math.floor(S.build.actual / 2) }); l[k] = v; } });
LN('A', 'plan', 'Shift plan', 460); LN('A', 'actual', 'Vehicles built', 383); LN('B', 'plan', 'Shift plan', 460); LN('B', 'actual', 'Vehicles built', 383);

// -- buffers
const SHOPF = (key) => ({ get: (S, e) => e.o[key], set: (S, v, e) => { e.o[key] = v; } });
def('Shop buffers', 'shops', 'shops/{shop}/buf', 'Buffer level (shop = press | weldA | weldB | paintA | paintB | engine | bumper)', '%', NUM, 82, Object.assign(SHOPF('buf'), pct, { ent: 'shop', set: (S, v, e) => { e.o.buf = v; } }));
def('Shop buffers', 'shops', 'shops/{shop}/units', 'Vehicle sets in the buffer (optional, else buffer % × capacity)', 'vehicle sets', NUM, 246, Object.assign({ ent: 'shop', get: (S, e) => (e.o.units !== undefined ? e.o.units : null) , set: (S, v, e) => { e.o.units = v; } }, pos));
def('Shop buffers', 'shops', 'shops/{shop}/hours', 'Hours of inventory in the buffer (optional override)', 'h', NUM, 2.2, Object.assign({ ent: 'shop', get: (S, e) => (e.o.hours !== undefined ? e.o.hours : null), set: (S, v, e) => { e.o.hours = v; } }, pos));
def('JV buffers', 'jvstock', 'jvstock/{jv}/buf', 'JV buffer level (jv = a name from Plant setup, e.g. JV1)', '%', NUM, 72, Object.assign({ ent: 'jv', get: (S, e) => e.o.buf, set: (S, v, e) => { e.o.buf = v; } }, pct));
def('JV buffers', 'jvstock', 'jvstock/{jv}/units', 'Vehicle sets in the JV buffer (optional)', 'vehicle sets', NUM, 86, Object.assign({ ent: 'jv', get: (S, e) => (e.o.units !== undefined ? e.o.units : null), set: (S, v, e) => { e.o.units = v; } }, pos));
def('JV buffers', 'jvstock', 'jvstock/{jv}/hours', 'Hours of inventory in the JV buffer (optional override)', 'h', NUM, 1.4, Object.assign({ ent: 'jv', get: (S, e) => (e.o.hours !== undefined ? e.o.hours : null), set: (S, v, e) => { e.o.hours = v; } }, pos));

// -- truck parking & bays
const Y = (k, label, unit, ex, o) => def('Truck parking & bays', 'yard', 'yard/' + k, label, unit, NUM, ex, field((S) => S.yard, k, o));
Y('expected', 'Trucks expected today', 'trucks', 34, cnt); Y('arrived', 'Trucks arrived at the gate', 'trucks', 26, cnt);
Y('docked', 'Trucks currently or already at a bay', 'trucks', 21, cnt); Y('received', 'Trucks received (unloaded & closed)', 'trucks', 18, cnt);
Y('occupied', 'Bays occupied right now', 'bays', 21, cnt); Y('docks', 'Total bays', 'bays', 28, { min: 1, int: true });
Y('g2d', 'Average gate-to-bay time', 'min', 32, { min: 0, max: 1440 }); Y('turn', 'Average truck turnaround', 'min', 68, { min: 0, max: 2880 });
def('Truck parking & bays', 'trucks', 'trucks/{truck}/status', 'Status of one truck', 'scheduled | arrived | docked | received', 'enum', 'docked', { ent: 'truck', enum: ['scheduled', 'arrived', 'docked', 'received'],
  get: (S, e) => e.o.status, set: (S, v, e) => Ing.ingest(S, 'trucks.item', { id: e.id, status: v }), viaIngest: true });
def('Truck parking & bays', 'trucks', 'trucks/{truck}/dock', 'Bay number a truck is at', 'bay no.', NUM, 4, { ent: 'truck', min: 1, int: true, get: (S, e) => e.o.dock, set: (S, v, e) => Ing.ingest(S, 'trucks.item', { id: e.id, dock: v }), viaIngest: true });
def('Truck parking & bays', 'trucks', 'trucks/{truck}/supplier', 'Supplier of one truck', 'text', 'text', 'Endurance', { ent: 'truck', get: (S, e) => e.o.sup, set: (S, v, e) => Ing.ingest(S, 'trucks.item', { id: e.id, supplier: v }), viaIngest: true });

// -- motorpool, KPIs, deliveries, quality
def('Motorpool & dispatch', 'finished', 'finished/units', 'Vehicles waiting in the motorpool', 'vehicles', NUM, 176, field((S) => S.finished, 'units', cnt));
def('Motorpool & dispatch', 'finished', 'finished/shipRate', 'Dispatch rate from the motorpool', 'vehicles/min', NUM, 1.8, field((S) => S.finished, 'shipRate', { min: 0, max: 20 }));
def('Motorpool & dispatch', 'finished', 'finished/onTime', 'Motorpool on-time', '%', NUM, 92, field((S) => S.finished, 'onTime', pct));
def('Motorpool & dispatch', 'finished', 'finished/shipOnTime', 'Shipment on-time', '%', NUM, 92, field((S) => S.finished, 'shipOnTime', pct));
def('KPIs', 'kpi', 'kpi/jit', 'JIT accuracy, last 2 h (deliveries within their time window; older name: kpi/jis)', '%', NUM, 98.4, field((S) => S.kpi, 'jit', pct));
def('KPIs', 'kpi', 'kpi/stockAcc', 'Stock accuracy (cycle count)', '%', NUM, 97.8, field((S) => S.kpi, 'stockAcc', pct));
def('KPIs', 'deliveries', 'deliveries/total', 'Internal deliveries today (total)', 'jobs', NUM, 375, field((S) => S.deliveries, 'total', cnt));
def('KPIs', 'deliveries', 'deliveries/onTime', 'Internal deliveries today (on time)', 'jobs', NUM, 345, field((S) => S.deliveries, 'onTime', cnt));
def('Quality', 'quality', 'quality/rejected', 'Rejected parts today', 'pcs', NUM, 16, field((S) => S.quality, 'rejected', cnt));
def('Quality', 'quality', 'quality/quarantined', 'Quarantined parts (under investigation)', 'pcs', NUM, 24, field((S) => S.quality, 'quarantined', cnt));
def('Quality', 'quality', 'quality/spf', 'Single-piece flow adherence', '%', NUM, 91, field((S) => S.quality, 'spf', pct));

// -- sequenced material routes (the dotted lines on the plant map)
const FL = (k, label, unit, ex, o) => def('Sequenced flows', 'seqflows', 'seqflows/{flow}/' + k, label + ' (flow = ' + Sim.SEQFLOWS.map((f) => f.id).join(' | ') + ')', unit, NUM, ex, Object.assign({ ent: 'flow', entName: 'flow', get: (S, e) => e.o[k], set: (S, v, e) => { e.o[k] = v; e.o._a = undefined; } }, o));
FL('active', 'Carriers (AMR / tow) in flight on the route', 'carriers', 1, { min: 0, max: 20, int: true });
FL('missions', 'Missions completed today on the route', 'missions', 46, cnt);
FL('onTimePct', 'Missions on time on the route', '%', 96, pct);

// -- kanban pull signals (shown in the movement-health overlay on the plant map)
def('Kanban', 'kanban', 'kanban/cards', 'Kanban cards / bins in the loop', 'cards', NUM, 120, field((S) => S.kanban, 'cards', { min: 1, int: true }));
def('Kanban', 'kanban', 'kanban/open', 'Pull signals open right now', 'signals', NUM, 18, field((S) => S.kanban, 'open', cnt));
def('Kanban', 'kanban', 'kanban/overdue', 'Open signals past their due time', 'signals', NUM, 2, field((S) => S.kanban, 'overdue', cnt));
def('Kanban', 'kanban', 'kanban/avgWaitMin', 'Average wait from signal to delivery', 'min', NUM, 14, field((S) => S.kanban, 'avgWaitMin', { min: 0, max: 1440 }));
def('Kanban', 'kanban', 'kanban/onTimePct', 'Signals delivered on time', '%', NUM, 94, field((S) => S.kanban, 'onTimePct', pct));

// -- in-plant transfers (rolling window of jobs)
const okOf = (t) => t.q.reduce((a, c) => a + c, 0);
const mkQ = (ok, total) => Array.from({ length: total }, (_, i) => (i < ok ? 1 : 0));
def('In-plant transfers', 'transfers', 'transfers/{route}/onTime', 'Jobs on time in the window (route = eng | bmp | milk | amr)', 'jobs', NUM, 7, { ent: 'transfer', entName: 'route', min: 0, int: true,
  get: (S, e) => okOf(e.o), set: (S, v, e) => { const total = e.o.q.length; if (v > total) throw new ValueError('onTime (' + v + ') cannot exceed total (' + total + ') — push transfers/' + e.id + '/total first', 400); e.o.q = mkQ(v, total); } });
def('In-plant transfers', 'transfers', 'transfers/{route}/total', 'Jobs in the window (on time + late)', 'jobs', NUM, 8, { ent: 'transfer', entName: 'route', min: 1, max: 200, int: true,
  get: (S, e) => e.o.q.length, set: (S, v, e) => { e.o.q = mkQ(Math.min(okOf(e.o), v), v); } });

// -- line-side stock (entity = item name slug)
const LS = (k, label, unit, ex, o) => def('Line-side stock', 'lineside', 'lineside/{item}/' + k, label, unit, NUM, ex, Object.assign({ ent: 'lineside', entName: 'item', min: k === 'safety' ? 1 : 0, get: (S, e) => e.o[k], set: (S, v, e) => Ing.ingest(S, 'lineside.item', { name: e.name || e.o.name, [k]: v }), viaIngest: true }, o));
LS('usable', 'Usable pieces at the line', 'pcs', 42); LS('safety', 'Safety stock (minimum)', 'pcs', 100); LS('max', 'Maximum / full level', 'pcs', 130);

// -- parts (entity = part id; created on first push)
const P = (k, label, unit, type, ex, o, payload, getter) => def('Parts', 'parts', 'parts/{part}/' + k, label, unit, type, ex, Object.assign({ ent: 'part', entName: 'part', get: getter, set: (S, v, e) => Ing.ingest(S, 'parts.item', Object.assign({ id: e.id }, payload(v))), viaIngest: true }, o));
P('stock', 'Usable stock (bay + line-side)', 'pcs', NUM, 28, pos, (v) => ({ stock: v }), (S, e) => e.o.stock);
P('rate', 'Consumption rate', 'pcs/min', NUM, 1.27, pos, (v) => ({ rate: v }), (S, e) => e.o.rate);
P('bay', 'Pieces waiting in the receiving bay', 'pcs', NUM, 8, pos, (v) => ({ inv: { bay: v } }), (S, e) => (e.o.inv ? e.o.inv.bay : null));
P('lineside', 'Pieces at line-side', 'pcs', NUM, 20, pos, (v) => ({ inv: { lineside: v } }), (S, e) => (e.o.inv ? e.o.inv.lineside : null));
P('inbound/qty', 'Quantity on the next inbound truck', 'pcs', NUM, 160, pos, (v) => ({ pending: { qty: v } }), (S, e) => (e.o.pending ? e.o.pending.qty : null));
P('inbound/eta', 'Minutes until the next inbound truck arrives', 'min', NUM, 25, { min: -1440, max: 10080 }, (v) => ({ pending: { eta: v } }), (S, e) => (e.o.pending ? e.o.pending.eta : null));
P('inbound/ref', 'Reference of the next inbound truck / ASN', 'text', 'text', 'V-181', {}, (v) => ({ pending: { ref: v } }), (S, e) => (e.o.pending ? e.o.pending.ref : null));
P('name', 'Part description', 'text', 'text', 'Bumper B/H (Front)', {}, (v) => ({ name: v }), (S, e) => e.o.name);
P('loc', 'Line-side location', 'text', 'text', 'ASY-08', {}, (v) => ({ loc: v }), (S, e) => e.o.loc);
P('shop', 'Shop (press | weld | paint | engine | bumper | assembly)', 'enum', 'enum', 'bumper', { enum: ['press', 'weld', 'paint', 'engine', 'bumper', 'assembly'] }, (v) => ({ shop: v }), (S, e) => e.o.shop);

// -- AMR fleets
function fleet(prefix, group, domain, key, unitEnt, routeEnt, routeLabel) {
  const F = (S) => S[key];
  const unit = (k, label, unit_, type, ex, o, payload, getter) => def(group, domain, prefix + '/{unit}/' + k, label, unit_, type, ex, Object.assign({ ent: unitEnt, entName: 'unit', get: getter, set: (S, v, e) => Ing.ingest(S, domain + '.unit', Object.assign({ id: e.id }, payload(v))), viaIngest: true }, o));
  unit('battery', 'Battery charge of one unit', '%', NUM, 77, pct, (v) => ({ battery: v }), (S, e) => e.o.b);
  unit('state', 'State of one unit', 'idle | busy | charging', 'enum', 'busy', { enum: ['idle', 'busy', 'charging'] }, (v) => ({ state: v }), (S, e) => e.o.s);
  def(group, domain, prefix + '/planned', 'Missions planned today', 'missions', NUM, 212, Object.assign({ get: (S) => F(S).planned, set: (S, v) => { F(S).planned = v; } }, cnt));
  def(group, domain, prefix + '/misc', 'Missions not tied to a listed route (repositioning etc.)', 'missions', NUM, 38, Object.assign({ get: (S) => F(S).misc, set: (S, v) => { F(S).misc = v; } }, cnt));
  def(group, domain, prefix + '/chargers', 'Charging stations', 'chargers', NUM, 6, Object.assign({ get: (S) => F(S).chargers, set: (S, v) => { F(S).chargers = v; } }, { min: 0, int: true }));
  def(group, domain, prefix + '/utilizationPct', 'Fleet utilization (optional, else busy ÷ dispatchable)', '%', NUM, 67, Object.assign({ get: (S) => Math.round(F(S).util * 100), set: (S, v) => { F(S).util = v / 100; } }, pct));
  def(group, domain, prefix + '/routes/{route}/missions', routeLabel + ' — missions completed today', 'missions', NUM, 42, Object.assign({ ent: routeEnt, entName: 'route', get: (S, e) => e.o.n, set: (S, v, e) => { e.o.n = v; } }, cnt));
  def(group, domain, prefix + '/routes/{route}/onTimePct', routeLabel + ' — on-time rate', '%', NUM, 98, Object.assign({ ent: routeEnt, entName: 'route', get: (S, e) => Math.round(e.o.ema * 100), set: (S, v, e) => { e.o.ema = v / 100; } }, pct));
}
fleet('amr', 'AMR fleet — indoor', 'amr', 'amr', 'amrUnit', 'amrRoute', 'Route');
fleet('jv', 'AMR fleet — JV', 'jv', 'jv', 'jvUnit', 'jvRoute', 'JV route');

// -- misc
def('Header', 'weather', 'weather/tempC', 'Outside temperature shown in the header', '°C', NUM, 28, { min: -50, max: 70, get: (S) => Math.round(S.weather * 10) / 10, set: (S, v) => { S.weather = v; } });

/* ---------- values shown on the dashboard that you can NOT push (calculated) ---------- */
const DERIVED = [
  ['Today build %', 'build/actual ÷ build/plan'],
  ['Parts at risk (count)', 'parts whose coverage is below 60 min'],
  ['Coverage per part (min)', 'usable stock ÷ consumption rate (parts/{part}/stock ÷ parts/{part}/rate)'],
  ['Earliest shortage (min)', 'smallest coverage across tracked parts'],
  ['Next action / owner per part', 'rule on coverage: <30 expedite, <50 transfer, <65 confirm truck, else monitor'],
  ['On-site trucks', 'yard/arrived − yard/received'],
  ['"(n expected)" under on-site trucks', 'min(4, yard/expected − yard/arrived)'],
  ['Internal deliveries on-time %', 'deliveries/onTime ÷ deliveries/total'],
  ['Bay turnaround KPI', 'yard/g2d'],
  ['Funnel percentages (arrived / at bay / received)', 'each count ÷ yard/expected'],
  ['Transfer route %, ON TIME / DELAYED', 'transfers/{route}/onTime ÷ total; DELAYED below 78%'],
  ['Line-side status LOW / WATCH / OK', 'usable ÷ safety: <50% LOW, <75% WATCH'],
  ['Line-side runway (min)', 'lineside usable ÷ build/rate'],
  ['Buffer status (shops, JVs)', '≥66% normal, ≥50% watch, else low'],
  ['Hours of inventory per position', 'pieces at the position ÷ (parts/{part}/rate × 60); shop & JV buffers: vehicle sets ÷ (build/rate × 60); motorpool: finished/units ÷ (finished/shipRate × 60)'],
  ['AMR available / busy / charging / low-battery counts', 'counted from the units\' state and battery (low = below 25%)'],
  ['AMR average battery', 'mean of units\' battery'],
  ['AMR utilization (if not pushed)', 'busy units ÷ (units − charging units)'],
  ['AMR missions done / planned', 'sum of route missions + misc / planned'],
  ['Rejected % of build', 'quality/rejected ÷ build/actual'],
  ['JV node colour', 'worse of buffer status and route on-time status'],
  ['Kanban / AMR health status on the map', 'kanban: red at 4+ overdue or on-time < 85%, amber at 2+ overdue or < 93%. AMR: red at a late route, 3+ low batteries or < 60% available; amber at a slow route, any low battery or utilisation > 85%'],
  ['Dotted-line activity on the map', 'a route line is lit while seqflows/<flow>/active > 0 on any route that uses it, and dimmed when nothing is in flight; the carrier markers equal active (max 3 drawn); LATE below 78% on time'],
  ['Sparklines / trends', 'sampled every 5 min from the live values above'],
  ['Clock, date, shift (A 06–14, B 14–22, C 22–06)', 'server clock'],
  ['LIVE / MIXED / DEMO and STALE badges', 'which domains received data, and how recently (staleSec on the Interfaces page)']
];

/* ---------- parsing / validation ---------- */
function coerce(def_, raw) {
  let v = raw;
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && 'value' in v) v = v.value;
  if (typeof v === 'string') v = v.trim();
  const range = () => (def_.min !== undefined || def_.max !== undefined ? ' (allowed ' + (def_.min !== undefined ? def_.min : '−∞') + '–' + (def_.max !== undefined ? def_.max : '∞') + ')' : '');
  if (def_.type === 'number') {
    if (v === '' || v === null || typeof v === 'boolean' || typeof v === 'object') throw new ValueError(def_.path + ' expects a number in ' + def_.unit);
    const n = Number(v);
    if (!Number.isFinite(n)) throw new ValueError(def_.path + ' expects a number in ' + def_.unit + ', got "' + v + '"');
    if (def_.int && !Number.isInteger(n)) throw new ValueError(def_.path + ' expects a whole number of ' + def_.unit + ', got ' + n);
    if ((def_.min !== undefined && n < def_.min) || (def_.max !== undefined && n > def_.max)) throw new ValueError(def_.path + ' = ' + n + ' ' + def_.unit + ' is out of range' + range());
    return n;
  }
  if (def_.type === 'boolean') {
    if (v === 1 || v === '1' || v === true || v === 'true') return true;
    if (v === 0 || v === '0' || v === false || v === 'false') return false;
    throw new ValueError(def_.path + ' expects 1 or 0 (true / false)');
  }
  if (def_.type === 'enum') {
    if (!def_.enum.includes(v)) throw new ValueError(def_.path + ' expects one of: ' + def_.enum.join(', '));
    return v;
  }
  if (v === null || typeof v === 'object' || v === undefined) throw new ValueError(def_.path + ' expects text');
  v = String(v);
  if (v.length > 200) throw new ValueError(def_.path + ' text is too long (max 200 characters)');
  return v;
}
/** Accepts a raw request body: 766, "766", {"value":766}, or text */
function parseBody(text) {
  const t = String(text === undefined || text === null ? '' : text).trim();
  if (t === '') throw new ValueError('empty body: send the value, e.g. 766 or {"value":766}');
  try { return JSON.parse(t); } catch (e) { return t; }
}

/* ---------- resolve / apply ---------- */
/** older names that still work: kpi/jis was renamed kpi/jit */
const canonPath = (p) => { const s = String(p).replace(/^\/+|\/+$/g, ''); return /^kpi\/jis$/i.test(s) ? 'kpi/jit' : s; };
function resolve(S, path) {
  const segs = canonPath(path).replace(/^\/+|\/+$/g, '').split('/').map((x) => decodeURIComponent(x));
  for (const d of R) {
    const ps = d.path.split('/');
    if (ps.length !== segs.length) continue;
    let id = null, ok = true;
    for (let i = 0; i < ps.length; i++) {
      if (/^\{.+\}$/.test(ps[i])) id = segs[i]; else if (ps[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { d, id };
  }
  throw new ValueError('unknown value path "' + path + '". GET /api/values lists every endpoint.', 404);
}
function entityFor(S, d, id) {
  if (!d.ent) return undefined;
  const K = ENT[d.ent];
  const e = K.find(S, id);
  if (e) return e;
  if (K.create) return { id, o: {}, name: id, created: true };
  throw new ValueError('unknown ' + (d.entName || d.ent) + ' "' + id + '". Valid: ' + K.list(S).join(', '), 404);
}
function apply(S, path, raw) {
  const { d, id } = resolve(S, path);
  const v = coerce(d, raw);
  const e = entityFor(S, d, id);
  d.set(S, v, e);
  if (!d.viaIngest) Ing.touch(S, d.domain);
  return { path: canonPath(path), value: v, unit: d.unit };
}
function read(S, path) {
  const { d, id } = resolve(S, path);
  const K = d.ent && ENT[d.ent], e = d.ent ? K.find(S, id) : undefined;
  if (d.ent && !e) throw new ValueError('unknown ' + (d.entName || d.ent) + ' "' + id + '". Valid: ' + K.list(S).join(', '), 404);
  return { path: canonPath(path), value: d.get(S, e), unit: d.unit };
}
/** validate a path + value without applying it (used for atomic batches) */
function check(S, path, raw) {
  const { d, id } = resolve(S, path);
  coerce(d, raw);
  entityFor(S, d, id);
  return d.domain;
}
/** domain a path belongs to (for the "domain is set to Simulated" check) */
const domainOf = (S, path) => resolve(S, path).d.domain;

/* ---------- source posts: many values, one call, all-or-nothing ---------- */
/** { build: {actual: 766}, "shops/press/buf": 82, parts: { P1: { stock: 28 } } }  ->  [{path, v}] */
function flatten(obj, prefix, out) {
  out = out || []; prefix = prefix || '';
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new ValueError('a source post must be a JSON object of values (arrays are not supported; use a keyed object, e.g. {"parts": {"P1": {"stock": 28}}})');
  for (const k of Object.keys(obj)) {
    const p = canonPath(prefix ? prefix + '/' + k : k), v = obj[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, out);
    else if (Array.isArray(v)) throw new ValueError(p + ': arrays are not supported in a source post');
    else out.push({ path: p, v });
  }
  return out;
}
/** does a source that owns `prefixes` (e.g. ["build","shops/press","kpi/jis"]) may write `path`? ("*" matches any one segment) */
function owns(prefixes, path) {
  const ps = canonPath(path).split('/');
  return (prefixes || []).some((pre) => { const q = canonPath(pre).replace(/^\/+|\/+$/g, '').split('/'); return q.length <= ps.length && q.every((s, i) => s === '*' || s.toLowerCase() === ps[i].toLowerCase()); });
}
/** a prefix is valid when it is the start of at least one registered path */
function prefixValid(pre) {
  const q = canonPath(pre).split('/');
  return !!q[0] && R.some((d) => { const ps = d.path.split('/'); return q.length <= ps.length && q.every((s, i) => s === '*' || /^\{.+\}$/.test(ps[i]) || s.toLowerCase() === ps[i].toLowerCase()); });
}
const rank = (it) => (/\/(total|plan|docks)$/.test(it.path) ? 0 : 1);     // totals before the values that must not exceed them
/** Apply many values atomically: either all are applied (and each domain is marked live once) or the state is left exactly as it was. */
function applyMany(S, items) {
  const snap = JSON.stringify(S);
  S._batch = new Set();
  try {
    const done = items.slice().sort((a, b) => rank(a) - rank(b)).map((it) => apply(S, it.path, it.v));
    const doms = Array.from(S._batch); delete S._batch;
    doms.forEach((d) => Ing.touch(S, d));
    return done;
  } catch (e) {
    delete S._batch;
    const old = JSON.parse(snap);
    for (const k of Object.keys(S)) delete S[k];
    Object.assign(S, old);
    throw e;
  }
}
/** validate everything first and report ALL problems, not just the first */
function validateMany(S, items, allowed) {
  const errs = [];
  for (const it of items) {
    try {
      const dom = check(S, it.path, it.v);
      if (allowed && !allowed(it.path, dom)) throw new ValueError('this source does not own this value (see its "owns" list on the Interfaces page)', 403);
    } catch (e) { errs.push({ path: it.path, error: e.message, status: e.status || 400 }); }
  }
  return errs;
}

function rangeText(d) {
  if (d.type === 'enum') return d.enum.join(' | ');
  if (d.type === 'boolean') return '0 | 1';
  if (d.type === 'text') return 'text ≤ 200 chars';
  const a = d.min !== undefined ? d.min : '−∞', b = d.max !== undefined ? d.max : '∞';
  return a + ' – ' + b + (d.int ? ', whole numbers' : '');
}
function catalog(S, base) {
  base = base || '';
  const inputs = R.map((d) => {
    const K = d.ent && ENT[d.ent];
    const ids = K ? K.list(S) : null;
    const ents = ids ? ids.slice(0, 60).map((id) => { const e = K.find(S, id); let cur = null; try { cur = d.get(S, e); } catch (x) { /* none */ } return { id, value: cur === undefined ? null : cur, path: d.path.replace(/\{.+?\}/, encodeURIComponent(id)) }; }) : null;
    const rec = (S.src || {})[d.domain] || {};
    const exId = ents && ents.length ? ents[0].id : (d.ent === 'part' ? 'P-BMP-F' : 'id');
    const samplePath = d.path.replace(/\{.+?\}/, encodeURIComponent(exId));
    const body = d.type === 'number' || d.type === 'boolean' ? String(d.example) : JSON.stringify(d.example);
    return {
      path: d.path, group: d.group, domain: d.domain, label: d.label, unit: d.unit, type: d.type, range: rangeText(d), example: d.example,
      entity: d.ent ? (d.entName || d.ent) : null, createsEntity: !!(d.ent && ENT[d.ent].create), entities: ents, entityCount: ids ? ids.length : null,
      current: d.ent ? null : (() => { try { const c = d.get(S); return c === undefined ? null : c; } catch (x) { return null; } })(),
      source: { live: !!(S.live && S.live[d.domain]), age: rec.age === undefined ? null : rec.age, stale: rec.status === 'stale' },
      curl: 'curl -X POST ' + base + '/api/value/' + samplePath + ' -H "Authorization: Bearer $INGEST_TOKEN" -d ' + (d.type === 'number' || d.type === 'boolean' ? body : "'" + body.replace(/^"|"$/g, '') + "'")
    };
  });
  return { base, count: inputs.length, inputs, derived: DERIVED.map((x) => ({ value: x[0], how: x[1] })) };
}

module.exports = { canonPath, catalog, apply, applyMany, validateMany, flatten, owns, prefixValid, read, check, resolve, domainOf, parseBody, coerce, ValueError, REGISTRY: R, DERIVED, slug };
