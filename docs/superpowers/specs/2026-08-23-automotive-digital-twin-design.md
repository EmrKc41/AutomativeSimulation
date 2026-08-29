# AI-Powered Automotive Smart Factory Digital Twin — Design

## Scope and success criteria

This platform is an operational automotive-factory digital twin, not a static dashboard. It simulates the path from material receiving to shipment, exposes its state in a web-based command center, preserves product traceability, and permits reproducible what-if scenarios.

The first releasable vertical slice must simulate one vehicle line from material receipt through final inspection and shipment. It must visibly react to one material shortage, one machine failure, and one quality rejection. An operator must be able to see the resulting WIP, bottleneck, OEE-related metrics, alerts, and shipment impact.

## Domain and factory-operation model

### Primary entities

| Area                         | Entities                                                                                       | Purpose                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Product master               | `ProductDefinition`, `BomItem`, `RoutingTemplate`, `OperationTemplate`                         | Defines what is manufactured and the approved route.                   |
| Planning                     | `WorkOrder`, `Schedule`, `KanbanSignal`                                                        | Turns demand into prioritized, capacity-aware production.              |
| Factory execution            | `ProductUnit`, `ExecutionRecord`, `ProductionLine`, `WorkCenter`, `Machine`, `Robot`, `Worker` | Represents a uniquely traceable unit moving through physical capacity. |
| Materials and intralogistics | `MaterialBatch`, `InventoryBalance`, `InventoryLocation`, `MoveTask`, `Agv`                    | Controls lot traceability, stock, and movement.                        |
| Quality                      | `Inspection`, `Defect`, `QualityDisposition`, `ReworkRecord`                                   | Records quality-gate decisions and rework/scrap outcomes.              |
| Maintenance                  | `MaintenancePlan`, `MaintenanceWorkOrder`, `MachineFailure`                                    | Records preventive and corrective maintenance.                         |
| Delivery                     | `Shipment`, `ShipmentItem`                                                                     | Tracks ready, loading, dispatched, in-transit, and delivered vehicles. |
| Observability                | `FactoryEvent`, `Alert`, `MetricSnapshot`, `CameraEvent`                                       | Immutable operational history and time-series KPIs.                    |

`ProductUnit` is the traceability anchor. It has an immutable serial/VIN-like ID and references all consumed materials, operations, inspections, defects, rework, and shipment items.

### Production flow and rules

`RECEIVED → INCOMING_QC → RAW_STOCK → RELEASED → PRESS → BODY_WELD → PAINT → ASSEMBLY → FINAL_QC → READY_TO_SHIP → LOADING → DISPATCHED`

An incoming-material or quality failure routes to quarantine. A production quality failure routes to a configured rework route when permitted, otherwise scrap. Product movement uses FIFO by default and FEFO for perishable materials. Work orders are released only when planned, material-feasible, and within WIP constraints.

Machines implement `IDLE`, `RUNNING`, `BLOCKED`, `STARVED`, `DOWN`, and `MAINTENANCE`. A station is blocked when its downstream capacity is unavailable and starved when it lacks product or material. A bottleneck is signalled from sustained high utilization combined with queue growth and cycle-time deviation; utilization alone is insufficient.

## Simulation architecture

The simulation is a hybrid discrete-event and fixed-time-step engine. Discrete events accurately express arrivals, failures, completion, and decisions. Fixed updates supply stable real-time animation and snapshots.

```text
Scenario or user command
  → command queue → simulation clock → due-event processor
  → production / logistics / quality rules → atomic state update
  → event bus → KPI aggregator + persisted snapshots
  → WebSocket subscribers, 3D scene, dashboard, alert center
```

`SimulationState` owns the current time, rate, paused/running mode, deterministic `randomSeed`, entities, event queue, metrics, alerts, and scenario configuration. Tick order is: apply commands and scheduled events; update maintenance/failures; release work; dispatch movements; advance stations; apply inspections; update shipment readiness; calculate metrics; publish snapshot.

All randomness is seed-driven. This makes a baseline and a disruption scenario replayable and comparable. Scenario changes are modelled as scheduled domain events rather than hidden state mutation.

## Persistent data model

PostgreSQL is the system of record for master data, transactional history, and indexes. An in-memory runtime state serves simulation ticks. Object storage is reserved for camera frames, videos, and model artifacts. Metrics may begin in PostgreSQL and move to a time-series extension only when retention/volume warrants it.

Important invariants: inventory cannot be negative; product IDs are immutable; an execution record must match the product route; a product cannot ship without final pass; events are append-only; KPI snapshots are reproducible from events.

## Event model

Events are versioned envelopes:

```json
{
  "eventId": "evt_...",
  "type": "DEFECT_DETECTED",
  "occurredAt": "simulation-time",
  "source": "quality-gate/body-check-04",
  "correlationId": "product-or-work-order-id",
  "causationId": "prior-event-id",
  "payload": {},
  "schemaVersion": 1
}
```

Initial event vocabulary: `MATERIAL_RECEIVED`, `MATERIAL_ACCEPTED`, `MATERIAL_QUARANTINED`, `PRODUCTION_STARTED`, `MACHINE_STARTED`, `MACHINE_STOPPED`, `PRODUCT_COMPLETED`, `DEFECT_DETECTED`, `QUALITY_CHECK_PASSED`, `QUALITY_CHECK_FAILED`, `REWORK_STARTED`, `REWORK_COMPLETED`, `MACHINE_FAILURE`, `MAINTENANCE_STARTED`, `MAINTENANCE_COMPLETED`, `BOTTLENECK_DETECTED`, `SHIPMENT_CREATED`, and `SHIPMENT_DISPATCHED`.

