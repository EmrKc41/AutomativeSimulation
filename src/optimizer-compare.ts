import type { ScenarioKind, SimulationResult } from "./domain.ts";
import { run, snapshot } from "./engine.ts";
import { factoryConfig, travelTicks } from "./factory.ts";
import {
  LegacyOptimizer,
  NearestVehicleOptimizer,
  SlackAwareOptimizer,
  type Optimizer,
} from "./optimizer.ts";
import { scenarioKinds, scenarios } from "./scenarios.ts";
import { createSimulation } from "./state.ts";

/**
 * Does the policy actually help?
 *
 * This is the part of an optimisation phase that usually goes missing. A solver
 * is wired in, the plan looks cleverer, and the improvement is asserted rather
 * than shown. Here the same seed runs the same factory twice, changing only the
 * policy, so every difference below is the policy's doing and nothing else.
 *
 * It is written to be able to report **no improvement**, and on this plant it
 * does exactly that for output — see the note on `OptimizerComparison`.
 */

export interface OptimizerRow {
  readonly optimizer: string;
  readonly scenario: ScenarioKind;
  /** Vehicles finished. The number the plant is judged on. */
  readonly output: number;
  readonly oee: number;
  readonly scheduleAdherence: number;
  /** Orders finished after their due date. */
  readonly lateOrders: number;
  /** Total minutes of lateness, which a single late order can hide. */
  readonly totalLatenessMinutes: number;
  /**
   * The worst single order.
   *
   * The number that decides whether a truck is missed. A policy that turns one
   * order 300 minutes late into four orders 20 minutes late looks worse by
   * order count and is far better on the loading dock, and only this column
   * shows it.
   */
  readonly maxLatenessMinutes: number;
  /** Every minute a vehicle spent moving. */
  readonly agvTravelMinutes: number;
  /** Of that, the minutes spent driving empty to a pickup. */
  readonly agvEmptyMinutes: number;
  /** Minutes between a pull signal and a vehicle taking it. */
  readonly avgJobWaitMinutes: number;
  readonly energyKwh: number;
}

export interface OptimizerComparison {
  readonly baseline: OptimizerRow;
  readonly candidate: OptimizerRow;
  /** candidate − baseline, so a positive output delta is more vehicles. */
  readonly delta: {
    readonly output: number;
    readonly oee: number;
    readonly lateOrders: number;
    readonly totalLatenessMinutes: number;
    readonly maxLatenessMinutes: number;
    readonly agvTravelMinutes: number;
    readonly agvEmptyMinutes: number;
    readonly energyKwh: number;
  };
}

/**
 * Minutes spent driving *with* a load.
 *
 * In the same unit the vehicles record their travel in. A first version measured
 * this in grid units against travel in minutes, so every run reported zero empty
 * running — a metric that is silently always zero is worse than no metric.
 */
function laden(result: SimulationResult): number {
  let total = 0;
  for (const task of result.moveTasks) {
    if (task.completedAt === null) continue;
    total += travelTicks(factoryConfig, task.from, task.to);
  }
  return total;
}

export function summariseRun(
  result: SimulationResult,
  optimizer: string,
  scenario: ScenarioKind,
): OptimizerRow {
  const travel = result.agvs.reduce((sum, agv) => sum + agv.travelTicks, 0);

  let lateOrders = 0;
  let lateness = 0;
  let worst = 0;
  for (const order of result.workOrders) {
    // An order that never finished is late by however long it has been overdue:
    // dropping it would let a policy look good by simply not finishing things.
    const finishedAt = order.status === "COMPLETED" ? order.completedAt : result.simulatedTime;
    const over = (finishedAt ?? result.simulatedTime) - order.dueTick;
    if (over > 0) {
      lateOrders += 1;
      lateness += over;
      worst = Math.max(worst, over);
    }
  }

  let waited = 0;
  let assigned = 0;
  for (const event of result.events) {
    if (event.type !== "AGV_TASK_ASSIGNED") continue;
    const task = result.moveTasks.find((candidate) => candidate.id === event.correlationId);
    if (!task) continue;
    assigned += 1;
    waited += event.occurredAt - task.createdAt;
  }

  return {
    optimizer,
    scenario,
    output: result.metrics.productionOutput,
    oee: result.metrics.oee,
    scheduleAdherence: result.metrics.scheduleAdherence,
    lateOrders,
    totalLatenessMinutes: lateness,
    maxLatenessMinutes: worst,
    agvTravelMinutes: travel,
    agvEmptyMinutes: Math.max(0, travel - laden(result)),
    avgJobWaitMinutes: assigned === 0 ? 0 : waited / assigned,
    energyKwh: result.metrics.energyConsumptionKwh,
  };
}

/** One run of one factory under one policy. */
export function runWith(
  optimizer: Optimizer,
  kind: ScenarioKind,
  ticks: number,
  seed: number,
): SimulationResult {
  const state = createSimulation({ seed, scenario: scenarios[kind], optimizer });
  run(state, ticks);
  return snapshot(state);
}

export function compareOptimizers(
  baseline: Optimizer,
  candidate: Optimizer,
  kind: ScenarioKind,
  ticks: number,
  seed: number,
): OptimizerComparison {
  const left = summariseRun(runWith(baseline, kind, ticks, seed), baseline.kind, kind);
  const right = summariseRun(runWith(candidate, kind, ticks, seed), candidate.kind, kind);

  return {
    baseline: left,
    candidate: right,
    delta: {
      output: right.output - left.output,
      oee: right.oee - left.oee,
      lateOrders: right.lateOrders - left.lateOrders,
      totalLatenessMinutes: right.totalLatenessMinutes - left.totalLatenessMinutes,
      maxLatenessMinutes: right.maxLatenessMinutes - left.maxLatenessMinutes,
      agvTravelMinutes: right.agvTravelMinutes - left.agvTravelMinutes,
      agvEmptyMinutes: right.agvEmptyMinutes - left.agvEmptyMinutes,
      energyKwh: right.energyKwh - left.energyKwh,
    },
  };
}

/**
 * The candidate against the baseline across every scenario and several seeds.
 *
 * One seed proves nothing: a policy can win a single run by luck and lose the
 * next four. Averaging over seeds is the least that makes a claim defensible.
 */
export function sweep(
  baseline: Optimizer,
  candidate: Optimizer,
  ticks = 600,
  seeds: readonly number[] = [1, 42, 907, 5150],
): readonly OptimizerComparison[] {
  const rows: OptimizerComparison[] = [];
  for (const kind of scenarioKinds) {
    for (const seed of seeds) {
      rows.push(compareOptimizers(baseline, candidate, kind, ticks, seed));
    }
  }
  return rows;
}

export const OPTIMIZERS: Readonly<Record<string, () => Optimizer>> = {
  /** What the engine always did. The number to beat. */
  legacy: () => new LegacyOptimizer(),
  /** What ships: finish the batch unless an order can no longer make its date. */
  "slack-aware": () => new SlackAwareOptimizer(),
  /** Measured and rejected; kept runnable so the comparison can be repeated. */
  "nearest-vehicle": () => new NearestVehicleOptimizer(),
};
