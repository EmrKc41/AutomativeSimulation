import type { FactoryMetrics, Machine, MachineMetric, ProductUnit } from "./domain.ts";
import { stationById } from "./factory.ts";
import { emit, raiseAlert, resolveAlert, type SimulationState } from "./state.ts";

/**
 * KPI projection and constraint detection.
 *
 * These are read models: they never change factory state, only summarise it,
 * so a dashboard, the copilot and a scenario comparison all read the same
 * numbers computed the same way.
 */

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  return denominator === 0 ? fallback : numerator / denominator;
}

function pushWindow(window: number[], value: number, limit: number): void {
  window.push(value);
  if (window.length > limit) window.shift();
}

/** Windowed utilisation from cumulative run-tick samples. */
export function windowedUtilization(machine: Machine): number {
  const samples = machine.utilizationWindow;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (samples.length < 2 || first === undefined || last === undefined) return 0;
  return (last - first) / (samples.length - 1);
}

/** True when the input buffer is trending upwards over the window. */
function queueGrowing(machine: Machine): boolean {
  const samples = machine.queueWindow;
  if (samples.length < 6) return false;
  const half = Math.floor(samples.length / 2);
  return average(samples.slice(half)) > average(samples.slice(0, half)) + 0.5;
}

/** True when recent operations run measurably slower than the nominal cycle. */
function cycleDeviating(machine: Machine, nominalCycleTicks: number): boolean {
  if (machine.cycleWindow.length < 3) return false;
  return average(machine.cycleWindow) > nominalCycleTicks * 1.15;
}

/**
 * Record one tick of observations for every machine.
 *
 * Called once per tick after the stations have advanced, so the windows behind
 * bottleneck detection are sampled at a fixed rate.
 */
export function sampleMachines(state: SimulationState): void {
  const limit = state.config.analysisWindowTicks + 1;
  for (const machine of state.machines) {
    pushWindow(machine.utilizationWindow, machine.runTicks, limit);
    pushWindow(machine.queueWindow, machine.queue.length, limit);
    machine.utilization = safeDivide(machine.runTicks, Math.max(1, state.time));
    machine.availability = safeDivide(
      Math.max(0, state.time - machine.downtimeTicks),
      Math.max(1, state.time),
      1,
    );
  }
}

/** Sustained utilisation threshold a station must clear to be a candidate. */
const BOTTLENECK_UTILIZATION = 0.75;

/**
 * Flag constraints.
 *
 * Utilisation alone is not a bottleneck — a fast station can be busy and still
 * not constrain the line. A station is reported as the constraint when it is
 * the line's busiest resource, is sustainably busy, AND work is waiting or
 * piling up in front of it or its operations have slowed. A stopped station
 * with a backlog is a constraint by definition, whatever its utilisation.
 */
export function detectBottlenecks(state: SimulationState): void {
  const routeMachines = state.machines.filter(
    (machine) => machine.id !== state.config.reworkStationId,
  );
  const busiest = routeMachines.reduce<Machine | null>(
    (leader, machine) =>
      leader === null || windowedUtilization(machine) > windowedUtilization(leader)
        ? machine
        : leader,
    null,
  );

  for (const machine of routeMachines) {
    const station = stationById(state.config, machine.id);
    const utilization = windowedUtilization(machine);
    const growing = queueGrowing(machine);
    const slowed = cycleDeviating(machine, station.cycleTicks);
    const waiting = average(machine.queueWindow) >= 1;
    const stoppedWithBacklog =
      (machine.status === "DOWN" || machine.status === "MAINTENANCE") && machine.queue.length > 0;
    const isBottleneck =
      (machine === busiest &&
        utilization >= BOTTLENECK_UTILIZATION &&
        (growing || slowed || waiting)) ||
      stoppedWithBacklog;
    const key = `bottleneck:${machine.id}`;

    if (isBottleneck && !machine.bottleneck) {
      machine.bottleneck = true;
      emit(state, "BOTTLENECK_DETECTED", state.config.lineId, machine.id, {
        utilization: Number(utilization.toFixed(3)),
        queueLength: machine.queue.length,
        queueGrowing: growing,
        cycleDeviation: slowed,
      });
      raiseAlert(
        state,
        key,
        "BOTTLENECK",
        "warning",
        machine.id,
        `${machine.station} hattı tutuyor: %${Math.round(utilization * 100)} doluluk, önünde ${machine.queue.length} araç bekliyor.`,
      );
    } else if (!isBottleneck && machine.bottleneck) {
      machine.bottleneck = false;
      emit(state, "BOTTLENECK_CLEARED", state.config.lineId, machine.id, {
        utilization: Number(utilization.toFixed(3)),
      });
      resolveAlert(state, key);
    }
  }
}

