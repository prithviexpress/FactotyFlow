# FactoryFlow — Automotive Logistics Control Tower

A live, interactive version of the control-tower dashboard (plant map, line risk, inbound trucks,
in-plant transfers, line-side stock, quality, AMR fleets). No dependencies, no build step.

## Run

```bash
node server.js            # http://localhost:8080  (server streams state over SSE)
# or just open public/index.html — the browser runs the same simulation locally
```

* `?source=server` — render the server's SSE stream instead of the in-browser sim
* `?speed=120` — start at a given sim speed (sim-seconds per real second; default 30)

## What's live

| Area | Behaviour |
|---|---|
| Today build / line stops | Vehicles build at line rate; a part reaching 0 stock stops the line until the truck arrives |
| Line risk (right) | Parts ranked by coverage = usable stock ÷ consumption rate; next action/owner derived from coverage |
| Plant map | Buffer %, JV status, flows (red/amber when a route is delayed, paused when the line stops) |
| Inbound / transfers / line-side / AMR / quality | Event-driven counters, rolling on-time windows, battery & charging model per AMR |
| Interaction | Click a shop tab or map node to filter/highlight; "Drill down" lists all parts; hover for tooltips & sparkline values |
| Demo scenarios | Footer buttons inject a truck delay, bumper slowdown, engine-mount shortage, AMR battery fault, JV C delay |

"Parts at risk" = coverage under 60 min (`RISK_MIN` in `public/sim.js`). Thresholds: buffer ≥66% normal, ≥50% watch;
line-side usable/safety ≥75% OK, ≥50% watch.

## Connecting real data

The UI (`public/app.js`) is a pure function of one JSON state object (shape: `createState()` in `public/sim.js`).
Replace the simulator with your feed: have `server.js` build that object from MES (build counts), WMS/ERP (stock, BOM,
consumption), yard/gate system (trucks), AMR fleet manager (robots, missions) and QMS (rejections), then keep
pushing it on `/events`. Set `demo:false` to switch the badge from DEMO DATA to LIVE.
