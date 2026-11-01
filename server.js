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
const Cfg = require('./adapters/config.js');
const { createManager } = require('./adapters/manager.js');
const mappers = require('./adapters/mappers.js');

const ROOT = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

const CONFIG_FILE = process.env.ADAPTERS_CONFIG || path.join(__dirname, 'adapters.config.json');
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function createApp(opts) {
  opts = opts || {};
  const cfg = opts.config ? Cfg.normalize(opts.config) : Cfg.load(opts.configFile === undefined ? CONFIG_FILE : opts.configFile);
  const configFile = opts.configFile === undefined ? CONFIG_FILE : opts.configFile;
  const adminToken = opts.adminToken !== undefined ? opts.adminToken : process.env.ADMIN_TOKEN;
  const log = opts.log || ((m) => console.log('[factoryflow] ' + m));
    const token = opts.token !== undefined ? opts.token : process.env.INGEST_TOKEN;
  const state = Sim.createState();
  const clients = new Set();
  const stops = [];

  const doIngest = (domain, payload) => Ing.ingest(state, domain, payload);
  const markErr = (domain, msg) => Ing.markError(state, domain, msg);
  const manager = createManager({ config: cfg, getState: () => state, ingest: doIngest, markError: markErr, log });
  manager.apply(cfg);
  stops.push(() => manager.stop());
  const wantsLive = () => Cfg.IDS.some((id) => ['rest', 'mqtt'].includes(manager.config.domains[id].mode));

  const isLive = () => Object.keys(state.live).length > 0;
  const timer = setInterval(() => {
    if (isLive() || wantsLive()) {                 // real data => real time (no sim acceleration)
      state.speed = 1;
      const d = new Date(); state.clock = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    }
    Sim.step(state, state.speed);
    Ing.health(state, manager.config.staleSec || 60);
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
    if (url.pathname === '/api/inventory') return send(res, 200, Sim.inventoryView(state));
    if (url.pathname === '/api/health') return send(res, 200, { demo: state.demo, mixed: state.mixed, stale: state.stale || [], sources: state.src });
    let m;
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/ingest\/([\w.]+)$/))) {
      if (token && req.headers.authorization !== 'Bearer ' + token) return send(res, 401, { error: 'unauthorized' });
      const dom = m[1];
      if (dom !== 'batch' && manager.config.domains[dom.split('.')[0]] && manager.config.domains[dom.split('.')[0]].mode === 'sim') return send(res, 409, { error: 'domain "' + dom + '" is set to Simulated on the Interfaces page; change its mode to accept data' });
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
    if (url.pathname.indexOf('/api/config') === 0) return configRoutes(req, res, url);
    const file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  function isAdmin(req) {
    if (adminToken) return req.headers.authorization === 'Bearer ' + adminToken;
    return LOOPBACK.has(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];   // no token configured: local access only
  }
  function readJson(req, cb) {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => { try { cb(null, JSON.parse(body || 'null')); } catch (e) { cb(new Ing.IngestError('invalid JSON')); } });
  }
  function configView() {
    return { config: Cfg.mask(manager.config), status: manager.status(), meta: { domains: Cfg.DOMAIN_INFO, modes: Cfg.MODES, mappers: Object.keys(mappers), file: configFile ? path.basename(configFile) : null, writable: !!configFile }, mqttInstalled: mqttInstalled(), demo: state.demo, mixed: state.mixed };
  }
  function mqttInstalled() { try { require.resolve('mqtt'); return true; } catch (e) { return false; } }
  function configRoutes(req, res, url) {
    if (!isAdmin(req)) return send(res, 401, { error: adminToken ? 'admin token required' : 'config API is limited to localhost; set ADMIN_TOKEN to enable remote access', tokenRequired: !!adminToken });
    if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, configView());
    if (req.method === 'PUT' && url.pathname === '/api/config') {
      return readJson(req, (err, body) => {
        if (err) return send(res, 400, { error: err.message });
        try {
          const next = Cfg.unmask(body && body.config ? body.config : body, manager.config);
          const errs = Cfg.validate(next);
          if (errs.length) return send(res, 400, { error: errs.join('\n'), errors: errs });
          if (configFile) Cfg.save(configFile, next);
          manager.apply(next);
          log('config saved: ' + Cfg.IDS.filter((i) => ['rest', 'mqtt'].includes(next.domains[i].mode)).join(', '));
          send(res, 200, configView());
        } catch (e) { send(res, 400, { error: e.message }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/config/test') {
      return readJson(req, (err, body) => {
        if (err || !body || !body.domain || !body.spec) return send(res, 400, { error: 'expected {domain, spec}' });
        const spec = Cfg.unmask({ domains: { [body.domain]: body.spec }, mqtt: body.broker || manager.config.mqtt }, manager.config);
        manager.test(body.domain, spec.domains[body.domain], spec.mqtt).then((r) => send(res, 200, r), (e) => send(res, e.status || 500, { error: e.message }));
      });
    }
    send(res, 404, { error: 'not found' });
  }
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
  const app = createApp({});
  app.listen(process.env.PORT || 8080).then((p) => console.log('FactoryFlow control tower on http://localhost:' + p));
}
module.exports = { createApp };
