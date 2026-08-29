import assert from "node:assert/strict";
import test from "node:test";

import type { SimulationResult } from "./domain.ts";
import { scenarioKinds } from "./scenarios.ts";
import { compareScenarios, runScenario } from "./simulation.ts";

const TICKS = 300;
const SEED = 42;

function baseline(): SimulationResult {
  return runScenario({ kind: "normal", ticks: TICKS, seed: SEED });
}

function has(result: SimulationResult, type: string): boolean {
  return result.events.some((event) => event.type === type);
}

test("the baseline run turns material into delivered vehicles", () => {
  const result = baseline();

  assert.ok(result.metrics.productionOutput > 0);
  assert.ok(result.shipments.some((shipment) => shipment.status === "DELIVERED"));
  assert.ok(has(result, "MATERIAL_RECEIVED"));
  assert.ok(has(result, "PRODUCTION_STARTED"));
  assert.ok(has(result, "PRODUCT_COMPLETED"));
  assert.ok(has(result, "SHIPMENT_DISPATCHED"));
  assert.equal(result.metrics.scheduleAdherence, 1, "the healthy line must keep up with takt");
});

test("a station breakdown costs availability and is opened and closed as one alert", () => {
  const result = runScenario({ kind: "machine_failure", ticks: TICKS, seed: SEED });
  const reference = baseline();
  const welding = result.machines.find((machine) => machine.id === "WELD-04");

  assert.ok(has(result, "MACHINE_FAILURE"));
  assert.ok(has(result, "MAINTENANCE_STARTED"));
  assert.ok(has(result, "MAINTENANCE_COMPLETED"));
  assert.ok((welding?.availability ?? 1) < 1);
  assert.ok(result.metrics.downtime > reference.metrics.downtime);
  assert.ok(result.metrics.availability < reference.metrics.availability);

  const failureAlerts = result.alerts.filter((alert) => alert.code === "MACHINE_FAILURE");
  assert.ok(failureAlerts.length > 0);
  assert.ok(
    failureAlerts.some((alert) => alert.resolvedAt !== null),
    "a repaired machine must close its alert instead of leaving it open forever",
  );
});

test("what a stop costs depends on where it lands, not only how long it lasts", () => {
  const reference = baseline();
  const oneStation = runScenario({ kind: "machine_failure", ticks: TICKS, seed: SEED });
  const wholeLine = runScenario({ kind: "line_stop", ticks: TICKS, seed: SEED });

  const oneStationLoss = reference.metrics.productionOutput - oneStation.metrics.productionOutput;
  const wholeLineLoss = reference.metrics.productionOutput - wholeLine.metrics.productionOutput;

  assert.ok(oneStationLoss > 0, "a stop on the route must cost output");
  assert.ok(
    wholeLineLoss > oneStationLoss,
    "stopping every station must cost more than stopping one of them",
  );
  assert.ok(wholeLine.metrics.downtime > oneStation.metrics.downtime * 3);
});

test("supply reduction starves the line and is reported as a material shortage", () => {
  const result = runScenario({ kind: "material_shortage", ticks: TICKS, seed: SEED });
  const reference = baseline();

  assert.ok(result.metrics.productionOutput < reference.metrics.productionOutput);
  assert.ok(has(result, "MATERIAL_SHORTAGE") || has(result, "STATION_STARVED"));
  assert.ok(
    result.alerts.some((alert) => alert.code === "MATERIAL_SHORTAGE"),
    "a starved line must raise a material alert",
  );
  assert.ok(result.metrics.inventoryOnHand < reference.metrics.inventoryOnHand);
});

test("process capability loss shows up as rework, scrap and lower first pass yield", () => {
  const result = runScenario({ kind: "quality_failure", ticks: TICKS, seed: SEED });
  const reference = baseline();

  assert.ok(result.metrics.firstPassYield < reference.metrics.firstPassYield);
  assert.ok(result.metrics.reworkRate > reference.metrics.reworkRate);
  assert.ok(result.metrics.scrapRate > 0, "repeated failures must eventually scrap a unit");
  assert.ok(has(result, "DEFECT_DETECTED"));
  assert.ok(has(result, "QUALITY_CHECK_FAILED"));
  assert.ok(has(result, "REWORK_STARTED"));
  assert.ok(has(result, "REWORK_COMPLETED"));
  assert.ok(has(result, "PRODUCT_SCRAPPED"));
});

test("extra demand does not create capacity, it creates schedule risk", () => {
  const result = runScenario({ kind: "demand_surge", ticks: TICKS, seed: SEED });
  const reference = baseline();

  assert.ok(result.metrics.plannedProduction > reference.metrics.plannedProduction);
  assert.ok(result.metrics.productionOutput <= reference.metrics.productionOutput);
  assert.ok(
    result.alerts.some((alert) => alert.code === "SCHEDULE_RISK"),
    "an order the line cannot finish on time must be flagged",
  );
});

test("a full line outage stops every route station and cuts output hardest", () => {
  const result = runScenario({ kind: "line_stop", ticks: TICKS, seed: SEED });
  const reference = baseline();

  for (const machineId of ["PRESS-01", "WELD-04", "PAINT-01", "ASSEMBLY-01", "FINAL-QC"]) {
    const machine = result.machines.find((candidate) => candidate.id === machineId);
    assert.ok((machine?.downtimeTicks ?? 0) >= 40, `${machineId} should have stopped`);
  }
  assert.ok(result.metrics.productionOutput < reference.metrics.productionOutput);
});

test("scenario comparison is measured against the same baseline and seed", () => {
  const rows = compareScenarios(scenarioKinds, 200, SEED);
  const normal = rows.find((row) => row.scenario === "normal");

  assert.equal(rows.length, scenarioKinds.length);
  assert.equal(normal?.outputDeltaVsBaseline, 0);
  for (const row of rows) {
    assert.ok(row.output >= 0);
    assert.ok(row.oee >= 0 && row.oee <= 1);
    assert.equal(row.outputDeltaVsBaseline, row.output - (normal?.output ?? 0));
  }
});

test("runScenario rejects a non-positive horizon", () => {
  assert.throws(() => runScenario({ kind: "normal", ticks: 0, seed: SEED }), /positive integer/);
});
