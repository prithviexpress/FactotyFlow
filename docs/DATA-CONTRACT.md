# Data contract

**Best for real systems: one POST per source system** (`POST /api/source/<name>`). Define sources on the Interfaces page (name, token, which values it *owns*);
each post carries many values as one JSON object, nested keys are path segments (or use `"kpi/jis": 98.4` directly):

```bash
curl -X POST http://host:8080/api/source/mes -H "Authorization: Bearer $MES_TOKEN" -H "Content-Type: application/json" \
  -d '{"build":{"plan":920,"actual":766,"rate":1.9}, "kpi":{"jis":98.4}, "shops":{"press":{"buf":82},"bumper":{"buf":42}}, "line":{"stopped":0}}'
curl -X POST http://host:8080/api/source/wms -H "Authorization: Bearer $WMS_TOKEN" -H "Content-Type: application/json" \
  -d '{"parts":{"P-BMP-F":{"stock":28,"rate":1.27,"inbound":{"qty":160,"eta":25}}}, "lineside":{"bumper-b-h-lh":{"usable":42}}}'
```
* **All-or-nothing:** every value is validated first (unit, range, ownership); if any fails, nothing is applied and the response lists *all* problems. Applied posts are one consistent snapshot, counted once per domain.
* **Ownership:** a source may only write the prefixes it owns (`build`, `kpi/jis`, `shops/*/buf` …); anything else → `403`. A source's token does not work for other sources.
* **Health:** the Data sources page and `GET /api/health` (`posters`) show last post, posts, values per post, rejected count and last error per source; a source silent longer than its *stale after* (default the global `staleSec`) is flagged STALE.
* Send only what changed, or everything; there is no required cadence.
* Arrays are not accepted in a source post (use keyed objects: `{"parts":{"P1":{…}}}`); use `/api/ingest/<domain>` for list-style bulk loads.

**Simplest way in: one endpoint per value.** `POST /api/value/<path>` with the number as the body (`766`, or `{"value":766}`):

```bash
curl -X POST http://host:8080/api/value/build/actual      -H "Authorization: Bearer $INGEST_TOKEN" -d 766        # (vehicles)
curl -X POST http://host:8080/api/value/shops/press/buf   -H "Authorization: Bearer $INGEST_TOKEN" -d 82         # (%)
curl -X POST http://host:8080/api/values -H "Authorization: Bearer $INGEST_TOKEN" -d '{"build/actual":766,"yard/arrived":26}'   # many, all-or-nothing
curl http://host:8080/api/value/build/actual                                                                      # read back
```
Every pushable value (67 paths: unit, valid range, example, current value, live/sim status) is listed on the **Data points** page
and in `GET /api/values`. Values are validated: wrong unit/type, out of range, or not a whole number → `400` with the allowed range; an unknown id → `404` with the valid ids;
a domain set to *Simulated* on the Interfaces page → `409`. Paths with `{x}` take an id (a shop, JV name, part number, AMR unit …); unknown part / truck / AMR / line-side ids are created on first push.
The dashboard also shows calculated numbers (coverage, hours, percentages, counts…): those are **not** pushable; `GET /api/values` lists them with their formulas.
The per-domain JSON endpoints below remain available for bulk loads.

The dashboard renders one state object. Real data reaches it through **domains**. A domain flips from
*simulated* to *live* on its first valid message (see **Data sources** page in the UI). Send JSON to
`POST /api/ingest/<domain>` (or `/api/ingest/batch` with `[{domain, payload}]`), or let the REST/MQTT
adapters do it (configured per data point on the Interfaces page). Invalid payloads return `400 {error}` and change nothing.

Time values: `eta` = minutes from now, or `etaAt` = ISO-8601 timestamp (converted for you).
`shop` is one of `press | weld | paint | engine | bumper | assembly`.

