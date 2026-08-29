# AI-Powered Automotive Smart Factory Digital Twin

A deterministic, event-driven simulation of one automotive production line — from
inbound material through pressing, welding, paint, assembly, a vision-based
quality gate, rework and scrap, to loaded and delivered shipments.

The engine is the foundation of the wider digital-twin platform. It is built
first, and verified on its own, so that the command centre, the 3D scene, the
copilot and the optimisation layer all read one authoritative operational model
instead of inventing their own numbers.

## Run

The system is two processes: the engine host, and the command centre that reads
from it.

```powershell
npm install
npm run server            # engine + REST/WebSocket on http://localhost:4000
```

```powershell
cd web
npm install
npm run dev               # command centre on http://localhost:3000
```

Open <http://localhost:3000>, pick a scenario and press Run. The command centre
holds no factory state of its own — with the host stopped it says so instead of
showing the last frame as if it were current.

For a run without the UI:

```powershell
npm test
npm run typecheck
npm run lint

npm run scenario                          # baseline, 240 ticks
npm run scenario -- quality_failure       # one disruption
npm run scenario -- --compare --ticks=300 # every scenario against the baseline
npm run scenario -- machine_failure --json --ticks=200
```

Scenarios: `normal`, `machine_failure`, `material_shortage`, `quality_failure`,
`demand_surge`, `line_stop`.

One tick is one minute of plant time, so the configured 480-tick shift is eight
hours and the 8-tick takt is eight minutes per vehicle.

## What the model actually does

**Route.** `PRESS-01 → WELD-04 → PAINT-01 → ASSEMBLY-01 → FINAL-QC`, with
`REWORK-01` off the main route. Final assembly is the slowest operation, so the
line has a genuine constraint to find rather than a scripted one.

**Flow.** Every station has a finite input buffer, so a full downstream buffer
`BLOCKED`s the station upstream and an empty one `STARVED`s the station
downstream. Work orders are released only when they are planned, material-
feasible and within the CONWIP cap, which is what keeps WIP bounded.

**Materials.** Lots arrive on a schedule, pass or fail incoming QC, and are
pulled to line side by AGVs on kanban signals — a bin below its reorder point
raises a move task, an AGV drives, loads, drives and unloads it. Lots are issued
FIFO, or FEFO where the material has a shelf life (paint). Every unit records the
lot IDs it consumed, so traceability runs from a delivered vehicle back to an
inbound delivery.

**Quality.** A process defect is created silently, because it is physical truth.
The factory only learns about it when an inspection finds it, and inspections
have finite recall and a false-positive rate. A weld defect missed by the body
camera can still be caught at the final gate — or escape to the customer, which
the KPI set reports separately. A rejected unit returns to the station that
rejected it after rework, and is scrapped after the configured rework limit.

**Failures.** Machines break down stochastically while running and resume the
interrupted operation after repair. Scenarios add scheduled breakdowns on top.

**Constraint detection.** Utilisation alone never flags a bottleneck. A station
is reported as the constraint when it is the line's busiest resource over the
analysis window _and_ work is waiting or piling up in front of it or its
operations have slowed — or when it has stopped with a backlog.

**Determinism.** All randomness comes from one seeded generator, and disruptions
are scheduled events rather than branches in the engine. Baseline and what-if
runs therefore share a single code path, so a difference in the KPI output is
attributable to the disruption instead of to run-to-run noise.

## Verified guarantees

Enforced by `npm test` (73 engine tests) and `npm test` inside `web/`
(18 tests over the scene and colour logic):

- The same seed replays to a byte-identical state, event log and KPI set; a
  different seed does not.
- Inventory is never negative, buffers never overflow, WIP never exceeds its cap,
  and a unit is never in two places at once — checked on every tick.
- The event log is append-only, uniquely identified and ordered in time.
- Only units that passed the final gate can ship.
- Units follow the approved route; rework returns them to the rejecting station.
- Every consumed lot traces to a received lot; quarantined lots are never issued.
- `OEE = availability × performance × quality`, and first-pass yield, rework rate
  and scrap rate partition every unit that left the line.
- Each disruption has a measurable, directional effect against the baseline.
- Every station's time ledger (running, starved, blocked, idle, down) sums to
  exactly the elapsed time — the property every loss attribution rests on.
