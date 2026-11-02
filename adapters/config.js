'use strict';
/* Interface configuration: one entry per data point (domain). Load / normalise / validate / mask / save. */
const fs = require('fs');
const path = require('path');
const mappers = require('./mappers');
const Sim = require('../public/sim.js');

const MODES = ['auto', 'sim', 'push', 'rest', 'mqtt'];
const MASK = '********';

/** The data points shown on the Interfaces page. `sample` documents the payload the dashboard expects. */
const DOMAIN_INFO = [
  { id: 'build', label: 'Today build (plan vs actual)', source: 'MES', sample: { plan: 920, actual: 766, rate: 1.9 } },
  { id: 'line', label: 'Line status & logistics stops', source: 'MES / Andon', sample: { stopped: false, reason: null, stops: 0, stoppedMin: 0 } },
  { id: 'shops', label: 'Shop buffer levels (%)', source: 'MES / WMS', sample: { press: { buf: 82, units: 246 }, weldA: 79, weldB: 74, paintA: 66, paintB: 62, engine: 68, bumper: { buf: 42, hours: 0.6 } } },
  { id: 'parts', label: 'Parts: stock, consumption rate, next inbound', source: 'WMS / ERP', item: 'parts.item', sample: [{ id: 'P-BMP-F', name: 'Bumper B/H (Front)', loc: 'ASY-08', shop: 'bumper', stock: 28, rate: 1.27, inv: { bay: 8, lineside: 20 }, pending: { ref: 'V-181', etaAt: '2026-10-14T15:05:00+05:30', qty: 160 } }] },
  { id: 'yard', label: 'Truck parking / bay counters', source: 'Gate / truck parking system', sample: { expected: 34, arrived: 26, docked: 21, received: 18, occupied: 21, docks: 28, g2d: 32, turn: 68 } },
  { id: 'trucks', label: 'Inbound truck list', source: 'Gate / truck parking system', item: 'trucks.item', sample: [{ id: 'TRK-1019', supplier: 'Endurance', material: 'Wiring Harness', status: 'docked', dock: 4, schedAt: '2026-10-14T13:34:00+05:30' }] },
  { id: 'transfers', label: 'In-plant transfer jobs (on time / total)', source: 'Intralogistics / TMS', sample: [{ id: 'eng', onTime: 12, total: 12 }, { id: 'bmp', onTime: 6, total: 8 }, { id: 'milk', onTime: 7, total: 8 }, { id: 'amr', onTime: 8, total: 10 }] },
  { id: 'lineside', label: 'Line-side stock (key materials)', source: 'WMS / Kanban', item: 'lineside.item', sample: [{ name: 'Bumper (B/H-LH)', usable: 42, safety: 100 }] },
  { id: 'amr', label: 'Indoor AMR fleet (units, routes)', source: 'Fleet manager', item: 'amr.unit', sample: { units: [{ id: 'AMR-01', state: 'busy', battery: 77, route: 'Milk-run (Line side)' }], routes: [{ name: 'Milk-run (Line side)', missions: 56, onTimePct: 90 }], planned: 212 } },
  { id: 'jv', label: 'JV AMR fleet (routes named after the configured JVs)', source: 'Fleet manager', item: 'jv.unit', sample: { units: [{ id: 'JV-01', state: 'idle', battery: 64 }], routes: [{ name: 'JV1 → Assembly', missions: 32, onTimePct: 97 }], planned: 118 } },
  { id: 'jvstock', label: 'JV buffer stock (one entry per configured JV)', source: 'JV systems', sample: { JV1: { buf: 72, units: 86 }, JV2: 68, JV3: { buf: 55, hours: 0.9 }, JV4: 80 } },
  { id: 'quality', label: 'Rejected / quarantined parts, SPF adherence', source: 'QMS', sample: { rejected: 16, quarantined: 24, spf: 91 } },
  { id: 'kpi', label: 'JIT (just-in-time) accuracy & stock accuracy (%)', source: 'MES / WMS', sample: { jit: 98.4, stockAcc: 97.8 } },
  { id: 'finished', label: 'Motorpool stock & shipment on-time (%)', source: 'Motorpool / dispatch', sample: { onTime: 92, shipOnTime: 92, units: 176, shipRate: 1.8 } },
  { id: 'kanban', label: 'Kanban pull signals (cards, open, overdue, wait, on-time %)', source: 'Kanban / WMS', sample: { cards: 120, open: 18, overdue: 2, avgWaitMin: 14, onTimePct: 94 } },
  { id: 'seqflows', label: 'Sequenced material routes (carriers in flight, missions, on-time %) per route', source: 'Fleet manager / tow control', sample: { jvB: { active: 1, missions: 46, onTimePct: 96 }, jvWB: { active: 1, missions: 31, onTimePct: 97 }, egA: { active: 1, missions: 50, onTimePct: 97 }, prWB: { active: 1, missions: 88, onTimePct: 98 } } },
  { id: 'deliveries', label: 'Internal deliveries (total / on time)', source: 'Intralogistics / TMS', sample: { total: 375, onTime: 345 } }
];
const IDS = DOMAIN_INFO.map((d) => d.id);

