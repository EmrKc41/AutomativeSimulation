import assert from "node:assert/strict";
import test from "node:test";

import type { SimulationResult } from "./domain.ts";
import { run, snapshot, tick } from "./engine.ts";
import { factoryConfig, lineSideLocation, stationById } from "./factory.ts";
import { scenarios } from "./scenarios.ts";
import { createSimulation, type SimulationState } from "./state.ts";

function start(kind: keyof typeof scenarios = "normal", seed = 42): SimulationState {
  return createSimulation({ seed, scenario: scenarios[kind] });
}

function completed(result: SimulationResult): number {
  return result.products.filter((product) => product.completedAt !== null).length;
}

test("a seeded run reaches steady production and reproduces exactly on replay", () => {
  const first = snapshot(run(start(), 240));
  const second = snapshot(run(start(), 240));

  assert.ok(completed(first) > 20, `expected sustained output, got ${completed(first)}`);
  assert.deepEqual(JSON.parse(JSON.stringify(second)), JSON.parse(JSON.stringify(first)));
});

test("a different seed produces a different operational history", () => {
  const a = snapshot(run(start("normal", 42), 240));
  const b = snapshot(run(start("normal", 7), 240));

  assert.notDeepEqual(
    a.events.map((event) => `${event.occurredAt}:${event.type}`),
    b.events.map((event) => `${event.occurredAt}:${event.type}`),
  );
});

test("core invariants hold on every single tick", () => {
  const state = start("quality_failure");

  for (let step = 0; step < 300; step += 1) {
    tick(state);

    for (const balance of state.inventory) {
      assert.ok(
        balance.quantity >= 0,
        `negative inventory in ${balance.batchId} at t=${state.time}`,
      );
    }

    for (const machine of state.machines) {
      const station = stationById(state.config, machine.id);
      assert.ok(
        machine.queue.length <= station.bufferCapacity,
        `${machine.id} buffer overflow at t=${state.time}`,
      );
      assert.ok(
        machine.runTicks <= state.time,
        `${machine.id} ran more ticks than elapsed at t=${state.time}`,
      );
      assert.ok(machine.downtimeTicks <= state.time);
      if (machine.status === "RUNNING") assert.notEqual(machine.currentProductId, null);
    }

    const wip = state.products.filter(
      (product) =>
        product.status === "QUEUED" ||
        product.status === "IN_PRODUCTION" ||
        product.status === "IN_REWORK",
    ).length;
    assert.ok(wip <= state.config.wipCap, `WIP cap exceeded at t=${state.time}: ${wip}`);

    for (const product of state.products) {
      assert.ok(
        product.reworkCount <= state.config.maxReworkPasses,
        `${product.id} exceeded the rework limit`,
      );
    }
  }
});

test("a unit is never in two places at once", () => {
  const state = start();
  for (let step = 0; step < 200; step += 1) {
    tick(state);
    const held = state.machines.flatMap((machine) => [
      ...machine.queue,
      ...(machine.currentProductId === null ? [] : [machine.currentProductId]),
    ]);
    assert.equal(new Set(held).size, held.length, `duplicate unit on the line at t=${state.time}`);
  }
});

test("the event log is append-only, uniquely identified and ordered in time", () => {
  const result = snapshot(run(start("machine_failure"), 200));
  const ids = result.events.map((event) => event.eventId);

  assert.equal(new Set(ids).size, ids.length);
  let previous = -1;
  for (const event of result.events) {
    assert.ok(event.occurredAt >= previous, "events must not travel backwards in time");
    assert.equal(event.schemaVersion, 1);
    previous = event.occurredAt;
  }
});

test("only units that passed the final gate can be shipped", () => {
  const result = snapshot(run(start("quality_failure"), 300));
  const shipped = result.products.filter((product) => product.shipmentId !== null);

  assert.ok(shipped.length > 0);
  for (const product of shipped) {
    assert.notEqual(product.completedAt, null, `${product.id} shipped without completing`);
    assert.notEqual(product.status, "SCRAPPED");
    const finalInspections = result.inspections.filter(
      (inspection) => inspection.productId === product.id && inspection.stationId === "FINAL-QC",
    );
    assert.equal(
      finalInspections.at(-1)?.result,
      "PASS",
      `${product.id} shipped without a final pass`,
    );
  }
});

test("units follow the approved route and rework returns them to the rejecting station", () => {
  const result = snapshot(run(start("quality_failure"), 300));
  const route = factoryConfig.route;

  for (const product of result.products) {
    const mainline = product.history.filter((record) => record.stationId !== "REWORK-01");
    let expected = 0;
    for (const record of mainline) {
      const index = route.indexOf(record.stationId);
      assert.ok(index >= 0, `unknown station ${record.stationId}`);
      assert.ok(index >= expected - 1 && index <= expected, `${product.id} skipped an operation`);
      expected = index + 1;
    }
  }

  const reworked = result.products.find((product) => product.reworkCount > 0);
  assert.ok(reworked, "the quality scenario must produce at least one rework");
  const reworkIndex = reworked.history.findIndex((record) => record.stationId === "REWORK-01");
  const before = reworked.history[reworkIndex - 1];
  const after = reworked.history[reworkIndex + 1];
  assert.ok(before && after);
  assert.equal(after.stationId, before.stationId, "rework must return the unit to the same gate");
});

