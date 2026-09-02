/**
 * Domain contracts for the factory digital twin.
 *
 * This module is the single source of truth for entity shapes, state machines
 * and the event vocabulary. It has no runtime dependencies so that the engine,
 * the KPI projections, the API layer and the 3D scene can all agree on the same
 * contract without importing simulation internals.
 */

// ---------------------------------------------------------------------------
// Event vocabulary
// ---------------------------------------------------------------------------

export type EventType =
  | "SCENARIO_APPLIED"
  | "TRUCK_ARRIVED"
  | "TRUCK_DOCKED"
  | "TRUCK_UNLOADED"
  | "TRUCK_DEPARTED"
  | "MATERIAL_RECEIVED"
  | "MATERIAL_ACCEPTED"
  | "MATERIAL_QUARANTINED"
  | "MATERIAL_SHORTAGE"
  | "MATERIAL_CONSUMED"
  | "KANBAN_SIGNAL"
  | "AGV_TASK_ASSIGNED"
  | "AGV_TASK_COMPLETED"
  | "WORK_ORDER_RELEASED"
  | "WORK_ORDER_COMPLETED"
  | "PRODUCTION_STARTED"
  | "MACHINE_STARTED"
  | "MACHINE_STOPPED"
  | "OPERATION_COMPLETED"
  | "STATION_BLOCKED"
  | "STATION_STARVED"
  | "INSPECTION_COMPLETED"
  | "DEFECT_DETECTED"
  | "DEFECT_ESCAPED"
  | "QUALITY_CHECK_PASSED"
  | "QUALITY_CHECK_FAILED"
  | "REWORK_STARTED"
  | "REWORK_COMPLETED"
  | "PRODUCT_SCRAPPED"
  | "MACHINE_FAILURE"
  | "MAINTENANCE_STARTED"
  | "MAINTENANCE_COMPLETED"
  | "BOTTLENECK_DETECTED"
  | "BOTTLENECK_CLEARED"
  | "PRODUCT_COMPLETED"
  | "SHIPMENT_CREATED"
  | "SHIPMENT_LOADING"
  | "SHIPMENT_DISPATCHED"
  | "SHIPMENT_DELIVERED";

export type EventPayload = Readonly<Record<string, string | number | boolean>>;

/** Versioned, append-only envelope. `causationId` links a fact to its trigger. */
export interface FactoryEvent {
  readonly eventId: string;
  readonly type: EventType;
  readonly occurredAt: number;
  readonly source: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly schemaVersion: 1;
  readonly payload: EventPayload;
}

// ---------------------------------------------------------------------------
// State machines
// ---------------------------------------------------------------------------

export type MachineStatus = "IDLE" | "RUNNING" | "BLOCKED" | "STARVED" | "DOWN" | "MAINTENANCE";

export type ProductStatus =
  | "WAITING_FOR_MATERIAL"
  | "QUEUED"
  | "IN_PRODUCTION"
  | "IN_REWORK"
  | "READY_TO_SHIP"
  | "LOADING"
  | "DISPATCHED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "SCRAPPED";

export type ShipmentStatus =
  "PLANNED" | "READY" | "LOADING" | "DISPATCHED" | "IN_TRANSIT" | "DELIVERED";

export type WorkOrderStatus = "PLANNED" | "RELEASED" | "IN_PROGRESS" | "COMPLETED";

export type AgvStatus = "IDLE" | "TO_PICKUP" | "LOADING" | "TO_DROP" | "UNLOADING";

export type MoveTaskStatus = "PENDING" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED";

export type InventoryStatus = "QUARANTINE" | "AVAILABLE" | "CONSUMED";

export type DefectType =
  | "SCRATCH"
  | "DENT"
  | "WELD_DEFECT"
  | "PAINT_DEFECT"
  | "MISSING_PART"
  | "WRONG_PART"
  | "SURFACE_DEFORMATION"
  | "MISALIGNMENT"
  | "DIMENSIONAL";

export type DefectSeverity = "minor" | "major" | "critical";

export type InspectionMethod = "VISION" | "DIMENSIONAL" | "MANUAL";

// ---------------------------------------------------------------------------
// Factory configuration (master data)
// ---------------------------------------------------------------------------

/**
 * Inspection capability of a station. `recall` is the share of present defects
 * the detector finds and `falsePositiveRate` the share of clean units it wrongly
 * rejects. Modelling both keeps the twin honest: a vision gate is not an oracle,
 * and escaped defects are exactly what a final gate must catch.
 */
