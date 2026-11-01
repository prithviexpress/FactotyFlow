#!/usr/bin/env node
/*
 * FactoryFlow server (zero required dependencies).
 *   GET  /                      dashboard (public/)
 *   GET  /events                Server-Sent Events: full state, 1 Hz
 *   GET  /api/state             state snapshot
 *   GET  /api/health            data-source freshness per domain
 *   POST /api/ingest/:domain    push data (webhook style). Auth: Bearer $INGEST_TOKEN if set
 *   POST /api/inject/:scenario  demo scenarios (demo mode only)
 *   POST /api/speed/:n          sim speed (demo mode only)
 * Optional pollers/subscribers are configured in adapters.config.json (see README).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const Sim = require('./public/sim.js');
const Ing = require('./adapters/ingest.js');
const { startRest } = require('./adapters/rest.js');
const { startMqtt } = require('./adapters/mqtt.js');

const ROOT = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function loadConfig() {
  const f = process.env.ADAPTERS_CONFIG || path.join(__dirname, 'adapters.config.json');
  if (!fs.existsSync(f)) return {};
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function createApp(opts) {
  opts = opts || {};
  const cfg = opts.config || {};
  const log = opts.log || ((m) => console.log('[factoryflow] ' + m));
  const staleSec = cfg.staleSec || 60;
  const token = opts.token !== undefined ? opts.token : process.env.INGEST_TOKEN;
  const state = Sim.createState();
  const clients = new Set();
  const stops = [];

  const doIngest = (domain, payload) => Ing.ingest(state, domain, payload);
  const markErr = (domain, msg) => Ing.markError(state, domain, msg);
  const wantsLive = !!((cfg.rest && cfg.rest.pollers && cfg.rest.pollers.length) || (cfg.mqtt && cfg.mqtt.subscriptions && cfg.mqtt.subscriptions.length));
  if (cfg.rest) stops.push(startRest(cfg.rest, doIngest, log, markErr));
  if (cfg.mqtt) stops.push(startMqtt(cfg.mqtt, doIngest, log, markErr));

  const isLive = () => Object.keys(state.live).length > 0;
  const timer = setInterval(() => {
    if (isLive() || wantsLive) {                 // real data => real time (no sim acceleration)
      state.speed = 1;
      const d = new Date(); state.clock = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    }
    Sim.step(state, state.speed);
    Ing.health(state, staleSec);
    const msg = 'data: ' + JSON.stringify(state) + '\n\n';
    for (const res of clients) res.write(msg);
  }, opts.tickMs || 1000);

  const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('data: ' + JSON.stringify(state) + '\n\n');
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/api/state') return send(res, 200, state);
    if (url.pathname === '/api/health') return send(res, 200, { demo: state.demo, mixed: state.mixed, stale: state.stale || [], sources: state.src });
    let m;
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/ingest\/([\w.]+)$/))) {
      if (token && req.headers.authorization !== 'Bearer ' + token) return send(res, 401, { error: 'unauthorized' });
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || 'null');
          for (const item of (m[1] === 'batch' ? asBatch(payload) : [{ domain: m[1], payload }])) doIngest(item.domain, item.payload);
          send(res, 202, { ok: true });
        } catch (e) { send(res, e.status || 400, { error: e.message }); }
      });
      return;
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/inject\/(\w+)$/))) { if (!isLive()) Sim.inject(state, m[1]); res.writeHead(204); return res.end(); }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/speed\/(\d+)$/))) { if (!isLive()) state.speed = Math.min(600, Math.max(1, +m[1])); res.writeHead(204); return res.end(); }
    const file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  function asBatch(p) {
    if (!Array.isArray(p)) throw new Ing.IngestError('batch must be an array of {domain, payload}');
    return p.map((x) => ({ domain: x.domain, payload: x.payload }));
  }
  return {
    server, state,
    listen: (port) => new Promise((r) => server.listen(port, () => r(server.address().port))),
    close: () => { clearInterval(timer); stops.forEach((s) => s && s()); for (const c of clients) c.end(); return new Promise((r) => server.close(r)); }
  };
}

if (require.main === module) {
  const app = createApp({ config: loadConfig() });
  app.listen(process.env.PORT || 8080).then((p) => console.log('FactoryFlow control tower on http://localhost:' + p));
}
module.exports = { createApp };
