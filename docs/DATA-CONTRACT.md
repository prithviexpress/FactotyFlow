# Data contract

The dashboard renders one state object. Real data reaches it through **domains**. A domain flips from
*simulated* to *live* on its first valid message (see **Data sources** page in the UI). Send JSON to
`POST /api/ingest/<domain>` (or `/api/ingest/batch` with `[{domain, payload}]`), or let the REST/MQTT
adapters do it (configured per data point on the Interfaces page). Invalid payloads return `400 {error}` and change nothing.

Time values: `eta` = minutes from now, or `etaAt` = ISO-8601 timestamp (converted for you).
`shop` is one of `press | weld | paint | engine | bumper | assembly`.

| Domain | Payload | Notes |
|---|---|---|
| `build` | `{plan, actual, rate?}` | rate = vehicles/min |
| `line` | `{stopped, reason?, stops?, stoppedMin?}` | |
| `shops` | `{press:82, weld:78, paint:65, engine:68, bumper:42, stores:76, kitting:68}` | buffer %; a value may be `{buf, units?, hours?, cap?}` — `units` = vehicle sets in the buffer, `hours` overrides the computed hours, `cap` = buffer capacity in sets |
| `parts` | `[{id, name, loc, shop, stock, rate, inv?:{dock, stores, supermarket, lineside}, pending?:{ref, eta\|etaAt, qty}}]` | **replaces** the list. `rate` = pcs/min consumed. coverage = stock ÷ rate |
| `parts.item` | one part or an array | upsert by `id`; omitted fields keep their value; `pending:null` clears |
| `yard` | `{expected, arrived, docked, received, occupied, docks, g2d, turn}` | g2d / turn in minutes |
| `trucks` / `trucks.item` | `{id, supplier, material, status, dock?, schedAt?, arrivedAt?, dockedAt?, doneAt?}` | status: scheduled/arrived/docked/received |
| `transfers` | `[{id, onTime, total}]` or `[{id, q:[1,0,1,…]}]` | ids: `eng`, `bmp`, `milk`, `amr` |
| `lineside` / `lineside.item` | `{name, usable, safety, max?, icon?, pending?:{eta\|etaAt, qty}}` | |
| `amr` / `jv` | `{units:[{id, state, battery, route?, taskMin?}], routes:[{name, missions, onTimePct}], planned, misc?, chargers?, utilizationPct?}` | state: idle/busy/charging |
| `amr.unit` / `jv.unit` | one unit or an array | upsert by `id` (what an MQTT per-robot topic sends) |
| `quality` | `{rejected, quarantined, spf}` | spf = % |
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

## Hours of inventory (`#/inventory`, `GET /api/inventory`)

Hours at a position = pieces at that position ÷ consumption per hour (`rate` × 60).

* **Per-position stock** comes from `parts[].inv` (`dock`, `stores`, `supermarket`, `lineside`, all pcs). *Usable* stock = stores + supermarket + line-side;
  `stock` defaults to that sum. If a feed sends only `stock`, the part shows the total but no per-position split (cells show —).
* **Inbound** hours = `pending.qty` ÷ rate (material on the next truck).
* **Shop WIP** hours = buffer vehicle-sets ÷ line rate (vehicles per hour). Give `units` (or `hours`) per shop, otherwise `buf% × cap` is used.
* **Finished vehicles** hours = `units` ÷ (`shipRate` × 60).
* Status colours use targets defined in `public/sim.js` (`TARGET_H`: stores 3 h, supermarket 1.5 h, line-side 0.75 h, shop WIP 1 h). They are demo values, not plant policy: set your own.
