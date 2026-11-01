'use strict';
/* Runs the configured REST pollers / MQTT subscriptions; hot-reloads when the config changes; tests endpoints. */
const mappers = require('./mappers');
const { transform } = require('./transform');
const Cfg = require('./config');
const Ing = require('./ingest');
const Sim = require('../public/sim.js');
const { topicMatches } = require('./mqtt');
const AF = require('./alertfeeds');

const subst = (s) => String(s === undefined || s === null ? '' : s).replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] || '');
const trunc = (v, n) => { let s = typeof v === 'string' ? v : JSON.stringify(v, null, 1); return s && s.length > (n || 2500) ? s.slice(0, n || 2500) + '\n… (truncated)' : s; };
const pipeline = (json, d, ctx) => mappers[d.mapper || 'identity'](transform(json, d), ctx || {});

function createManager(o) {
  const log = o.log || (() => {});
  let cfg = o.config || Cfg.defaults();
  let stops = [];
  const runtime = {};                      // per-domain: { via, error, lastOk }

  const ingestFor = (id, via) => (payload) => {
    const name = Cfg.ingestName(id, cfg.domains[id]);
    o.ingest(name, payload);
    const S = o.getState(), rec = S.src[id]; if (rec) rec.via = via;
    runtime[id] = { via, error: null, lastOk: Date.now() };
  };
  const failFor = (id, via) => (e) => { runtime[id] = Object.assign(runtime[id] || {}, { via, error: e.message }); o.markError(id, e.message); };

  function stop() { stops.forEach((s) => { try { s(); } catch (e) { /* ignore */ } }); stops = []; }

  /* ---------- alert providers (weather / traffic / custom feeds) ---------- */
  async function getJson(url, headers) {
    const h = {}; for (const k in headers || {}) h[k] = subst(headers[k]);
    const res = await fetch(subst(url), { headers: h, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  /** build a provider job: { name, every (min), fetchAndDerive() -> {alerts, info?} } */
  function providerJob(kind, spec, plant) {
    if (kind === 'weather') return { name: 'weather', fetch: async () => AF.weatherAlerts(await getJson(spec.url || AF.weatherUrl(plant)), spec) };
    if (kind === 'traffic') return { name: 'traffic', fetch: async () => AF.trafficAlerts(await getJson(spec.url || AF.trafficUrl({ key: subst(spec.key), lat: plant.lat, lon: plant.lon, radiusKm: spec.radiusKm })), spec) };
    return { name: 'feed:' + spec.name, fetch: async () => AF.feedAlerts(await getJson(spec.url, spec.headers), spec) };
  }
  function startAlerts(next) {
    const S = o.getState(), A = next.alerts, plant = next.plant, jobs = [];
    if (A.weather.enabled) jobs.push(Object.assign(providerJob('weather', A.weather, plant), { every: A.weather.intervalMin }));
    if (A.traffic.enabled) jobs.push(Object.assign(providerJob('traffic', A.traffic, plant), { every: A.traffic.intervalMin }));
    for (const f of A.feeds) if (f.enabled) jobs.push(Object.assign(providerJob('feed', f, plant), { every: f.intervalMin }));
    const keep = new Set(jobs.map((j) => j.name));
    for (const n of Object.keys(S.alertSrc)) if (!keep.has(n)) { Sim.reconcileAlerts(S, n, []); Sim.clearAlert(S, 'system:alertsrc:' + n); delete S.alertSrc[n]; if (n === 'weather') { delete S.live.weather; S.weatherInfo = null; } }
    for (const job of jobs) {
      let busy = false;
      const run = async () => {
        if (busy) return; busy = true;
        const rec = S.alertSrc[job.name] || (S.alertSrc[job.name] = { count: 0, fails: 0, alerts: 0 });
        try {
          const r = await job.fetch();
          Sim.reconcileAlerts(S, job.name, r.alerts);
          if (job.name === 'weather' && r.info) { S.weather = r.info.temp; S.weatherInfo = { text: r.info.text, icon: r.info.icon, detail: r.info.detail }; o.touch && o.touch(S, 'weather'); }
          rec.last = Date.now(); rec.count++; rec.alerts = r.alerts.length; rec.error = null; rec.fails = 0;
          Sim.clearAlert(S, 'system:alertsrc:' + job.name);
        } catch (e) {
          rec.error = e.message; rec.fails++; rec.lastErr = Date.now();
          if (rec.fails >= 3) Sim.raiseAlert(S, { id: 'system:alertsrc:' + job.name, level: 'watch', kind: 'system', title: 'Alert source "' + job.name + '" is unreachable', msg: e.message + ' \u2014 weather/traffic/event alerts from it are not being updated.', source: 'system' });
          if (rec.fails % 10 === 1) log('alerts ' + job.name + ' failed: ' + e.message);
        } finally { busy = false; }
      };
      run();
      const t = setInterval(run, Math.max(1, job.every) * 60000);
      stops.push(() => clearInterval(t));
    }
  }
  /** Dry-run one provider against its real endpoint; nothing is applied to the dashboard. */
  async function testAlert(kind, spec, plant) {
    const job = providerJob(kind, spec, plant), t0 = Date.now();
    try {
      const r = await job.fetch();
      return { ok: true, ms: Date.now() - t0, alerts: r.alerts, info: r.info || null };
    } catch (e) { return { ok: false, ms: Date.now() - t0, error: e.name === 'TimeoutError' ? 'timed out after 10 s' : e.message }; }
  }

  function startRest(id, d) {
    const ok = ingestFor(id, 'rest'), bad = failFor(id, 'rest');
    let busy = false, fails = 0;
    const tick = async () => {
      if (busy) return; busy = true;
      try {
        const headers = {}; for (const k in d.headers || {}) headers[k] = subst(d.headers[k]);
        const res = await fetch(subst(d.url), { method: d.method || 'GET', headers, signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        ok(pipeline(await res.json(), d, {}));
        if (fails) log('rest ' + id + ' recovered'); fails = 0;
      } catch (e) { if (fails++ % 10 === 0) log('rest ' + id + ' failed: ' + e.message); bad(e); } finally { busy = false; }
    };
    tick();
    const t = setInterval(tick, Math.max(1, d.intervalSec || 15) * 1000);
    stops.push(() => clearInterval(t));
  }

  function startMqtt(rows) {
    let mqtt; try { mqtt = require('mqtt'); } catch (e) { log('mqtt package not installed (npm i mqtt)'); rows.forEach(([id]) => failFor(id, 'mqtt')(new Error('mqtt package not installed on the server'))); return; }
    const c = mqtt.connect(subst(cfg.mqtt.url), { username: subst(cfg.mqtt.username) || undefined, password: subst(cfg.mqtt.password) || undefined, reconnectPeriod: 5000 });
    c.on('connect', () => { log('mqtt connected'); rows.forEach(([, d]) => c.subscribe(subst(d.topic), { qos: cfg.mqtt.qos || 0 })); rows.forEach(([id]) => { if (runtime[id]) runtime[id].error = null; }); });
    c.on('error', (e) => rows.forEach(([id]) => failFor(id, 'mqtt')(e)));
    c.on('message', (topic, buf) => {
      for (const [id, d] of rows) {
        if (!topicMatches(subst(d.topic), topic)) continue;
        try {
          const segments = topic.split('/');
          let p = pipeline(JSON.parse(buf.toString()), d, { topic, segments });
          if (d.idIndex !== null && d.idIndex !== undefined && d.idIndex !== '' && p && !Array.isArray(p) && p.id === undefined) p = Object.assign({ id: segments[Number(d.idIndex)] }, p);
          ingestFor(id, 'mqtt')(p);
        } catch (e) { failFor(id, 'mqtt')(e); }
      }
    });
    stops.push(() => c.end(true));
  }

  /** Apply a (validated) config: restart adapters, hand domains that are no longer fed back to the simulator. */
  function apply(next) {
    const prev = cfg; cfg = next; stop();
    const S = o.getState();
    Sim.setPlant(S, next.plant);
    const polled = (x) => x === 'rest' || x === 'mqtt';
    for (const id of Cfg.IDS) {
      const was = prev.domains[id].mode, now = next.domains[id].mode;
      if (S.live[id] && (now === 'sim' || (polled(was) && !polled(now)))) { Sim.resetDomain(S, id); delete runtime[id]; }
    }
    startAlerts(next);
    const mq = [];
    for (const id of Cfg.IDS) {
      const d = next.domains[id];
      if (d.mode === 'rest') startRest(id, d);
      if (d.mode === 'mqtt') mq.push([id, d]);
    }
    if (mq.length) startMqtt(mq);
  }

  /** Dry-run a single row against the real endpoint; validated on a scratch state so nothing is changed. */
  async function test(id, d, broker) {
    const info = Cfg.DOMAIN_INFO.find((x) => x.id === id);
    if (!info) throw Object.assign(new Error('unknown domain'), { status: 400 });
    const scratch = Sim.createState();
    const finish = (raw, ctxExtra) => {
      const out = { raw: trunc(raw) };
      try {
        const mapped = pipeline(raw, d, ctxExtra);
        out.mapped = trunc(mapped);
        Ing.ingest(scratch, Cfg.ingestName(id, d), mapped);
        out.valid = true;
      } catch (e) { out.valid = false; out.error = e.message; }
      return out;
    };
    if (d.mode === 'rest') {
      const errs = Cfg.validate(Object.assign(Cfg.defaults(), { domains: Object.assign(Cfg.defaults().domains, { [id]: Object.assign(Cfg.defaults().domains[id], d) }) }));
      const mine = errs.filter((e) => e.indexOf(id + ':') === 0);
      if (mine.length) return { ok: false, error: mine.join('; ') };
      const t0 = Date.now(), headers = {}; for (const k in d.headers || {}) headers[k] = subst(d.headers[k]);
      try {
        const res = await fetch(subst(d.url), { method: d.method || 'GET', headers, signal: AbortSignal.timeout(8000) });
        const text = await res.text(); let json;
        try { json = JSON.parse(text); } catch (e) { return { ok: false, status: res.status, ms: Date.now() - t0, error: 'Response is not JSON', raw: trunc(text, 600) }; }
        return Object.assign({ ok: res.ok, status: res.status, ms: Date.now() - t0 }, finish(json, {}), res.ok ? {} : { error: 'HTTP ' + res.status });
      } catch (e) { return { ok: false, ms: Date.now() - t0, error: e.name === 'TimeoutError' ? 'timed out after 8 s' : e.message }; }
    }
    if (d.mode === 'mqtt') {
      let mqtt; try { mqtt = require('mqtt'); } catch (e) { return { ok: false, error: 'mqtt package not installed on the server (npm i mqtt)' }; }
      if (!d.topic) return { ok: false, error: 'topic is required' };
      const b = broker || cfg.mqtt;
      return new Promise((resolve) => {
        const c = mqtt.connect(subst(b.url), { username: subst(b.username) || undefined, password: subst(b.password === Cfg.MASK ? cfg.mqtt.password : b.password) || undefined, reconnectPeriod: 0, connectTimeout: 5000 });
        const done = (r) => { clearTimeout(timer); c.end(true); resolve(r); };
        const timer = setTimeout(() => done({ ok: true, waited: true, error: 'Connected and subscribed, but no message within 8 s (topic may be quiet)' }), 8000);
        c.on('error', (e) => done({ ok: false, error: e.message }));
        c.on('connect', () => c.subscribe(subst(d.topic), (err) => { if (err) done({ ok: false, error: err.message }); }));
        c.on('message', (topic, buf) => {
          let json; try { json = JSON.parse(buf.toString()); } catch (e) { return done({ ok: false, topic, error: 'Message is not JSON', raw: trunc(buf.toString(), 600) }); }
          const segments = topic.split('/');
          const r = finish(json, { topic, segments });
          done(Object.assign({ ok: true, topic }, r));
        });
      });
    }
    return { ok: false, error: 'Nothing to test for mode "' + d.mode + '"' };
  }

  function status() {
    const S = o.getState(), out = {};
    for (const id of Cfg.IDS) {
      const r = S.src[id] || {}, rt = runtime[id] || {};
      out[id] = { live: !!S.live[id], via: r.via || rt.via || null, last: r.last || null, age: r.age === undefined ? null : r.age, count: r.count || 0, stale: r.status === 'stale', error: rt.error || r.error || null };
    }
    return out;
  }
  return { apply, stop, test, testAlert, status, get config() { return cfg; } };
}
module.exports = { createManager };
