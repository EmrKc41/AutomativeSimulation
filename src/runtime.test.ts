import assert from "node:assert/strict";
import test from "node:test";

import type { FactoryFrame } from "./domain.ts";
import { SimulationRuntime } from "./runtime.ts";

function paused(seed = 42): SimulationRuntime {
  return new SimulationRuntime({ seed, scenario: "normal" });
}

test("a new runtime starts paused at time zero and publishes nothing yet", () => {
  const runtime = paused();
  const frame = runtime.getFrame();

  assert.equal(runtime.status, "paused");
  assert.equal(frame.simulatedTime, 0);
  assert.equal(frame.sequence, 0);
  assert.equal(frame.v, 1);
  assert.equal(frame.speed, 1);
  runtime.dispose();
});

test("stepping advances the factory and raises the sequence", () => {
  const runtime = paused();
  const frames: FactoryFrame[] = [];
  runtime.subscribe((frame) => frames.push(frame));

  const result = runtime.execute({ type: "STEP", ticks: 40 });

  assert.ok(result.accepted);
  assert.match(result.commandId, /^cmd-\d{5}$/);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.simulatedTime, 40);
  assert.equal(frames[0]?.sequence, 1);
  assert.ok(frames[0]!.events.length > 0);
  runtime.dispose();
});

test("frames carry only new events, and the full log only on request", () => {
  const runtime = paused();
  runtime.execute({ type: "STEP", ticks: 30 });
  const firstBatch = runtime.getFrame().events.length;

  const frames: FactoryFrame[] = [];
  runtime.subscribe((frame) => frames.push(frame));
  runtime.execute({ type: "STEP", ticks: 10 });
  const delta = frames.at(-1);

  assert.ok(delta);
  assert.ok(delta.events.length > 0);
  assert.ok(
    delta.events.every((event) => event.occurredAt > 30),
    "a delta frame must not resend events the client already has",
  );
  assert.ok(runtime.getFrame(true).events.length > firstBatch);
  runtime.dispose();
});

test("a live run reproduces the batch engine exactly", async () => {
  const live = new SimulationRuntime({ seed: 42, scenario: "machine_failure", tickIntervalMs: 1 });
  const batch = new SimulationRuntime({ seed: 42, scenario: "machine_failure" });

  batch.execute({ type: "STEP", ticks: 60 });
  live.execute({ type: "PLAY" });
  await new Promise((resolve) => setTimeout(resolve, 250));
  live.execute({ type: "PAUSE" });

  // The wall clock decides how far the live run got; the history up to that
  // point must still match tick for tick.
  const reached = live.state.time;
  assert.ok(reached > 0, "the timer must have advanced the factory");

  const replay = new SimulationRuntime({ seed: 42, scenario: "machine_failure" });
  replay.execute({ type: "STEP", ticks: reached });
  assert.deepEqual(
    live.getFrame(true).events.map((event) => `${event.occurredAt}:${event.type}`),
    replay.getFrame(true).events.map((event) => `${event.occurredAt}:${event.type}`),
  );
  assert.deepEqual(live.state.metrics, replay.state.metrics);
  assert.ok(batch.state.time === 60);

  live.dispose();
  batch.dispose();
  replay.dispose();
});

test("pause stops the clock", async () => {
  const runtime = new SimulationRuntime({ seed: 42, scenario: "normal", tickIntervalMs: 5 });
  runtime.execute({ type: "PLAY" });
  await new Promise((resolve) => setTimeout(resolve, 60));
  runtime.execute({ type: "PAUSE" });

  const stopped = runtime.state.time;
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(runtime.state.time, stopped);
  assert.equal(runtime.status, "paused");
  runtime.dispose();
});

test("speed is validated and only accepts supported multipliers", () => {
  const runtime = paused();

  assert.ok(runtime.execute({ type: "SET_SPEED", speed: 4 }).accepted);
  assert.equal(runtime.speed, 4);

  const rejected = runtime.execute({ type: "SET_SPEED", speed: 3.7 });
  assert.equal(rejected.accepted, false);
  assert.match(rejected.message, /speed must be one of/);
  assert.equal(runtime.speed, 4);
  runtime.dispose();
});

test("reset rewinds the clock and starts a new simulation identity", () => {
  const runtime = paused();
  runtime.execute({ type: "STEP", ticks: 50 });
  const before = runtime.simulationId;

  const result = runtime.execute({ type: "RESET", scenario: "quality_failure", seed: 7 });
  const frame = runtime.getFrame();

  assert.ok(result.accepted);
  assert.equal(frame.simulatedTime, 0);
  assert.equal(frame.scenario, "quality_failure");
  assert.equal(frame.seed, 7);
  assert.equal(frame.status, "paused");
  assert.notEqual(runtime.simulationId, before);
  runtime.dispose();
});

test("an unknown scenario is rejected instead of silently resetting", () => {
  const runtime = paused();
  runtime.execute({ type: "STEP", ticks: 10 });

  const result = runtime.execute({
    type: "LOAD_SCENARIO",
    scenario: "meltdown" as "normal",
  });

  assert.equal(result.accepted, false);
  assert.equal(runtime.state.time, 10, "a rejected command must not change state");
  runtime.dispose();
});

