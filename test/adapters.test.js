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

test('yard bays: the grid shows the bays\' own ids, and a truck at "AA-02" lights that bay', () => {
  const Sim = require('../public/sim.js'), S = Sim.createState();
  Ing.ingest(S, 'yard', { expected: 4, arrived: 3, docked: 2, received: 1, occupied: 1, bays: ['AA-01', 'AA-02', 'BB-01'] });
  assert.deepEqual(S.yard.bays, ['AA-01', 'AA-02', 'BB-01']);
  assert.equal(S.yard.docks, 3, 'docks follows the list when it is not sent');
  Ing.ingest(S, 'trucks', [{ id: 'T1', status: 'docked', dock: 'AA-02' }, { id: 'T2', status: 'docked', dock: 'bb-01' }, { id: 'T3', status: 'received', dock: 'AA-01' }]);
  assert.equal(S.trucks[0].dock, 'AA-02');
  assert.deepEqual(Sim.bayGrid(S), [{ id: 'AA-01', busy: false }, { id: 'AA-02', busy: true }, { id: 'BB-01', busy: false }]);  // case matters; a received truck holds no bay
});

test('yard bays: without the list the grid is 1..docks and numeric docks still work', () => {
  const Sim = require('../public/sim.js'), S = Sim.createState();
  S.yard.bays = undefined;
  Ing.ingest(S, 'yard', { docks: 3 });
  Ing.ingest(S, 'trucks', [{ id: 'T1', status: 'docked', dock: 2 }, { id: 'T2', status: 'docked', dock: '3' }]);
  assert.deepEqual(Sim.bayGrid(S).map((b) => [b.id, b.busy]), [['1', false], ['2', true], ['3', true]]);
});

test('yard bays: bad lists are refused and change nothing', () => {
  const S = require('../public/sim.js').createState();
  for (const bad of [['A', 'A'], [''], 'AA-01', [new Array(30).join('x')]]) assert.throws(() => Ing.ingest(S, 'yard', { bays: bad }), /yard\.bays/);
  assert.throws(() => Ing.ingest(S, 'trucks', [{ id: 'T', dock: new Array(30).join('x') }]), /dock/);
});

test('the funnel adds up: expected = not yet here + waiting + at a bay now + received', () => {
  const { funnel } = require('../public/sim.js');
  const f = funnel({ expected: 1264, arrived: 330, docked: 219, received: 196 });
  assert.deepEqual(f, { expected: 1264, notYet: 934, waiting: 111, atBayNow: 23, received: 196 });
  for (const y of [{ expected: 34, arrived: 26, docked: 21, received: 18 }, { expected: 5, arrived: 9, docked: 9, received: 9 }, { expected: 0, arrived: 0, docked: 0, received: 0 }]) {
    const g = funnel(y);
    assert.equal(g.notYet + g.waiting + g.atBayNow + g.received, g.expected);
    assert.ok([g.notYet, g.waiting, g.atBayNow, g.received].every((n) => n >= 0));
  }
});

test('bay view inputs are prepared: assignedBay per truck, per-bay status, unload limit', () => {
  const S = Sim.createState();
  Ing.ingest(S, 'yard', { bays: ['AB-13', 'AB-14', 'AB-15'] });
  Ing.ingest(S, 'trucks.item', { id: 'HR38AB0266073', status: 'arrived', assignedBay: 'AB-14' });
  assert.equal(S.trucks.find((t) => t.id === 'HR38AB0266073').assignedBay, 'AB-14');
  Ing.ingest(S, 'trucks.item', { id: 'HR38AB0266073', supplier: 'Bharat Forge' });                    // partial update keeps it
  assert.equal(S.trucks.find((t) => t.id === 'HR38AB0266073').assignedBay, 'AB-14');
  Ing.ingest(S, 'yard', { bayStatus: { 'AB-14': 'blocked', 'AB-15': 'outOfService' } });
  Ing.ingest(S, 'yard', { bayStatus: { 'AB-15': 'available' } });                                      // clears one, keeps the other
  assert.deepEqual(S.yard.bayStatus, { 'AB-14': 'blocked' });
  assert.throws(() => Ing.ingest(S, 'yard', { bayStatus: { 'AB-13': 'broken' } }), /must be one of/);
  assert.deepEqual(S.yard.bayStatus, { 'AB-14': 'blocked' });                                          // a bad post changes nothing
  const V = require('../adapters/values.js');
  V.apply(S, 'yard/bays/AB-13/status', 'outOfService'); assert.equal(S.yard.bayStatus['AB-13'], 'outOfService');
  assert.equal(V.read(S, 'yard/bays/AB-14/status').value, 'blocked'); assert.equal(V.read(S, 'yard/bays/AB-15/status').value, 'available');
  V.apply(S, 'trucks/HR38AB0266073/assignedBay', 'AB-15'); assert.equal(S.trucks.find((t) => t.id === 'HR38AB0266073').assignedBay, 'AB-15');
  V.apply(S, 'yard/unloadLimitMin', '60'); assert.equal(S.yard.unloadLimitMin, 60);
  assert.throws(() => V.apply(S, 'yard/unloadLimitMin', '0'), /out of range/);
});

