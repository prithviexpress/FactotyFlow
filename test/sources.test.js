'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../adapters/values.js');
const Cfg = require('../adapters/config.js');
const Sim = require('../public/sim.js');
const { createApp } = require('../server.js');

test('flatten nested posts into value paths; reject arrays', () => {
  assert.deepEqual(V.flatten({ build: { actual: 766 }, 'kpi/jit': 98.4, parts: { P1: { stock: 28, inbound: { qty: 100 } } } }).map((x) => x.path),
    ['build/actual', 'kpi/jit', 'parts/P1/stock', 'parts/P1/inbound/qty']);
  assert.throws(() => V.flatten({ parts: [{ id: 'P1' }] }), /arrays are not supported/);
});

test('ownership prefixes', () => {
  assert.ok(V.owns(['build', 'kpi/jit'], 'build/actual'));
  assert.ok(V.owns(['kpi/jit'], 'kpi/jit'));
  assert.ok(!V.owns(['kpi/jit'], 'kpi/stockAcc'));
  assert.ok(V.owns(['shops/*/buf'], 'shops/press/buf')); assert.ok(!V.owns(['shops/*/buf'], 'shops/press/units'));
  assert.ok(V.prefixValid('shops') && V.prefixValid('kpi/jit') && V.prefixValid('parts/P1/stock') && !V.prefixValid('nope'));
});

test('applyMany is all-or-nothing and counts each domain once', () => {
  const S = Sim.createState();
  const before = JSON.stringify(S);
  assert.throws(() => V.applyMany(S, [{ path: 'build/actual', v: 700 }, { path: 'transfers/bmp/onTime', v: 99 }]), /cannot exceed total/);
  assert.equal(JSON.stringify(S), before);                                            // fully rolled back
  V.applyMany(S, [{ path: 'transfers/bmp/onTime', v: 7 }, { path: 'transfers/bmp/total', v: 9 }, { path: 'build/actual', v: 700 }, { path: 'build/plan', v: 800 }]);
  assert.equal(S.transfers[1].q.length, 9); assert.equal(S.src.build.count, 1);        // order-independent; one touch per domain
});

test('source posts: own token, ownership, atomic, health, config masking', async () => {
  const cfg = { sources: { mes: { token: 'mes-token-1234567890', owns: ['build', 'kpi/jit', 'shops'] }, wms: { token: 'wms-token-1234567890', owns: ['parts', 'lineside'] } } };
  assert.deepEqual(Cfg.validate(Cfg.normalize(cfg)), []);
  assert.ok(Cfg.validate(Cfg.normalize({ sources: { x: { token: 'short', owns: ['nope'] } } })).length >= 2);
  assert.equal(Cfg.mask(Cfg.normalize(cfg)).sources.mes.token, Cfg.MASK);

  const app = createApp({ configFile: '', tickMs: 50, log() {}, token: '', config: cfg });
  const base = 'http://127.0.0.1:' + (await app.listen(0));
  const post = async (p, b, t) => { const r = await fetch(base + p, { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: JSON.stringify(b) }); return [r.status, await r.json()]; };
  const MES = 'mes-token-1234567890', WMS = 'wms-token-1234567890';

  assert.equal((await post('/api/source/mes', { build: { actual: 5 } }, 'wrong'))[0], 401);
  assert.equal((await post('/api/source/mes', { build: { actual: 5 } }, WMS))[0], 401);          // another source's token does not work
  assert.equal((await post('/api/source/ghost', { build: { actual: 5 } }, MES))[0], 404);
  let [c, b] = await post('/api/source/mes', { build: { actual: 766, plan: 920 }, 'kpi/jit': 98.4, shops: { press: { buf: 80 } } }, MES);
  assert.equal(c, 200); assert.equal(b.applied, 4);
  assert.equal(app.state.build.actual, 766); assert.equal(app.state.src.build.count, 1); assert.equal(app.state.sources.mes.count, 1);

  [c, b] = await post('/api/source/mes', { build: { actual: 900 }, parts: { P1: { stock: 5 } }, 'kpi/stockAcc': 99 }, MES);   // not owned -> nothing applied
  assert.equal(c, 403); assert.match(b.error, /parts\/P1\/stock/); assert.match(b.error, /nothing was applied/);
  assert.equal(app.state.build.actual, 766);
  [c, b] = await post('/api/source/mes', { build: { actual: 900 }, shops: { press: { buf: 250 } } }, MES);                    // invalid -> nothing applied
  assert.equal(c, 400); assert.equal(app.state.build.actual, 766); assert.equal(app.state.sources.mes.rejected, 2);

  [c] = await post('/api/source/wms', { parts: { P1: { stock: 28, rate: 1.2, inbound: { qty: 100, eta: 20 } } }, lineside: { 'bumper-b-h-lh': { usable: 40 } } }, WMS);
  assert.equal(c, 200); assert.equal(app.state.parts.length, 1);

  const h = await (await fetch(base + '/api/health')).json();
  assert.equal(h.posters.mes.count, 1); assert.deepEqual(h.posters.wms.owns, ['parts', 'lineside']);
  await app.close();
});

test('JIT replaces JIS: the old kpi/jis path, jis field and jis label still work', () => {
  const S = require('../public/sim.js').createState();
  assert.equal(S.setup.terms.jit, 'JIT accuracy'); assert.ok('jit' in S.kpi && !('jis' in S.kpi));
  assert.equal(V.apply(S, 'kpi/jis', '97.2').path, 'kpi/jit'); assert.equal(S.kpi.jit, 97.2);                 // old path -> new value
  assert.equal(V.read(S, 'kpi/jis').value, 97.2);
  assert.deepEqual(V.flatten({ kpi: { jis: 96 } }).map((x) => x.path), ['kpi/jit']);
  assert.ok(V.owns(['kpi/jis'], 'kpi/jit') && V.owns(['kpi/jit'], 'kpi/jis'));                                // ownership lists written either way
  require('../adapters/ingest.js').ingest(S, 'kpi', { jis: 95.5 }); assert.equal(S.kpi.jit, 95.5);            // old domain payload
  const migrated = Cfg.normalize({ plant: { terms: { jis: 'JIS accuracy', bay: 'Bay' } } });
  assert.equal(migrated.plant.terms.jit, 'JIT accuracy');                                                     // old default label is not carried over
  assert.equal(Cfg.normalize({ plant: { terms: { jis: 'Sequence hit rate' } } }).plant.terms.jit, 'Sequence hit rate');   // a custom label is kept
});
