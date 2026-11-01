'use strict';
/* MQTT subscriber (needs the optional `mqtt` package: npm i mqtt). Each message -> mapper -> ingest. */
const mappers = require('./mappers');
const subst = (s) => String(s || '').replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] || '');

/** MQTT topic filter match with + and # wildcards */
function topicMatches(filter, topic) {
  const f = filter.split('/'), t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

function startMqtt(cfg, ingest, log, markError) {
  let mqtt;
  try { mqtt = require('mqtt'); } catch (e) { log('mqtt: package not installed — run `npm i mqtt` (adapter disabled)'); return () => {}; }
  const subs = (cfg.subscriptions || []).filter((s) => {
    if (!mappers[s.mapper || 'identity']) { log('mqtt: unknown mapper "' + s.mapper + '" for ' + s.topic); return false; }
    return true;
  });
  const c = mqtt.connect(subst(cfg.url), { username: subst(cfg.username) || undefined, password: subst(cfg.password) || undefined, reconnectPeriod: 5000 });
  c.on('connect', () => { log('mqtt: connected, subscribing to ' + subs.length + ' topics'); subs.forEach((s) => c.subscribe(s.topic, { qos: cfg.qos || 0 })); });
  c.on('error', (e) => log('mqtt: ' + e.message));
  c.on('message', (topic, buf) => {
    for (const s of subs) {
      if (!topicMatches(s.topic, topic)) continue;
      try {
        const segments = topic.split('/');
        let payload = mappers[s.mapper || 'identity'](JSON.parse(buf.toString()), { topic, segments });
        if (s.idIndex !== undefined && payload && !Array.isArray(payload) && payload.id === undefined) payload = Object.assign({ id: segments[s.idIndex] }, payload);
        ingest(s.domain, payload);
      } catch (e) { log('mqtt: ' + topic + ' rejected: ' + e.message); markError(s.domain, e.message); }
    }
  });
  return () => c.end(true);
}
module.exports = { startMqtt, topicMatches };
