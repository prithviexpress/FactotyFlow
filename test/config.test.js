'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { transform } = require('../adapters/transform.js');
const Cfg = require('../adapters/config.js');
const { createApp } = require('../server.js');

test('transform: root + field map + scaling + nested contract fields', () => {
  const vendor = { data: { items: [{ material: 'M1', desc: 'Door', onHand: '40', perHour: 90, asn: 'A1', eta: '2026-01-01T10:00:00Z' }] } };
  const out = transform(vendor, { root: 'data.items', fields: { id: 'material', name: 'desc', stock: 'onHand', rate: { path: 'perHour', div: 60 }, 'pending.ref': 'asn', 'pending.etaAt': 'eta' } });
  assert.deepEqual(out, [{ id: 'M1', name: 'Door', stock: 40, rate: 1.5, pending: { ref: 'A1', etaAt: '2026-01-01T10:00:00Z' } }]);
  assert.throws(() => transform({}, { root: 'nope.x' }), /not found/);
});

test('config validation + masking', () => {
  const c = Cfg.normalize({ domains: { parts: { mode: 'rest', url: 'ftp://x', headers: { Authorization: 'Bearer secret', X: '${TOK}' } }, amr: { mode: 'mqtt' } } });
  const errs = Cfg.validate(c);
  assert.ok(errs.some((e) => /parts: REST URL/.test(e)));
  assert.ok(errs.some((e) => /amr: MQTT topic/.test(e)));
  assert.ok(errs.some((e) => /MQTT broker URL/.test(e)));
  const m = Cfg.mask(c);
  assert.equal(m.domains.parts.headers.Authorization, Cfg.MASK);
  assert.equal(m.domains.parts.headers.X, '${TOK}');
  assert.equal(Cfg.unmask(m, c).domains.parts.headers.Authorization, 'Bearer secret');
});

test('Interfaces API: save -> poll -> live; test endpoint; sim mode hands domain back', async () => {
  // stub vendor API
  const vendor = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer vendor-secret') { res.writeHead(401); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/bad' ? { data: { built: 'x' } } : { data: { shiftPlan: 800, built: 321 } }));
  });
  await new Promise((r) => vendor.listen(0, '127.0.0.1', r));
  const vurl = 'http://127.0.0.1:' + vendor.address().port;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-')), 'cfg.json');
  const app = createApp({ configFile: file, tickMs: 50, log() {}, token: '' });
  const base = 'http://127.0.0.1:' + (await app.listen(0));
  const call = (m, p, b) => fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });

  let v = await (await call('GET', '/api/config')).json();
  assert.equal(v.meta.domains.length, 20);
  const row = { mode: 'rest', url: vurl + '/ok', intervalSec: 1, headers: { Authorization: 'Bearer vendor-secret' }, root: 'data', fields: { plan: 'shiftPlan', actual: 'built' } };

  // dry-run
  let t = await (await call('POST', '/api/config/test', { domain: 'build', spec: row })).json();
  assert.equal(t.ok, true); assert.equal(t.valid, true); assert.match(t.mapped, /321/);
  t = await (await call('POST', '/api/config/test', { domain: 'build', spec: Object.assign({}, row, { url: vurl + '/bad' }) })).json();
  assert.equal(t.valid, false); assert.match(t.error, /actual must be a number/);
  t = await (await call('POST', '/api/config/test', { domain: 'build', spec: Object.assign({}, row, { headers: {} }) })).json();
  assert.equal(t.ok, false); assert.equal(t.status, 401);

  // invalid save is rejected and not applied
  let r = await call('PUT', '/api/config', { config: { domains: { build: { mode: 'rest', url: 'nope' } } } });
  assert.equal(r.status, 400);

  // save -> live
  v.config.domains.build = Object.assign(v.config.domains.build, row);
  r = await call('PUT', '/api/config', { config: v.config });
  assert.equal(r.status, 200);
  await new Promise((r2) => setTimeout(r2, 400));
  assert.equal(app.state.build.actual, 321); assert.equal(app.state.build.plan, 800);
  v = await (await call('GET', '/api/config')).json();
  assert.equal(v.status.build.live, true); assert.equal(v.status.build.via, 'rest');
  assert.equal(v.config.domains.build.headers.Authorization, Cfg.MASK);            // secret never returned
  assert.match(fs.readFileSync(file, 'utf8'), /vendor-secret/);                    // but persisted
  assert.equal((fs.statSync(file).mode & 0o077), 0);                               // file not group/world readable

  // saving the masked config back keeps the secret and keeps working
  assert.equal((await call('PUT', '/api/config', { config: v.config })).status, 200);
  await new Promise((r2) => setTimeout(r2, 1300));
  assert.equal(v.status.build.error, null);
  assert.equal((await (await call('GET', '/api/config')).json()).status.build.error, null);

  // back to simulated: simulator takes over with fresh data, pushes are refused
  v.config.domains.build.mode = 'sim';
  assert.equal((await call('PUT', '/api/config', { config: v.config })).status, 200);
  assert.equal(app.state.live.build, undefined);
  assert.equal(app.state.build.plan, 920);
  assert.equal((await call('POST', '/api/ingest/build', { actual: 5 })).status, 409);

  await app.close(); vendor.close();
});

