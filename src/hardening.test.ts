import assert from "node:assert/strict";
import test from "node:test";

import { SimulationRuntime } from "./runtime.ts";

/**
 * Failures that only show up on a server that has been running a while.
 *
 * Every case here was reproduced before it was fixed. The first one killed the
 * whole process, which is worth stating plainly: one browser tab closing at an
 * awkward moment ended the simulation for everybody else watching it.
 */

/** Let the runtime's timer fire a few times. */
const ticksToRun = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a subscriber that throws is dropped, and everyone else still gets frames", async () => {
  const runtime = new SimulationRuntime({ seed: 42, scenario: "normal", tickIntervalMs: 10 });
  let healthy = 0;
  let broken = 0;

  runtime.subscribe(() => {
    broken += 1;
    throw new Error("soket kapandı");
  });
  runtime.subscribe(() => {
    healthy += 1;
  });

  runtime.execute({ type: "PLAY" });
  await ticksToRun(200);
  // Read before disposing: dispose clears the set, which would make the last
  // assertion pass for the wrong reason.
  const remaining = runtime.listenerCount;
  runtime.dispose();

  // Before the fix this threw out of a setInterval callback, which is an
  // uncaught exception, which ends the process.
  assert.ok(healthy > 1, `sağlıklı abone kare almalıydı, aldığı: ${healthy}`);
  assert.equal(broken, 1, "hata veren aboneye ikinci kez kare gönderilmemeli");
  assert.equal(runtime.droppedListeners, 1);
  assert.equal(remaining, 1);
});

test("a subscriber that throws does not stop the ones after it in the list", async () => {
  const runtime = new SimulationRuntime({ seed: 42, scenario: "normal", tickIntervalMs: 10 });
  let after = 0;

  // Registration order matters: the old loop stopped dead at the first throw,
  // so whoever subscribed later got nothing at all.
  runtime.subscribe(() => {
    throw new Error("ilk abone patladı");
  });
  runtime.subscribe(() => {
    after += 1;
  });

  runtime.execute({ type: "PLAY" });
  await ticksToRun(150);
  runtime.dispose();

  assert.ok(after > 0, "hata veren aboneden sonrakiler de kare almalı");
});

test("the run keeps its own state consistent when a subscriber fails", async () => {
  const runtime = new SimulationRuntime({ seed: 42, scenario: "normal", tickIntervalMs: 10 });
  runtime.subscribe(() => {
    throw new Error("kırık");
  });

  runtime.execute({ type: "PLAY" });
  await ticksToRun(150);
  const time = runtime.state.time;
  runtime.dispose();

  assert.ok(time > 0, "abone kırık diye fabrika durmamalı");
  assert.equal(runtime.tickFailures, 0, "abone hatası tick hatası sayılmamalı");
});

test("the first frame carries a bounded tail, however long the server has been up", () => {
  const runtime = new SimulationRuntime({ seed: 42, scenario: "normal" });
  const sizes: number[] = [];
  const counts: number[] = [];

  for (let block = 0; block < 4; block += 1) {
    runtime.execute({ type: "STEP", ticks: 1000 });
    const frame = runtime.getFrame(true);
    sizes.push(Buffer.byteLength(JSON.stringify(frame)));
    counts.push(frame.events.length);
  }
  runtime.dispose();

  // It used to be the whole log: 589 KB by minute 3000 and still climbing, of
  // which the browser kept 600 events and discarded the rest.
  const first = sizes[0]!;
  const last = sizes.at(-1)!;
  assert.ok(last < first * 1.1, `ilk kare çalışma süresiyle büyüyor: ${first} → ${last} bayt`);
  assert.ok(counts.every((count) => count <= 600));
});

test("the first frame says how much history it left behind", () => {
  const runtime = new SimulationRuntime({ seed: 42, scenario: "normal" });
  runtime.execute({ type: "STEP", ticks: 1000 });
  const frame = runtime.getFrame(true);
  runtime.dispose();

  // Without this a client cannot tell a quiet plant from a truncated feed.
  assert.equal(frame.eventsTotal, runtime.state.events.length);
  assert.ok(frame.eventsTotal > frame.events.length, "bu koşuda geçmiş kırpılmış olmalı");
});

