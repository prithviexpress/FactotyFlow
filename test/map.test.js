'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../public/sim.js');
global.window = { FactorySim: Sim };
require('../public/map.js');
const Ing = require('../adapters/ingest.js');
const Cfg = require('../adapters/config.js');
const V = require('../adapters/values.js');

const ctx = (S) => ({ T: (k) => S.setup.terms[k], f0: Math.round, ui: { shop: 'all' }, IV: Sim.inventoryView(S) });

test('block layout renders the drawing\'s blocks, the JV tiles, the sequence bus and carriers; logistics sit apart', () => {
  const S = Sim.createState(), r = global.window.FFMap.render(S, ctx(S));
  for (const id of ['jvzone', 'egtm', 'imma', 'press', 'weldB', 'weldA', 'paintB', 'paintA', 'asmB', 'asmA']) assert.ok(r.nodes.includes('data-node="' + id + '"'), id);
  for (const n of ['JV1', 'JV2', 'JV3', 'JV4']) assert.ok(r.nodes.includes('>' + n + '<'), n);
  assert.ok(r.nodes.includes('ASSEMBLY A') && r.nodes.includes('ASSEMBLY B') && r.nodes.includes('PRESS A/B'));
  // the unnamed light blocks of the drawing stay placeholders; truck parking / motorpool / shipment are in a separate, labelled strip
  assert.equal((r.nodes.match(/unnamed block/g) || []).length, 4);
  assert.ok(r.nodes.includes('LOGISTICS AREAS') && r.nodes.includes('not positioned'));
  for (const id of ['logi-yard', 'logi-motorpool', 'logi-shipment']) assert.ok(r.nodes.includes('data-node="' + id + '"'), id);
  assert.ok(!r.nodes.includes('ASSUMED POSITION'));
  assert.match(r.flows, /class="seq/); assert.match(r.flows, /animateMotion/); assert.match(r.flows, /id="rt-jv-b"/);
  // assembly A is fed from the west: down the gap between paint (x<=573) and assembly (x>=581), never round the right edge
  assert.match(r.flows, /id="rt-jv-a" d="M230,138 V151 H577 V254 H581"/); assert.ok(!r.flows.includes('H1148'));
  S.line.stopped = true; S.line.reason = 'x';
  assert.ok(!global.window.FFMap.render(S, ctx(S)).flows.includes('animateMotion'));          // carriers stop with the line
});

test('layout labels, carriers and bindings come from the plant setup; text is escaped', () => {
  const S = Sim.createState();
  Sim.setPlant(S, { jvs: ['Seats <b>', 'Glass'], slots: { egtm: { label: 'POWER', carrier: 'tow' }, top3: { bind: 'shipment', label: 'DISPATCH 2' }, asmA: { label: 'FINAL A' } } });
  const r = global.window.FFMap.render(S, ctx(S));
  assert.ok(r.nodes.includes('POWER') && r.nodes.includes('FINAL A') && r.nodes.includes('DISPATCH 2'));
  assert.ok(!r.nodes.includes('Seats <b>') && r.nodes.includes('Seats &lt;b&gt;'));
  assert.ok(r.nodes.includes('TOW'));
});

test('per-line assembly counts: pushed values win, otherwise half of the total', () => {
  const S = Sim.createState();
  S.build.plan = 920; S.build.actual = 767;
  let l = Sim.lineSplit(S); assert.equal(l.derived, true); assert.equal(l.A.actual + l.B.actual, 767);
  V.apply(S, 'build/lineA/actual', '400'); V.apply(S, 'build/lineA/plan', '470');
  l = Sim.lineSplit(S); assert.equal(l.A.actual, 400); assert.equal(l.B.actual, 367); assert.equal(l.B.plan, 450); assert.equal(l.derived, false);
});

test('A/B buffers: shops feed accepts per-line keys and the older single weld / paint keys', () => {
  const S = Sim.createState();
  Ing.ingest(S, 'shops', { weld: 70, paintA: 55, paintB: 45 });
  assert.equal(S.shops.weldA.buf, 70); assert.equal(S.shops.weldB.buf, 70); assert.equal(S.shops.paintA.buf, 55); assert.equal(S.shops.paintB.buf, 45);
  const cfg = Cfg.normalize({ plant: { slots: { top1: { bind: 'warp' }, egtm: { carrier: 'rocket' }, jv: { label: 'x'.repeat(30) } } } });
  const errs = Cfg.validate(cfg);
  assert.ok(errs.some((e) => /top1.*it can show/.test(e)) && errs.some((e) => /egtm.*amr or tow/.test(e)) && errs.some((e) => /jv.*24 characters/.test(e)));
});

test('a widget you place in an unnamed block is marked ASSUMED POSITION until confirmed, and leaves the logistics strip', () => {
  const S = Sim.createState();
  const count = (str) => (str.match(/ASSUMED POSITION/g) || []).length;
  Sim.setPlant(S, { slots: { top1: { bind: 'motorpool' } } });
  let r = global.window.FFMap.render(S, ctx(S));
  assert.equal(count(r.nodes), 1); assert.ok(r.nodes.includes('k-light assumed'));
  assert.ok(!r.nodes.includes('data-node="logi-motorpool"') && r.nodes.includes('data-node="logi-yard"'));   // moved out of the strip
  Sim.setPlant(S, { slots: { top1: { bind: 'motorpool', confirmed: true } } });
  r = global.window.FFMap.render(S, ctx(S));
  assert.equal(count(r.nodes), 0); assert.ok(r.nodes.includes('data-tip="Motorpool \u00b7 position confirmed.'));
  Sim.setPlant(S, { slots: { yard: { bind: 'yard' }, top1: { bind: 'motorpool' }, top2: { bind: 'shipment' } } });
  assert.ok(!global.window.FFMap.render(S, ctx(S)).nodes.includes('LOGISTICS AREAS'));                       // everything placed: no strip
  const cfg = Cfg.normalize({ plant: { slots: { top2: { confirmed: 'true' }, top3: { confirmed: false } } } });
  assert.equal(cfg.plant.slots.top2.confirmed, true); assert.equal(cfg.plant.slots.top3.confirmed, false);
});
