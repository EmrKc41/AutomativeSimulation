import assert from "node:assert/strict";
import test from "node:test";

import { run, tick } from "./engine.ts";
import { factoryConfig, isReworkStation, routeStationIds, totalDemandPerShift } from "./factory.ts";
import { computeMetrics, windowedUtilization } from "./metrics.ts";
import { scenarios } from "./scenarios.ts";
import { createSimulation } from "./state.ts";

function state(kind: keyof typeof scenarios = "normal", seed = 42) {
  return createSimulation({ seed, scenario: scenarios[kind] });
}

test("OEE is exactly availability x performance x quality", () => {
  const metrics = computeMetrics(run(state(), 240));

  assert.ok(
    Math.abs(metrics.oee - metrics.availability * metrics.performance * metrics.quality) < 1e-9,
  );
  for (const value of [metrics.availability, metrics.performance, metrics.quality, metrics.oee]) {
    assert.ok(value >= 0 && value <= 1, `${value} is outside 0..1`);
  }
});

test("yield components partition the units that left the line", () => {
  const simulation = run(state("quality_failure"), 300);
  const metrics = computeMetrics(simulation);

  const completed = simulation.products.filter((product) => product.completedAt !== null);
  const scrapped = simulation.products.filter((product) => product.status === "SCRAPPED");
  const unitsOut = completed.length + scrapped.length;
  const reworked = completed.filter((product) => product.reworkCount > 0).length;

  assert.ok(unitsOut > 0);
  assert.ok(Math.abs(metrics.scrapRate - scrapped.length / unitsOut) < 1e-9);
  assert.ok(Math.abs(metrics.reworkRate - reworked / unitsOut) < 1e-9);
  assert.ok(
    Math.abs(metrics.firstPassYield - (unitsOut - reworked - scrapped.length) / unitsOut) < 1e-9,
  );
  assert.ok(
    Math.abs(metrics.firstPassYield + metrics.reworkRate + metrics.scrapRate - 1) < 1e-9,
    "first pass, rework and scrap must account for every unit",
  );
});

test("takt time comes from demand, cycle time from observed output", () => {
  const simulation = run(state(), 240);
  const metrics = computeMetrics(simulation);

  // Takt tesisin tamamına ait: üç hattın talebi toplanıyor, çünkü müşteriye
  // giden araç sayısı da toplam.
  assert.equal(metrics.taktTime, factoryConfig.shiftTicks / totalDemandPerShift(factoryConfig));
  assert.ok(Math.abs(metrics.throughput - 1 / metrics.cycleTime) < 1e-9);
  assert.ok(metrics.cycleTime > 0);
});

test("downtime, MTBF and MTTR agree with the machine records", () => {
  const simulation = run(state("machine_failure"), 240);
  const metrics = computeMetrics(simulation);
  const routeIds = routeStationIds(factoryConfig);
  const routeMachines = simulation.machines.filter((machine) => routeIds.has(machine.id));

  const downtime = routeMachines.reduce((total, machine) => total + machine.downtimeTicks, 0);
  const failures = routeMachines.reduce((total, machine) => total + machine.failureCount, 0);

  assert.equal(metrics.downtime, downtime);
  assert.ok(failures > 0);
  assert.ok(Math.abs(metrics.mttr - downtime / failures) < 1e-9);
  assert.ok(Math.abs(metrics.mtbf - (simulation.time - downtime) / failures) < 1e-9);
});

test("a reported bottleneck is a real route station, and utilisation alone is not enough", () => {
  const simulation = run(state(), 240);
  const metrics = computeMetrics(simulation);

  assert.ok(metrics.bottleneck !== null, "a saturated line must name its constraint");
  assert.ok(routeStationIds(factoryConfig).has(metrics.bottleneck));

  // The constraint must be the line's busiest resource over the analysis
  // window, not merely a station that happens to be busy right now.
  const flagged = simulation.machines.find((machine) => machine.id === metrics.bottleneck);
  assert.ok(flagged);
  for (const machine of simulation.machines) {
    // Tamir hücreleri rotanın dışında; hattı tutan yer olamazlar.
    if (isReworkStation(factoryConfig, machine.id)) continue;
    assert.ok(windowedUtilization(machine) <= windowedUtilization(flagged) + 1e-9);
  }
});

test("an idle line reports no constraint and no invented health", () => {
  const simulation = state();
  tick(simulation);
  const metrics = computeMetrics(simulation);

  assert.equal(metrics.bottleneck, null);
  assert.equal(metrics.productionOutput, 0);
  assert.equal(metrics.quality, 1);
  assert.equal(metrics.availability, 1);
  assert.equal(metrics.oee, 0);
});

test("energy accounting covers running and idle machines", () => {
  const simulation = run(state(), 120);
  const metrics = computeMetrics(simulation);

  const total = simulation.machines.reduce((sum, machine) => sum + machine.energyKwh, 0);
  assert.ok(Math.abs(metrics.energyConsumptionKwh - Number(total.toFixed(2))) < 1e-9);
  assert.ok(metrics.machines.every((machine) => machine.energyKwh > 0));
});
