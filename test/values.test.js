'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../public/sim.js');
const V = require('../adapters/values.js');
const { createApp } = require('../server.js');

test('every pushable value: example pushes, reads back, and flips its domain live', () => {
  for (const d of V.REGISTRY) {
    const S = Sim.createState();
    const c = V.catalog(S).inputs.find((x) => x.path === d.path);
    const id = c.entities && c.entities.length ? c.entities[0].id : 'X-1';
    const path = d.path.replace(/\{.+?\}/, encodeURIComponent(id));
    const r = V.apply(S, path, d.type === 'text' || d.type === 'enum' ? String(d.example) : d.example);
    assert.equal(r.unit, d.unit, path);
    const back = V.read(S, path).value;
    if (d.type === 'number') assert.ok(Math.abs(back - d.example) < 0.06, path + ' read back ' + back + ' expected ' + d.example);
    else if (d.type === 'boolean') assert.equal(back, d.example ? 1 : 0, path);
    else assert.equal(back, d.example, path);
    if (d.domain !== 'weather') assert.equal(S.live[d.domain], true, path + ' should mark ' + d.domain + ' live');
  }
});

test('validation: unit/range/whole-number/enum/unknown entity', () => {
  const S = Sim.createState();
  assert.throws(() => V.apply(S, 'shops/press/buf', '101'), /out of range \(allowed 0–100\)/);
  assert.throws(() => V.apply(S, 'shops/press/buf', 'abc'), /expects a number in %/);
  assert.throws(() => V.apply(S, 'yard/arrived', '2.5'), /whole number of trucks/);
  assert.throws(() => V.apply(S, 'trucks/TRK-1019/status', 'sideways'), /one of: scheduled, arrived, docked, received/);
  assert.throws(() => V.apply(S, 'shops/stores/buf', '5'), /unknown shop "stores"\. Valid: press, weldA, weldB, paintA, paintB, engine, bumper/);
  assert.throws(() => V.apply(S, 'nope/x', '1'), /unknown value path/);
  assert.throws(() => V.apply(S, 'transfers/bmp/onTime', '99'), /cannot exceed total/);
  assert.equal(S.live.shops, undefined);                      // nothing flipped by rejected pushes
  assert.equal(V.apply(S, 'line/stopped', 'true').value, true);
});

test('partial pushes do not wipe the other fields of the same entity', () => {
  const S = Sim.createState();
  V.apply(S, 'parts/A/rate', '2'); V.apply(S, 'parts/A/bay', '10'); V.apply(S, 'parts/A/lineside', '30');
  V.apply(S, 'parts/A/inbound/qty', '100'); V.apply(S, 'parts/A/inbound/eta', '25'); V.apply(S, 'parts/A/inbound/ref', 'V-9');
  V.apply(S, 'parts/A/inbound/qty', '120');                                       // only qty changes
  const p = S.parts.find((x) => x.id === 'A');
  assert.equal(p.rate, 2); assert.deepEqual(p.inv, { bay: 10, lineside: 30 }); assert.equal(p.stock, 40);
  assert.deepEqual([p.pending.ref, p.pending.eta, p.pending.qty], ['V-9', 25, 120]);
  assert.equal(S.parts.length, 1);                                                // simulated parts were dropped on first push
  V.apply(S, 'amr/AMR-01/battery', '15'); V.apply(S, 'amr/AMR-01/state', 'charging'); V.apply(S, 'amr/AMR-01/battery', '18');
  const u = S.amr.amrs.find((a) => a.id === 'AMR-01');
  assert.deepEqual([u.b, u.s], [18, 'charging']);
});

test('HTTP: raw number / JSON body, batch is all-or-nothing, catalogue, token, sim-mode refusal', async () => {
  const app = createApp({ token: 'tok', tickMs: 50, log() {}, configFile: '' });
  const base = 'http://127.0.0.1:' + (await app.listen(0));
  const post = (p, body, tok) => fetch(base + p, { method: 'POST', headers: tok === false ? {} : { Authorization: 'Bearer ' + (tok || 'tok') }, body });
  assert.equal((await post('/api/value/build/actual', '766', false)).status, 401);
  let r = await post('/api/value/build/actual', '766');                                  // plain number
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, path: 'build/actual', value: 766, unit: 'vehicles' });
  assert.equal((await post('/api/value/build/plan', '{"value": 900}')).status, 200);    // JSON body
  assert.equal(app.state.build.plan, 900);
  r = await post('/api/value/shops/press/buf', '250'); assert.equal(r.status, 400);
  assert.match((await r.json()).error, /out of range/);
  r = await post('/api/values', JSON.stringify({ 'shops/weldA/buf': 70, 'yard/arrived': 'x' }));   // one bad -> nothing applied
  assert.equal(r.status, 400); assert.notEqual(app.state.shops.weldA.buf, 70);
  r = await post('/api/values', JSON.stringify({ 'shops/weldA/buf': 70, 'yard/arrived': 20 }));
  assert.equal(r.status, 200); assert.equal(app.state.shops.weldA.buf, 70); assert.equal(app.state.yard.arrived, 20);
  const g = await (await fetch(base + '/api/value/yard/arrived')).json(); assert.equal(g.value, 20); assert.equal(g.unit, 'trucks');
  const cat = await (await fetch(base + '/api/values')).json();
  assert.ok(cat.count >= 60); assert.ok(cat.derived.length >= 15);
  const e = cat.inputs.find((x) => x.path === 'shops/{shop}/buf');
  assert.equal(e.unit, '%'); assert.equal(e.range, '0 – 100'); assert.deepEqual(e.entities.map((x) => x.id), ['press', 'weldA', 'weldB', 'paintA', 'paintB', 'engine', 'bumper']);
  assert.equal(e.source.live, true);
  assert.ok(!cat.inputs.some((x) => /coverage|hours/i.test(x.path) && x.group === 'Derived'));
  // a domain set to Simulated refuses pushes
  const cfg = { config: { domains: { quality: { mode: 'sim' } } } };
  assert.equal((await fetch(base + '/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) })).status, 200);
  r = await post('/api/value/quality/rejected', '3'); assert.equal(r.status, 409);
  await app.close();
});
