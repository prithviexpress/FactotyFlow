'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const Sim = require('../public/sim.js');
const AF = require('../adapters/alertfeeds.js');
const Cfg = require('../adapters/config.js');
const { createApp } = require('../server.js');

const WX = { current: { temperature_2m: 31.2, precipitation: 0.2, weather_code: 3, wind_gusts_10m: 38 }, hourly: { time: ['a', 'b', 'c', 'd'], precipitation: [0.2, 0.5, 12.4, 3], weather_code: [3, 61, 95, 80], wind_gusts_10m: [38, 45, 66, 40] } };

test('weather alerts are derived from thresholds and clear when conditions pass', () => {
  const r = AF.weatherAlerts(WX, { gustKmh: 60, rainMmH: 10 });
  assert.deepEqual(r.alerts.map((a) => a.id).sort(), ['weather:gust', 'weather:rain', 'weather:thunder']);
  assert.equal(r.alerts.find((a) => a.id === 'weather:thunder').level, 'watch');            // forecast, not now
  assert.match(r.alerts.find((a) => a.id === 'weather:thunder').title, /in about 2 h/);
  const now = JSON.parse(JSON.stringify(WX)); now.current.weather_code = 96;
  assert.equal(AF.weatherAlerts(now, {}).alerts.find((a) => a.id === 'weather:thunder').level, 'critical');   // now
  assert.deepEqual(AF.weatherAlerts({ current: { temperature_2m: 44, precipitation: 0, weather_code: 0, wind_gusts_10m: 3 }, hourly: { time: [] } }, {}).alerts.map((a) => a.id), ['weather:heat']);
  assert.throws(() => AF.weatherAlerts({ nope: 1 }, {}), /unexpected weather response/);
});

test('traffic incidents -> alerts, small delays ignored, worst first', () => {
  const r = AF.trafficAlerts({ incidents: [
    { properties: { id: 'a', iconCategory: 6, magnitudeOfDelay: 3, delay: 1320, roadNumbers: ['NH48'], from: 'Gate 2', to: 'Plant Rd', events: [{ description: 'Queuing traffic' }] } },
    { properties: { id: 'b', iconCategory: 9, magnitudeOfDelay: 1, delay: 60 } },
    { properties: { id: 'c', iconCategory: 8, magnitudeOfDelay: 4, delay: 0, roadNumbers: ['SH17'] } }] }, { minDelaySec: 300 });
  assert.deepEqual(r.alerts.map((a) => a.id), ['traffic:c', 'traffic:a']);                  // closed road first, small works dropped
  assert.equal(r.alerts[1].level, 'critical'); assert.match(r.alerts[1].msg, /\+22 min/);
});

test('reconcile raises, updates, escalates and clears provider alerts; push alerts expire', () => {
  const S = Sim.createState();
  Sim.reconcileAlerts(S, 'weather', [{ id: 'weather:gust', level: 'watch', title: 'Gust', kind: 'weather' }], 1000);
  Sim.reconcileAlerts(S, 'weather', [{ id: 'weather:gust', level: 'critical', title: 'Gust', kind: 'weather' }], 2000);
  assert.equal(S.alerts.length, 1); assert.equal(S.alerts[0].level, 'critical'); assert.equal(S.alerts[0].ts, 1000);
  Sim.raiseAlert(S, { id: 'p1', level: 'watch', title: 'Blockade', expiresMin: 1 }, 5000);
  Sim.pruneAlerts(S, 5000 + 61000);
  assert.deepEqual(S.alerts.map((a) => a.id), ['weather:gust']); assert.equal(S.alertLog[0].why, 'expired');
  Sim.reconcileAlerts(S, 'weather', [], 9000);
  assert.equal(S.alerts.length, 0);
});

