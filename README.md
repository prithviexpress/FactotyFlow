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

## Detail pages

Every panel, KPI tile and several map nodes link to a page (`#/parts`, `#/inbound`, `#/transfers`, `#/lineside`, `#/amr`,
`#/quality`, `#/shop/<press|weld|paint|engine|bumper|assembly>`, `#/events`, `#/sources`). `Esc` goes back.
Click a shop on the map to filter the risk table; click it again to open its page.

## Connecting real data

Three ways in, all feeding the same ingest layer (`adapters/ingest.js`, contract in `docs/DATA-CONTRACT.md`):

| Path | Use for | Setup |
|---|---|---|
| **Push** `POST /api/ingest/<domain>` | MES / WMS / middleware that can call a webhook | set `INGEST_TOKEN`, send JSON |
| **REST poller** | systems of record that only offer a GET API | `adapters.config.json` → `rest.pollers` |
| **MQTT subscriber** | AMR fleet (e.g. VDA 5050), gate/yard events, PLC gateways | `npm i` (mqtt is an optional dependency), `adapters.config.json` → `mqtt` |

```bash
cp adapters.config.example.json adapters.config.json   # edit URLs / topics, secrets via ${ENV_VARS}
INGEST_TOKEN=change-me node server.js
curl -X POST localhost:8080/api/ingest/build -H 'Authorization: Bearer change-me' -d '{"plan":920,"actual":412}'
```

Vendor payloads are translated by named **mappers** in `adapters/mappers.js` (`wms-stock` and `vda5050-state` are examples
to adapt, not tested against a real system). In live/mixed mode the clock is real time, simulation speed is locked to 1x and the
demo scenario buttons are disabled. Domains without a feed stay simulated (header shows MIXED DATA); a silent feed is flagged STALE.

Browser-only mode (no server) is always simulated; `?source=server` is required to see pushed data.

## Tests

`npm test` — ingest validation, auth, stale detection, topic matching, and an end-to-end run against an in-process MQTT broker (aedes).