export interface InspectionConfig {
  readonly enabled: boolean;
  readonly method: InspectionMethod;
  readonly recall: number;
  readonly falsePositiveRate: number;
  readonly cameraId: string | null;
}

export interface BomItem {
  readonly materialId: string;
  readonly quantity: number;
}

export interface StationConfig {
  readonly id: string;
  readonly name: string;
  readonly workCenter: string;
  readonly lineId: string;
  /** Nominal processing time for one unit, in ticks. */
  readonly cycleTicks: number;
  /** Symmetric tick jitter applied around `cycleTicks`. */
  readonly cycleJitter: number;
  /** Input buffer size; a full buffer blocks the upstream station. */
  readonly bufferCapacity: number;
  /** Per-tick hazard rate of an unplanned stop while running. */
  readonly failureRatePerTick: number;
  readonly repairTicks: readonly [number, number];
  /** Probability this operation introduces a defect into the unit. */
  readonly defectRate: number;
  readonly defectTypes: readonly DefectType[];
  readonly inspection: InspectionConfig;
  readonly runEnergyKwhPerTick: number;
  readonly idleEnergyKwhPerTick: number;
  /** Materials drawn from line-side stock when an operation starts. */
  readonly consumes: readonly BomItem[];
  /** Line-side kanban trigger and replenishment lot size. */
  readonly reorderPoint: number;
  readonly reorderQuantity: number;
  readonly robotCount: number;
  readonly operatorCount: number;
  /** Position in the layout, used by the 3D scene and AGV travel estimates. */
  readonly position: readonly [number, number];
}

export interface MaterialConfig {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  /** Ticks between inbound deliveries. */
  readonly supplyIntervalTicks: number;
  readonly supplyQuantity: number;
  /** Probability an inbound lot fails incoming QC and is quarantined. */
  readonly incomingRejectRate: number;
  /** Shelf life in ticks; a finite value switches the lot policy to FEFO. */
  readonly shelfLifeTicks: number | null;
}

export interface WorkOrderConfig {
  readonly id: string;
  /** Hangi hatta üretileceği. Ürün de hattını buradan alıyor. */
  readonly lineId: string;
  readonly productDefinitionId: string;
  readonly quantity: number;
  readonly priority: number;
  readonly dueTick: number;
}

export interface ShipmentPlanConfig {
  readonly customer: string;
  readonly destination: string;
  readonly vehicle: string;
  readonly capacity: number;
  readonly loadingTicks: number;
  readonly transitTicks: number;
}

/**
 * Bir üretim hattı.
 *
 * Tesiste birden fazla hat var ve her biri **kendi modelini** üretiyor. Rota,
 * tamir hücresi ve hat tavanı hatta özel; mal kabul, depo, bitmiş ürün ve
 * sevkiyat ise ortak — sahada da öyle: üç montaj hattı tek bir depodan beslenip
 * tek bir sevkiyat sahasından çıkar.
 */
export interface LineConfig {
  readonly id: string;
  /** Ordered production route; `reworkStationId` sits off the main route. */
  readonly route: readonly string[];
  readonly reworkStationId: string;
  /** Maximum units allowed on this line at once (CONWIP cap). */
  readonly wipCap: number;
  /** Customer demand for this line, used for takt time. */
  readonly demandPerShift: number;
  /** Bu hattın ürettiği modelin adı — ekranda ve raporda görünen şey. */
  readonly model: string;
}

export interface FactoryConfig {
  readonly lines: readonly LineConfig[];
  readonly stations: readonly StationConfig[];
  readonly materials: readonly MaterialConfig[];
  readonly workOrders: readonly WorkOrderConfig[];
  readonly shipmentPlan: ShipmentPlanConfig;
  /** Rework attempts allowed before a unit is scrapped. */
  readonly maxReworkPasses: number;
  /** Ticks an AGV needs per layout distance unit. */
  readonly agvTicksPerDistance: number;
  readonly agvCount: number;
  readonly agvHandlingTicks: number;
  /** Rolling window, in ticks, used by bottleneck and rate calculations. */
  readonly analysisWindowTicks: number;
  readonly shiftTicks: number;
}

// ---------------------------------------------------------------------------
// Runtime entities
// ---------------------------------------------------------------------------

export interface Defect {
  readonly id: string;
  readonly productId: string;
  readonly type: DefectType;
  readonly severity: DefectSeverity;
  readonly originStationId: string;
  readonly createdAt: number;
  detected: boolean;
  detectedAt: number | null;
  detectedBy: string | null;
  resolved: boolean;
  resolvedAt: number | null;
}