function defaults() {
  const domains = {};
  for (const d of IDS) domains[d] = blank();
  return {
    staleSec: 60, sources: {}, mqtt: { url: '', username: '', password: '', qos: 0 },
    plant: { jvs: Sim.DEFAULT_JVS.slice(), terms: Object.assign({}, Sim.DEFAULT_TERMS), slots: JSON.parse(JSON.stringify(Sim.DEFAULT_SLOTS)), layoutVersion: 2, place: '', lat: null, lon: null },
    alerts: {
      weather: { enabled: false, intervalMin: 10, gustKmh: 60, rainMmH: 10, tempHighC: 40, tempLowC: 0, lookaheadH: 3, url: '' },
      traffic: { enabled: false, provider: 'tomtom', key: '', radiusKm: 8, minDelaySec: 300, intervalMin: 5, url: '' },
      feeds: []
    },
    domains
  };
}
function blank() {
  return { mode: 'auto', url: '', method: 'GET', intervalSec: 15, headers: {}, topic: '', idIndex: null, mapper: 'identity', root: '', fields: {}, item: false };
}

/** Accepts the new format, or the legacy {rest:{pollers}, mqtt:{subscriptions}} format. */
function normalize(raw) {
  const cfg = defaults();
  raw = raw || {};
  if (raw.staleSec) cfg.staleSec = Number(raw.staleSec) || 60;
  if (raw.sources && typeof raw.sources === 'object') {
    for (const n of Object.keys(raw.sources)) {
      const s = raw.sources[n] || {};
      cfg.sources[n] = { label: String(s.label || n), token: String(s.token || ''), owns: (Array.isArray(s.owns) ? s.owns : String(s.owns || '').split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean), staleSec: s.staleSec ? Number(s.staleSec) : 0 };
    }
  }
  if (raw.alerts) {
    const a = raw.alerts, num = (v, d) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
    for (const k of ['weather', 'traffic']) {
      const src = a[k] || {}, dst = cfg.alerts[k];
      dst.enabled = !!src.enabled;
      for (const f of Object.keys(dst)) {
        if (f === 'enabled' || src[f] === undefined) continue;
        dst[f] = typeof dst[f] === 'number' ? num(src[f], dst[f]) : String(src[f]).trim();
      }
    }
    if (Array.isArray(a.feeds)) cfg.alerts.feeds = a.feeds.map((f) => ({ name: String(f.name || '').trim(), url: String(f.url || '').trim(), intervalMin: num(f.intervalMin, 10), headers: f.headers && typeof f.headers === 'object' ? f.headers : {}, root: String(f.root || '').trim(), fields: f.fields && typeof f.fields === 'object' ? f.fields : {}, kind: String(f.kind || 'event'), enabled: f.enabled !== false }));
  }
  if (raw.plant) {
    // layout v2 swapped the two overlays (kanban beside JV, AMR top right). A config saved with the old defaults is migrated; any other arrangement is the user's own and is kept.
    if (Number(raw.plant.layoutVersion || 1) < 2 && raw.plant.slots && raw.plant.slots.yard && raw.plant.slots.top2 && raw.plant.slots.yard.bind === 'amr' && raw.plant.slots.top2.bind === 'kanban') {
      raw = Object.assign({}, raw, { plant: Object.assign({}, raw.plant, { slots: Object.assign({}, raw.plant.slots, { yard: Object.assign({}, raw.plant.slots.yard, { bind: 'kanban' }), top2: Object.assign({}, raw.plant.slots.top2, { bind: 'amr' }) }) }) });
    }
    if (raw.plant.terms && raw.plant.terms.jis !== undefined && raw.plant.terms.jit === undefined) {      // the KPI label was called jis before; the old default is dropped, a custom label is kept
      const old = String(raw.plant.terms.jis).trim();
      if (old && old !== 'JIS accuracy') cfg.plant.terms.jit = old;
    }
    if (raw.plant.slots && typeof raw.plant.slots === 'object') {
      for (const k of Object.keys(Sim.DEFAULT_SLOTS)) {
        const s = raw.plant.slots[k]; if (!s || typeof s !== 'object') continue;
        for (const f of ['label', 'bind', 'carrier']) if (s[f] !== undefined) cfg.plant.slots[k][f] = String(s[f]).trim();
        if (s.confirmed !== undefined) cfg.plant.slots[k].confirmed = s.confirmed === true || s.confirmed === 'true';
      }
    }
    if (raw.plant.place !== undefined) cfg.plant.place = String(raw.plant.place).trim();
    for (const k of ['lat', 'lon']) if (raw.plant[k] !== undefined) cfg.plant[k] = raw.plant[k] === '' || raw.plant[k] === null ? null : Number(raw.plant[k]);
    if (Array.isArray(raw.plant.jvs)) cfg.plant.jvs = raw.plant.jvs.map((x) => String(x).trim());
    if (raw.plant.terms && typeof raw.plant.terms === 'object') for (const k of Object.keys(Sim.DEFAULT_TERMS)) if (raw.plant.terms[k] !== undefined) cfg.plant.terms[k] = String(raw.plant.terms[k]).trim();
  }
  if (raw.mqtt) for (const k of ['url', 'username', 'password', 'qos']) if (raw.mqtt[k] !== undefined) cfg.mqtt[k] = raw.mqtt[k];
  for (const id of IDS) if (raw.domains && raw.domains[id]) Object.assign(cfg.domains[id], clean(raw.domains[id]));
  const legacy = (raw.rest && raw.rest.pollers) || [];
  for (const p of legacy) { const [b, item] = splitDomain(p.domain); if (cfg.domains[b]) Object.assign(cfg.domains[b], { mode: 'rest', url: p.url, intervalSec: p.intervalSec || 15, headers: p.headers || {}, mapper: p.mapper || 'identity', item }); }
  for (const s of (raw.mqtt && raw.mqtt.subscriptions) || []) { const [b, item] = splitDomain(s.domain); if (cfg.domains[b]) Object.assign(cfg.domains[b], { mode: 'mqtt', topic: s.topic, mapper: s.mapper || 'identity', idIndex: s.idIndex === undefined ? null : s.idIndex, item }); }
  return cfg;
}
function splitDomain(d) { const [b, rest] = String(d).split('.'); return [b, !!rest]; }
function clean(d) {
  const o = {};
  for (const k of Object.keys(blank())) if (d[k] !== undefined) o[k] = d[k];
  return o;
}