- No analysis cites an entity that is not in the run, and asking a question
  never changes the factory.

## An honest result worth reading

Over a 300-minute run the baseline builds 46 vehicles. A 24-minute stop at
welding costs four of them; a 40-minute stop of the _whole_ line costs seven,
for 226 minutes of recorded downtime against 52. Duration alone does not
predict the loss — where the stop lands does. Adding demand costs nothing at all
in output, because demand is not capacity; it shows up as schedule risk instead.
The model exists to make those distinctions visible, because they are the
distinctions a plant manager is paid to act on.

## Layout

| File                | Role                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `src/domain.ts`     | Entity shapes, state machines, event vocabulary, KPI contract          |
| `src/factory.ts`    | Seed master data: stations, materials, work orders, layout             |
| `src/scenarios.ts`  | Disruptions as declarative schedules                                   |
| `src/rng.ts`        | Seeded PRNG behind every stochastic decision                           |
| `src/state.ts`      | Runtime state, event/alert emission, lot-accurate inventory            |
| `src/engine.ts`     | The tick: scenarios, health, supply, release, AGVs, stations, shipping |
| `src/metrics.ts`    | KPI projection and constraint detection                                |
| `src/simulation.ts` | Batch runs and scenario comparison                                     |
| `src/cli.ts`        | Terminal inspector                                                     |

## The command centre

One screen, one authoritative source. Every panel renders from the same frame,
so two panels can never disagree about the state of the plant. The rules it is
built to:

- **The UI never invents health.** Colour and wording come from one lookup table
  keyed on states the engine published; the dashboard is not allowed to decide
  something looks bad.
- **Colour is never the only signal.** Every status is a dot _and_ a word.
- **"Live" has to be earned.** The badge reads LIVE only when a frame actually
  arrived recently; otherwise PAUSED, STALE or RECONNECTING.
- **Motion means change.** Bars move because an operation is progressing;
  nothing pulses for effect, and `prefers-reduced-motion` is honoured.

Design tokens (dark industrial palette, Fira Sans/Fira Code, dashboard density)
come from `design-system/factory-command-center/MASTER.md`.

### The viewport: schematic and 3D

The primary viewport has two readings of the same frame, switched in its header.

The **schematic** is a flat line diagram — buffers as slots, stations as cells,
the rework branch below. It is the faster read for buffer pressure and blocking.

The **3D factory** is a React Three Fiber scene of the plant floor: zones,
the transfer line, machine bodies with a status beacon and an operation progress
bar, robot arms that sweep only while their station is running, inspection
cameras over the gates with the volume they cover, vehicle bodies in buffer slots
and on machines, AGVs driving the aisle, and carriers loading in the yard.
Orbit, zoom and pan freely, or jump to a named viewpoint — Press, Body shop,
Paint, Assembly, Quality gate, Rework, Shipping. Clicking a machine or a body
opens the same detail panel the boards open.

Two rules govern the scene:

- **Nothing is placed where the twin has not put it.** Positions come from
  `StationConfig.position`, the location table, machine queues and `Agv.progress`
  — never from scene-side guesswork. `web/src/lib/scene-layout.ts` is the whole
  mapping, and it is unit-tested.
- **Motion is interpolation, not prediction.** A body eases toward the position
  the latest frame reports so travel reads as travel; it never moves toward a
  state the factory has not published. Under `prefers-reduced-motion` the easing
  and camera transitions are dropped and objects snap to their reported place.

Three.js is loaded on demand, so the first paint of the command centre does not
carry the 3D bundle.

## Analytics and the copilot

The copilot answers questions about the plant in Turkish or English, from the
run's own record. Ask it "En büyük darboğaz nerede?" or "Where did the OEE time
go?" and it routes the question to a deterministic analysis and shows you the
evidence that analysis rests on.

**It is not a language model, and it does not pretend to be one.** The split is
the point:

- `src/analytics.ts` is arithmetic over the published state and the event log.
  Nothing in it is estimated, modelled or phrased — every figure traces back to
  a machine record or an event ID.
- `src/copilot.ts` decides _which_ analysis answers a question. It never
  computes a number and never answers from anything but the analysis it routed
  to.