export interface Inspection {
  readonly id: string;
  readonly productId: string;
  readonly stationId: string;
  readonly cameraId: string | null;
  readonly method: InspectionMethod;
  readonly occurredAt: number;
  readonly result: "PASS" | "FAIL";
  readonly defectProbability: number;
  readonly detectedDefectIds: readonly string[];
  readonly falsePositive: boolean;
  /** Which detector produced this record — simulated, recorded, or a real one. */
  readonly inspectorKind: string;
}

/** One completed operation on one unit; the audit trail behind cycle time. */
export interface ExecutionRecord {
  readonly stationId: string;
  readonly machineId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly reworkPass: number;
}

export interface ProductUnit {
  readonly id: string;
  readonly workOrderId: string;
  /**
   * Üretildiği hat.
   *
   * İş emrinden türetilebilirdi ama motor her adımda hattın rotasına bakıyor;
   * her seferinde iş emrini aramak yerine burada duruyor. Ürün açıldığı anda
   * yazılıyor ve bir daha değişmiyor — bir araç hat değiştirmez.
   */
  readonly lineId: string;
  status: ProductStatus;
  /** Index into the unit's own line route. */
  stageIndex: number;
  reworkCount: number;
  readonly consumedMaterialBatchIds: string[];
  readonly defectIds: string[];
  readonly inspectionIds: string[];
  readonly history: ExecutionRecord[];
  releasedAt: number | null;
  completedAt: number | null;
  scrappedAt: number | null;
  shipmentId: string | null;
  currentMachineId: string | null;
  operationStartedAt: number | null;
  remainingTicks: number;
}

export interface Machine {
  readonly id: string;
  readonly station: string;
  readonly lineId: string;
  status: MachineStatus;
  currentProductId: string | null;
  remainingTicks: number;
  /** Input buffer, consumed FIFO. */
  readonly queue: string[];
  runTicks: number;
  idleTicks: number;
  blockedTicks: number;
  starvedTicks: number;
  downtimeTicks: number;
  repairTicksRemaining: number;
  failureCount: number;
  producedCount: number;
  energyKwh: number;
  availability: number;
  utilization: number;
  bottleneck: boolean;
  /** Rolling samples backing bottleneck detection. */
  readonly utilizationWindow: number[];
  readonly queueWindow: number[];
  readonly cycleWindow: number[];
}

export interface InventoryBalance {
  readonly materialId: string;
  readonly batchId: string;
  location: string;
  quantity: number;
  readonly receivedAt: number;
  readonly expiresAt: number | null;
  status: InventoryStatus;
}

/**
 * Bir teslimatın gelişi.
 *
 * Tır ekrana konulmuş bir süs değil: malzemeyi getiren şeyin kendisi. Yükü
 * boşaltılmadan stok düşmez, çünkü gerçekte de düşmez.
 *
 * Zamanlama bilerek şöyle: tır, teslimat saatinden **önce** yola çıkar ve
 * boşaltmayı tam teslimat saatinde bitirir. Böylece tedarik programı
 * değişmez — tır eklemek üretim sayılarını kaydırmaz, yalnızca zaten olan
 * şeyin görünür hâlini verir.
 */
export type TruckStatus = "ARRIVING" | "DOCKED" | "UNLOADING" | "COMPLETED";

export interface InboundTruck {
  readonly id: string;
  readonly materialId: string;
  readonly batchId: string;
  readonly quantity: number;
  status: TruckStatus;
  /** Yola çıktığı dakika. */
  readonly dispatchedAt: number;
  /** Boşaltmanın biteceği — yani stoğun düşeceği — dakika. */
  readonly dueAt: number;
  /** Mevcut aşamada kalan dakika. */
  ticksRemaining: number;
  /** Mevcut aşamanın toplam süresi; 3D sahne bunun üzerinden ilerler. */
  legTicks: number;
  /** 0..1 aşama içinde ilerleme. */
  progress: number;
  /** Yanaştığı rampa. Tek rampa var, ama alan sözleşmede dursun. */
  readonly dockId: string;
  /** Boşaltma bitene kadar null; sonra girdi kalitesinin kararı. */
  accepted: boolean | null;
  completedAt: number | null;
}

export interface MoveTask {
  readonly id: string;
  readonly materialId: string;
  readonly quantity: number;
  readonly from: string;
  readonly to: string;
  readonly createdAt: number;
  status: MoveTaskStatus;
  assignedAgvId: string | null;
  completedAt: number | null;
}