| Domain | Payload | Notes |
|---|---|---|
| `build` | `{plan, actual, rate?}` | rate = vehicles/min |
| `build/lineA/plan, build/lineA/actual, build/lineB/…` (value endpoints) | vehicles | optional per-assembly-line counts; without them each line shows half of the total |
| `line` | `{stopped, reason?, stops?, stoppedMin?}` | |
| `shops` | `{press:82, weldA:79, weldB:74, paintA:66, paintB:62, engine:68, bumper:42}` (`weld` / `paint` alone set both lines) | buffer %; a value may be `{buf, units?, hours?, cap?}` — `units` = vehicle sets in the buffer, `hours` overrides the computed hours, `cap` = buffer capacity in sets |
| `parts` | `[{id, name, loc, shop, stock, rate, inv?:{dock, stores, supermarket, lineside}, pending?:{ref, eta\|etaAt, qty}}]` | **replaces** the list. `rate` = pcs/min consumed. coverage = stock ÷ rate |
| `parts.item` | one part or an array | upsert by `id`; omitted fields keep their value; `pending:null` clears |
| `yard` | `{expected, arrived, docked, received, occupied, docks, g2d, turn}` | g2d / turn in minutes |
| `trucks` / `trucks.item` | `{id, supplier, material, status, dock?, schedAt?, arrivedAt?, dockedAt?, doneAt?}` | status: scheduled/arrived/docked/received |
| `transfers` | `[{id, onTime, total}]` or `[{id, q:[1,0,1,…]}]` | ids: `eng`, `bmp`, `milk`, `amr` |
| `lineside` / `lineside.item` | `{name, usable, safety, max?, icon?, pending?:{eta\|etaAt, qty}}` | |
| `amr` / `jv` | `{units:[{id, state, battery, route?, taskMin?}], routes:[{name, missions, onTimePct}], planned, misc?, chargers?, utilizationPct?}` | state: idle/busy/charging |
| `amr.unit` / `jv.unit` | one unit or an array | upsert by `id` (what an MQTT per-robot topic sends) |
| `jvstock` | `{ "JV1": 72, "JV2": {buf:68, units?, hours?, cap?}, … }` | keyed by the JV names configured in Plant setup (case-insensitive); an unknown name is rejected with the list of configured names |
| `quality` | `{rejected, quarantined, spf}` | spf = % |
| `seqflows` | `{ jvB: {active, missions, onTimePct}, jvA, jvWB, jvWA, egB, egA, imB, imA, prWB, prWA }` | the dotted routes on the plant map: carriers (AMR / tow) in flight, missions today, on-time %. JV feeds Assembly B and A and Weld B and A; EGTM and IMM-A feed Assembly B and A; Press feeds Weld B and A. Per value: `seqflows/<flow>/active|missions|onTimePct`. Simulated until fed |
| `kanban` | `{cards, open, overdue, avgWaitMin, onTimePct}` | kanban pull signals: cards in the loop, signals open now, of which overdue, average wait (min), on-time rate (%). Drives the KANBAN TRANSFERS overlay on the plant map |
| `kpi` | `{jis, stockAcc}` | % |
| `finished` | `{onTime, shipOnTime, units?, shipRate?}` | % ; `units` = finished vehicles waiting, `shipRate` = vehicles/min dispatched (for hours of finished-vehicle inventory) |
| `deliveries` | `{total, onTime}` | |
| `event` | `{msg, lvl: info\|ok\|watch\|low}` | appends to the event log; does not flip a domain live |

## Things the feed must provide that a plain stock export does not

* **`rate` per part** — consumption pcs/min from the live VIN build sequence × BOM. The *line risk* panel is only as
  good as this number; a flat daily-usage average will hide shortages caused by a model-mix change.
* **`pending` per part** — the next inbound ASN/truck (ETA + qty), otherwise the next-action text cannot name a truck.
* **Stable `id`s** — parts, units and trucks are upserted by id.

## Freshness

`staleSec` (adapters.config.json, default 60). A domain with no message for longer is flagged **STALE** in the header
and keeps its last value (it is never silently re-simulated).

## Plant setup (names) — Interfaces page → *Plant setup*, or `plant` in `adapters.config.json`

