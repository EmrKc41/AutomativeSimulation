import assert from "node:assert/strict";
import test from "node:test";

import type { Defect, StationConfig } from "./domain.ts";
import { stationById } from "./factory.ts";
import { scenarios } from "./scenarios.ts";
import { createSimulation } from "./state.ts";
import { ServiceInspector, type ServiceResponse } from "./vision/service.ts";

/**
 * The adapter is tested against an injected `fetch`, not a running service.
 *
 * Every case that matters here is a failure case — a timeout, a 500, a body
 * that is not what was promised — and those are easier to produce reliably in a
 * stub than against a real endpoint.
 */

function station(): StationConfig {
  return stationById(createSimulation({ seed: 1, scenario: scenarios.normal }).config, "PAINT-01");
}

function defect(id: string, type: Defect["type"] = "PAINT_DEFECT"): Defect {
  return {
    id,
    productId: "CAR-2026-000001",
    type,
    severity: "major",
    originStationId: "PAINT-01",
    createdAt: 1,
    detected: false,
    detectedAt: null,
    detectedBy: null,
    resolved: false,
    resolvedAt: null,
  };
}

function request(presentDefects: readonly Defect[] = []) {
  return {
    productId: "CAR-2026-000001",
    stationId: "PAINT-01",
    cameraId: "CAM-PAINT-01",
    method: "VISION" as const,
    simulatedTime: 12,
    presentDefects,
  };
}

/** A stub that answers with a fixed body, and records what it was asked. */
function stubFetch(body: ServiceResponse | null, status = 200) {
  const calls: Array<Record<string, unknown>> = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** Let the adapter's fire-and-forget request settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the first inspection is a miss, because the service has not answered yet", () => {
  const { impl } = stubFetch({
    productId: "CAR-2026-000001",
    stationId: "PAINT-01",
    detections: [],
  });
  const inspector = new ServiceInspector({
    endpoint: "http://localhost:8000",
    threshold: 0.5,
    fetchImpl: impl,
  });

  const outcome = inspector.inspect(request([defect("DEF-1")]), station());

  // A camera that has not spoken reports nothing. It does not guess.
  assert.deepEqual(outcome.detectedDefectIds, []);
  assert.equal(outcome.falsePositive, false);
  assert.equal(outcome.defectProbability, 0);
  assert.equal(inspector.misses, 1);
  assert.equal(inspector.calls, 1);
});

test("a detection above the threshold is matched to the defect it names", async () => {
  const { impl } = stubFetch({
    productId: "CAR-2026-000001",
    stationId: "PAINT-01",
    detections: [{ label: "PAINT_DEFECT", score: 0.91 }],
  });
  const inspector = new ServiceInspector({ endpoint: "http://x", threshold: 0.5, fetchImpl: impl });
  const present = [defect("DEF-1")];

  inspector.inspect(request(present), station());
  await settle();
  const outcome = inspector.inspect(request(present), station());

  assert.deepEqual(outcome.detectedDefectIds, ["DEF-1"]);
  assert.equal(outcome.falsePositive, false);
  assert.equal(outcome.defectProbability, 0.91);
});

test("a detection below the threshold is not a detection", async () => {
  const { impl } = stubFetch({
    productId: "CAR-2026-000001",
    stationId: "PAINT-01",
    detections: [{ label: "PAINT_DEFECT", score: 0.31 }],
  });
  const inspector = new ServiceInspector({ endpoint: "http://x", threshold: 0.6, fetchImpl: impl });
  const present = [defect("DEF-1")];

  inspector.inspect(request(present), station());
  await settle();
  const outcome = inspector.inspect(request(present), station());

  assert.deepEqual(outcome.detectedDefectIds, []);
  assert.equal(outcome.falsePositive, false);
});

test("a confident detection the twin cannot explain is a false rejection, not a pass", async () => {
  const { impl } = stubFetch({
    productId: "CAR-2026-000001",
    stationId: "PAINT-01",
    detections: [{ label: "SCRATCH", score: 0.88 }],
  });
  const inspector = new ServiceInspector({ endpoint: "http://x", threshold: 0.5, fetchImpl: impl });

  inspector.inspect(request([]), station());
  await settle();
  const outcome = inspector.inspect(request([]), station());

  // The gate rejected a unit the twin knows to be clean. On the floor that is
  // exactly what an unexplained rejection is.
  assert.deepEqual(outcome.detectedDefectIds, []);
  assert.equal(outcome.falsePositive, true);
});

test("an OK class never counts as a detection", async () => {
  const { impl } = stubFetch({
    productId: "CAR-2026-000001",
    stationId: "PAINT-01",
    detections: [{ label: "OK", score: 0.99 }],
  });
  const inspector = new ServiceInspector({ endpoint: "http://x", threshold: 0.5, fetchImpl: impl });

  inspector.inspect(request([]), station());
  await settle();
  const outcome = inspector.inspect(request([]), station());

  assert.deepEqual(outcome.detectedDefectIds, []);
  assert.equal(outcome.falsePositive, false);
});

