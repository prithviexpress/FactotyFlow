#!/usr/bin/env node
/*
 * Zero-dependency server for FactoryFlow.
 *   GET  /               -> dashboard (public/)
 *   GET  /api/state      -> current state snapshot (JSON)
 *   GET  /events         -> Server-Sent Events stream of state (1 Hz)
 *   POST /api/inject/:n  -> trigger a demo scenario (truckDelay|bumperJam|amrFault|jvDelay|shortage)
 *   POST /api/speed/:n   -> set simulation speed (sim-seconds per real second)
 *
 * Open the dashboard with ?source=server to render the server's stream instead of the in-browser sim.
 * To plug in real data, replace the `Sim.step(...)` call below with your own state builder
 * (same JSON shape) or have your MES/WMS/AMR systems push into `state`.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const Sim = require('./public/sim.js');

const PORT = process.env.PORT || 8080;
const ROOT = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

const state = Sim.createState();
const clients = new Set();

setInterval(() => {
  Sim.step(state, state.speed);               // 1 real second = state.speed sim seconds
  const msg = 'data: ' + JSON.stringify(state) + '\n\n';
  for (const res of clients) res.write(msg);
}, 1000);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('data: ' + JSON.stringify(state) + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(state));
  }
  let m;
  if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/inject\/(\w+)$/))) {
    Sim.inject(state, m[1]); res.writeHead(204); return res.end();
  }
  if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/speed\/(\d+)$/))) {
    state.speed = Math.min(600, Math.max(1, +m[1])); res.writeHead(204); return res.end();
  }
  let file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log('FactoryFlow control tower on http://localhost:' + PORT));
