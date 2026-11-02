# BOMs, sequence, stock and how the KPIs follow from them

**Status: not built yet.** Today the dashboard takes a *consumption rate per part* (`parts/<id>/rate`) as a number you push. It does not hold a BOM and does not read a build sequence.
Everything below is the data you would need so the numbers can be **calculated** instead of pushed. Templates are in `docs/templates/`.

## The five datasets (and how often they change)

| Dataset | What it is | Changes | Best way in |
|---|---|---|---|
| **BOM master** (`bom.csv`) | which parts, how many per vehicle, per shop / line / station, from which source | rarely (ECN, new model) | **file upload** (CSV / XLSX) with validation, preview and a version history |
| **Build sequence** (`vehicle_sequence.csv`) | the vehicles about to be built, in order, with their variant | every minute | read-only feed from MES (REST push, or a read-only DB view) |
| **Stock** (`stock.csv`) | pieces per part per position (inbound, bay, line-side, JV) and quality status | every few minutes | WMS feed / read-only DB view |
| **Inbound** (`inbound_asn.csv`) | trucks and ASNs: what is coming, when | minutes | gate / ASN feed |
| **Delivery events** (`delivery_events.csv`) | each sequenced delivery: called, due, delivered, sequence expected vs actual | continuous | MES / fleet manager; needed for JIS accuracy |

## Columns to consider

**BOM master.** `plant, shop, line (A/B/both), station, model, variant_code (ALL or a trim / colour / drive-side / powertrain code), part_no, part_desc, rev, ecn_no, qty_per_vehicle, uom,
supply_type (JIS | KANBAN | BULK | MILKRUN), source_type (JV | SUPPLIER | INTERNAL), source_name (JV1, press, supplier), dest_shop, dest_line, pack_qty, container_type, lineside_loc,
min_qty (safety), max_qty, lead_time_min, critical (Y/N), status (ACTIVE | PENDING | OBSOLETE), valid_from, valid_to`.
*Why the awkward ones matter:* `variant_code` makes consumption depend on the mix (a high-trim harness is not used by every vehicle); `rev` + `valid_from` stop an engineering change from being applied on the wrong day;
`dest_shop/dest_line` tells the map which dotted route a part travels (JV to weld B, JV to assembly A, ...); `lead_time_min` is what turns coverage into "must be ordered by".

**Build sequence.** `vin, seq_no, line, model, variant_code, trim, colour, drive_side, powertrain, plan_ts, actual_start_ts, status (PLANNED | IN_PROGRESS | BUILT | SCRAPPED), current_shop`.

**Stock.** `part_no, location_type (INBOUND | BAY | LINESIDE | JV), location_id, qty, quality_status (OK | QUARANTINE | BLOCKED), as_of_ts`. Only `OK` counts as usable.

**Inbound.** `asn_no, truck_id, supplier, part_no, qty, eta_ts, status (EN_ROUTE | AT_BAY | RECEIVED), bay`.

**Delivery events.** `delivery_id, vin, part_no, source_name, dest_shop, dest_line, called_ts, due_ts, delivered_ts, seq_expected, seq_actual, result (OK | LATE | WRONG | MISSING)`.

## What then calculates itself

With the BOM, the sequence and the stock, per part per shop:

* **Consumption over the next N minutes** = sum of `qty_per_vehicle` over the *next vehicles in the sequence whose variant uses the part* (not an average rate).
* **Coverage (min)** = usable stock at line-side + bay ÷ that consumption rate; the dashboard's *earliest shortage*, *parts at risk*, next action and owner follow from it.
* **Hours of inventory** at each position = pieces at the position ÷ consumption per hour.
* **Line-side status** = usable ÷ `min_qty` (the current LOW / WATCH / OK rule).
* **JIS accuracy** = deliveries with `result = OK` ÷ all sequenced deliveries in the window; **on-time %** per route = `delivered_ts <= due_ts`.
* **Shop-wise BOM status**: a BOM line is *short* when coverage is below its `lead_time_min`, *at risk* below 2x, else *OK*; a shop's status is its worst critical line.

What stays an input: build counts, line stops, quality counts, AMR and kanban numbers.

## Database or upload?

* **BOM master: upload.** It is small, versioned and reviewed; a file with validation and a diff is safer than a live link.
* **Stock, sequence, inbound, events: a read-only connection** (REST from the system, or a SQL view on a replica). Read-only account, a view that returns exactly the columns above, a timeout, and a poll every 10-60 s. Do not point the dashboard at the transactional tables.
* Inside the app a small embedded database (SQLite) is enough for the BOM history and the computed results.

## Decisions I need from you

1. Where does the BOM live today: ERP, PLM or Excel? Does it carry variant codes, or only one BOM per model?
2. Which system knows the build sequence, and how far ahead (the next 2 hours, a full shift)?
3. Is stock split by position in the WMS, or only totals?
4. How does your plant define JIS accuracy: per vehicle or per part?
