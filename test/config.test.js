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
  assert.equal(v.meta.domains.length, 17);
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
  const r = await put({ plant: { jvs: ['Seats Co', 'Cockpit Co'], terms: { bay: 'Bay', jis: 'JIT adherence' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(app.state.setup.jvs, ['Seats Co', 'Cockpit Co']);
  assert.equal(app.state.setup.terms.jis, 'JIT adherence');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).plant.jvs, ['Seats Co', 'Cockpit Co']);
  await app.close();
});