test("a client sees every event exactly once: no gaps, no repeats", async () => {
  const runtime = new SimulationRuntime({
    seed: 42,
    scenario: "machine_failure",
    tickIntervalMs: 10,
  });

  // Collected, not asserted in place. A subscriber that throws is now dropped
  // rather than crashing the run, so an assertion in here would take the
  // observer out of the test instead of failing it.
  const delivered: string[] = [];
  const hello = runtime.getFrame(true);
  for (const event of hello.events) delivered.push(event.eventId);

  runtime.subscribe((frame) => {
    for (const event of frame.events) delivered.push(event.eventId);
  });

  runtime.execute({ type: "PLAY" });
  await ticksToRun(300);
  const total = runtime.state.events.length;
  runtime.dispose();

  const unique = new Set(delivered);
  assert.ok(delivered.length > hello.events.length, "canlı kare hiç olay taşımadı");
  // A freshly started server used to send its opening-stock events twice —
  // once in the hello, once in a first delta that still started from zero — so
  // every material receipt appeared twice in the operator's timeline.
  assert.equal(unique.size, delivered.length, "aynı olay iki kez gönderildi");
  assert.equal(unique.size, total, `${total} olaydan ${unique.size} tanesi ulaştı`);
});

test("disposing stops the timer and releases subscribers", async () => {
  const runtime = new SimulationRuntime({ seed: 42, scenario: "normal", tickIntervalMs: 10 });
  let frames = 0;
  runtime.subscribe(() => {
    frames += 1;
  });

  runtime.execute({ type: "PLAY" });
  await ticksToRun(120);
  runtime.dispose();

  const afterDispose = frames;
  await ticksToRun(120);

  // A runtime that keeps ticking after dispose is a leak that survives every
  // reset, and it would quietly double the tick rate on the next run.
  assert.equal(frames, afterDispose, "dispose sonrası kare gelmemeli");
  assert.equal(runtime.listenerCount, 0);
});

test("a long run does not grow without bound", () => {
  const runtime = new SimulationRuntime({ seed: 42, scenario: "normal" });
  runtime.execute({ type: "STEP", ticks: 1000 });
  const early = {
    products: runtime.state.products.length,
    inspections: runtime.state.inspections.length,
    tasks: runtime.state.moveTasks.length,
  };

  for (let block = 0; block < 5; block += 1) runtime.execute({ type: "STEP", ticks: 1000 });
  runtime.dispose();

  // The order book is finite, so once it is done these must stop growing. If
  // they do not, something is being appended every tick and the twin cannot be
  // left running.
  assert.equal(runtime.state.products.length, early.products);
  assert.equal(runtime.state.inspections.length, early.inspections);
  assert.equal(runtime.state.moveTasks.length, early.tasks);
});

test("a rejected command changes nothing at all", () => {
  const runtime = new SimulationRuntime({ seed: 42, scenario: "normal" });
  runtime.execute({ type: "STEP", ticks: 50 });
  const before = { time: runtime.state.time, events: runtime.state.events.length };

  const tooMany = runtime.execute({ type: "STEP", ticks: 5000 });
  const badSpeed = runtime.execute({ type: "SET_SPEED", speed: 999 });
  runtime.dispose();

  assert.equal(tooMany.accepted, false);
  assert.equal(badSpeed.accepted, false);
  // A command that half-applies is worse than one that fails: the operator
  // sees a rejection and assumes the plant is where they left it.
  assert.equal(runtime.state.time, before.time);
  assert.equal(runtime.state.events.length, before.events);
  assert.equal(runtime.speed, 1);
});

// ---------------------------------------------------------------------------
// Work queued behind the factory clock
// ---------------------------------------------------------------------------

/**
 * The report queue, as a standalone piece.
 *
 * The server chains report builds so that only one runs at a time. That is the
 * whole fix for a measured problem: at 16x speed, ten concurrent workbook
 * requests froze the tick loop for 1.55 seconds, because building a workbook is
 * about 200 ms of solid CPU on the same thread that runs the plant.
 */
function makeQueue() {
  let chain: Promise<unknown> = Promise.resolve();
  return function queue<T>(build: () => Promise<T>): Promise<T> {
    const next = chain.then(build, build);
    chain = next.catch(() => undefined);
    return next;
  };
}

test("queued work runs one at a time, in the order it arrived", async () => {
  const queue = makeQueue();
  const order: number[] = [];
  let running = 0;
  let peak = 0;

  const job = (id: number, ms: number) =>
    queue(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      order.push(id);
      running -= 1;
      return id;
    });

  // Deliberately slowest-first: without a queue this finishes 3, 2, 1.
  await Promise.all([job(1, 30), job(2, 10), job(3, 1)]);

  assert.equal(peak, 1, "aynı anda birden fazla rapor üretilmemeli");
  assert.deepEqual(order, [1, 2, 3], "sıra geldiği gibi korunmalı");
});

test("one failing job does not break the queue for the ones behind it", async () => {
  const queue = makeQueue();

  const failed = queue(async () => {
    throw new Error("rapor üretilemedi");
  });
  const after = queue(async () => "sonraki");

  await assert.rejects(failed, /rapor üretilemedi/);
  // A broken chain would leave every later download hanging forever, which is
  // worse than the failure that caused it.
  assert.equal(await after, "sonraki");
});