Commands request change; domain rules validate them; events record confirmed facts; projections build UI/KPI read models. Consumers must be idempotent by `eventId`. The event log is the audit trail and a replay source, not a replacement for operational query tables.

## AI Factory Copilot architecture

The copilot receives a structured question plus an authorized analytics context. It never treats untrusted camera/event text as instructions. Its answer pipeline is:

```text
Natural-language question → intent and time/line/entity filters
→ queried KPI/event/traceability evidence → deterministic analysis helpers
→ cited recommendation and uncertainty → UI response
```

It will initially use simulation and operational data only: bottleneck explanation, target-vs-actual variance, machine-risk ranking from maintenance signals, and scenario comparison. It may recommend an action, but does not automatically alter a production plan. Any proposed plan becomes an explicit scenario or command requiring user action.

## Computer-vision architecture

Camera integration is adapter-based so a synthetic feed works before GPU infrastructure is available.

```text
Camera/recorded video/synthetic frame
→ stream adapter → detector/segmenter/classifier/tracker
→ quality-rule adapter → CameraEvent / Inspection / Defect
→ event bus → alert, product traceability, dashboard, copilot evidence
```

The first simulation uses synthetic inspection results bound to product/station/time. A later DeepStream path publishes the same `CameraEvent` contract. TAO models are candidates for scratch, dent, weld, paint, missing-part, and alignment inspection; no model will be represented as deployed without a validated dataset, evaluation, and operating threshold.

## 3D scene architecture

The web scene separates static factory layout from dynamic simulation entities. Static layout describes zones, lines, work centers, conveyors, warehouse aisles, camera positions, and shipping. Dynamic entities subscribe to the latest authoritative state: products move through route waypoints, AGVs follow movement tasks, robots animate machine operations, and material/product colors communicate operational meaning.

The scene uses React Three Fiber/Three.js, an interaction layer for selection and camera bookmarks, and a simulation-to-scene mapping layer. Green means normal production, yellow capacity pressure, orange quality/operational risk, red critical issue, and blue logistics. Framer Motion is limited to meaningful 2D transitions; 3D operations use scene animation and state-driven interpolation.

USD/Omniverse integration remains optional behind an asset-export/import boundary. It is not required for the first browser-based vertical slice.

## API and realtime architecture

The initial backend exposes REST for stable resources and commands, and WebSocket for simulation snapshots, events, metrics, and alerts.

| API area   | Representative operations                                                 |
| ---------- | ------------------------------------------------------------------------- |
| Simulation | start, pause, reset, set speed, load scenario, create scenario run        |
| Factory    | query lines, machines, inventory, work orders, products, and traceability |
| Operations | create/reprioritize work order, request move, begin/complete maintenance  |
| Quality    | list inspections/defects, inspect a product, resolve/rework disposition   |
| Analytics  | KPI range, bottlenecks, downtime, scenario comparison                     |
| Copilot    | ask a read-only operational question with evidence response               |

The command API must return a command result/correlation ID rather than silently mutating state. WebSocket messages are versioned and keep a `simulationId`, `sequence`, and `simulatedTime` so clients can discard stale frames and recover from a snapshot.

## UI architecture

The operational command center has one primary viewport, not a collection of disconnected admin pages:

- A 3D factory view with selectable zones, camera bookmarks, machines, active products, AGVs, and routes.
- A KPI rail showing OEE, availability, performance, quality, output, WIP, takt/cycle time, utilization, energy, and shipments.
- A contextual detail panel for the selected entity with traceability and recommended action.
- A time/event panel for alerts, production flow, downtime, and scenario markers.
- A scenario bar for pause, speed, baseline comparison, and controlled disruptions.
- A copilot panel whose answers contain supporting metrics and event references.

UI status is derived from simulation state; it must not invent health colors or counts locally. Accessibility requires non-color status labels, keyboard selection, readable charts, and reduced-motion support.

## Development roadmap

1. **Foundation:** repository setup, TypeScript/Python contracts, deterministic event/state model, seeds, automated invariant tests.
2. **Vertical simulation slice:** one line, four to six stations, material lot, quality gate, rework, shipment, live KPIs, disruption scenarios.
3. **Command center:** real-time dashboard, event/alert timeline, traceability drill-down, pause/speed/reset/scenario controls.
4. **3D factory:** static layout, state-driven line/product/AGV visualization, selection and bookmarks.
5. **Analytics and copilot:** bottleneck, OEE loss, variance, and scenario comparisons with evidence.
6. **Vision integration:** synthetic feed adapter, then validated DeepStream/TAO deployment where hardware/data are available.
7. **Optimization and calibration:** cuOpt scheduling/routes; real-camera calibration; USD/Omniverse when an appropriate asset/hardware environment exists.
8. **Hardening:** load tests, event replay, data retention, security, observability, user acceptance with manufacturing SMEs.

## Verification strategy

Unit tests cover routing, quality disposition, inventory, machine state transitions, KPI formulas, and deterministic random scenarios. Integration tests assert event ordering and API/WebSocket contracts. Scenario tests compare baseline with machine failure, material shortage, demand increase, quality degradation, and line outage. Visual acceptance checks confirm that selected scene objects and dashboard values correspond to the same simulation snapshot.