test('alert config: needs plant location + key; secrets masked', () => {
  const bad = Cfg.validate(Cfg.normalize({ alerts: { weather: { enabled: true }, traffic: { enabled: true } } }));
  assert.ok(bad.some((e) => /latitude/.test(e)) && bad.some((e) => /API key/.test(e)));
  const ok = Cfg.normalize({ plant: { lat: 12.97, lon: 77.59 }, alerts: { weather: { enabled: true }, traffic: { enabled: true, key: 'k-123' }, feeds: [{ name: 'news', url: 'https://x/y', headers: { A: 'secret' } }] } });
  assert.deepEqual(Cfg.validate(ok), []);
  const m = Cfg.mask(ok);
  assert.equal(m.alerts.traffic.key, Cfg.MASK); assert.equal(m.alerts.feeds[0].headers.A, Cfg.MASK);
  assert.equal(Cfg.unmask(m, ok).alerts.traffic.key, 'k-123');
});

test('server: provider polling against stub endpoints, push alert API, logo upload, test-alert', async () => {
  const stub = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.startsWith('/wx') ? WX : req.url.startsWith('/tt') ? { incidents: [{ properties: { id: 'z', iconCategory: 6, magnitudeOfDelay: 3, delay: 900, roadNumbers: ['NH48'] } }] } : { data: [{ id: 1, headline: 'Port strike', sev: 'Severe' }] }));
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const su = 'http://127.0.0.1:' + stub.address().port;
  const app = createApp({ configFile: '', tickMs: 50, log() {}, token: 'tok', config: { plant: { lat: 12.97, lon: 77.59 },
    alerts: { weather: { enabled: true, url: su + '/wx', gustKmh: 60 }, traffic: { enabled: true, key: 'k', url: su + '/tt' }, feeds: [{ name: 'news', url: su + '/feed', root: 'data', fields: { id: 'id', title: 'headline', level: 'sev' } }] } } });
  const base = 'http://127.0.0.1:' + (await app.listen(0));
  await new Promise((r) => setTimeout(r, 600));
  const ids = app.state.alerts.map((a) => a.id).sort();
  assert.ok(ids.includes('weather:thunder') && ids.includes('traffic:z') && ids.includes('feed:news:1'), ids.join(','));
  assert.equal(app.state.weather, 31.2); assert.ok(app.state.weatherInfo.text);
  assert.equal(app.state.alerts.find((a) => a.id === 'feed:news:1').level, 'critical');

  const H = { Authorization: 'Bearer tok', 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/alert', { method: 'POST', body: '{}' })).status, 401);
  let r = await fetch(base + '/api/alert', { method: 'POST', headers: H, body: JSON.stringify({ level: 'critical', title: 'Fire drill at Gate 1', message: 'Evacuate yard', kind: 'security', expiresMin: 30, id: 'drill-1' }) });
  assert.equal(r.status, 200);
  assert.equal((await fetch(base + '/api/alert', { method: 'POST', headers: H, body: JSON.stringify({ level: 'huge', title: 'x' }) })).status, 400);
  assert.equal(app.state.alerts.find((a) => a.id === 'drill-1').kind, 'security');
  assert.equal((await fetch(base + '/api/alert/drill-1', { method: 'DELETE', headers: H })).status, 200);
  assert.equal((await fetch(base + '/api/alert/drill-1', { method: 'DELETE', headers: H })).status, 404);

  // dry-run test of a provider
  const t = await (await fetch(base + '/api/config/test-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'weather', spec: { url: su + '/wx', gustKmh: 60 } }) })).json();
  assert.equal(t.ok, true); assert.equal(t.alerts.length, 3);

  // logo: type + content are checked
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const up = (type, body) => fetch(base + '/api/logo', { method: 'POST', headers: { 'Content-Type': type }, body });
  assert.equal((await up('image/png', Buffer.from('not a png'))).status, 400);
  assert.equal((await up('text/html', '<b>')).status, 415);
  assert.equal((await up('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).status, 400);
  assert.equal((await up('image/png', png)).status, 200);
  const got = await fetch(base + '/logo'); assert.equal(got.status, 200); assert.equal(got.headers.get('content-type'), 'image/png');
  assert.match(got.headers.get('content-security-policy'), /sandbox/);
  assert.equal(app.state.branding.logo, true);
  assert.equal((await fetch(base + '/api/logo', { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(base + '/logo')).status, 404);
  await app.close(); stub.close();
});
