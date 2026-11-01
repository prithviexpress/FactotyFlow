'use strict';
// End-to-end: real MQTT broker (aedes, in-process) -> adapter -> state. Skipped if mqtt/aedes are not installed.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
let aedes, mqtt;
try { aedes = require('aedes'); mqtt = require('mqtt'); } catch (e) { /* optional */ }
const { createApp } = require('../server.js');

test('MQTT: VDA5050 state + plain domain messages reach the dashboard state', { skip: !aedes }, async () => {
  const A = aedes.Aedes || aedes.default || aedes;
  const broker = A.createBroker ? await A.createBroker() : new A();
  const srv = net.createServer(broker.handle);
  await new Promise((r) => srv.listen(0, r));
  const url = 'mqtt://127.0.0.1:' + srv.address().port;
  const app = createApp({ tickMs: 50, log() {}, config: { mqtt: { url, subscriptions: [
    { topic: 'uagv/v2/+/+/state', domain: 'amr.unit', mapper: 'vda5050-state' },
    { topic: 'plant01/line/status', domain: 'line' }] } } });
  await app.listen(0);
  const pub = mqtt.connect(url);
  await new Promise((r) => pub.on('connect', r));
  await new Promise((r) => setTimeout(r, 400));     // let adapter subscribe
  pub.publish('uagv/v2/acme/AGV-7/state', JSON.stringify({ serialNumber: 'AGV-7', batteryState: { batteryCharge: 41, charging: false }, driving: true }));
  pub.publish('plant01/line/status', JSON.stringify({ stopped: true, reason: 'Andon pulled', stops: 1 }));
  pub.publish('plant01/line/status', '{not json');   // must not crash
  await new Promise((r) => setTimeout(r, 500));
  const s = app.state;
  assert.equal(s.live.amr, true);
  assert.deepEqual(s.amr.amrs.map((a) => [a.id, a.s, a.b]), [['AGV-7', 'busy', 41]]);
  assert.equal(s.line.stopped, true); assert.equal(s.line.reason, 'Andon pulled');
  pub.end(true); await app.close(); srv.close(); broker.close();
});
