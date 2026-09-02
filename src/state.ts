import type {
  Agv,
  Alert,
  AlertCode,
  Defect,
  EventPayload,
  EventType,
  FactoryConfig,
  FactoryMetrics,
  InboundTruck,
  Inspection,
  InventoryBalance,
  LotAllocation,
  Machine,
  MoveTask,
  ProductUnit,
  ScenarioDefinition,
  Shipment,
  WorkOrder,
} from "./domain.ts";
import { EventStore } from "./events.ts";
import { LOCATIONS, factoryConfig, lineSideLocation, totalDemandPerShift } from "./factory.ts";
import { Rng } from "./rng.ts";
import { SlackAwareOptimizer, type Optimizer } from "./optimizer.ts";
import { SimulatedInspector, type Inspector } from "./vision/inspector.ts";

/**
 * The authoritative runtime state of one simulation run.
 *
 * Everything a consumer needs — 3D scene, dashboard, copilot, API — is derived
 * from this object or from the append-only event log inside it. Nothing that
 * matters operationally is kept in closures.
 */
export interface SimulationState {
  time: number;
  readonly seed: number;
  readonly config: FactoryConfig;
  readonly scenario: ScenarioDefinition;
  readonly rng: Rng;
  /**
   * Bir kez üretilmiş olay anahtarları.
   *
   * "Çıkış kapısında bekliyor" gibi bir durum her tikte tekrar edilirse olay
   * akışı aynı satırla dolar ve gerçekten yeni olan şey görünmez olur.
   */
  readonly emittedOnce: Set<string>;
  /**
   * Whatever is looking at the units.
   *
   * The engine never decides how a defect is found — it asks this. Swapping in
   * a recorded or a real detector changes the source of a detection and
   * nothing else about the factory's rules.
   */
  inspector: Inspector;
  /**
   * Whatever is planning the line.
   *
   * The engine never decides which order goes next or which vehicle takes a
   * job — it asks this and applies the answer. Swapping the policy changes the
   * plan and nothing else about the factory's rules, which is what makes two
   * policies comparable on one seed.
   */
  optimizer: Optimizer;
  readonly machines: Machine[];
  readonly products: ProductUnit[];
  readonly productIndex: Map<string, ProductUnit>;
  readonly workOrders: WorkOrder[];
  readonly inventory: InventoryBalance[];
  readonly defects: Defect[];
  readonly defectIndex: Map<string, Defect>;
  readonly inspections: Inspection[];
  /** Yolda ve rampadaki teslimatlar. */
  readonly trucks: InboundTruck[];
  readonly moveTasks: MoveTask[];
  readonly agvs: Agv[];
  readonly shipments: Shipment[];
  readonly events: EventStore;
  readonly alerts: Alert[];
  metrics: FactoryMetrics;
  readonly counters: Counters;
  /** Scenario-driven modifiers; 1 means "as designed". */
  defectRateMultiplier: number;
  supplyMultiplier: number;
  readonly appliedScenarioEvents: Set<number>;
  /** Open alert keys, so a persistent condition raises one alert, not hundreds. */
  readonly openAlertKeys: Map<string, string>;
}

export interface Counters {
  event: number;
  product: number;
  defect: number;
  inspection: number;
  moveTask: number;
  truck: number;
  shipment: number;
  alert: number;
  batch: number;
  workOrder: number;
}

export const emptyMetrics: FactoryMetrics = {
  simulatedTime: 0,
  availability: 1,
  performance: 0,
  quality: 1,
  oee: 0,
  productionOutput: 0,
  plannedProduction: 0,
  scrapRate: 0,
  reworkRate: 0,
  firstPassYield: 1,
  cycleTime: 0,
  taktTime: 0,
  throughput: 0,
  downtime: 0,
  mtbf: 0,
  mttr: 0,
  wip: 0,
  lineUtilization: 0,
  machineUtilization: 0,
  energyConsumptionKwh: 0,
  inventoryOnHand: 0,
  shipmentStatus: "PLANNED",
  bottleneck: null,
  openAlerts: 0,
  detectedDefects: 0,
  escapedDefects: 0,
  scheduleAdherence: 1,
  machines: [],
};

// ---------------------------------------------------------------------------
// Event and alert emission
// ---------------------------------------------------------------------------

export function emit(
  state: SimulationState,
  type: EventType,
  source: string,
  correlationId: string,
  payload: EventPayload = {},
  causationId: string | null = null,
): string {
  state.counters.event += 1;
  const eventId = `evt-${String(state.counters.event).padStart(6, "0")}`;
  state.events.append({
    eventId,
    type,
    occurredAt: state.time,
    source,
    correlationId,
    causationId,
    schemaVersion: 1,
    payload,
  });
  return eventId;
}