test("step rejects an out-of-range horizon", () => {
  const runtime = paused();

  for (const ticks of [0, -5, 1.5, 5000]) {
    const result = runtime.execute({ type: "STEP", ticks });
    assert.equal(result.accepted, false, `${ticks} should be rejected`);
  }
  assert.equal(runtime.state.time, 0);
  runtime.dispose();
});

test("acknowledging an alert requires a real alert", () => {
  const runtime = paused();
  runtime.execute({ type: "STEP", ticks: 120 });

  const alert = runtime.state.alerts[0];
  assert.ok(alert, "the horizon should have produced at least one alert");
  assert.ok(runtime.execute({ type: "ACKNOWLEDGE_ALERT", alertId: alert.id }).accepted);
  assert.equal(alert.acknowledged, true);
  assert.equal(
    runtime.execute({ type: "ACKNOWLEDGE_ALERT", alertId: "alert-nope" }).accepted,
    false,
  );
  runtime.dispose();
});

test("a frame stays small while the history keeps growing", () => {
  const runtime = paused();
  runtime.execute({ type: "STEP", ticks: 400 });
  const frame = runtime.getFrame(true);

  const wip = frame.activeProducts.filter(
    (product) =>
      product.status === "QUEUED" ||
      product.status === "IN_PRODUCTION" ||
      product.status === "IN_REWORK",
  ).length;

  assert.ok(frame.events.length > 500, "the audit trail must keep everything");
  assert.ok(wip <= 6);
  assert.ok(
    frame.activeProducts.length < runtime.getSnapshot().products.length,
    "a frame must not carry every unit ever built",
  );
  assert.ok(frame.openAlerts.every((alert) => alert.resolvedAt === null));
  runtime.dispose();
});

test("subscribers can unsubscribe and stop receiving frames", () => {
  const runtime = paused();
  let received = 0;
  const unsubscribe = runtime.subscribe(() => {
    received += 1;
  });

  runtime.execute({ type: "STEP", ticks: 1 });
  unsubscribe();
  runtime.execute({ type: "STEP", ticks: 1 });

  assert.equal(received, 1);
  runtime.dispose();
});

test("a stopped station raises an andon and clears it only when it runs again", async () => {
  const runtime = new SimulationRuntime({ seed: 42, scenario: "machine_failure" });

  runtime.execute({ type: "STEP", ticks: 39 });
  assert.equal(runtime.getFrame().andon.active, false, "hat henüz durmadı");

  // The scenario stops welding at minute 40.
  runtime.execute({ type: "STEP", ticks: 6 });
  const stopped = runtime.getFrame().andon;
  assert.equal(stopped.active, true);
  assert.equal(stopped.stops.length, 1);
  assert.equal(stopped.stops[0]?.machineId, "WELD-04");
  assert.equal(stopped.stops[0]?.since, 40);
  assert.ok((stopped.stops[0]?.elapsedMinutes ?? 0) > 0);
  assert.equal(stopped.raisedAt, 40);

  // It stays raised for the whole repair, not just the first tick.
  runtime.execute({ type: "STEP", ticks: 10 });
  assert.equal(runtime.getFrame().andon.active, true, "onarım sürerken uyarı düşmemeli");

  runtime.execute({ type: "STEP", ticks: 60 });
  const recovered = runtime.getFrame().andon;
  assert.equal(recovered.active, false, "makine çalışınca uyarı kendiliğinden kapanmalı");
  assert.equal(recovered.raisedAt, null);
  runtime.dispose();
});

test("planned maintenance is not an andon", () => {
  // Only unplanned stops demand stop-call-wait. Treating scheduled work the
  // same way would teach an operator to ignore the signal that matters.
  const runtime = new SimulationRuntime({ seed: 42, scenario: "normal" });
  runtime.execute({ type: "STEP", ticks: 300 });

  const frame = runtime.getFrame();
  const down = frame.machines.filter((machine) => machine.status === "DOWN");
  const maintenance = frame.machines.filter((machine) => machine.status === "MAINTENANCE");

  assert.equal(frame.andon.stops.length, down.length);
  for (const machine of maintenance) {
    assert.ok(!frame.andon.stops.some((stop) => stop.machineId === machine.id));
  }
  runtime.dispose();
});

test("the andon names the unit caught on the machine", () => {
  const runtime = new SimulationRuntime({ seed: 42, scenario: "machine_failure" });
  runtime.execute({ type: "STEP", ticks: 45 });

  const stop = runtime.getFrame().andon.stops[0];
  assert.ok(stop);
  // Whatever it says is holding a unit must really be holding that unit.
  if (stop.heldProductId !== null) {
    const machine = runtime.state.machines.find((candidate) => candidate.id === stop.machineId);
    assert.equal(machine?.currentProductId, stop.heldProductId);
  }
  runtime.dispose();
});

test("a full line outage raises every stopped station, earliest first", () => {
  const runtime = new SimulationRuntime({ seed: 42, scenario: "line_stop" });
  runtime.execute({ type: "STEP", ticks: 65 });

  const andon = runtime.getFrame().andon;
  assert.ok(andon.stops.length >= 4, `beklenen çoklu duruş, gelen ${andon.stops.length}`);
  for (let index = 1; index < andon.stops.length; index += 1) {
    assert.ok((andon.stops[index - 1]?.since ?? 0) <= (andon.stops[index]?.since ?? 0));
  }
  runtime.dispose();
});