test("every consumed material lot is traceable to a received lot", () => {
  const result = snapshot(run(start(), 240));
  const received = new Set(
    result.events
      .filter((event) => event.type === "MATERIAL_RECEIVED")
      .map((event) => event.correlationId),
  );

  const consumers = result.products.filter(
    (product) => product.consumedMaterialBatchIds.length > 0,
  );
  assert.ok(consumers.length > 0);
  for (const product of consumers) {
    for (const batchId of product.consumedMaterialBatchIds) {
      assert.ok(received.has(batchId), `${batchId} was consumed but never received`);
    }
  }
});

test("quarantined lots are never issued to the line", () => {
  let quarantineSeen = 0;

  for (const seed of [1, 7, 42, 99]) {
    const result = snapshot(run(start("normal", seed), 400));
    const quarantined = new Set(
      result.events
        .filter((event) => event.type === "MATERIAL_QUARANTINED")
        .map((event) => event.correlationId),
    );
    quarantineSeen += quarantined.size;

    for (const product of result.products) {
      for (const batchId of product.consumedMaterialBatchIds) {
        assert.ok(!quarantined.has(batchId), `${batchId} was quarantined but still consumed`);
      }
    }
  }

  assert.ok(quarantineSeen > 0, "incoming QC must reject at least one lot across these seeds");
});

test("kanban replenishment keeps line-side stock supplied by AGV, not by magic", () => {
  const state = start();
  run(state, 240);

  const delivered = state.moveTasks.filter((task) => task.status === "COMPLETED");
  assert.ok(delivered.length > 0, "line-side bins must be refilled by move tasks");
  assert.ok(state.agvs.some((agv) => agv.completedTasks > 0));

  for (const task of state.moveTasks) {
    assert.equal(task.from, "RAW-STOCK-A");
    assert.ok(task.to.startsWith("LINE-SIDE/"));
  }

  const pressLineSide = lineSideLocation("PRESS-01");
  const onHand = state.inventory
    .filter((balance) => balance.location === pressLineSide)
    .reduce((total, balance) => total + balance.quantity, 0);
  assert.ok(onHand >= 0);
});

test("a defect only becomes known to the factory through an inspection", () => {
  const result = snapshot(run(start("quality_failure"), 300));
  const detectedEvents = result.events.filter((event) => event.type === "DEFECT_DETECTED");

  assert.ok(result.defects.length > 0);
  assert.ok(detectedEvents.length > 0);
  assert.ok(
    detectedEvents.length <= result.defects.length,
    "the factory cannot detect more defects than exist",
  );
  for (const defect of result.defects) {
    if (!defect.detected) continue;
    assert.notEqual(defect.detectedBy, null);
    assert.ok((defect.detectedAt ?? -1) >= defect.createdAt);
  }
});

test("a machine stop suspends its operation and resumes it after repair", () => {
  const state = start("machine_failure");
  run(state, 60);

  const welding = state.machines.find((machine) => machine.id === "WELD-04");
  assert.ok(welding);
  assert.ok(welding.failureCount >= 1);
  assert.ok(
    welding.downtimeTicks >= 20,
    `expected sustained downtime, got ${welding.downtimeTicks}`,
  );

  run(state, 180);
  const result = snapshot(state);
  assert.ok(result.events.some((event) => event.type === "MAINTENANCE_COMPLETED"));
  assert.notEqual(welding.status, "DOWN");
  assert.ok(welding.producedCount > 0, "the station must produce again after repair");
});

test("shipments progress through the full logistics state machine", () => {
  const result = snapshot(run(start(), 300));
  const delivered = result.shipments.filter((shipment) => shipment.status === "DELIVERED");

  assert.ok(delivered.length > 0);
  for (const shipment of delivered) {
    assert.ok(shipment.actualDeparture !== null && shipment.deliveredAt !== null);
    assert.ok(shipment.deliveredAt > shipment.actualDeparture);
    assert.ok(shipment.productIds.length <= shipment.capacity);
  }

  const types = result.events.map((event) => event.type);
  for (const expected of [
    "SHIPMENT_CREATED",
    "SHIPMENT_LOADING",
    "SHIPMENT_DISPATCHED",
    "SHIPMENT_DELIVERED",
  ] as const) {
    assert.ok(types.includes(expected), `missing ${expected}`);
  }
});

test("run rejects a negative horizon", () => {
  assert.throws(() => run(start(), -1), /non-negative integer/);
});
