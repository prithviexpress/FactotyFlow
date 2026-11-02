# FactoryFlow — Automotive Logistics Control Tower

A live, interactive version of the control-tower dashboard (plant map, line risk, inbound trucks,
in-plant transfers, line-side stock, quality, AMR fleets). No dependencies, no build step.

## Plant layout (central flow)

The plant map is a block layout like the plant sketch (JV zone with a tile per JV, truck parking & bays, EGTM, motorpool, IMM-A, shipment, press A/B, weld A/B, paint A/B, assembly A/B).
Red dotted lines are the sequenced material flows (JV, EGTM and IMM-A into assembly; press into weld) with animated AMR / tow-truck carriers. Block names, what the light blocks show and the carrier type are editable under **Interfaces -> Plant setup -> Plant layout**.
Blocks are flat cards with a status accent on the left edge. **Only the blocks named in the plant drawing are positioned.** The four unnamed light blocks stay placeholders, and truck parking & bays, motorpool and shipment are shown in a separate, dashed *LOGISTICS AREAS (not positioned)* strip, because they are not in the drawing. To put one into a block, assign it under Interfaces -> Plant setup -> Plant layout; it is then marked ASSUMED POSITION until you tick *confirmed*. EGTM / IMM-A use the engine / bumper shop data (see their tooltips). JV, EGTM and IMM-A material reaches assembly B with three drops from the top, and assembly A by going down the gap between paint and assembly, along a lane under A and up into it with the same three drops (a mirror of B).
The vacant top blocks carry two **movement-health overlays**, drawn as transparent instrument panels (cyan hairline, header band, mono numerals, tagged OVERLAY) so they cannot be mistaken for shops: **AMR fleet health** (indoor + JV: idle / busy / charging, battery, low-battery units, late routes, utilisation) and **kanban transfer health** (on-time %, open and overdue pull signals, average wait, and a lane per key line-side material). Kanban has its own data point (`kanban/cards|open|overdue|avgWaitMin|onTimePct`); until it is fed it is simulated. Either overlay can be moved or removed under Interfaces -> Plant layout.
Weld and paint are now two lines each (`weldA`, `weldB`, `paintA`, `paintB`); assembly shows lines A and B (pushed per line, or half of the total).

## Look & feel, logo, alerts

* **Red glow:** any tile, panel or map node with a problem gets a pulsing red outline; hover a KPI tile to see why. Rules: line stopped or logistics stops today; any part under 30 min of cover; 6+ trucks waiting for a bay or all bays full; internal deliveries on time < 85%; JIS < 95%; gate-to-bay > 45 min; stock accuracy < 95%; a delayed transfer route; LOW line-side stock; single-piece flow < 90%; a late AMR route or 3+ low-battery AMRs; any shop/JV/motorpool node in the red. Thresholds are in `problems()` in `public/app.js`.
* **Dark / light theme:** the sun/moon button in the top bar (remembered per browser).
* **Logo:** click the logo box in the top bar (or **Interfaces → Branding → Browse**). PNG, JPG, SVG, WEBP or GIF, max 1 MB. With the server it is stored next to the config file and shown on every screen; without a server it is kept in that browser only.
* **Top bar:** no DEMO badge. MIXED DATA / LIVE / STALE badges still appear when real feeds are connected; the footer says "Simulated data" while everything is simulated.
* **Alerts (weather, traffic, unusual events):** the bell in the top bar, a bar under it for unacknowledged WATCH / CRITICAL alerts, and `#/alerts`. Sources, set under **Interfaces → Alerts & weather**:
  * *Weather*: Open-Meteo (free, no key) at the plant's latitude/longitude; alerts are **derived from your thresholds** (thunderstorm, heavy rain, strong gusts, heat, cold, fog). It is a forecast service, not an official warning feed.
  * *Traffic*: TomTom Traffic Incidents around the plant (needs your API key). Closed roads and delays over your minimum raise alerts. Written from TomTom's documented response shape; not tested against a live key.
  * *Event feeds*: any JSON URL (security bulletin, disaster feed, internal incident system) with a root path and field map.
  * *Other systems*: `POST /api/alert` with `{"level":"critical","title":"…","message":"…","kind":"security","expiresMin":30}` (same token as the other push endpoints); `DELETE /api/alert/<id>` clears one.
  * A provider that fails 3 times in a row raises its own "alert source unreachable" alert, so silence never looks like "all clear".