/**
 * Raise an alert unless the same condition is already open.
 *
 * `key` identifies the condition (not the occurrence), which is what stops a
 * starved station from producing one alert per tick.
 */
export function raiseAlert(
  state: SimulationState,
  key: string,
  code: AlertCode,
  severity: Alert["severity"],
  entityId: string,
  message: string,
): void {
  if (state.openAlertKeys.has(key)) return;
  state.counters.alert += 1;
  const id = `alert-${String(state.counters.alert).padStart(4, "0")}`;
  state.openAlertKeys.set(key, id);
  state.alerts.push({
    id,
    code,
    severity,
    occurredAt: state.time,
    entityId,
    message,
    acknowledged: false,
    resolvedAt: null,
  });
}

export function resolveAlert(state: SimulationState, key: string): void {
  const id = state.openAlertKeys.get(key);
  if (id === undefined) return;
  state.openAlertKeys.delete(key);
  const alert = state.alerts.find((candidate) => candidate.id === id);
  if (alert) alert.resolvedAt = state.time;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

function issuableLots(
  state: SimulationState,
  materialId: string,
  location: string,
): InventoryBalance[] {
  const lots = state.inventory.filter(
    (balance) =>
      balance.materialId === materialId &&
      balance.location === location &&
      balance.status === "AVAILABLE" &&
      balance.quantity > 0,
  );
  // FEFO for lots with a shelf life, FIFO otherwise.
  return lots.sort((left, right) => {
    if (left.expiresAt !== null && right.expiresAt !== null)
      return left.expiresAt - right.expiresAt;
    return left.receivedAt - right.receivedAt;
  });
}

export function availableQuantity(
  state: SimulationState,
  materialId: string,
  location: string,
): number {
  return issuableLots(state, materialId, location).reduce(
    (total, balance) => total + balance.quantity,
    0,
  );
}

/** Take up to `quantity` units, honouring lot policy. Never goes negative. */
export function withdraw(
  state: SimulationState,
  materialId: string,
  location: string,
  quantity: number,
): LotAllocation[] {
  const allocations: LotAllocation[] = [];
  let remaining = quantity;
  for (const lot of issuableLots(state, materialId, location)) {
    if (remaining <= 0) break;
    const taken = Math.min(lot.quantity, remaining);
    lot.quantity -= taken;
    remaining -= taken;
    allocations.push({ batchId: lot.batchId, quantity: taken });
  }
  return allocations;
}

/** Put lots down at a location, preserving batch identity for traceability. */
export function deposit(
  state: SimulationState,
  materialId: string,
  location: string,
  allocations: readonly LotAllocation[],
): void {
  for (const allocation of allocations) {
    const existing = state.inventory.find(
      (balance) => balance.batchId === allocation.batchId && balance.location === location,
    );
    if (existing) {
      existing.quantity += allocation.quantity;
      continue;
    }
    const origin = state.inventory.find((balance) => balance.batchId === allocation.batchId);
    state.inventory.push({
      materialId,
      batchId: allocation.batchId,
      location,
      quantity: allocation.quantity,
      receivedAt: origin?.receivedAt ?? state.time,
      expiresAt: origin?.expiresAt ?? null,
      status: "AVAILABLE",
    });
  }
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface SimulationOptions {
  readonly seed: number;
  readonly scenario: ScenarioDefinition;
  readonly config?: FactoryConfig;
  /**
   * Defaults to a detector modelled on the stations' configured recall and
   * false-positive rate, drawing from the run's own seeded stream.
   */
  readonly inspector?: (rng: Rng) => Inspector;
  /**
   * Defaults to the policy that was measured to be better: finish the batch
   * you started unless an order can no longer make its due date. The rules the
   * engine used before are still available as `LegacyOptimizer`, because they
   * are the baseline every claim here is measured against.
   */
  readonly optimizer?: Optimizer;
}

export function createSimulation(options: SimulationOptions): SimulationState {
  const config = options.config ?? factoryConfig;
  const counters: Counters = {
    event: 0,
    product: 0,
    defect: 0,
    inspection: 0,
    moveTask: 0,
    truck: 0,
    shipment: 0,
    alert: 0,
    batch: 0,
    workOrder: 0,
  };

  const machines: Machine[] = config.stations.map((station) => ({
    id: station.id,
    station: station.name,
    lineId: station.lineId,
    status: "IDLE",
    currentProductId: null,
    remainingTicks: 0,
    queue: [],
    runTicks: 0,
    idleTicks: 0,
    blockedTicks: 0,
    starvedTicks: 0,
    downtimeTicks: 0,
    repairTicksRemaining: 0,
    failureCount: 0,
    producedCount: 0,
    energyKwh: 0,
    availability: 1,
    utilization: 0,
    bottleneck: false,
    utilizationWindow: [],
    queueWindow: [],
    cycleWindow: [],
  }));

  const agvs: Agv[] = Array.from({ length: config.agvCount }, (_unused, index) => ({
    id: `AGV-${String(index + 1).padStart(2, "0")}`,
    status: "IDLE",
    taskId: null,
    cargoMaterialId: null,
    cargo: [],
    ticksRemaining: 0,
    legTicks: 0,
    progress: 0,
    fromLocation: LOCATIONS.rawStock,
    toLocation: LOCATIONS.rawStock,
    completedTasks: 0,
    travelTicks: 0,
  }));

  const workOrders: WorkOrder[] = config.workOrders.map((order) => ({
    id: order.id,
    lineId: order.lineId,
    productDefinitionId: order.productDefinitionId,
    quantity: order.quantity,
    priority: order.priority,
    dueTick: order.dueTick,
    released: 0,
    completed: 0,
    scrapped: 0,
    status: "PLANNED",
    completedAt: null,
  }));

  const rng = new Rng(options.seed);
  const emittedOnce = new Set<string>();
  const state: SimulationState = {
    time: 0,
    seed: options.seed,
    config,
    scenario: options.scenario,
    rng,
    emittedOnce,
    inspector: (options.inspector ?? ((stream) => new SimulatedInspector(stream)))(rng),
    optimizer: options.optimizer ?? new SlackAwareOptimizer(),
    machines,
    products: [],
    productIndex: new Map(),
    workOrders,
    inventory: [],
    defects: [],
    defectIndex: new Map(),
    inspections: [],
    trucks: [],
    moveTasks: [],
    agvs,
    shipments: [],
    events: new EventStore(),
    alerts: [],
    // A tick-zero snapshot still has to be a complete, honest read model: the
    // station list and the takt the plant is held to are known before the first
    // unit is released, so a consumer never has to special-case an empty frame.
    metrics: {
      ...emptyMetrics,
      plannedProduction: totalPlanned(workOrders),
      taktTime: config.shiftTicks / totalDemandPerShift(config),
      machines: machines.map((machine) => ({
        machineId: machine.id,
        station: machine.station,
        status: machine.status,
        utilization: 0,
        availability: 1,
        queueLength: 0,
        bottleneck: false,
        downtime: 0,
        producedCount: 0,
        energyKwh: 0,
      })),
    },
    counters,
    defectRateMultiplier: 1,
    supplyMultiplier: 1,
    appliedScenarioEvents: new Set(),
    openAlertKeys: new Map(),
  };

  seedOpeningStock(state);
  return state;
}

export function totalPlanned(workOrders: readonly WorkOrder[]): number {
  return workOrders.reduce((total, order) => total + order.quantity, 0);
}

/** Opening stock covers three delivery cycles, the usual safety cover. */
const OPENING_STOCK_CYCLES = 3;

/**
 * Opening stock: one lot per material in the raw store plus a line-side kanban
 * bin, so the line can start on tick 1 instead of waiting for the first inbound
 * delivery. A real plant runs the same way.
 */
function seedOpeningStock(state: SimulationState): void {
  for (const material of state.config.materials) {
    state.counters.batch += 1;
    const batchId = `${material.id}-LOT-${String(state.counters.batch).padStart(3, "0")}`;
    state.inventory.push({
      materialId: material.id,
      batchId,
      location: LOCATIONS.rawStock,
      quantity: material.supplyQuantity * OPENING_STOCK_CYCLES,
      receivedAt: 0,
      expiresAt: material.shelfLifeTicks === null ? null : material.shelfLifeTicks,
      status: "AVAILABLE",
    });
    const openingQuantity = material.supplyQuantity * OPENING_STOCK_CYCLES;
    emit(state, "MATERIAL_RECEIVED", LOCATIONS.receiving, batchId, {
      material: material.id,
      quantity: openingQuantity,
      opening: true,
    });
    emit(state, "MATERIAL_ACCEPTED", LOCATIONS.incomingQc, batchId, {
      material: material.id,
      quantity: openingQuantity,
    });
  }

  for (const station of state.config.stations) {
    for (const item of station.consumes) {
      const allocations = withdraw(
        state,
        item.materialId,
        LOCATIONS.rawStock,
        station.reorderQuantity,
      );
      deposit(state, item.materialId, lineSideLocation(station.id), allocations);
    }
  }
}
