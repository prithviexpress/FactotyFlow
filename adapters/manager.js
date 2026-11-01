'use strict';
/* Runs the configured REST pollers / MQTT subscriptions; hot-reloads when the config changes; tests endpoints. */
const mappers = require('./mappers');
const { transform } = require('./transform');
const Cfg = require('./config');
const Ing = require('./ingest');
const Sim = require('../public/sim.js');
const { topicMatches } = require('./mqtt');

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
    const polled = (x) => x === 'rest' || x === 'mqtt';
    for (const id of Cfg.IDS) {
      const was = prev.domains[id].mode, now = next.domains[id].mode;
      if (S.live[id] && (now === 'sim' || (polled(was) && !polled(now)))) { Sim.resetDomain(S, id); delete runtime[id]; }
    }
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
  return { apply, stop, test, status, get config() { return cfg; } };
}
module.exports = { createManager };