## Do I need Node.js?

| What you want | Needs Node? |
|---|---|
| Look at the dashboard and all detail pages with **simulated** data | **No.** Open `public/index.html` in a browser (works from a file, no install). |
| Receive real data (push endpoints, source posts, REST/MQTT feeds), the **Interfaces** and **Data points** pages, config saved to disk | **Yes.** All of that is `server.js`. |

Node 18 or newer is required (the code uses built-in `fetch`; I have only run it on Node 22). The server has **no npm dependencies** to install; `mqtt` is optional and only needed for MQTT feeds.
If you cannot install Node on the machine: download the *portable* build (zip / tar.xz) from nodejs.org, unpack it anywhere, and run it directly (no admin rights, nothing installed), e.g. `node-v22.x-win-x64\node.exe server.js`.

## Run

```bash
node server.js            # http://localhost:8080  (server streams state over SSE)
# or just open public/index.html — the browser runs the same simulation locally
```

* served by `node server.js` the page uses the server automatically; `?source=local` forces the in-browser sim
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

Plant names (JV1…JV6 list, *bay*, *motorpool*, *truck parking*, KPI wording) are set under **Interfaces → Plant setup**.
Every panel, KPI tile and several map nodes link to a page (`#/parts`, `#/inventory` (hours of inventory at every position, CSV export, `GET /api/inventory`), `#/inbound`, `#/transfers`, `#/lineside`, `#/amr`,
`#/quality`, `#/shop/<press|weld|paint|engine|bumper|assembly>`, `#/events`, `#/sources`). `Esc` goes back.
Click a shop on the map to filter the risk table; click it again to open its page.

## Connecting real data — the Interfaces page

Run `node server.js`, open `http://localhost:8080` (the page auto-detects the server) and go to **⚙ Interfaces** (`#/settings`).
Every data point on the dashboard is one row:

1. choose a source: **Simulated**, **Push (webhook)**, **REST poll** or **MQTT subscribe**;
2. enter the endpoint (URL + interval + headers, or MQTT topic). If your vendor's JSON differs from the dashboard's, set a *root path* and a
   *field map* (e.g. `{"id":"material","stock":"onHand","rate":{"path":"hourlyUsage","div":60}}`) or pick a named mapper;
3. **Test** calls the real endpoint (or waits for an MQTT message) and shows the raw response, the mapped result, and whether the dashboard accepts it;
4. **Save & apply** writes `adapters.config.json` and hot-reloads the feeds. Status chips show LIVE / STALE / ERROR per row; rows set back to Simulated get fresh demo data.

Security: the config API is **localhost-only** unless `ADMIN_TOKEN` is set (then send it as a bearer token; the page asks for it). It makes the server fetch
URLs you type, so never expose it unauthenticated. Secrets typed into the page are stored in `adapters.config.json` (mode 600, git-ignored) and are never
sent back to the browser; prefer `${ENV_VAR}` references. Push ingest is separately protected by `INGEST_TOKEN`.

**One POST per source system (recommended):** define `mes`, `wms`, `fleet`… under **Interfaces → Sources** (own token, the values it owns); each posts many values at once to `POST /api/source/<name>`, applied all-or-nothing, with per-source health. The Payload template button writes the exact JSON (with units and examples) for what a source owns.

**One endpoint per value:** every pushable number has its own path, e.g. `POST /api/value/build/actual` with body `766` (see the **Data points** page, `#/datapoints`, or `GET /api/values`: unit, valid range, example, current value). Calculated numbers are listed there too and cannot be pushed.

Other ways in: `POST /api/ingest/<domain>` (see `docs/DATA-CONTRACT.md`), or edit `adapters.config.json` by hand (`adapters.config.example.json`).
Browser-only mode (opening `public/index.html` as a file, or `?source=local`) is always simulated and cannot store endpoints.

In live/mixed mode the clock is real time, simulation speed is locked to 1x and the demo buttons are disabled; a silent feed is flagged STALE.
`wms-stock` and `vda5050-state` mappers are examples to adapt, not tested against a real system.

## Tests

`npm test` — ingest validation, auth, stale detection, field mapping, the Interfaces API (save → poll → live, test, mask, hand-back-to-sim, admin gate) and an end-to-end run against an in-process MQTT broker (aedes).