/** One lot's contribution to a withdrawal or a deposit. */
export interface LotAllocation {
  readonly batchId: string;
  readonly quantity: number;
}

export interface Agv {
  readonly id: string;
  status: AgvStatus;
  taskId: string | null;
  /** Lots currently on board, so material stays traceable while in motion. */
  cargoMaterialId: string | null;
  readonly cargo: LotAllocation[];
  ticksRemaining: number;
  legTicks: number;
  /** 0..1 along the current leg; the 3D scene interpolates on this. */
  progress: number;
  fromLocation: string;
  toLocation: string;
  completedTasks: number;
  travelTicks: number;
}

export interface WorkOrder {
  readonly id: string;
  readonly lineId: string;
  readonly productDefinitionId: string;
  readonly quantity: number;
  readonly priority: number;
  readonly dueTick: number;
  released: number;
  completed: number;
  scrapped: number;
  status: WorkOrderStatus;
  completedAt: number | null;
}

export interface Shipment {
  readonly id: string;
  readonly customer: string;
  readonly destination: string;
  readonly vehicle: string;
  readonly capacity: number;
  readonly productIds: string[];
  status: ShipmentStatus;
  readonly plannedDeparture: number;
  actualDeparture: number | null;
  deliveredAt: number | null;
  ticksRemaining: number;
}

export type AlertCode =
  | "MACHINE_FAILURE"
  | "BOTTLENECK"
  | "QUALITY_FAILURE"
  | "MATERIAL_SHORTAGE"
  | "SCRAP"
  | "SCHEDULE_RISK";

export interface Alert {
  readonly id: string;
  readonly code: AlertCode;
  readonly severity: "info" | "warning" | "critical";
  readonly occurredAt: number;
  readonly entityId: string;
  readonly message: string;
  acknowledged: boolean;
  resolvedAt: number | null;
}

// ---------------------------------------------------------------------------
// KPI projection
// ---------------------------------------------------------------------------

export interface MachineMetric {
  readonly machineId: string;
  readonly station: string;
  readonly status: MachineStatus;
  readonly utilization: number;
  readonly availability: number;
  readonly queueLength: number;
  readonly bottleneck: boolean;
  readonly downtime: number;
  readonly producedCount: number;
  readonly energyKwh: number;
}