/** Returns a list of human-readable problems ([] = valid). */
function validate(cfg) {
  const errs = [];
  if (!(cfg.staleSec >= 5 && cfg.staleSec <= 86400)) errs.push('staleSec must be between 5 and 86400');
  const jvs = cfg.plant.jvs;
  if (!jvs.length || jvs.length > Sim.MAX_JVS) errs.push('JV names: between 1 and ' + Sim.MAX_JVS + ' names are required');
  if (jvs.some((n) => !n || n.length > 24)) errs.push('JV names must be 1\u201324 characters');
  if (new Set(jvs.map((n) => n.toLowerCase())).size !== jvs.length) errs.push('JV names must be unique');
  for (const k of Object.keys(cfg.plant.terms)) { const max = k === 'title' ? 48 : 32; if (!cfg.plant.terms[k] || cfg.plant.terms[k].length > max) errs.push('terminology "' + k + '" must be 1\u2013' + max + ' characters'); }
  const Vals = require('./values');
  const tokens = [];
  for (const n of Object.keys(cfg.sources)) {
    const s = cfg.sources[n];
    if (!/^[a-z0-9_-]{1,24}$/.test(n)) errs.push('source "' + n + '": name must be 1\u201324 characters of a-z, 0-9, - or _');
    if (!s.owns.length) errs.push('source "' + n + '": list at least one value it owns (e.g. build, kpi/jit)');
    for (const pre of s.owns) if (!Vals.prefixValid(pre)) errs.push('source "' + n + '": "' + pre + '" matches no data point (see the Data points page)');
    if (!/^\$\{\w+\}$/.test(s.token) && s.token.length < 16) errs.push('source "' + n + '": token must be at least 16 characters (or a ${ENV_VAR} reference)');
    if (s.token) tokens.push(s.token);
    if (s.staleSec && !(s.staleSec >= 5)) errs.push('source "' + n + '": stale-after must be at least 5 s');
  }
  if (new Set(tokens).size !== tokens.length) errs.push('two sources share the same token');
  for (const k of Object.keys(cfg.plant.slots)) {
    const s = cfg.plant.slots[k];
    if (s.label && s.label.length > 24) errs.push('layout block "' + k + '": label must be at most 24 characters');
    if (s.bind !== undefined && !Sim.SLOT_BINDS.includes(s.bind)) errs.push('layout block "' + k + '": it can show: ' + Sim.SLOT_BINDS.join(', '));
    if (s.carrier !== undefined && !Sim.CARRIERS.includes(s.carrier)) errs.push('layout block "' + k + '": carrier must be amr or tow');
  }
  const P = cfg.plant, A = cfg.alerts, okLL = P.lat !== null && P.lon !== null && Math.abs(P.lat) <= 90 && Math.abs(P.lon) <= 180;
  if ((P.lat !== null && !(Math.abs(P.lat) <= 90)) || (P.lon !== null && !(Math.abs(P.lon) <= 180))) errs.push('plant location: latitude must be -90..90 and longitude -180..180');
  for (const k of ['weather', 'traffic']) {
    const a = A[k];
    if (!a.enabled) continue;
    if (!a.url && !okLL) errs.push('alerts.' + k + ': set the plant latitude / longitude under Plant setup first');
    if (!(a.intervalMin >= 1 && a.intervalMin <= 1440)) errs.push('alerts.' + k + ': interval must be 1\u20131440 min');
    if (a.url && !/^https?:\/\//i.test(a.url)) errs.push('alerts.' + k + ': URL override must start with http:// or https://');
  }
  if (A.traffic.enabled && !A.traffic.url && !A.traffic.key) errs.push('alerts.traffic: an API key is required (TomTom) \u2014 or give a URL override');
  if (A.traffic.enabled && !(A.traffic.radiusKm >= 0.5 && A.traffic.radiusKm <= 50)) errs.push('alerts.traffic: radius must be 0.5\u201350 km');
  const fnames = new Set();
  for (const f of A.feeds) {
    if (!/^[a-z0-9_-]{1,24}$/.test(f.name)) errs.push('alert feed "' + f.name + '": name must be 1\u201324 characters of a-z, 0-9, - or _');
    if (fnames.has(f.name)) errs.push('alert feed "' + f.name + '": duplicate name'); fnames.add(f.name);
    if (!/^https?:\/\//i.test(f.url)) errs.push('alert feed "' + f.name + '": URL must start with http:// or https://');
    if (!(f.intervalMin >= 1 && f.intervalMin <= 1440)) errs.push('alert feed "' + f.name + '": interval must be 1\u20131440 min');
  }
  let needBroker = false;
  for (const id of IDS) {
    const d = cfg.domains[id];
    if (!MODES.includes(d.mode)) { errs.push(id + ': unknown mode "' + d.mode + '"'); continue; }
    if (!mappers[d.mapper || 'identity']) errs.push(id + ': unknown mapper "' + d.mapper + '"');
    if (d.fields && (typeof d.fields !== 'object' || Array.isArray(d.fields))) errs.push(id + ': field map must be a JSON object');
    if (d.mode === 'rest') {
      if (!/^https?:\/\//i.test(d.url || '')) errs.push(id + ': REST URL must start with http:// or https://');
      else if (/^https?:\/\/(169\.254\.|\[?fe80)/i.test(d.url)) errs.push(id + ': link-local addresses are not allowed');
      if (!(d.intervalSec >= 1 && d.intervalSec <= 3600)) errs.push(id + ': interval must be 1–3600 s');
      if (!['GET', 'POST'].includes(d.method)) errs.push(id + ': method must be GET or POST');
    }
    if (d.mode === 'mqtt') { needBroker = true; if (!d.topic) errs.push(id + ': MQTT topic is required'); }
  }
  if (needBroker && !/^(mqtt|mqtts|ws|wss|tcp):\/\//i.test(cfg.mqtt.url || '')) errs.push('MQTT broker URL is required (mqtt://host:1883)');
  return errs;
}

const isEnvRef = (v) => /^\$\{\w+\}$/.test(String(v));
/** Never send stored secrets back to the browser: only ${ENV_VAR} references are shown verbatim. */
function mask(cfg) {
  const c = JSON.parse(JSON.stringify(cfg));
  if (c.mqtt.password && !isEnvRef(c.mqtt.password)) c.mqtt.password = MASK;
  for (const n of Object.keys(c.sources)) if (c.sources[n].token && !isEnvRef(c.sources[n].token)) c.sources[n].token = MASK;
  if (c.alerts.traffic.key && !isEnvRef(c.alerts.traffic.key)) c.alerts.traffic.key = MASK;
  for (const f of c.alerts.feeds) for (const k of Object.keys(f.headers || {})) if (!isEnvRef(f.headers[k])) f.headers[k] = MASK;
  for (const id of IDS) for (const k of Object.keys(c.domains[id].headers || {})) if (!isEnvRef(c.domains[id].headers[k])) c.domains[id].headers[k] = MASK;
  return c;
}
/** Replace MASK placeholders in an incoming config with the stored values. */
function unmask(incoming, stored) {
  const c = normalize(incoming);
  if (c.mqtt.password === MASK) c.mqtt.password = stored.mqtt.password;
  for (const n of Object.keys(c.sources)) if (c.sources[n].token === MASK) c.sources[n].token = (stored.sources[n] && stored.sources[n].token) || '';
  if (c.alerts.traffic.key === MASK) c.alerts.traffic.key = stored.alerts.traffic.key;
  for (const f of c.alerts.feeds) { const old = stored.alerts.feeds.find((x) => x.name === f.name); for (const k of Object.keys(f.headers || {})) if (f.headers[k] === MASK) { if (old && old.headers && old.headers[k] !== undefined) f.headers[k] = old.headers[k]; else delete f.headers[k]; } }
  for (const id of IDS) {
    const h = c.domains[id].headers || {};
    for (const k of Object.keys(h)) if (h[k] === MASK) { const old = stored.domains[id].headers && stored.domains[id].headers[k]; if (old === undefined) delete h[k]; else h[k] = old; }
  }
  return c;
}

function load(file) {
  if (!file || !fs.existsSync(file)) return normalize({});
  return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
}
function save(file, cfg) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });   // may contain credentials
  fs.renameSync(tmp, file);
}
/** ingest domain name for a configured row */
const ingestName = (id, d) => {
  const info = DOMAIN_INFO.find((x) => x.id === id);
  return d.item && info && info.item ? info.item : id;
};

module.exports = { DOMAIN_INFO, IDS, MODES, MASK, defaults, normalize, validate, mask, unmask, load, save, ingestName };