test('Interfaces API is admin-gated when ADMIN_TOKEN is set', async () => {
  const app = createApp({ configFile: '', adminToken: 'adm', log() {}, tickMs: 50 });
  const base = 'http://127.0.0.1:' + (await app.listen(0));
  assert.equal((await fetch(base + '/api/config')).status, 401);
  assert.equal((await fetch(base + '/api/config', { headers: { Authorization: 'Bearer adm' } })).status, 200);
  assert.equal((await fetch(base + '/api/config/test', { method: 'POST', body: '{}' })).status, 401);
  await app.close();
});

test('plant setup is validated, saved and applied to the live state', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-')), 'cfg.json');
  const app = createApp({ configFile: file, tickMs: 50, log() {} });
  const base = 'http://127.0.0.1:' + (await app.listen(0));
  const put = (b) => fetch(base + '/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: b }) });
  assert.equal((await put({ plant: { jvs: ['X', 'x'] } })).status, 400);                  // duplicate
  assert.equal((await put({ plant: { jvs: [] } })).status, 400);
  const r = await put({ plant: { jvs: ['Seats Co', 'Cockpit Co'], terms: { bay: 'Bay', jit: 'JIT adherence' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(app.state.setup.jvs, ['Seats Co', 'Cockpit Co']);
  assert.equal(app.state.setup.terms.jit, 'JIT adherence');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).plant.jvs, ['Seats Co', 'Cockpit Co']);
  await app.close();
});

test('dashboard heading is configurable and defaults to MATERIAL FLOW CONTROL TOWER', () => {
  const S = require('../public/sim.js').createState();
  assert.equal(S.setup.terms.title, 'MATERIAL FLOW CONTROL TOWER');
  assert.equal(Cfg.normalize({}).plant.terms.title, 'MATERIAL FLOW CONTROL TOWER');
  assert.deepEqual(Cfg.validate(Cfg.normalize({ plant: { terms: { title: 'PLANT 01 MATERIAL FLOW TOWER' } } })), []);
  assert.ok(Cfg.validate(Cfg.normalize({ plant: { terms: { title: 'x'.repeat(49) } } })).some((e) => /title.*48/.test(e)));
});

test('a viewer that stops reading is skipped and then dropped: the server does not buffer snapshots for it', async () => {
  const net = require('node:net');
  const app = createApp({ configFile: '', log() {}, tickMs: 10, maxPendingBytes: 256 * 1024, stuckMs: 400 });
  const port = await app.listen(0);
  const trucks = Array.from({ length: 900 }, (_, i) => ({ id: 'HR38AB' + String(i).padStart(7, '0'), supplier: 'Supplier ' + i, material: 'Material ' + i, status: 'arrived' }));
  await fetch('http://127.0.0.1:' + port + '/api/ingest/trucks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(trucks) });
  const stuck = net.connect(port, '127.0.0.1'); stuck.pause();                       // connects, asks for the stream, never reads it
  await new Promise((r) => stuck.once('connect', r));
  stuck.write('GET /events HTTP/1.1\r\nHost: x\r\n\r\n');
  const reader = await fetch('http://127.0.0.1:' + port + '/events'), rd = reader.body.getReader(); let got = 0;
  const pump = (async () => { for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.length; } })().catch(() => {});
  let worst = 0;
  for (let i = 0; i < 150; i++) { await new Promise((r) => setTimeout(r, 10)); for (const n of app.viewers().pending) worst = Math.max(worst, n); }
  const v = app.viewers();
  assert.ok(worst < 2 * 1024 * 1024, 'pending bytes stayed bounded, worst ' + worst);   // unbounded, this would be well over 100 snapshots
  assert.ok(v.skipped > 0 && v.dropped === 1 && v.count === 1, JSON.stringify(v));      // the stuck one was dropped, the reading one stays
  assert.ok(got > 1024 * 1024);                                                         // and the healthy viewer kept receiving
  stuck.destroy(); await rd.cancel().catch(() => {}); await pump; await app.close();
});