function isFinished(product: ProductUnit): boolean {
  return product.completedAt !== null;
}

export function computeMetrics(state: SimulationState): FactoryMetrics {
  const elapsed = Math.max(1, state.time);
  const routeIds = new Set(state.config.route);
  const routeMachines = state.machines.filter((machine) => routeIds.has(machine.id));

  const completed = state.products.filter(isFinished);
  const scrapped = state.products.filter((product) => product.status === "SCRAPPED");
  const unitsOut = completed.length + scrapped.length;
  const reworked = completed.filter((product) => product.reworkCount > 0).length;

  const downtime = routeMachines.reduce((total, machine) => total + machine.downtimeTicks, 0);
  const failures = routeMachines.reduce((total, machine) => total + machine.failureCount, 0);
  const availability = average(routeMachines.map((machine) => machine.availability));

  // Performance compares actual output against what the line's slowest station
  // could have produced in the time it was actually available.
  const idealLineCycle = Math.max(
    ...state.config.route.map((id) => stationById(state.config, id).cycleTicks),
  );
  const lineRunTime = Math.max(1, elapsed * availability);
  const performance = Math.min(1, safeDivide(idealLineCycle * unitsOut, lineRunTime));
  const quality = safeDivide(completed.length, unitsOut, 1);

  const detectedDefects = state.defects.filter((defect) => defect.detected).length;
  const escapedDefects = state.defects.filter((defect) => {
    if (defect.detected || defect.resolved) return false;
    const product = state.productIndex.get(defect.productId);
    return product !== undefined && isFinished(product);
  }).length;

  const taktTime = safeDivide(state.config.shiftTicks, state.config.demandPerShift);
  const expectedByNow =
    taktTime === 0
      ? 0
      : Math.min(
          state.workOrders.reduce((total, order) => total + order.quantity, 0),
          Math.floor(elapsed / taktTime),
        );

  const machineMetrics: MachineMetric[] = state.machines.map((machine) => ({
    machineId: machine.id,
    station: machine.station,
    status: machine.status,
    utilization: machine.utilization,
    availability: machine.availability,
    queueLength: machine.queue.length,
    bottleneck: machine.bottleneck,
    downtime: machine.downtimeTicks,
    producedCount: machine.producedCount,
    energyKwh: Number(machine.energyKwh.toFixed(2)),
  }));

  const latestShipment = state.shipments[state.shipments.length - 1];

  return {
    simulatedTime: state.time,
    availability,
    performance,
    quality,
    oee: availability * performance * quality,
    productionOutput: completed.length,
    plannedProduction: state.workOrders.reduce((total, order) => total + order.quantity, 0),
    scrapRate: safeDivide(scrapped.length, unitsOut),
    reworkRate: safeDivide(reworked, unitsOut),
    firstPassYield: safeDivide(unitsOut - reworked - scrapped.length, unitsOut, 1),
    // Average time between two consecutive units leaving the line.
    cycleTime: safeDivide(elapsed, unitsOut),
    taktTime,
    throughput: safeDivide(unitsOut, elapsed),
    downtime,
    mtbf: failures === 0 ? elapsed : safeDivide(elapsed - downtime, failures),
    mttr: safeDivide(downtime, failures),
    wip: state.products.filter(
      (product) =>
        product.status === "QUEUED" ||
        product.status === "IN_PRODUCTION" ||
        product.status === "IN_REWORK",
    ).length,
    lineUtilization: average(routeMachines.map((machine) => machine.utilization)),
    machineUtilization: average(state.machines.map((machine) => machine.utilization)),
    energyConsumptionKwh: Number(
      state.machines.reduce((total, machine) => total + machine.energyKwh, 0).toFixed(2),
    ),
    inventoryOnHand: state.inventory
      .filter((balance) => balance.status === "AVAILABLE")
      .reduce((total, balance) => total + balance.quantity, 0),
    shipmentStatus: latestShipment?.status ?? "PLANNED",
    bottleneck: state.machines.find((machine) => machine.bottleneck)?.id ?? null,
    openAlerts: state.openAlertKeys.size,
    detectedDefects,
    escapedDefects,
    scheduleAdherence: expectedByNow === 0 ? 1 : Math.min(1, completed.length / expectedByNow),
    machines: machineMetrics,
  };
}
