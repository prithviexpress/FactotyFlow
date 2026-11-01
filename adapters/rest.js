'use strict';
/* REST pollers: GET a URL every N seconds, map, ingest. (Push/webhook ingest lives in server.js: POST /api/ingest/:domain) */
const mappers = require('./mappers');
const subst = (s) => String(s).replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] || '');

function startRest(cfg, ingest, log, markError) {
  const timers = [];
  for (const p of (cfg && cfg.pollers) || []) {
    const map = mappers[p.mapper || 'identity'];
    if (!map) { log('rest: unknown mapper "' + p.mapper + '" for ' + p.domain); continue; }
    const headers = {};
    for (const k in p.headers || {}) headers[k] = subst(p.headers[k]);
    let fails = 0, busy = false;
    const tick = async () => {
      if (busy) return; busy = true;
      try {
        const res = await fetch(subst(p.url), { headers, signal: AbortSignal.timeout((p.timeoutSec || 8) * 1000) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        ingest(p.domain, map(await res.json(), {}));
        if (fails) log('rest: ' + p.domain + ' recovered');
        fails = 0;
      } catch (e) {
        if (fails++ % 10 === 0) log('rest: ' + p.domain + ' failed: ' + e.message);
        markError(p.domain, e.message);
      } finally { busy = false; }
    };
    tick();
    timers.push(setInterval(tick, Math.max(1, p.intervalSec || 15) * 1000));
  }
  return () => timers.forEach(clearInterval);
}
module.exports = { startRest };