That boundary is also the upgrade path. A model can replace the intent step and
rephrase the output, and the answers stay exactly as true as they are today,
because the model still would not be the thing doing the counting.

Three behaviours are deliberate:

- **A question outside the data is refused**, not improvised. It says so and
  lists what it can answer.
- **Recommendations are offered, never executed.** When the copilot proposes a
  scenario, it renders a button. A human presses it or nothing happens.
- **The question is data, not instruction.** It is matched against a fixed
  keyword table; there is no path from question text to a command. A test asks
  it to "delete every work order" and asserts the factory is unchanged.

What it will answer: the line's constraint and what would _not_ help it; where
the constraint's time went; whether the line is meeting takt and which work
orders cannot finish; which machines carry the most observed failure risk;
defect Pareto, gate performance and escapes; material shortages and line-side
cover; shipment timeliness; the full genealogy of one unit by its ID; and the
current plant status.

## Raporlar

İki belge, aynı koşu kaydından üretilir; ikisi de Türkçedir.

**Excel — üretim analizi.** Panonun ekran görüntüsü değil, çalışılabilir veri.
Her rakam gerçek sayı ve Excel sayı biçimiyle yazılır (`0.0%` kodunu Türkçe
Excel kendisi `%94,7` diye gösterir), pay ve kümülatif sütunları **canlı
formül**dür, her sayfada donmuş başlık ve otomatik filtre vardır. On sayfa:
Özet, İstasyonlar, Kalite (Pareto + kapı performansı), İş Emirleri, Sevkiyat,
Stok, Araçlar, Alarmlar, Bakım Riski ve tam Olay Kaydı — sonuncusu pivot tablo
kurmak için ham veridir.

**PDF — vardiya durum raporu.** Tek sayfa, yazdırılıp panoya asılmak üzere.
Bir vardiya amirinin devir teslimde sorduğu dört soruyu cevaplar: ne kadar
ürettik, bizi ne tutuyor, ne açık, siparişler yetişir mi. Sıralama ve pivot
isteyen her şey Excel'e aittir.

```powershell
npm run report                                  # normal senaryo, 300 dk
npm run report -- quality_failure --ticks=480   # başka senaryo ve ufuk
npm run report -- machine_failure --out=C:
aporlar
```

Komuta merkezinde üst bardaki **Excel** ve **PDF** düğmeleri, o anki canlı
koşudan aynı belgeleri indirir.

Yazı tipleri `assets/fonts/` altında depoya dahildir (Fira Sans, SIL OFL).
PDFKit'in gömülü yazı tipleri WinAnsi kodlamasını kullanır ve içinde `ş`, `ğ`,
`İ`, `ı` yoktur — Türkçe bir rapor onlarla bozuk çıkar.

### API

| Method | Path                | Purpose                                             |
| ------ | ------------------- | --------------------------------------------------- |
| GET    | `/api/health`       | Host liveness and clock                             |
| GET    | `/api/config`       | Master data: stations, materials, orders, scenarios |
| GET    | `/api/frame`        | Current read model (`?events=all` for the log)      |
| GET    | `/api/snapshot`     | Everything, including full history                  |
| GET    | `/api/events`       | Filter by `since`, `type`, `correlationId`          |
| GET    | `/api/products/:id` | Traceability bundle for one unit                    |
| POST   | `/api/commands`     | `PLAY`/`PAUSE`/`STEP`/`SET_SPEED`/`RESET`/…         |
| WS     | `/ws`               | `hello` then one `frame` per tick                   |

A command returns a correlation ID and an accepted/rejected result rather than
mutating state silently, and an unrecognised body is rejected instead of
coerced. Frames carry a `sequence` so a client can drop a stale or duplicated
message, and only the events created since the previous frame — the full audit
trail stays server-side.

## Not yet built

No real computer vision, no optimisation solver, and no persistence (the host
holds one run in memory). Inspections are simulated against the same
`Inspection` contract a DeepStream/TAO pipeline would publish, so the vision
path can be swapped in later without changing the domain. See
`docs/superpowers/specs/2026-08-23-automotive-digital-twin-design.md` for the
architecture and `docs/IMPLEMENTATION_PLAN.md` for the phase plan.
