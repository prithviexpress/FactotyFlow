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

test('block layout renders the drawing\'s blocks, the JV tiles, the sequence bus and carriers; vacant blocks, no logistics strip', () => {
  const S = Sim.createState(); Sim.setPlant(S, { jvs: ['JV1', 'JV2', 'JV3', 'JV4'] });
  const r = global.window.FFMap.render(S, ctx(S));
  for (const id of ['jvzone', 'egtm', 'imma', 'press', 'weldB', 'weldA', 'paintB', 'paintA', 'asmB', 'asmA']) assert.ok(r.nodes.includes('data-node="' + id + '"'), id);
  for (const n of ['JV1', 'JV2', 'JV3', 'JV4']) assert.ok(r.nodes.includes('>' + n + '<'), n);
  assert.ok(r.nodes.includes('ASSEMBLY A') && r.nodes.includes('ASSEMBLY B') && r.nodes.includes('PRESS A/B'));
  // the four light blocks are vacant (for messages); AMR / kanban overlays and the logistics strip are gone from the drawing
  assert.equal((r.nodes.match(/>VACANT</g) || []).length, 4);
  assert.ok(!r.nodes.includes('data-node="amrhealth"') && !r.nodes.includes('data-node="kanbanhealth"') && !r.nodes.includes('LOGISTICS AREAS') && !r.nodes.includes('logi-'));
  assert.ok(!r.nodes.includes('ASSUMED POSITION'));
  assert.match(r.flows, /class="seq/); assert.match(r.flows, /animateMotion/); assert.match(r.flows, /id="rt-jv-b"/);
  // assembly A: down the gap between paint (x<=573) and assembly (x>=581), along the lane under A, then up into A at the same x as B's drops (mirror)
  assert.match(r.flows, /id="rt-jv-wb" d="M230,156 V169 H200 V182"/); assert.match(r.flows, /id="rt-jv-wa" d="M230,156 V169 H287 V332 H200 V320"/);      // JV also feeds weld B (from the top) and weld A (from underneath: down the weld / paint gap, along the lane under A, up into it)
  assert.match(r.flows, /id="rt-jv-a" d="M230,156 V169 H577 V332 H600 V320"/); assert.match(r.flows, /id="rt-eg-a" d="M626,156 V169 H577 V332 H700 V320"/);
  assert.match(r.flows, /id="rt-im-a" d="M784,156 V169 H577 V332 H860 V320"/); assert.ok(!r.flows.includes('H1148'));
  assert.ok(r.flows.includes('M600,332 V320') && r.flows.includes('M700,169 V182'));
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

test('a widget you place in an unnamed block is marked ASSUMED POSITION until confirmed, ', () => {
  const S = Sim.createState();
  const count = (str) => (str.match(/ASSUMED POSITION/g) || []).length;
  Sim.setPlant(S, { slots: { top1: { bind: 'motorpool' } } });
  let r = global.window.FFMap.render(S, ctx(S));
  assert.equal(count(r.nodes), 1); assert.ok(r.nodes.includes('k-light assumed'));
  Sim.setPlant(S, { slots: { top1: { bind: 'motorpool', confirmed: true } } });
  r = global.window.FFMap.render(S, ctx(S));
  assert.equal(count(r.nodes), 0); assert.ok(r.nodes.includes('data-tip="Motorpool \u00b7 position confirmed.'));
  Sim.setPlant(S, { slots: { yard: { bind: 'yard' }, top1: { bind: 'motorpool' }, top2: { bind: 'shipment' } } });
  assert.equal((global.window.FFMap.render(S, ctx(S)).nodes.match(/>VACANT</g) || []).length, 1);                 // only top3 is left vacant
  const cfg = Cfg.normalize({ plant: { slots: { top2: { confirmed: 'true' }, top3: { confirmed: false } } } });
  assert.equal(cfg.plant.slots.top2.confirmed, true); assert.equal(cfg.plant.slots.top3.confirmed, false);
});

test('overlays: AMR spans the two tall blocks and kanban sits beside JV; either can be moved or removed', () => {
  const S = Sim.createState(); Sim.setPlant(S, { slots: { yard: { bind: 'kanban' }, top2: { bind: 'amr' } } });
  let r = global.window.FFMap.render(S, ctx(S));
  assert.ok(r.nodes.includes('data-node="kanbanhealth"') && r.nodes.includes('data-node="amrhealth"'));
  const pos = (id) => { const m = r.nodes.match(new RegExp('data-node="' + id + '"[\\s\\S]*?<rect class="obk" x="(\\d+)" y="\\d+" width="(\\d+)"')); return { x: +m[1], w: +m[2] }; };
  assert.equal(pos('kanbanhealth').x, 291);                                                    // beside JV (the large block)
  assert.deepEqual(pos('amrhealth'), { x: 897, w: 247 });                                      // both tall blocks, top right
  Sim.setPlant(S, { slots: { top2: { bind: 'amr' }, top3: { bind: 'shipment' }, yard: { bind: 'none' } } });
  r = global.window.FFMap.render(S, ctx(S));
  assert.ok(r.nodes.includes('data-node="top3"') && r.nodes.includes('>AMR<') && !r.nodes.includes('KANBAN TRANSFERS'));      // narrow AMR view; kanban removed
});

test('overlays moved out of the drawing: configs saved with the old placement are migrated, a v3 choice is kept, vacant blocks carry a message', () => {
  const old = Cfg.normalize({ plant: { slots: { yard: { bind: 'amr' }, top2: { bind: 'kanban' } } } });
  assert.equal(old.plant.slots.yard.bind, 'none'); assert.equal(old.plant.slots.top2.bind, 'none');
  const v2 = Cfg.normalize({ plant: { layoutVersion: 2, slots: { yard: { bind: 'kanban' }, top2: { bind: 'amr' } } } });
  assert.equal(v2.plant.slots.yard.bind, 'none'); assert.equal(v2.plant.slots.top2.bind, 'none');
  const v3 = Cfg.normalize({ plant: { layoutVersion: 3, slots: { yard: { bind: 'kanban' }, top2: { bind: 'amr' } } } });
  assert.equal(v3.plant.slots.yard.bind, 'kanban'); assert.equal(v3.plant.slots.top2.bind, 'amr');
  const own = Cfg.normalize({ plant: { slots: { yard: { bind: 'motorpool' } } } });
  assert.equal(own.plant.slots.yard.bind, 'motorpool');
  assert.equal(Cfg.normalize({}).plant.slots.yard.bind, 'none');
  const msg = Cfg.normalize({ plant: { layoutVersion: 3, slots: { top1: { text: 'Safety day <b>Friday</b> 10:00' } } } });
  assert.equal(msg.plant.slots.top1.text, 'Safety day <b>Friday</b> 10:00');
  assert.ok(Cfg.validate(Cfg.normalize({ plant: { layoutVersion: 3, slots: { top1: { text: 'x'.repeat(161) } } } })).some((e) => /message must be at most 160/.test(e)));
  const S = Sim.createState(); Sim.setPlant(S, msg.plant);
  const r = global.window.FFMap.render(S, ctx(S));
  assert.ok(r.nodes.includes('Safety day') && !r.nodes.includes('<b>Friday'));                                  // shown and escaped
});

test('movement health: AMR status rules and kanban status rules', () => {
  const S = Sim.createState();
  for (const k of ['amr', 'jv']) { S[k].amrs.forEach((a) => { a.b = 80; if (a.s === 'charging') a.s = 'idle'; }); S[k].routes.forEach((r) => { r.ema = 0.97; }); S[k].util = 0.3; }
  assert.equal(Sim.amrHealth(S).status, 'ok');
  S.amr.amrs[0].s = 'idle'; S.amr.amrs[0].b = 10; assert.equal(Sim.amrHealth(S).status, 'watch');                    // one low battery
  S.jv.routes[0].ema = 0.7; assert.equal(Sim.amrHealth(S).status, 'low');                                           // a late route
  assert.equal(Sim.kanbanStatus({ overdue: 0, onTimePct: 99 }), 'ok'); assert.equal(Sim.kanbanStatus({ overdue: 2, onTimePct: 99 }), 'watch');
  assert.equal(Sim.kanbanStatus({ overdue: 1, onTimePct: 90 }), 'watch'); assert.equal(Sim.kanbanStatus({ overdue: 4, onTimePct: 99 }), 'low'); assert.equal(Sim.kanbanStatus({ overdue: 0, onTimePct: 80 }), 'low');
});

test('kanban data point: simulated by default, pushable per value or as a group, validated', () => {
  const S = Sim.createState();
  for (let i = 0; i < 400; i++) Sim.step(S, 30);
  assert.ok(S.kanban.open >= 0 && S.kanban.open <= S.kanban.cards && S.kanban.onTimePct >= 40 && S.kanban.onTimePct <= 100);
  V.apply(S, 'kanban/overdue', '5'); V.apply(S, 'kanban/onTimePct', '81');
  assert.equal(S.live.kanban, true); const before = S.kanban.overdue;
  for (let i = 0; i < 50; i++) Sim.step(S, 30);
  assert.equal(S.kanban.overdue, before);                                       // once live the simulator leaves it alone
  assert.throws(() => V.apply(S, 'kanban/onTimePct', '120'), /out of range/);
  assert.throws(() => Ing.ingest(S, 'kanban', { onTimePct: 140 }), /between 0 and 100/);
  Ing.ingest(S, 'kanban', { open: 30, cards: 150 }); assert.equal(S.kanban.open, 30);
});

test('every route line is dynamic: carriers = in flight, idle lines dim, late routes turn red, hover shows the data', () => {
  const S = Sim.createState();
  const count = (str, rid) => (str.match(new RegExp('<mpath href="#rt-' + rid + '"/>', 'g')) || []).length;
  for (const id of Object.keys(S.seqflows)) { S.seqflows[id].active = 0; }
  let r = global.window.FFMap.render(S, ctx(S));
  assert.equal((r.flows.match(/animateMotion/g) || []).length, 0);                       // nothing in flight -> no carriers
  assert.ok(r.flows.includes('class="seq idle" d="M600,169 V182"'));                     // and the lines are dimmed
  S.seqflows.jvWB.active = 2; S.seqflows.eg_x = undefined; delete S.seqflows.eg_x;
  r = global.window.FFMap.render(S, ctx(S));
  assert.equal(count(r.flows, 'jv-wb'), 2);                                              // two carriers on JV -> Weld B
  assert.ok(r.flows.includes('class="seq" d="M200,169 V182" marker-end') || r.flows.includes('class="seq" d="M200,169 V182"'));
  assert.ok(r.flows.includes('class="seq idle" d="M287,169 V332 H200"'));                // JV -> Weld A still idle
  S.seqflows.jvWB.onTimePct = 60;
  r = global.window.FFMap.render(S, ctx(S));
  assert.ok(r.flows.includes('seq late')); assert.ok(r.flows.includes('JV \u2192 Weld B: 2 in flight')); assert.ok(r.nodes.includes('LATE'));
  S.seqflows.jvWB.active = 9;
  assert.equal(count(global.window.FFMap.render(S, ctx(S)).flows, 'jv-wb'), 3);          // at most 3 markers drawn per route
});

test('seqflows data point: simulated, validated, per-value endpoints', () => {
  const S = Sim.createState();
  for (let i = 0; i < 600; i++) Sim.step(S, 30);
  for (const id of Object.keys(S.seqflows)) { const f = S.seqflows[id]; assert.ok(Number.isInteger(f.active) && f.active >= 0 && f.active <= 4 && f.onTimePct >= 0 && f.onTimePct <= 100 && f.missions >= 0, id); }
  V.apply(S, 'seqflows/jvWB/active', '3'); V.apply(S, 'seqflows/jvWB/onTimePct', '88.5');
  assert.equal(S.live.seqflows, true); assert.equal(S.seqflows.jvWB.active, 3);
  for (let i = 0; i < 50; i++) Sim.step(S, 30);
  assert.equal(S.seqflows.jvWB.active, 3);                                               // live: the simulator leaves it alone
  assert.throws(() => V.apply(S, 'seqflows/jvWB/active', '2.5'), /whole number/);
  assert.throws(() => V.apply(S, 'seqflows/nope/active', '1'), /unknown flow "nope"/);
  assert.throws(() => Ing.ingest(S, 'seqflows', { jvB: { onTimePct: 120 } }), /between 0 and 100/);
  assert.throws(() => Ing.ingest(S, 'seqflows', { jvB: { active: 1 }, zz: { active: 1 } }), /unknown flow "zz"/);
  assert.equal(S.seqflows.jvB.active, Math.round(S.seqflows.jvB._a === undefined ? S.seqflows.jvB.active : S.seqflows.jvB.active));
  Ing.ingest(S, 'seqflows', { jvB: { active: 2, missions: 99 } }); assert.equal(S.seqflows.jvB.missions, 99);
});

test('the default 8 JV parts all render on the map (compact list mode) and the minute counters accumulate', () => {
  const S = Sim.createState();
  assert.equal(S.jvSites.length, 8);
  const r = global.window.FFMap.render(S, ctx(S));
  assert.equal((r.nodes.match(/class="nd jvt/g) || []).length, 8);
  // run-without-components: a non-critical part runs out while the line builds
  Sim.inject(S, 'missingPart'); Sim.step(S, 600);
  assert.ok(S.line.missing >= 1);
  assert.ok(S.line.runWithoutMin > 0);
});