test("two detections of one class cannot both claim the same defect", async () => {
  const { impl } = stubFetch({
    productId: "CAR-2026-000001",
    stationId: "PAINT-01",
    detections: [
      { label: "PAINT_DEFECT", score: 0.9 },
      { label: "PAINT_DEFECT", score: 0.8 },
    ],
  });
  const inspector = new ServiceInspector({ endpoint: "http://x", threshold: 0.5, fetchImpl: impl });
  const present = [defect("DEF-1")];

  inspector.inspect(request(present), station());
  await settle();
  const outcome = inspector.inspect(request(present), station());

  assert.deepEqual(outcome.detectedDefectIds, ["DEF-1"]);
  // The second box explains nothing, so the unit is also flagged as a false
  // rejection rather than the extra box quietly vanishing.
  assert.equal(outcome.falsePositive, false);
});

test("a service error is a miss and never a silent pass", async () => {
  const failing = (async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;
  const inspector = new ServiceInspector({
    endpoint: "http://x",
    threshold: 0.5,
    fetchImpl: failing,
  });

  inspector.inspect(request([defect("DEF-1")]), station());
  await settle();
  const outcome = inspector.inspect(request([defect("DEF-1")]), station());

  assert.deepEqual(outcome.detectedDefectIds, []);
  assert.equal(outcome.defectProbability, 0);
  assert.ok(inspector.failures >= 1, "hata sayılmalı");
  assert.equal(inspector.misses, 2, "hata geçiş sayılmamalı");
});

test("a non-2xx response is a failure, not an empty result", async () => {
  const { impl } = stubFetch(null, 503);
  const inspector = new ServiceInspector({ endpoint: "http://x", threshold: 0.5, fetchImpl: impl });

  inspector.inspect(request([]), station());
  await settle();

  assert.ok(inspector.failures >= 1);
});

test("a malformed body is rejected rather than half-read", async () => {
  const impl = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ productId: "x" }),
    }) as Response) as unknown as typeof fetch;
  const inspector = new ServiceInspector({ endpoint: "http://x", threshold: 0.5, fetchImpl: impl });

  inspector.inspect(request([]), station());
  await settle();
  const outcome = inspector.inspect(request([]), station());

  assert.ok(inspector.failures >= 1);
  assert.deepEqual(outcome.detectedDefectIds, []);
});

test("the line is never blocked waiting for the service", () => {
  // The call is fire-and-forget: a hung endpoint must not stall a tick.
  const hanging = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  const inspector = new ServiceInspector({
    endpoint: "http://x",
    threshold: 0.5,
    fetchImpl: hanging,
  });

  const started = Date.now();
  for (let index = 0; index < 50; index += 1) inspector.inspect(request([]), station());

  assert.ok(Date.now() - started < 100, "muayene senkron beklememeli");
});

test("only one call per unit and station is in flight at a time", async () => {
  const { impl, calls } = stubFetch({
    productId: "CAR-2026-000001",
    stationId: "PAINT-01",
    detections: [],
  });
  const inspector = new ServiceInspector({ endpoint: "http://x", threshold: 0.5, fetchImpl: impl });

  inspector.inspect(request([]), station());
  inspector.inspect(request([]), station());
  inspector.inspect(request([]), station());

  assert.equal(calls.length, 1, "aynı araç için yığılmamalı");
  await settle();
});

test("the request carries what a camera would need to find the frame", async () => {
  const { impl, calls } = stubFetch({
    productId: "CAR-2026-000001",
    stationId: "PAINT-01",
    detections: [],
  });
  const inspector = new ServiceInspector({ endpoint: "http://x", threshold: 0.5, fetchImpl: impl });

  inspector.inspect(request([]), station());
  await settle();

  const sent = calls[0];
  assert.ok(sent);
  assert.equal(sent["productId"], "CAR-2026-000001");
  assert.equal(sent["stationId"], "PAINT-01");
  assert.equal(sent["camera"], "CAM-PAINT-01");
  assert.equal(sent["method"], "VISION");
  assert.equal(sent["simulatedTime"], 12);
});

test("a result is consumed once, so a stale answer cannot be reused", async () => {
  const { impl } = stubFetch({
    productId: "CAR-2026-000001",
    stationId: "PAINT-01",
    detections: [{ label: "PAINT_DEFECT", score: 0.95 }],
  });
  const inspector = new ServiceInspector({ endpoint: "http://x", threshold: 0.5, fetchImpl: impl });
  const present = [defect("DEF-1")];

  inspector.inspect(request(present), station());
  await settle();
  const first = inspector.inspect(request(present), station());
  const second = inspector.inspect(request([defect("DEF-2")]), station());

  assert.deepEqual(first.detectedDefectIds, ["DEF-1"]);
  // The second inspection has no fresh answer yet; it must not replay the first.
  assert.deepEqual(second.detectedDefectIds, []);
});

test("the inspector identifies itself on every record it produces", () => {
  const { impl } = stubFetch({ productId: "x", stationId: "y", detections: [] });
  const inspector = new ServiceInspector({ endpoint: "http://x", threshold: 0.5, fetchImpl: impl });

  assert.equal(inspector.kind, "service");
});
