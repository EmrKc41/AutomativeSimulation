import type {
  Defect,
  DefectSeverity,
  InboundTruck,
  LineConfig,
  Inspection,
  Machine,
  ProductUnit,
  SimulationResult,
  StationConfig,
  WorkOrder,
} from "./domain.ts";
import {
  LOCATIONS,
  lineById,
  lineSideLocation,
  materialName,
  routeStationIds,
  stationById,
  travelTicks,
} from "./factory.ts";
import { computeMetrics, detectBottlenecks, sampleMachines } from "./metrics.ts";
import {
  availableQuantity,
  deposit,
  emit,
  raiseAlert,
  resolveAlert,
  withdraw,
  type SimulationState,
} from "./state.ts";

/**
 * The factory tick.
 *
 * One tick is one fixed time step of the plant. The phase order below is the
 * contract: disruptions land first so everything downstream sees the same
 * world, machine health is settled before any work is planned against it, and
 * KPIs are computed last so a snapshot always describes a finished tick rather
 * than a half-applied one.
 */
export function tick(state: SimulationState): void {
  state.time += 1;
  applyScenarioEvents(state);
  updateMachineHealth(state);
  inboundLogistics(state);
  releaseWork(state);
  runIntralogistics(state);
  advanceStations(state);
  updateLogistics(state);
  reviewSchedule(state);
  sampleMachines(state);
  detectBottlenecks(state);
  state.metrics = computeMetrics(state);
}

export function run(state: SimulationState, ticks: number): SimulationState {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error("ticks must be a non-negative integer");
  }
  for (let index = 0; index < ticks; index += 1) tick(state);
  return state;
}

