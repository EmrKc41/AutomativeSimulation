import type { FactoryMetrics, ScenarioInput, ScenarioKind, SimulationResult } from "./domain.ts";
import { run, snapshot } from "./engine.ts";
import { scenarios } from "./scenarios.ts";
import { createSimulation } from "./state.ts";

/**
 * Public entry point for a complete, reproducible run.
 *
 * The engine is tick-based, so a consumer that wants live behaviour should use
 * `createSimulation` plus `tick` directly. This helper is for batch runs:
 * tests, scenario comparison, and the command-line inspector.
 */
export function runScenario(input: ScenarioInput): SimulationResult {
  if (!Number.isInteger(input.ticks) || input.ticks < 1) {
    throw new Error("ticks must be a positive integer");
  }
  const scenario = scenarios[input.kind];
  const state = createSimulation({ seed: input.seed, scenario });
  run(state, input.ticks);
  return snapshot(state);
}

export interface ScenarioComparisonRow {
  readonly scenario: ScenarioKind;
  readonly label: string;
  readonly output: number;
  readonly oee: number;
  readonly firstPassYield: number;
  readonly scrapRate: number;
  readonly downtime: number;
  readonly scheduleAdherence: number;
  readonly wip: number;
  readonly energyKwh: number;
  readonly shipmentsDispatched: number;
  readonly bottleneck: string | null;
  /** Output difference against the baseline run, in units. */
  readonly outputDeltaVsBaseline: number;
}

function summarise(result: SimulationResult): Omit<ScenarioComparisonRow, "outputDeltaVsBaseline"> {
  const metrics: FactoryMetrics = result.metrics;
  return {
    scenario: result.scenario,
    label: scenarios[result.scenario].label,
    output: metrics.productionOutput,
    oee: metrics.oee,
    firstPassYield: metrics.firstPassYield,
    scrapRate: metrics.scrapRate,
    downtime: metrics.downtime,
    scheduleAdherence: metrics.scheduleAdherence,
    wip: metrics.wip,
    energyKwh: metrics.energyConsumptionKwh,
    shipmentsDispatched: result.shipments.filter(
      (shipment) =>
        shipment.status === "DISPATCHED" ||
        shipment.status === "IN_TRANSIT" ||
        shipment.status === "DELIVERED",
    ).length,
    bottleneck: metrics.bottleneck,
  };
}

/**
 * Run several scenarios on the same seed and horizon.
 *
 * Because disruptions are scheduled events rather than engine branches, and all
 * randomness comes from the same seeded stream, the differences below are
 * attributable to the disruption instead of to run-to-run noise.
 */
export function compareScenarios(
  kinds: readonly ScenarioKind[],
  ticks: number,
  seed: number,
): ScenarioComparisonRow[] {
  const baseline = summarise(runScenario({ kind: "normal", ticks, seed }));
  return kinds.map((kind) => {
    const row = kind === "normal" ? baseline : summarise(runScenario({ kind, ticks, seed }));
    return { ...row, outputDeltaVsBaseline: row.output - baseline.output };
  });
}
