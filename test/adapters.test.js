'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../public/sim.js');
const Ing = require('../adapters/ingest.js');
const { topicMatches } = require('../adapters/mqtt.js');
const mappers = require('../adapters/mappers.js');
const { createApp } = require('../server.js');

test('parts ingest flips domain live and sim stops driving it', () => {
  const S = Sim.createState();
  Ing.ingest(S, 'parts', [{ id: 'A1', name: 'Test Part', shop: 'weld', stock: 100, rate: 2 }]);
  assert.equal(S.live.parts, true);
  for (let i = 0; i < 200; i++) Sim.step(S, 30);
  assert.equal(S.parts.length, 1);
  assert.equal(S.parts[0].stock, 100);          // not consumed by the simulator
  assert.equal(S.shops.press.buf > 0, true);    // other domains still simulated
});
test('upsert + etaAt conversion', () => {
  const S = Sim.createState();
  Ing.ingest(S, 'parts.item', { id: 'X', stock: 5, rate: 1, pending: { ref: 'ASN1', etaAt: new Date(Date.now() + 30 * 60000).toISOString(), qty: 50 } });
  const p = S.parts.find((x) => x.id === 'X');
  assert.ok(p.pending.eta > 29 && p.pending.eta < 31);
  Ing.ingest(S, 'parts.item', { id: 'X', stock: 9 });            // partial update keeps pending
  assert.equal(S.parts.find((x) => x.id === 'X').pending.ref, 'ASN1');
});
test('bad payloads are rejected, state untouched', () => {
  const S = Sim.createState();
  assert.throws(() => Ing.ingest(S, 'build', { actual: 'abc' }), /actual must be a number/);
  assert.throws(() => Ing.ingest(S, 'nope', {}), /unknown domain/);
  assert.throws(() => Ing.ingest(S, 'parts', { not: 'array' }), /array/);
  assert.equal(S.live.build, undefined);
});
test('amr units upsert and utilisation derived', () => {
  const S = Sim.createState();
  Ing.ingest(S, 'amr', { units: [{ id: 'A', state: 'busy', battery: 80 }, { id: 'B', state: 'idle', battery: 20 }, { id: 'C', state: 'charging', battery: 10 }], routes: [{ name: 'R1', missions: 5, onTimePct: 90 }] });
  Ing.ingest(S, 'amr.unit', { id: 'B', state: 'busy', battery: 19 });
  const v = Sim.fleetView(S.amr);
  assert.equal(v.total, 3); assert.equal(v.busy, 2); assert.equal(v.charging, 1);
  assert.equal(Math.round(S.amr.util * 100), 100);
});
test('health marks stale domains and mixed mode', () => {
  const S = Sim.createState();
  Ing.ingest(S, 'quality', { rejected: 3 });
  S.src.quality.last = Date.now() - 120000;
  Ing.health(S, 60);
  assert.deepEqual(S.stale, ['quality']); assert.equal(S.mixed, true); assert.equal(S.demo, false);
});
test('mqtt topic matching', () => {
  assert.ok(topicMatches('uagv/v2/+/+/state', 'uagv/v2/acme/amr-7/state'));
  assert.ok(!topicMatches('uagv/v2/+/+/state', 'uagv/v2/acme/state'));
  assert.ok(topicMatches('plant01/#', 'plant01/a/b'));
});
test('vda5050 mapper', () => {
  const u = mappers['vda5050-state']({ serialNumber: 'AGV1', batteryState: { batteryCharge: 63.5, charging: false }, driving: true });
  assert.deepEqual(u, { id: 'AGV1', battery: 63.5, state: 'busy' });
});
test('HTTP ingest: auth, validation, live state', async () => {
  const app = createApp({ token: 's3cret', tickMs: 50, log() {} });
  const port = await app.listen(0), base = 'http://127.0.0.1:' + port;
  const post = (p, body, tok) => fetch(base + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: JSON.stringify(body) });
  assert.equal((await post('/api/ingest/build', { actual: 10 })).status, 401);
  assert.equal((await post('/api/ingest/build', { actual: 'x' }, 's3cret')).status, 400);
  assert.equal((await post('/api/ingest/build', { plan: 500, actual: 123 }, 's3cret')).status, 202);
  assert.equal((await post('/api/ingest/batch', [{ domain: 'quality', payload: { rejected: 7 } }], 's3cret')).status, 202);
  await new Promise((r) => setTimeout(r, 300));
  const s = await (await fetch(base + '/api/state')).json();
  assert.equal(s.build.actual, 123); assert.equal(s.quality.rejected, 7); assert.equal(s.speed, 1); assert.equal(s.mixed, true);
  const h = await (await fetch(base + '/api/health')).json();
  assert.equal(h.sources.build.status, 'fresh');
  await app.close();
});