/** Immutable-facing view of the run, safe to serialise to an API or a UI. */
export function snapshot(state: SimulationState): SimulationResult {
  return {
    scenario: state.scenario.kind,
    seed: state.seed,
    simulatedTime: state.time,
    products: state.products,
    workOrders: state.workOrders,
    machines: state.machines,
    inventory: state.inventory,
    agvs: state.agvs,
    trucks: state.trucks,
    moveTasks: state.moveTasks,
    shipments: state.shipments,
    inspections: state.inspections,
    defects: state.defects,
    events: state.events,
    alerts: state.alerts,
    metrics: state.metrics,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findMachine(state: SimulationState, id: string): Machine {
  const machine = state.machines.find((candidate) => candidate.id === id);
  if (!machine) throw new Error(`unknown machine: ${id}`);
  return machine;
}

function requireProduct(state: SimulationState, id: string): ProductUnit {
  const product = state.productIndex.get(id);
  if (!product) throw new Error(`unknown product: ${id}`);
  return product;
}

function workOrderOf(state: SimulationState, product: ProductUnit): WorkOrder {
  const order = state.workOrders.find((candidate) => candidate.id === product.workOrderId);
  if (!order) throw new Error(`unknown work order: ${product.workOrderId}`);
  return order;
}

/** Ürünün üretildiği hat. Rota, tamir hücresi ve hat tavanı buradan geliyor. */
function lineOf(state: SimulationState, product: ProductUnit): LineConfig {
  return lineById(state.config, product.lineId);
}

/**
 * Hattaki açık araç sayısı (WIP).
 *
 * Hat başına sayılıyor: tesiste üç hat var ve birinin dolu olması diğerinin
 * iş almasını engellemez. Tek sayaç olsaydı en hızlı hat, diğerlerinin
 * tavanını da yerdi.
 */
function activeWip(state: SimulationState, lineId: string): number {
  return state.products.filter(
    (product) =>
      product.lineId === lineId &&
      (product.status === "QUEUED" ||
        product.status === "IN_PRODUCTION" ||
        product.status === "IN_REWORK"),
  ).length;
}

// ---------------------------------------------------------------------------
// Phase 1 — scenario events
// ---------------------------------------------------------------------------

function applyScenarioEvents(state: SimulationState): void {
  state.scenario.events.forEach((scenarioEvent, index) => {
    if (scenarioEvent.at !== state.time || state.appliedScenarioEvents.has(index)) return;
    state.appliedScenarioEvents.add(index);
    emit(state, "SCENARIO_APPLIED", "scenario", state.scenario.kind, {
      kind: scenarioEvent.kind,
      at: scenarioEvent.at,
    });

    switch (scenarioEvent.kind) {
      case "MACHINE_BREAKDOWN":
        forceBreakdown(state, scenarioEvent.machineId, scenarioEvent.durationTicks, "scenario");
        break;
      case "SUPPLY_CHANGE":
        state.supplyMultiplier = scenarioEvent.multiplier;
        break;
      case "QUALITY_DEGRADATION":
        state.defectRateMultiplier = scenarioEvent.multiplier;
        break;
      case "DEMAND_SURGE": {
        state.counters.workOrder += 1;
        const id = `WO-SURGE-${String(state.counters.workOrder).padStart(3, "0")}`;
        // Ek talep ilk hatta düşüyor. Senaryonun anlattığı şey "beklenmedik
        // sipariş"; hangi hatta gideceği planlamanın kararı ve bu ayrım
        // senaryoya girmediği sürece tek yerde tutuluyor.
        const surgeLine = state.config.lines[0]!;
        state.workOrders.push({
          id,
          lineId: surgeLine.id,
          productDefinitionId: surgeLine.model.toLocaleUpperCase("tr-TR"),
          quantity: scenarioEvent.extraUnits,
          priority: 0,
          dueTick: scenarioEvent.dueTick,
          released: 0,
          completed: 0,
          scrapped: 0,
          status: "PLANNED",
          completedAt: null,
        });
        emit(state, "WORK_ORDER_RELEASED", "planning", id, {
          quantity: scenarioEvent.extraUnits,
          dueTick: scenarioEvent.dueTick,
          reason: "demand-surge",
        });
        break;
      }
      case "LINE_STOP":
        // Senaryo tesisi durduruyor, tek hattı değil: elektrik kesintisi üç
        // hattı birden vurur.
        for (const stationId of routeStationIds(state.config)) {
          forceBreakdown(state, stationId, scenarioEvent.durationTicks, "scenario:line-stop");
        }
        break;
    }
  });
}

function forceBreakdown(
  state: SimulationState,
  machineId: string,
  durationTicks: number,
  cause: string,
): void {
  const machine = findMachine(state, machineId);
  if (machine.status === "DOWN") {
    machine.repairTicksRemaining = Math.max(machine.repairTicksRemaining, durationTicks);
    return;
  }
  machine.status = "DOWN";
  machine.repairTicksRemaining = durationTicks;
  machine.failureCount += 1;
  emit(state, "MACHINE_STOPPED", machine.id, machine.id, { cause });
  const failureEventId = emit(
    state,
    "MACHINE_FAILURE",
    machine.id,
    machine.currentProductId ?? machine.id,
    { durationTicks, cause },
  );
  emit(
    state,
    "MAINTENANCE_STARTED",
    machine.id,
    machine.id,
    { corrective: true, durationTicks },
    failureEventId,
  );
  raiseAlert(
    state,
    `failure:${machine.id}`,
    "MACHINE_FAILURE",
    "critical",
    machine.id,
    `${machine.station} durdu. Tahmini ${durationTicks} dk. Sonrasındaki istasyonlar besleme alamayacak.`,
  );
}

// ---------------------------------------------------------------------------
// Phase 2 — machine health
// ---------------------------------------------------------------------------

/**
 * Settle machine health before any work is planned against it.
 *
 * A repair is charged for exactly as many minutes as it lasts, and the machine
 * resumes on the following tick rather than working the minute it was still
 * being fixed. Together with `processMachine`, this keeps every station's time
 * ledger summing to the elapsed time — the property every loss attribution in
 * `analytics.ts` rests on.
 */
function updateMachineHealth(state: SimulationState): void {
  for (const machine of state.machines) {
    const station = stationById(state.config, machine.id);

    if (machine.status === "DOWN") {
      if (machine.repairTicksRemaining > 0) {
        machine.downtimeTicks += 1;
        machine.repairTicksRemaining -= 1;
        machine.energyKwh += station.idleEnergyKwhPerTick;
        continue;
      }
      // The repair finished at the end of the previous tick; resume exactly
      // where the stop interrupted the operation.
      machine.status =
        machine.currentProductId === null
          ? "IDLE"
          : machine.remainingTicks > 0
            ? "RUNNING"
            : "BLOCKED";
      emit(state, "MAINTENANCE_COMPLETED", machine.id, machine.id, { restored: true });
      resolveAlert(state, `failure:${machine.id}`);
      continue;
    }

    if (machine.status === "RUNNING" && state.rng.chance(station.failureRatePerTick)) {
      forceBreakdown(state, machine.id, state.rng.nextInt(...station.repairTicks), "random");
      // The stop happens inside this minute, so this minute is downtime: the
      // station-advance phase will skip the machine entirely.
      machine.downtimeTicks += 1;
      machine.repairTicksRemaining -= 1;
      machine.energyKwh += station.idleEnergyKwhPerTick;
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 3 — inbound trucks, material receipt and incoming quality control
// ---------------------------------------------------------------------------

/**
 * How long a delivery spends approaching, docking and unloading.
 *
 * These are the minutes the 3D view animates over. They are also the reason a
 * truck is dispatched *before* its delivery is due rather than when it lands:
 * the supply schedule is unchanged, so adding trucks moved no production
 * number at all. A truck that shifted the plan would be a new fact about the
 * factory smuggled in as a visual.
 */
const TRUCK_APPROACH_TICKS = 4;
const TRUCK_DOCK_TICKS = 1;
const TRUCK_UNLOAD_TICKS = 3;
const TRUCK_LEAD_TICKS = TRUCK_APPROACH_TICKS + TRUCK_DOCK_TICKS + TRUCK_UNLOAD_TICKS;
/** How long a finished truck stays visible so the scene can drive it away. */
const TRUCK_DEPART_TICKS = 3;

function inboundLogistics(state: SimulationState): void {
  dispatchTrucks(state);
  advanceTrucks(state);
}

/** Send a truck for every delivery that becomes due one lead time from now. */
function dispatchTrucks(state: SimulationState): void {
  for (const material of state.config.materials) {
    const dueAt = state.time + TRUCK_LEAD_TICKS;
    if (dueAt % material.supplyIntervalTicks !== 0) continue;
    const quantity = Math.round(material.supplyQuantity * state.supplyMultiplier);
    if (quantity <= 0) continue;

    // The batch is named at dispatch, so the id on the truck in the 3D view is
    // the id the lot keeps for the rest of its life.
    state.counters.batch += 1;
    const batchId = `${material.id}-LOT-${String(state.counters.batch).padStart(3, "0")}`;
    state.counters.truck += 1;
    const id = `TIR-${String(state.counters.truck).padStart(4, "0")}`;

    state.trucks.push({
      id,
      materialId: material.id,
      batchId,
      quantity,
      status: "ARRIVING",
      dispatchedAt: state.time,
      dueAt,
      ticksRemaining: TRUCK_APPROACH_TICKS,
      legTicks: TRUCK_APPROACH_TICKS,
      progress: 0,
      dockId: LOCATIONS.receiving,
      accepted: null,
      completedAt: null,
    });

    emit(state, "TRUCK_ARRIVED", LOCATIONS.receiving, id, {
      material: material.id,
      quantity,
      batch: batchId,
    });
  }
}

function advanceTrucks(state: SimulationState): void {
  for (const truck of state.trucks) {
    if (truck.status === "COMPLETED") continue;
    // A truck dispatched this very tick does not also travel this tick.
    // Without this it arrives a minute early, which quietly moves the supply
    // schedule — the one thing this design promised not to do.
    if (truck.dispatchedAt === state.time) continue;

    truck.ticksRemaining -= 1;
    truck.progress = truck.legTicks <= 0 ? 1 : 1 - truck.ticksRemaining / truck.legTicks;
    if (truck.ticksRemaining > 0) continue;

    switch (truck.status) {
      case "ARRIVING":
        truck.status = "DOCKED";
        truck.legTicks = TRUCK_DOCK_TICKS;
        truck.ticksRemaining = TRUCK_DOCK_TICKS;
        truck.progress = 0;
        emit(state, "TRUCK_DOCKED", LOCATIONS.receiving, truck.id, { batch: truck.batchId });
        break;

      case "DOCKED":
        truck.status = "UNLOADING";
        truck.legTicks = TRUCK_UNLOAD_TICKS;
        truck.ticksRemaining = TRUCK_UNLOAD_TICKS;
        truck.progress = 0;
        break;

      case "UNLOADING":
        // The stock lands now, not a minute earlier: nothing is in the store
        // until it has actually come off the truck.
        truck.accepted = receiveBatch(state, truck);
        truck.status = "COMPLETED";
        truck.completedAt = state.time;
        emit(state, "TRUCK_UNLOADED", LOCATIONS.receiving, truck.id, {
          batch: truck.batchId,
          result: truck.accepted ? "PASS" : "FAIL",
        });
        break;

      default:
        break;
    }
  }

  // Finished trucks linger briefly so the scene can drive them off, then go.
  const before = state.trucks.length;
  const survivors = state.trucks.filter(
    (truck) => truck.completedAt === null || state.time - truck.completedAt <= TRUCK_DEPART_TICKS,
  );
  if (survivors.length !== before) {
    for (const truck of state.trucks) {
      if (!survivors.includes(truck)) {
        emit(state, "TRUCK_DEPARTED", LOCATIONS.receiving, truck.id, { batch: truck.batchId });
      }
    }
    state.trucks.length = 0;
    state.trucks.push(...survivors);
  }
}

/**
 * The delivery lands: stock in, incoming quality decides.
 *
 * Returns whether the batch passed. The rule is exactly the one that was here
 * before trucks existed — a batch is quarantined on the material's own
 * incoming reject rate — so the same seed still quarantines the same lots.
 */
function receiveBatch(state: SimulationState, truck: InboundTruck): boolean {
  const material = state.config.materials.find((entry) => entry.id === truck.materialId);
  if (!material) return true;

  const quarantined = state.rng.chance(material.incomingRejectRate);

  state.inventory.push({
    materialId: material.id,
    batchId: truck.batchId,
    location: quarantined ? LOCATIONS.quarantine : LOCATIONS.rawStock,
    quantity: truck.quantity,
    receivedAt: state.time,
    expiresAt: material.shelfLifeTicks === null ? null : state.time + material.shelfLifeTicks,
    status: quarantined ? "QUARANTINE" : "AVAILABLE",
  });

  const receivedEventId = emit(state, "MATERIAL_RECEIVED", LOCATIONS.receiving, truck.batchId, {
    material: material.id,
    quantity: truck.quantity,
  });
  emit(
    state,
    quarantined ? "MATERIAL_QUARANTINED" : "MATERIAL_ACCEPTED",
    LOCATIONS.incomingQc,
    truck.batchId,
    { material: material.id, quantity: truck.quantity },
    receivedEventId,
  );
  return !quarantined;
}

// ---------------------------------------------------------------------------
// Phase 4 — work-order release
// ---------------------------------------------------------------------------

/** Release is allowed only when it is planned, material-feasible and within WIP. */
function releaseWork(state: SimulationState): void {
  // Her hat kendi tavanına ve kendi iş emirlerine bakıyor. Sıra sabit: hat
  // sırası değişirse aynı tohum farklı koşu üretirdi.
  for (const line of state.config.lines) releaseLine(state, line);
}

function releaseLine(state: SimulationState, line: LineConfig): void {
  const firstStationId = line.route[0];
  if (firstStationId === undefined) return;
  const firstMachine = findMachine(state, firstStationId);
  const firstStation = stationById(state.config, firstStationId);

  while (
    activeWip(state, line.id) < line.wipCap &&
    firstMachine.queue.length < firstStation.bufferCapacity
  ) {
    const order = nextWorkOrder(state, line);
    if (!order) return;

    const missing = infeasibleMaterials(state);
    if (missing.length > 0) {
      for (const materialId of missing) {
        emit(state, "MATERIAL_SHORTAGE", LOCATIONS.rawStock, materialId, {
          workOrder: order.id,
          onHand: totalAvailable(state, materialId),
        });
        raiseAlert(
          state,
          `shortage:${materialId}`,
          "MATERIAL_SHORTAGE",
          "critical",
          materialId,
          `${materialName(state.config, materialId)} stokta yok; ${order.id} iş emri hatta verilemiyor.`,
        );
      }
      return;
    }

    state.counters.product += 1;
    const product: ProductUnit = {
      id: `CAR-2026-${String(state.counters.product).padStart(6, "0")}`,
      workOrderId: order.id,
      lineId: line.id,
      status: "QUEUED",
      stageIndex: 0,
      reworkCount: 0,
      consumedMaterialBatchIds: [],
      defectIds: [],
      inspectionIds: [],
      history: [],
      releasedAt: state.time,
      completedAt: null,
      scrappedAt: null,
      shipmentId: null,
      currentMachineId: null,
      operationStartedAt: null,
      remainingTicks: 0,
    };
    state.products.push(product);
    state.productIndex.set(product.id, product);
    firstMachine.queue.push(product.id);
    order.released += 1;
    order.status = order.released >= order.quantity ? "IN_PROGRESS" : "RELEASED";

    const releaseEventId = emit(state, "WORK_ORDER_RELEASED", "planning", order.id, {
      product: product.id,
      released: order.released,
      quantity: order.quantity,
    });
    emit(
      state,
      "PRODUCTION_STARTED",
      line.id,
      product.id,
      { workOrder: order.id, definition: order.productDefinitionId },
      releaseEventId,
    );
  }
}

/**
 * Which order goes onto the line next.
 *
 * The engine states the situation and applies the answer; it does not hold an
 * opinion about sequencing. A policy that returns an order the engine did not
 * offer is ignored rather than trusted — the optimiser may be a remote solver,
 * and a plan is data, not an instruction.
 */
function nextWorkOrder(state: SimulationState, line: LineConfig): WorkOrder | null {
  // Yalnızca bu hattın emirleri: bir hattın planlaması diğerinin işini almaz.
  const open = state.workOrders.filter(
    (order) => order.lineId === line.id && order.released < order.quantity,
  );
  if (open.length === 0) return null;

  const chosenId = state.optimizer.nextRelease({
    time: state.time,
    taktTime: state.config.shiftTicks / line.demandPerShift,
    wip: activeWip(state, line.id),
    wipCap: line.wipCap,
    candidates: open.map((order) => ({
      id: order.id,
      priority: order.priority,
      dueTick: order.dueTick,
      quantity: order.quantity,
      released: order.released,
      completed: order.completed,
      scrapped: order.scrapped,
    })),
  });

  if (chosenId === null) return null;
  return open.find((order) => order.id === chosenId) ?? null;
}

function totalAvailable(state: SimulationState, materialId: string): number {
  return state.inventory
    .filter((balance) => balance.materialId === materialId && balance.status === "AVAILABLE")
    .reduce((total, balance) => total + balance.quantity, 0);
}

/** Materials the route needs for one more unit but cannot currently supply. */
function infeasibleMaterials(state: SimulationState): string[] {
  const missing: string[] = [];
  // Depo ortak: üç hat da aynı raftan besleniyor, o yüzden eksik malzeme
  // bütün rotaların ihtiyacına göre belirleniyor.
  for (const stationId of routeStationIds(state.config)) {
    const station = stationById(state.config, stationId);
    for (const item of station.consumes) {
      if (totalAvailable(state, item.materialId) < item.quantity) missing.push(item.materialId);
    }
  }
  for (const materialId of new Set(state.config.materials.map((material) => material.id))) {
    if (!missing.includes(materialId)) resolveAlert(state, `shortage:${materialId}`);
  }
  return [...new Set(missing)];
}

// ---------------------------------------------------------------------------
// Phase 5 — kanban replenishment and AGV movement
// ---------------------------------------------------------------------------

function runIntralogistics(state: SimulationState): void {
  raiseKanbanSignals(state);
  assignMoveTasks(state);
  advanceAgvs(state);
}

/** Pull replenishment: a line-side bin below its reorder point calls material. */
function raiseKanbanSignals(state: SimulationState): void {
  for (const station of state.config.stations) {
    for (const item of station.consumes) {
      const target = lineSideLocation(station.id);
      if (availableQuantity(state, item.materialId, target) >= station.reorderPoint) continue;
      const inFlight = state.moveTasks.some(
        (task) =>
          task.status !== "COMPLETED" && task.materialId === item.materialId && task.to === target,
      );
      if (inFlight) continue;

      state.counters.moveTask += 1;
      const id = `MOV-${String(state.counters.moveTask).padStart(5, "0")}`;
      state.moveTasks.push({
        id,
        materialId: item.materialId,
        quantity: station.reorderQuantity,
        from: LOCATIONS.rawStock,
        to: target,
        createdAt: state.time,
        status: "PENDING",
        assignedAgvId: null,
        completedAt: null,
      });
      emit(state, "KANBAN_SIGNAL", station.id, id, {
        material: item.materialId,
        quantity: station.reorderQuantity,
      });
    }
  }
}

function assignMoveTasks(state: SimulationState): void {
  const idle = state.agvs.filter((agv) => agv.status === "IDLE");
  const pending = state.moveTasks.filter((task) => task.status === "PENDING");
  if (idle.length === 0 || pending.length === 0) return;

  const plan = state.optimizer.dispatch({
    time: state.time,
    config: state.config,
    vehicles: idle.map((agv) => ({ id: agv.id, location: agv.fromLocation })),
    jobs: pending.map((task) => ({
      id: task.id,
      materialId: task.materialId,
      from: task.from,
      to: task.to,
      createdAt: task.createdAt,
    })),
  });

  // The plan is checked, not trusted: a policy may be a remote solver, and a
  // duplicate pairing would put one vehicle on two jobs or two vehicles on one.
  const usedAgvs = new Set<string>();
  const usedTasks = new Set<string>();

  for (const pair of plan) {
    if (usedAgvs.has(pair.agvId) || usedTasks.has(pair.taskId)) continue;
    const agv = idle.find((candidate) => candidate.id === pair.agvId);
    const task = pending.find((candidate) => candidate.id === pair.taskId);
    if (!agv || !task) continue;
    usedAgvs.add(pair.agvId);
    usedTasks.add(pair.taskId);

    task.status = "ASSIGNED";
    task.assignedAgvId = agv.id;
    agv.taskId = task.id;
    agv.status = "TO_PICKUP";
    agv.toLocation = task.from;
    agv.legTicks = travelTicks(state.config, agv.fromLocation, task.from);
    agv.ticksRemaining = agv.legTicks;
    agv.progress = 0;
    emit(state, "AGV_TASK_ASSIGNED", agv.id, task.id, {
      material: task.materialId,
      from: task.from,
      to: task.to,
    });
  }
}

function advanceAgvs(state: SimulationState): void {
  for (const agv of state.agvs) {
    if (agv.status === "IDLE" || agv.taskId === null) continue;
    const task = state.moveTasks.find((candidate) => candidate.id === agv.taskId);
    if (!task) {
      agv.status = "IDLE";
      agv.taskId = null;
      continue;
    }

    agv.ticksRemaining -= 1;
    agv.travelTicks += 1;
    agv.progress = agv.legTicks <= 0 ? 1 : 1 - agv.ticksRemaining / agv.legTicks;
    if (agv.ticksRemaining > 0) continue;

    switch (agv.status) {
      case "TO_PICKUP":
        agv.fromLocation = task.from;
        agv.status = "LOADING";
        agv.legTicks = state.config.agvHandlingTicks;
        agv.ticksRemaining = agv.legTicks;
        agv.progress = 0;
        task.status = "IN_PROGRESS";
        break;
      case "LOADING": {
        const allocations = withdraw(state, task.materialId, task.from, task.quantity);
        agv.cargoMaterialId = task.materialId;
        agv.cargo.splice(0, agv.cargo.length, ...allocations);
        agv.status = "TO_DROP";
        agv.toLocation = task.to;
        agv.legTicks = travelTicks(state.config, task.from, task.to);
        agv.ticksRemaining = agv.legTicks;
        agv.progress = 0;
        break;
      }
      case "TO_DROP":
        agv.fromLocation = task.to;
        agv.status = "UNLOADING";
        agv.legTicks = state.config.agvHandlingTicks;
        agv.ticksRemaining = agv.legTicks;
        agv.progress = 0;
        break;
      case "UNLOADING": {
        const moved = agv.cargo.reduce((total, lot) => total + lot.quantity, 0);
        if (agv.cargoMaterialId !== null && moved > 0) {
          deposit(state, agv.cargoMaterialId, task.to, agv.cargo);
        }
        task.status = "COMPLETED";
        task.completedAt = state.time;
        emit(state, "AGV_TASK_COMPLETED", agv.id, task.id, {
          material: task.materialId,
          quantity: moved,
          to: task.to,
        });
        agv.cargo.length = 0;
        agv.cargoMaterialId = null;
        agv.taskId = null;
        agv.status = "IDLE";
        agv.completedTasks += 1;
        agv.progress = 1;
        break;
      }
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 6 — station execution
// ---------------------------------------------------------------------------

/**
 * Stations advance downstream-first so a unit cannot skip through several
 * operations in a single tick, and so buffer space freed downstream is only
 * visible to the upstream station on the next tick — the way a real line feels.
 */
function advanceStations(state: SimulationState): void {
  // Her hat kendi içinde aşağıdan yukarı işleniyor. Hatlar arası sıra sabit:
  // değişirse aynı tohum farklı koşu üretir.
  const order = state.config.lines.flatMap((line) => [
    line.reworkStationId,
    ...[...line.route].reverse(),
  ]);
  for (const stationId of order) processMachine(state, stationId);

  // Second pass: pick up units that arrived after a station had already taken
  // its turn this tick. Without it a station would end the tick reported as
  // starved while a unit sits in its buffer — true to the tick order, but a
  // contradiction to anyone reading the board. Starting still costs a full
  // cycle, so this does not let a unit skip an operation.
  for (const stationId of order) {
    const machine = findMachine(state, stationId);
    if (machine.currentProductId !== null || machine.queue.length === 0) continue;
    if (machine.status !== "IDLE" && machine.status !== "STARVED") continue;
    startNextUnit(state, machine, stationById(state.config, stationId), false);
  }
}

/**
 * Advance one station by one tick.
 *
 * A machine spends each tick in exactly one accounted state — running, blocked,
 * starved, idle or down. `charged` enforces that: a tick that finishes a unit
 * and then finds the next buffer full is a running tick, not a running tick
 * *and* a blocked tick. Without it the station's time ledger sums past 100% and
 * every loss attribution built on it overstates the loss.
 */
function processMachine(state: SimulationState, stationId: string): void {
  const machine = findMachine(state, stationId);
  const station = stationById(state.config, stationId);
  if (machine.status === "DOWN") return; // charged as downtime in the health phase
  let charged = false;

  if (machine.status === "RUNNING") {
    machine.remainingTicks -= 1;
    machine.runTicks += 1;
    machine.energyKwh += station.runEnergyKwhPerTick;
    charged = true;
    if (machine.remainingTicks > 0) return;
    completeOperation(state, machine, station);
  }

  if (machine.status === "BLOCKED") {
    if (!tryHandoff(state, machine)) {
      if (!charged) {
        machine.blockedTicks += 1;
        machine.energyKwh += station.idleEnergyKwhPerTick;
      }
      return;
    }
  }

  if (machine.currentProductId === null) startNextUnit(state, machine, station, !charged);
}

/**
 * Try to begin the next operation.
 *
 * `chargeTick` is false when this tick has already been accounted for — on the
 * reconciliation pass, or when the station just finished a unit — so a station
 * can never pay for the same minute twice.
 */
function startNextUnit(
  state: SimulationState,
  machine: Machine,
  station: StationConfig,
  chargeTick: boolean,
): void {
  const productId = machine.queue[0];
  if (productId === undefined) {
    // "Besleme yok" mu "boşta" mı: makinenin **kendi hattında** açık araç
    // varsa besleme bekliyordur. Tesis genelinde sayılsaydı, hiç işi olmayan
    // bir hattın istasyonları komşu hat çalıştığı için "besleme yok"
    // görünürdü — sorunu yanlış yere gösteren bir etiket.
    machine.status = activeWip(state, machine.lineId) > 0 ? "STARVED" : "IDLE";
    if (!chargeTick) return;
    if (machine.status === "STARVED") machine.starvedTicks += 1;
    else machine.idleTicks += 1;
    machine.energyKwh += station.idleEnergyKwhPerTick;
    return;
  }

  const lineSide = lineSideLocation(station.id);
  for (const item of station.consumes) {
    if (availableQuantity(state, item.materialId, lineSide) >= item.quantity) continue;
    machine.status = "STARVED";
    if (chargeTick) {
      machine.starvedTicks += 1;
      machine.energyKwh += station.idleEnergyKwhPerTick;
    }
    if (chargeTick) {
      emit(state, "STATION_STARVED", machine.id, machine.id, {
        material: item.materialId,
        required: item.quantity,
      });
    }
    raiseAlert(
      state,
      `lineside:${station.id}:${item.materialId}`,
      "MATERIAL_SHORTAGE",
      "warning",
      station.id,
      `${station.name} hat kenarında ${materialName(state.config, item.materialId)} kalmadı.`,
    );
    return;
  }
  for (const item of station.consumes) {
    resolveAlert(state, `lineside:${station.id}:${item.materialId}`);
  }

  machine.queue.shift();
  const product = requireProduct(state, productId);

  for (const item of station.consumes) {
    const allocations = withdraw(state, item.materialId, lineSide, item.quantity);
    for (const lot of allocations) {
      if (!product.consumedMaterialBatchIds.includes(lot.batchId)) {
        product.consumedMaterialBatchIds.push(lot.batchId);
      }
      emit(state, "MATERIAL_CONSUMED", station.id, product.id, {
        material: item.materialId,
        batch: lot.batchId,
        quantity: lot.quantity,
      });
    }
  }

  const jitter =
    station.cycleJitter === 0 ? 0 : state.rng.nextInt(-station.cycleJitter, station.cycleJitter);
  machine.currentProductId = product.id;
  machine.remainingTicks = Math.max(1, station.cycleTicks + jitter);
  machine.status = "RUNNING";
  if (chargeTick) {
    // Loading the unit is part of the operation, so the tick is production time.
    machine.runTicks += 1;
    machine.energyKwh += station.runEnergyKwhPerTick;
  }
  product.currentMachineId = machine.id;
  product.operationStartedAt = state.time;
  product.remainingTicks = machine.remainingTicks;
  product.status =
    station.id === lineOf(state, product).reworkStationId ? "IN_REWORK" : "IN_PRODUCTION";
  emit(state, "MACHINE_STARTED", machine.id, product.id, {
    station: station.name,
    plannedTicks: machine.remainingTicks,
  });
}

function completeOperation(state: SimulationState, machine: Machine, station: StationConfig): void {
  const productId = machine.currentProductId;
  if (productId === null) return;
  const product = requireProduct(state, productId);

  const startedAt = product.operationStartedAt ?? state.time;
  const duration = state.time - startedAt;
  product.history.push({
    stationId: station.id,
    machineId: machine.id,
    startedAt,
    completedAt: state.time,
    reworkPass: product.reworkCount,
  });
  product.remainingTicks = 0;
  machine.producedCount += 1;
  machine.cycleWindow.push(duration);
  if (machine.cycleWindow.length > state.config.analysisWindowTicks) machine.cycleWindow.shift();
  emit(state, "OPERATION_COMPLETED", machine.id, product.id, {
    station: station.name,
    durationTicks: duration,
    reworkPass: product.reworkCount,
  });

  if (station.id === lineOf(state, product).reworkStationId) {
    completeRework(state, product);
  } else {
    completeProductionStep(state, product, station);
  }

  if (!tryHandoff(state, machine)) machine.status = "BLOCKED";
}

function completeRework(state: SimulationState, product: ProductUnit): void {
  for (const defectId of product.defectIds) {
    const defect = state.defectIndex.get(defectId);
    if (!defect || defect.resolved) continue;
    defect.resolved = true;
    defect.resolvedAt = state.time;
  }
  product.status = "QUEUED";
  const line = lineOf(state, product);
  emit(state, "REWORK_COMPLETED", line.reworkStationId, product.id, {
    reworkCount: product.reworkCount,
    returnsTo: line.route[product.stageIndex] ?? "UNKNOWN",
  });
  resolveAlert(state, `quality:${product.id}`);
}

function completeProductionStep(
  state: SimulationState,
  product: ProductUnit,
  station: StationConfig,
): void {
  injectDefect(state, product, station);
  const inspection = station.inspection.enabled ? runInspection(state, product, station) : null;
  const isFinalStage = product.stageIndex === lineOf(state, product).route.length - 1;

  if (inspection !== null && inspection.result === "FAIL") {
    emit(state, "QUALITY_CHECK_FAILED", station.id, product.id, {
      disposition: product.reworkCount >= state.config.maxReworkPasses ? "SCRAP" : "REWORK",
      defectProbability: inspection.defectProbability,
      falsePositive: inspection.falsePositive,
    });

    if (product.reworkCount >= state.config.maxReworkPasses) {
      scrapProduct(state, product, station);
      return;
    }

    product.reworkCount += 1;
    product.status = "IN_REWORK";
    emit(state, "REWORK_STARTED", lineOf(state, product).reworkStationId, product.id, {
      pass: product.reworkCount,
      from: station.id,
    });
    raiseAlert(
      state,
      `quality:${product.id}`,
      "QUALITY_FAILURE",
      "warning",
      product.id,
      `${product.id} ${station.name} kontrolünden geçemedi; tamire gönderildi (${product.reworkCount}. tur).`,
    );
    return;
  }

  if (inspection !== null) {
    emit(state, "QUALITY_CHECK_PASSED", station.id, product.id, {
      final: isFinalStage,
      defectProbability: inspection.defectProbability,
    });
  }

  if (!isFinalStage) {
    product.stageIndex += 1;
    product.status = "QUEUED";
    return;
  }

  product.status = "READY_TO_SHIP";
  product.completedAt = state.time;
  const order = workOrderOf(state, product);
  order.completed += 1;
  emit(state, "PRODUCT_COMPLETED", product.lineId, product.id, {
    workOrder: order.id,
    leadTimeTicks: state.time - (product.releasedAt ?? state.time),
    reworkCount: product.reworkCount,
  });

  // A defect that survives the final gate is a defect the customer receives.
  for (const defectId of product.defectIds) {
    const defect = state.defectIndex.get(defectId);
    if (!defect || defect.detected || defect.resolved) continue;
    emit(state, "DEFECT_ESCAPED", station.id, product.id, {
      defect: defect.type,
      origin: defect.originStationId,
      severity: defect.severity,
    });
  }

  closeWorkOrderIfDone(state, order);
}

function scrapProduct(state: SimulationState, product: ProductUnit, station: StationConfig): void {
  product.status = "SCRAPPED";
  product.scrappedAt = state.time;
  const order = workOrderOf(state, product);
  order.scrapped += 1;
  emit(state, "PRODUCT_SCRAPPED", station.id, product.id, {
    workOrder: order.id,
    reworkPasses: product.reworkCount,
  });
  raiseAlert(
    state,
    `scrap:${product.id}`,
    "SCRAP",
    "critical",
    product.id,
    `${product.id} ${product.reworkCount} tamir turundan sonra hurdaya ayrıldı.`,
  );
  resolveAlert(state, `quality:${product.id}`);
  closeWorkOrderIfDone(state, order);
}

function closeWorkOrderIfDone(state: SimulationState, order: WorkOrder): void {
  if (order.status === "COMPLETED") return;
  if (order.completed + order.scrapped < order.quantity) return;
  order.status = "COMPLETED";
  order.completedAt = state.time;
  emit(state, "WORK_ORDER_COMPLETED", "planning", order.id, {
    completed: order.completed,
    scrapped: order.scrapped,
    dueTick: order.dueTick,
    late: state.time > order.dueTick,
  });
}

/**
 * A process defect is physical truth, so it is created silently: the factory
 * only learns about it if an inspection finds it. Emitting an event here would
 * give the dashboard information no real plant has.
 */
function injectDefect(state: SimulationState, product: ProductUnit, station: StationConfig): void {
  if (station.defectTypes.length === 0) return;
  const rate = Math.min(0.95, station.defectRate * state.defectRateMultiplier);
  if (!state.rng.chance(rate)) return;

  state.counters.defect += 1;
  const severity: DefectSeverity = state.rng.chance(0.15)
    ? "critical"
    : state.rng.chance(0.45)
      ? "major"
      : "minor";
  const defect: Defect = {
    id: `DEF-${String(state.counters.defect).padStart(5, "0")}`,
    productId: product.id,
    type: state.rng.pick(station.defectTypes),
    severity,
    originStationId: station.id,
    createdAt: state.time,
    detected: false,
    detectedAt: null,
    detectedBy: null,
    resolved: false,
    resolvedAt: null,
  };
  state.defects.push(defect);
  state.defectIndex.set(defect.id, defect);
  product.defectIds.push(defect.id);
}

/**
 * Vision/dimensional inspection with finite recall and a false-positive rate.
 * The gate sees every unresolved defect on the unit — not just the ones created
 * at this station — which is why an escaped weld defect can still be caught at
 * the final gate.
 */
function runInspection(
  state: SimulationState,
  product: ProductUnit,
  station: StationConfig,
): Inspection {
  const present = product.defectIds
    .map((id) => state.defectIndex.get(id))
    .filter(
      (defect): defect is Defect => defect !== undefined && !defect.resolved && !defect.detected,
    );

  const camera = station.inspection.cameraId ?? station.id;
  // The engine asks; it does not look. Marking the defects and deciding what
  // the result means stays here, because those are factory rules, not vision.
  const outcome = state.inspector.inspect(
    {
      productId: product.id,
      stationId: station.id,
      cameraId: station.inspection.cameraId,
      method: station.inspection.method,
      simulatedTime: state.time,
      presentDefects: present,
    },
    station,
  );

  const detectedIds = new Set(outcome.detectedDefectIds);
  const detected: Defect[] = [];
  for (const defect of present) {
    if (!detectedIds.has(defect.id)) continue;
    defect.detected = true;
    defect.detectedAt = state.time;
    defect.detectedBy = camera;
    detected.push(defect);
  }

  const falsePositive = outcome.falsePositive;
  const result = detected.length > 0 || falsePositive ? "FAIL" : "PASS";
  const defectProbability = outcome.defectProbability;

  state.counters.inspection += 1;
  const inspection: Inspection = {
    id: `INS-${String(state.counters.inspection).padStart(6, "0")}`,
    productId: product.id,
    stationId: station.id,
    cameraId: station.inspection.cameraId,
    method: station.inspection.method,
    occurredAt: state.time,
    result,
    defectProbability: Number(defectProbability.toFixed(3)),
    detectedDefectIds: detected.map((defect) => defect.id),
    falsePositive,
    inspectorKind: state.inspector.kind,
  };
  state.inspections.push(inspection);
  product.inspectionIds.push(inspection.id);

  emit(state, "INSPECTION_COMPLETED", station.inspection.cameraId ?? station.id, product.id, {
    method: inspection.method,
    result,
    defectProbability: inspection.defectProbability,
    detected: detected.length,
  });
  for (const defect of detected) {
    emit(state, "DEFECT_DETECTED", station.inspection.cameraId ?? station.id, product.id, {
      defect: defect.type,
      severity: defect.severity,
      origin: defect.originStationId,
      inspection: inspection.id,
    });
  }

  return inspection;
}

/** Move the finished unit onward; false means the station is blocked. */
function tryHandoff(state: SimulationState, machine: Machine): boolean {
  const productId = machine.currentProductId;
  if (productId === null) return true;
  const product = requireProduct(state, productId);

  let accepted = false;
  switch (product.status) {
    case "SCRAPPED":
    case "READY_TO_SHIP":
      accepted = true;
      break;
    case "IN_REWORK": {
      // Araç kendi hattının tamir hücresine gidiyor. Tek hücre olsaydı üç
      // hattın tamiri aynı kuyruğa düşer ve bir hattın kalite sorunu
      // diğerlerinin akışını tıkardı.
      const reworkId = lineOf(state, product).reworkStationId;
      const rework = findMachine(state, reworkId);
      const reworkStation = stationById(state.config, reworkId);
      if (rework.queue.length < reworkStation.bufferCapacity) {
        rework.queue.push(productId);
        accepted = true;
      }
      break;
    }
    case "QUEUED": {
      const nextId = lineOf(state, product).route[product.stageIndex];
      if (nextId === undefined) {
        accepted = true;
        break;
      }
      const next = findMachine(state, nextId);
      const nextStation = stationById(state.config, nextId);
      if (next.queue.length < nextStation.bufferCapacity) {
        next.queue.push(productId);
        accepted = true;
      }
      break;
    }
    default:
      accepted = true;
      break;
  }

  if (!accepted) {
    if (machine.status !== "BLOCKED") {
      emit(state, "STATION_BLOCKED", machine.id, product.id, {
        reason: product.status === "IN_REWORK" ? "rework-buffer-full" : "downstream-buffer-full",
      });
    }
    return false;
  }

  machine.currentProductId = null;
  machine.status = "IDLE";
  product.currentMachineId = null;
  product.operationStartedAt = null;
  return true;
}

// ---------------------------------------------------------------------------
// Phase 7 — shipment
// ---------------------------------------------------------------------------

/**
 * Çıkış yolunun bir taşıyıcı için boşalma süresi.
 *
 * Taşıyıcı rampadan kapıya kadar bu kadar dakika yolda; o sürede ikinci bir
 * taşıyıcı yola çıkmıyor.
 */
const EXIT_ROAD_TICKS = 3;

/** Çıkış yolunda o an başka bir taşıyıcı var mı? */
function cikisYoluBos(state: SimulationState): boolean {
  return !state.shipments.some(
    (shipment) =>
      shipment.actualDeparture !== null && state.time - shipment.actualDeparture < EXIT_ROAD_TICKS,
  );
}

/** Aynı olayı her tikte tekrar üretmemek için: anahtar başına bir kez. */
function emitOnce(state: SimulationState, key: string, üret: () => void): void {
  if (state.emittedOnce.has(key)) return;
  state.emittedOnce.add(key);
  üret();
}

function updateLogistics(state: SimulationState): void {
  const plan = state.config.shipmentPlan;

  for (const product of state.products) {
    if (product.status !== "READY_TO_SHIP" || product.shipmentId !== null) continue;
    // Taşıyıcı **kendi hattının** araçlarını topluyor.
    let shipment = state.shipments.find(
      (candidate) =>
        candidate.lineId === product.lineId &&
        candidate.status === "PLANNED" &&
        candidate.productIds.length < candidate.capacity,
    );
    if (!shipment) {
      state.counters.shipment += 1;
      const line = lineById(state.config, product.lineId);
      shipment = {
        id: `SHP-2026-${String(state.counters.shipment).padStart(4, "0")}`,
        lineId: line.id,
        customer: plan.customer,
        destination: plan.destination,
        vehicle: plan.vehicle,
        capacity: plan.capacity,
        productIds: [],
        status: "PLANNED",
        // The plan is when a carrier *should* leave: long enough to fill at
        // takt, plus loading. Dating it from "now" would mark every shipment
        // late the moment it opened, which tells an operator nothing.
        // Taşıyıcı tek hattan doluyor, o yüzden **o hattın** taktıyla:
        // tesis ortalaması, bir hattın kendi hızını gizlerdi.
        plannedDeparture:
          state.time +
          Math.round(plan.capacity * (state.config.shiftTicks / line.demandPerShift)) +
          plan.loadingTicks,
        actualDeparture: null,
        deliveredAt: null,
        ticksRemaining: 0,
      };
      state.shipments.push(shipment);
      emit(state, "SHIPMENT_CREATED", "shipping", shipment.id, {
        line: shipment.lineId,
        customer: shipment.customer,
        destination: shipment.destination,
        capacity: shipment.capacity,
      });
    }
    shipment.productIds.push(product.id);
    product.shipmentId = shipment.id;
    if (shipment.productIds.length >= shipment.capacity) shipment.status = "READY";
  }

  for (const shipment of state.shipments) {
    switch (shipment.status) {
      case "READY":
        shipment.status = "LOADING";
        shipment.ticksRemaining = plan.loadingTicks;
        setShipmentProducts(state, shipment.productIds, "LOADING");
        emit(state, "SHIPMENT_LOADING", LOCATIONS.shipping, shipment.id, {
          units: shipment.productIds.length,
        });
        break;
      case "LOADING":
        if (shipment.ticksRemaining > 0) shipment.ticksRemaining -= 1;
        if (shipment.ticksRemaining > 0) break;
        // Çıkış yolu tek ve paylaşılan: aynı anda bir taşıyıcı geçer.
        //
        // Üç hattın taşıyıcısı aynı takta dolduğu için yüklemeleri de aynı
        // dakikaya denk geliyordu; üçü birden kapıya yürüseydi sahnede iç içe
        // geçerlerdi. Bekleyen taşıyıcı rampada kalıyor, sırası gelince
        // çıkıyor — kapının önünde kuyruk olması uydurma değil, tek kapılı bir
        // tesisin gerçeği.
        if (!cikisYoluBos(state)) {
          emitOnce(state, `exit-queue:${shipment.id}`, () =>
            emit(state, "SHIPMENT_LOADING", LOCATIONS.shipping, shipment.id, {
              line: shipment.lineId,
              waitingFor: "çıkış kapısı",
            }),
          );
          break;
        }
        shipment.status = "DISPATCHED";
        shipment.actualDeparture = state.time;
        shipment.ticksRemaining = plan.transitTicks;
        setShipmentProducts(state, shipment.productIds, "DISPATCHED");
        emit(state, "SHIPMENT_DISPATCHED", LOCATIONS.shipping, shipment.id, {
          units: shipment.productIds.length,
          plannedDeparture: shipment.plannedDeparture,
          actualDeparture: shipment.actualDeparture,
          destination: shipment.destination,
        });
        break;
      case "DISPATCHED":
        shipment.status = "IN_TRANSIT";
        setShipmentProducts(state, shipment.productIds, "IN_TRANSIT");
        break;
      case "IN_TRANSIT":
        shipment.ticksRemaining -= 1;
        if (shipment.ticksRemaining > 0) break;
        shipment.status = "DELIVERED";
        shipment.deliveredAt = state.time;
        setShipmentProducts(state, shipment.productIds, "DELIVERED");
        emit(state, "SHIPMENT_DELIVERED", shipment.destination, shipment.id, {
          units: shipment.productIds.length,
        });
        break;
      default:
        break;
    }
  }
}

function setShipmentProducts(
  state: SimulationState,
  productIds: readonly string[],
  status: ProductUnit["status"],
): void {
  for (const productId of productIds) {
    const product = state.productIndex.get(productId);
    if (product) product.status = status;
  }
}

// ---------------------------------------------------------------------------
// Phase 8 — schedule review
// ---------------------------------------------------------------------------

function reviewSchedule(state: SimulationState): void {
  for (const order of state.workOrders) {
    const key = `schedule:${order.id}`;
    if (order.status === "COMPLETED") {
      resolveAlert(state, key);
      continue;
    }
    const remaining = order.quantity - order.completed - order.scrapped;
    const ticksLeft = order.dueTick - state.time;
    // Emrin kendi hattının taktı: hatlar farklı talep taşıyabilir ve tesis
    // ortalaması, yavaş bir hattın riskini gizlerdi.
    const taktTime = state.config.shiftTicks / lineById(state.config, order.lineId).demandPerShift;
    if (ticksLeft <= 0 || remaining * taktTime > ticksLeft) {
      raiseAlert(
        state,
        key,
        "SCHEDULE_RISK",
        ticksLeft <= 0 ? "critical" : "warning",
        order.id,
        ticksLeft <= 0
          ? `${order.id} termini geçti; ${remaining} araç hâlâ bitmedi (${-ticksLeft} dk gecikme).`
          : `${order.id} için ${remaining} araç kaldı, termine ${ticksLeft} dk var.`,
      );
    } else {
      resolveAlert(state, key);
    }
  }
}