export interface FactoryMetrics {
  readonly simulatedTime: number;
  readonly availability: number;
  readonly performance: number;
  readonly quality: number;
  readonly oee: number;
  readonly productionOutput: number;
  readonly plannedProduction: number;
  readonly scrapRate: number;
  readonly reworkRate: number;
  readonly firstPassYield: number;
  readonly cycleTime: number;
  readonly taktTime: number;
  readonly throughput: number;
  readonly downtime: number;
  readonly mtbf: number;
  readonly mttr: number;
  readonly wip: number;
  readonly lineUtilization: number;
  readonly machineUtilization: number;
  readonly energyConsumptionKwh: number;
  readonly inventoryOnHand: number;
  readonly shipmentStatus: ShipmentStatus;
  readonly bottleneck: string | null;
  readonly openAlerts: number;
  readonly detectedDefects: number;
  readonly escapedDefects: number;
  readonly scheduleAdherence: number;
  readonly machines: readonly MachineMetric[];
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export type ScenarioKind =
  | "normal"
  | "quality_failure"
  | "machine_failure"
  | "material_shortage"
  | "demand_surge"
  | "line_stop";

/** Disruptions are scheduled facts, never hidden mutations of engine state. */
export type ScenarioEvent =
  | {
      readonly at: number;
      readonly kind: "MACHINE_BREAKDOWN";
      readonly machineId: string;
      readonly durationTicks: number;
    }
  | { readonly at: number; readonly kind: "SUPPLY_CHANGE"; readonly multiplier: number }
  | { readonly at: number; readonly kind: "QUALITY_DEGRADATION"; readonly multiplier: number }
  | {
      readonly at: number;
      readonly kind: "DEMAND_SURGE";
      readonly extraUnits: number;
      readonly dueTick: number;
    }
  | {
      readonly at: number;
      readonly kind: "LINE_STOP";
      readonly lineId: string;
      readonly durationTicks: number;
    };

export interface ScenarioDefinition {
  readonly kind: ScenarioKind;
  readonly label: string;
  readonly description: string;
  readonly events: readonly ScenarioEvent[];
}

export interface ScenarioInput {
  readonly kind: ScenarioKind;
  readonly ticks: number;
  readonly seed: number;
}

export interface SimulationResult {
  readonly scenario: ScenarioKind;
  readonly seed: number;
  readonly simulatedTime: number;
  readonly products: readonly ProductUnit[];
  readonly workOrders: readonly WorkOrder[];
  readonly machines: readonly Machine[];
  readonly inventory: readonly InventoryBalance[];
  readonly agvs: readonly Agv[];
  readonly trucks: readonly InboundTruck[];
  readonly moveTasks: readonly MoveTask[];
  readonly shipments: readonly Shipment[];
  readonly inspections: readonly Inspection[];
  readonly defects: readonly Defect[];
  readonly events: readonly FactoryEvent[];
  readonly alerts: readonly Alert[];
  readonly metrics: FactoryMetrics;
}

// ---------------------------------------------------------------------------
// Live runtime contract (API and WebSocket)
// ---------------------------------------------------------------------------

export type RuntimeStatus = "running" | "paused";

/**
 * A station that has stopped and the response it demands.
 *
 * This is not another alert. A plant's andon rule is absolute and identical for
 * every rank — stop, call, wait — and the twin has to state it that way rather
 * than filing it as one more row in a list. It is derived from machine state,
 * so it cannot drift out of step with the line.
 */
export interface AndonStop {
  readonly machineId: string;
  readonly station: string;
  /** Plant minute the stop began. */
  readonly since: number;
  readonly elapsedMinutes: number;
  readonly estimatedRemaining: number;
  /** The unit caught on the machine when it stopped, if any. */
  readonly heldProductId: string | null;
}

export interface AndonState {
  readonly active: boolean;
  readonly stops: readonly AndonStop[];
  /** Minute the earliest still-open stop began; null when the line is running. */
  readonly raisedAt: number | null;
}

export interface InventorySummary {
  readonly materialId: string;
  readonly location: string;
  readonly quantity: number;
  readonly status: InventoryStatus;
}

/**
 * One published tick.
 *
 * A frame carries the current read model plus only the events created since the
 * previous frame. `sequence` lets a client discard a stale or duplicated frame,
 * and `simulatedTime` lets it recognise a reset. The complete history stays
 * server-side and is fetched over REST, never streamed on every tick.
 */
export interface FactoryFrame {
  readonly v: 1;
  readonly simulationId: string;
  readonly sequence: number;
  readonly simulatedTime: number;
  readonly status: RuntimeStatus;
  readonly speed: number;
  readonly scenario: ScenarioKind;
  readonly seed: number;
  readonly metrics: FactoryMetrics;
  readonly machines: readonly Machine[];
  readonly agvs: readonly Agv[];
  /** Yolda ve rampadaki teslimatlar. */
  readonly trucks: readonly InboundTruck[];
  readonly shipments: readonly Shipment[];
  readonly workOrders: readonly WorkOrder[];
  /** Units on the line plus a short tail of finished ones, not the full history. */
  readonly activeProducts: readonly ProductUnit[];
  readonly openAlerts: readonly Alert[];
  /** Stopped stations. Empty means the line is running. */
  readonly andon: AndonState;
  readonly inventory: readonly InventorySummary[];
  /**
   * Events appended since the previous frame.
   *
   * On a client's first frame this is a bounded **tail**, not the whole log.
   * It used to be the whole log, which meant the payload grew for as long as
   * the server stayed up — 565 KB of events by simulated minute 3000, of which
   * the browser kept 600 and threw the rest away.
   */
  readonly events: readonly FactoryEvent[];
  /**
   * How many events exist in total.
   *
   * `events.length < eventsTotal` on a first frame means there is history the
   * frame did not carry. It lives at `GET /api/events`, which pages properly
   * and can filter by type or by unit.
   */
  readonly eventsTotal: number;
}

export type Command =
  | { readonly type: "PLAY" }
  | { readonly type: "PAUSE" }
  | { readonly type: "STEP"; readonly ticks?: number }
  | { readonly type: "SET_SPEED"; readonly speed: number }
  | { readonly type: "RESET"; readonly scenario?: ScenarioKind; readonly seed?: number }
  | { readonly type: "LOAD_SCENARIO"; readonly scenario: ScenarioKind; readonly seed?: number }
  | { readonly type: "ACKNOWLEDGE_ALERT"; readonly alertId: string };

/**
 * Commands request change; they never mutate state silently. The correlation ID
 * lets a caller tie a UI action to the frame that resulted from it.
 */
export interface CommandResult {
  readonly commandId: string;
  readonly accepted: boolean;
  readonly message: string;
  readonly simulatedTime: number;
  readonly sequence: number;
}
