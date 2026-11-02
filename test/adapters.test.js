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

test('inventory hours: per-position split from the feed, JV buffers, motorpool', () => {
  const S = Sim.createState();
  Sim.setPlant(S, { jvs: ['JV1', 'JV2', 'JV3', 'JV4'] });
  Ing.ingest(S, 'parts', [
    { id: 'A', name: 'A', shop: 'weld', rate: 1, inv: { bay: 30, lineside: 30 } },      // 1 pcs/min = 60 pcs/h
    { id: 'B', name: 'B', shop: 'weld', rate: 2, stock: 240 }                            // no split from the feed
  ]);
  assert.equal(S.parts[0].stock, 60);                                                    // usable = bay + line-side
  Ing.ingest(S, 'shops', { press: { buf: 50, units: 114 }, weld: 78 });
  Ing.ingest(S, 'jvstock', { jv1: { buf: 50, units: 57 }, JV3: { buf: 40, hours: 0.4 } }); // names match case-insensitively
  Ing.ingest(S, 'finished', { units: 108, shipRate: 1 });
  assert.throws(() => Ing.ingest(S, 'jvstock', { JV9: 50 }), /unknown JV "JV9" \(configured JVs: JV1, JV2, JV3, JV4\)/);
  const V = Sim.inventoryView(S), rate = S.build.rate * 60;
  const ra = V.rows.find((r) => r.id === 'A'), rb = V.rows.find((r) => r.id === 'B');
  assert.equal(ra.h.bay, 0.5); assert.equal(ra.h.lineside, 0.5); assert.equal(ra.h.total, 1);
  assert.equal(rb.h.total, 2); assert.equal(rb.h.lineside, undefined);                   // no split -> total only
  assert.equal(V.positions.find((p) => p.id === 'lineside').count, 1);
  assert.equal(V.positions.find((p) => p.id === 'lineside').status, 'watch');            // 0.5 h vs 0.75 h target
  assert.ok(Math.abs(V.wip.find((w) => w.id === 'press').hours - 114 / rate) < 1e-9);
  assert.ok(Math.abs(V.wip.find((w) => w.id === 'jv:JV1').hours - 57 / rate) < 1e-9);
  assert.equal(V.wip.find((w) => w.id === 'jv:JV3').hours, 0.4);
  assert.equal(V.finished.hours, 1.8); assert.equal(V.finished.label, 'Motorpool');
  assert.equal(S.shops.stores, undefined);                                               // central stores / kitting no longer exist
});

test('plant setup: JV names and terminology drive the state', () => {
  const S = Sim.createState();
  assert.deepEqual(S.setup.jvs, ['Sheet metal Belsonica', 'Sheet metal SKH', 'Seat set', 'Carpet', 'Door Trim', 'Exhaust', 'Glass', 'Fuel tank']);
  Sim.setPlant(S, { jvs: ['Alpha', 'Beta', 'Gamma'], terms: { bay: 'Berth', motorpool: 'Yard X' } });
  assert.deepEqual(S.jvSites.map((j) => j.name), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(S.jv.routes.map((r) => r.name), ['Alpha \u2192 Assembly', 'Beta \u2192 Assembly', 'Gamma \u2192 Assembly']);
  assert.equal(S.setup.terms.bay, 'Berth'); assert.equal(S.setup.terms.parking, 'Truck parking');   // others keep defaults
  assert.equal(Sim.inventoryView(S).finished.label, 'Yard X');
  Sim.setPlant(S, { jvs: ['Alpha', 'Beta', 'Gamma', 'D', 'E', 'F', 'G', 'H', 'I'] });
  assert.equal(S.jvSites.length, 8);                                                     // capped at 8
  for (let i = 0; i < 500; i++) Sim.step(S, 30);                                         // simulates fine with renamed JVs
});
