'use strict';
/*
 * Alert providers: turn an external response into the *complete* current list of alerts for that source.
 * - weather: Open-Meteo forecast (free, no key). Alerts are DERIVED from thresholds you set (it is a forecast API, not an official warning feed).
 * - traffic: TomTom Traffic Incidents (needs an API key). Parsing follows TomTom's incidentDetails v5 GeoJSON shape; verify against your account.
 * - feeds:   any JSON endpoint (security bulletins, government disaster feeds, an internal incident system) via root + field map.
 */
const { transform, getPath } = require('./transform');

const WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail' };
const wmoText = (c) => WMO[c] || 'Weather code ' + c;
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const DEFAULT_WEATHER = { gustKmh: 60, rainMmH: 10, tempHighC: 40, tempLowC: 0, lookaheadH: 3 };

/** Open-Meteo request URL for a plant location */
function weatherUrl(c) {
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(c.lat) + '&longitude=' + encodeURIComponent(c.lon) +
    '&current=temperature_2m,precipitation,weather_code,wind_gusts_10m&hourly=precipitation,weather_code,wind_gusts_10m&forecast_hours=6&timezone=auto';
}

/** json = Open-Meteo response -> { alerts, info } */
function weatherAlerts(json, cfg) {
  const t = Object.assign({}, DEFAULT_WEATHER, cfg || {});
  const cur = json && json.current;
  if (!cur || cur.temperature_2m === undefined) throw new Error('unexpected weather response (no "current" block)');
  const hr = json.hourly || {}, look = Math.max(1, num(t.lookaheadH, 3));
  const slots = [{ code: cur.weather_code, rain: num(cur.precipitation, 0), gust: num(cur.wind_gusts_10m, 0), in: 0 }];
  (hr.time || []).slice(0, Math.min(look + 1, (hr.time || []).length)).forEach((_, i) => {
    if (i === 0) return;
    slots.push({ code: (hr.weather_code || [])[i], rain: num((hr.precipitation || [])[i], 0), gust: num((hr.wind_gusts_10m || [])[i], 0), in: i });
  });
  const temp = num(cur.temperature_2m, 0), alerts = [];
  const when = (s) => (s.in === 0 ? 'now' : 'in about ' + s.in + ' h');
  const first = (pred) => slots.find(pred);

  const storm = first((s) => s.code >= 95);
  if (storm) alerts.push({ id: 'weather:thunder', level: storm.in === 0 ? 'critical' : 'watch', kind: 'weather', title: wmoText(storm.code) + ' ' + when(storm), msg: 'Secure open-air loads, pause yard moves and trailer unloading outdoors while it lasts.' });
  const rain = first((s) => s.rain >= t.rainMmH);
  if (rain) { const heavy = rain.rain >= 2 * t.rainMmH; alerts.push({ id: 'weather:rain', level: heavy ? 'critical' : 'watch', kind: 'weather', title: 'Heavy rain ' + when(rain) + ' (' + rain.rain.toFixed(1) + ' mm/h)', msg: 'Expect slower truck turnaround and wet-floor risk at the bays.' }); }
  const gust = first((s) => s.gust >= t.gustKmh);
  if (gust) alerts.push({ id: 'weather:gust', level: gust.gust >= 1.5 * t.gustKmh ? 'critical' : 'watch', kind: 'weather', title: 'Strong wind ' + when(gust) + ' (gusts ' + Math.round(gust.gust) + ' km/h)', msg: 'Check crane / forklift limits and loose outdoor stock.' });
  if (temp >= t.tempHighC) alerts.push({ id: 'weather:heat', level: temp >= t.tempHighC + 5 ? 'critical' : 'watch', kind: 'weather', title: 'High temperature ' + temp.toFixed(1) + '°C', msg: 'Heat stress risk for yard and dock staff; AMR batteries may derate.' });
  if (temp <= t.tempLowC) alerts.push({ id: 'weather:cold', level: 'watch', kind: 'weather', title: 'Low temperature ' + temp.toFixed(1) + '°C', msg: 'Ice risk on approach roads and in the yard.' });
  const fog = first((s) => s.code === 45 || s.code === 48);
  if (fog) alerts.push({ id: 'weather:fog', level: 'watch', kind: 'weather', title: 'Fog ' + when(fog), msg: 'Low visibility on approach roads; inbound trucks may be late.' });

  const worst = alerts.find((a) => a.level === 'critical') || alerts[0];
  const text = wmoText(cur.weather_code);
  const icon = storm || (cur.weather_code >= 51 && cur.weather_code <= 99) ? 'storm' : 'sun';
  return { alerts, info: { temp, text: worst ? worst.title.replace(/ \(.*/, '') : text, icon: worst ? 'storm' : icon, detail: text + ' · gusts ' + Math.round(num(cur.wind_gusts_10m, 0)) + ' km/h · rain ' + num(cur.precipitation, 0).toFixed(1) + ' mm' } };
}

/** TomTom Traffic Incidents request URL: a box of +-radiusKm around the plant */
function trafficUrl(c) {
  const dLat = c.radiusKm / 111, dLon = c.radiusKm / (111 * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180)));
  const bbox = [c.lon - dLon, c.lat - dLat, c.lon + dLon, c.lat + dLat].map((x) => x.toFixed(5)).join(',');
  const fields = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity}}}';
  return 'https://api.tomtom.com/traffic/services/5/incidentDetails?key=' + encodeURIComponent(c.key) + '&bbox=' + bbox + '&fields=' + encodeURIComponent(fields) + '&language=en-GB&timeValidityFilter=present';
}
const TT_CAT = { 0: 'Incident', 1: 'Accident', 2: 'Fog', 3: 'Dangerous conditions', 4: 'Rain', 5: 'Ice', 6: 'Traffic jam', 7: 'Lane closed', 8: 'Road closed', 9: 'Road works', 10: 'Wind', 11: 'Flooding', 14: 'Broken-down vehicle' };