```json
"plant": { "jvs": ["JV1","JV2","JV3","JV4"], "terms": { "bay":"Bay", "bays":"Bays", "atBay":"At bay", "motorpool":"Motorpool", "parking":"Truck parking", "jis":"JIS accuracy" } }
```
* `jvs` (1–6 unique names, ≤24 chars): one node on the plant map, one buffer-hours entry, one JV AMR route (`<name> → Assembly`) each. There are no central stores / kitting / supermarket positions.
* `terms`: wording used on the dashboard. Data field names do not change (`docked` = at bay, `docks` = number of bays, `yard` = truck parking, `finished` = motorpool).
* **JIS** = Just-In-Sequence (parts delivered in the exact order of the vehicles on the line). If your plant measures delivery *time windows* (JIT), set `terms.jis` to e.g. `JIT adherence` — and feed the matching measurement into `kpi.jis`.

## Hours of inventory (`#/inventory`, `GET /api/inventory`)

Hours at a position = pieces at that position ÷ consumption per hour (`rate` × 60). Flow: **inbound → bay → line-side**.

* **Per-position stock** comes from `parts[].inv` (`bay`, `lineside`, pcs; `dock` is accepted as an alias of `bay`). *Usable* stock = bay + line-side;
  `stock` defaults to that sum. If a feed sends only `stock`, the part shows the total but no per-position split (cells show —).
* **Inbound** hours = `pending.qty` ÷ rate (material on the next truck).
* **Shop and JV buffer** hours = buffer vehicle-sets ÷ line rate (vehicles per hour). Give `units` (or `hours`), otherwise `buf% × cap` is used.
* **Motorpool** hours = `finished.units` ÷ (`finished.shipRate` × 60).
* Status colours use targets in `public/sim.js` (`TARGET_H`: line-side 0.75 h, shop buffers 1 h, JV buffers 1 h). Demo values, not plant policy: set your own.

## Plant block layout (central flow)

The map mirrors the plant's block arrangement: a JV zone (one tile per JV), a truck-parking / bays block, EGTM, motorpool, IMM-A, shipment, one spare block, press A/B, weld A/B, paint A/B and assembly A/B.
The red dotted line is the **sequenced material flow**: JV, EGTM and IMM-A feed a bus that drops into assembly B from the top and runs down the gap between paint and assembly along a lane under assembly A and up into it with the same three drops (a mirror of B); JV also feeds weld B from the top and weld A from underneath (down the gap between weld and paint, along a lane under weld A, up into it: a mirror of B); the press feeds both weld lines.
Animated markers are the carriers (AMR = circle, tow truck = small train): one marker per carrier in flight on that route (`seqflows/<flow>/active`, at most 3 drawn), slower and red when the route is under 78% on time, and stopped when the line stops. A route with nothing in flight is dimmed; hovering a line shows its numbers.
Names, which blocks hold which widget (truck parking & bays / motorpool / shipment / none) and the carrier type (AMR or tow) of each source are set under **Interfaces -> Plant setup -> Plant layout** (`plant.slots` in the config).
The four unnamed light blocks (`plant.slots.<yard|top1|top2|top3>`) default to `bind: "none"` (placeholders). Truck parking & bays, motorpool and shipment are not in the plant drawing, so they appear in a separate LOGISTICS AREAS strip; assigning one to a block (`bind: yard | motorpool | shipment`) draws it there marked as an assumed position until `confirmed: true`.
Only the transfer statuses (EGTM = Engine -> Assembly, IMM-A = Bumper -> Assembly) and the JV AMR routes feed the flow colours; press -> weld has no data feed yet.

The two light overlays on the plant map (AMR fleet health, kanban transfer health) are bound with `plant.slots.<slot>.bind` = `amr` or `kanban` (defaults: kanban in the large block beside JV; AMR health across the two tall blocks at top right, which act as one when the second is unused). `plant.layoutVersion: 2` marks this arrangement; a config saved with the earlier default positions is swapped automatically once..