test('topic data (production, utility, quality, safety): simulated, pushable in part, validated before applying, forecast from run rate', () => {
  const S = Sim.createState(); S.clock = 600;                                    // 10:00, shift 06:30 to 15:00
  for (const k in S.production.depts) S.production.depts[k].actual = 0;
  Ing.ingest(S, 'production', { depts: { weld: { plan: 15000, actual: 6000, avail: 96, perf: 98, qual: 99 }, press: { plan: 73000, actual: 20000 } }, losses: { Breakdown: 12, 'Die change': 40 } });
  assert.equal(S.live.production, true); assert.equal(S.production.depts.weld.actual, 6000); assert.equal(S.production.depts.paint.plan, 14000);     // not sent: unchanged
  assert.ok(Math.abs(S.production.depts.weld.oee - 93.1392) < 0.001);            // OEE from its three parts when not sent itself
  assert.deepEqual(S.production.losses[0], { reason: 'Die change', min: 40 });   // largest first
  const v = Sim.mgmtView(S), weld = v.rows.find((r) => r.id === 'weld');
  assert.equal(Math.round(weld.due), Math.round(15000 * (210 / 510)));           // plan to now = plan x elapsed share of the shift
  assert.equal(Math.round(v.forecast), Math.round((26000 / 210) * 510));          // run-rate forecast
  assert.throws(() => Ing.ingest(S, 'production', { depts: { weld: { actual: 7000 }, nope: { plan: 1 } } }), /unknown department "nope"/);
  assert.equal(S.production.depts.weld.actual, 6000);                            // a bad post changes nothing
  assert.throws(() => Ing.ingest(S, 'production', { shift: { start: '15:00', end: '06:30' } }), /after shift.start/);
  Ing.ingest(S, 'utility', { depts: { paint: { energy: 9000 } }, power: { kw: 5100 }, air: { bar: 6.0 } });
  assert.equal(S.utility.depts.paint.energy, 9000); assert.equal(S.utility.power.kw, 5100); assert.ok(S.utility.power.peakKw >= 5100); assert.equal(S.utility.depts.paint.energyTarget, 19000);
  Ing.ingest(S, 'quality', { fourM: { man: 97 }, depts: { weld: { inspected: 6000, defects: 300 } }, defects: { Spatter: 200, Dent: 100 } });
  assert.equal(S.quality.fourM.man, 97); assert.equal(Sim.mgmtView(S).rows.find((r) => r.id === 'weld').fpy, 95);
  assert.throws(() => Ing.ingest(S, 'quality', { fourM: { man: 120 } }), /between 0 and 100/);
  assert.throws(() => Ing.ingest(S, 'quality', { depts: { weld: { inspected: 10, defects: 11 } } }), /cannot exceed/);
  Ing.ingest(S, 'safety', { lti: 1, daysSinceLti: 0, incidents: { 'INC-900': { dept: 'paint', type: 'Chemical splash', sev: 'high' }, 'INC-204': { status: 'closed' } }, depts: { paint: 96.5 } });
  assert.equal(S.safety.lti, 1); assert.equal(S.safety.incidents[0].id, 'INC-900'); assert.equal(S.safety.incidents.find((x) => x.id === 'INC-204').status, 'closed'); assert.equal(S.safety.depts.paint, 96.5);
  assert.throws(() => Ing.ingest(S, 'safety', { incidents: { X: { sev: 'huge' } } }), /low, med or high/);
  const V = require('../adapters/values.js');
  V.apply(S, 'production/depts/paint/actual', '5000'); assert.equal(S.production.depts.paint.actual, 5000);
  V.apply(S, 'safety/trir', '0.25'); assert.equal(S.safety.trir, 0.25); V.apply(S, 'utility/air/bar', '6.4'); assert.equal(S.utility.air.bar, 6.4);
  V.apply(S, 'quality/depts/weld/defects', '120'); V.apply(S, 'safety/depts/weld/compliance', '97'); V.apply(S, 'yard/turnTarget', '45');
  assert.equal(S.quality.depts.weld.defects, 120); assert.equal(S.safety.depts.weld, 97); assert.equal(Sim.mgmtView(S).tatTarget, 45);
  assert.throws(() => V.apply(S, 'production/depts/xx/plan', '1'), /unknown department/);
  const before = S.production.depts.weld.actual, e0 = S.utility.depts.paint.energy; for (let i = 0; i < 20; i++) Sim.step(S, 30);
  assert.equal(S.production.depts.weld.actual, before); assert.equal(S.utility.depts.paint.energy, e0);     // live: the simulator leaves them alone
});