/** json = TomTom incidentDetails response -> { alerts } (largest delays first, at most 5) */
function trafficAlerts(json, cfg) {
  const minDelay = num(cfg && cfg.minDelaySec, 300);
  const list = (json && json.incidents) || (json && json.features) || null;
  if (!Array.isArray(list)) throw new Error('unexpected traffic response (no "incidents" list)');
  const out = list.map((it) => {
    const p = it.properties || it, ev = (p.events && p.events[0]) || {};
    const delay = num(p.delay, 0), mag = num(p.magnitudeOfDelay, 0), closed = mag === 4 || ev.iconCategory === 8 || p.iconCategory === 8;
    return { p, ev, delay, mag, closed, cat: TT_CAT[p.iconCategory] || TT_CAT[ev.iconCategory] || 'Incident' };
  }).filter((x) => x.closed || x.delay >= minDelay || x.mag >= 3)
    .sort((a, b) => (b.closed - a.closed) || b.delay - a.delay).slice(0, 5)
    .map((x) => {
      const road = (x.p.roadNumbers && x.p.roadNumbers[0]) || x.p.from || 'approach road';
      const lvl = x.closed || x.mag >= 3 || x.delay >= 900 ? 'critical' : 'watch';
      return { id: 'traffic:' + (x.p.id || (road + ':' + x.cat)), level: lvl, kind: 'traffic', title: x.cat + ' on ' + road + (x.p.to && x.p.from ? ' (' + x.p.from + ' → ' + x.p.to + ')' : ''),
        msg: (x.delay ? '+' + Math.round(x.delay / 60) + ' min delay. ' : '') + (x.closed ? 'Road closed. ' : '') + (x.ev.description || '') + (x.p.length ? ' Length ' + Math.round(x.p.length) + ' m.' : '') + ' Inbound trucks on this route may be late.' };
    });
  return { alerts: out };
}

/** Any JSON feed. spec: { root, fields: { id, title, msg, level }, kind } -> alerts */
function feedAlerts(json, spec) {
  const items = transform(json, { root: spec.root, fields: spec.fields });
  const arr = Array.isArray(items) ? items : [items];
  const lvl = (v) => { const s = String(v === undefined ? '' : v).toLowerCase(); return /crit|severe|extreme|red|high|emerg/.test(s) ? 'critical' : /info|low|minor|green|none|test/.test(s) ? 'info' : 'watch'; };
  return { alerts: arr.filter((x) => x && (x.title || x.msg)).slice(0, 20).map((x, i) => ({ id: 'feed:' + (spec.name || 'feed') + ':' + (x.id !== undefined ? x.id : i), level: lvl(x.level), kind: spec.kind || 'event', title: String(x.title || x.msg).slice(0, 120), msg: String(x.msg || '').slice(0, 400) })) };
}

module.exports = { weatherAlerts, weatherUrl, trafficAlerts, trafficUrl, feedAlerts, wmoText, DEFAULT_WEATHER, getPath };
