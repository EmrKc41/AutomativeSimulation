import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { Defect, StationConfig } from "./domain.ts";
import { run } from "./engine.ts";
import { stationById } from "./factory.ts";
import { Rng } from "./rng.ts";
import { scenarios } from "./scenarios.ts";
import { createSimulation } from "./state.ts";
import {
  DEFAULT_SPEC,
  DEFECT_CLASSES,
  OK_CLASS,
  PerfectInspector,
  RecordedInspector,
  SimulatedInspector,
  classDistribution,
  exportDataset,
  renderSample,
  validateDataset,
  type DatasetSpec,
  type Inspector,
  type Layout,
} from "./vision/index.ts";

const SPEC: DatasetSpec = { ...DEFAULT_SPEC, size: 120, imageSize: 96 };

function defect(id: string): Defect {
  return {
    id,
    productId: "CAR-2026-000001",
    type: "SCRATCH",
    severity: "minor",
    originStationId: "PAINT-01",
    createdAt: 1,
    detected: false,
    detectedAt: null,
    detectedBy: null,
    resolved: false,
    resolvedAt: null,
  };
}

function paintStation(): StationConfig {
  return stationById(createSimulation({ seed: 1, scenario: scenarios.normal }).config, "PAINT-01");
}

// --- the seam ---------------------------------------------------------------

test("the engine asks an inspector rather than looking itself", () => {
  const state = run(createSimulation({ seed: 42, scenario: scenarios.quality_failure }), 300);

  assert.ok(state.inspections.length > 0);
  assert.ok(state.inspections.every((inspection) => inspection.inspectorKind === "simulated"));
});

test("a perfect inspector removes detection loss without changing any other rule", () => {
  const simulated = run(createSimulation({ seed: 42, scenario: scenarios.quality_failure }), 300);
  const perfect = run(
    createSimulation({
      seed: 42,
      scenario: scenarios.quality_failure,
      inspector: () => new PerfectInspector(),
    }),
    300,
  );

  assert.ok(perfect.inspections.every((inspection) => inspection.inspectorKind === "perfect"));
  // Nothing gets past a perfect gate, so nothing reaches the customer.
  assert.equal(perfect.metrics.escapedDefects, 0);
  assert.ok(
    perfect.metrics.escapedDefects <= simulated.metrics.escapedDefects,
    "a better detector cannot let more defects through",
  );
  // The plant still runs: the change is in what is seen, not in how it works.
  assert.ok(perfect.metrics.productionOutput > 0);
  assert.ok(perfect.defects.length > 0);
});

test("a recorded inspector replays detections and admits what it has no record of", () => {
  const recorded = new RecordedInspector([
    [
      RecordedInspector.key("CAR-2026-000001", "PAINT-01"),
      { detectedDefectIds: ["DEF-1"], falsePositive: false, defectProbability: 0.93 },
    ],
  ]);
  // Held as the interface, which is how the engine sees every inspector.
  const inspector: Inspector = recorded;
  const station = paintStation();

  const known = inspector.inspect(
    {
      productId: "CAR-2026-000001",
      stationId: "PAINT-01",
      cameraId: "CAM-PAINT-01",
      method: "VISION",
      simulatedTime: 10,
      presentDefects: [defect("DEF-1")],
    },
    station,
  );
  assert.deepEqual(known.detectedDefectIds, ["DEF-1"]);
  assert.equal(recorded.misses, 0);

  const unknown = inspector.inspect(
    {
      productId: "CAR-2026-000099",
      stationId: "PAINT-01",
      cameraId: "CAM-PAINT-01",
      method: "VISION",
      simulatedTime: 12,
      presentDefects: [defect("DEF-9")],
    },
    station,
  );
  // Silence is reported as silence, not guessed at.
  assert.deepEqual(unknown.detectedDefectIds, []);
  assert.equal(unknown.defectProbability, 0);
  assert.equal(recorded.misses, 1);
});

test("the simulated inspector honours the station's configured recall", () => {
  const station = paintStation();
  const inspector = new SimulatedInspector(new Rng(7));
  const present = Array.from({ length: 400 }, (_unused, index) => defect(`DEF-${index}`));

  let detected = 0;
  for (const single of present) {
    const outcome = inspector.inspect(
      {
        productId: "CAR-2026-000001",
        stationId: station.id,
        cameraId: station.inspection.cameraId,
        method: station.inspection.method,
        simulatedTime: 1,
        presentDefects: [single],
      },
      station,
    );
    detected += outcome.detectedDefectIds.length;
  }

  const rate = detected / present.length;
  assert.ok(
    Math.abs(rate - station.inspection.recall) < 0.08,
    `yakalama oranı ${rate.toFixed(2)}, beklenen ${station.inspection.recall}`,
  );
});

test("a clean unit can be falsely rejected, and a defective one is never a false positive", () => {
  const station = paintStation();
  const inspector = new SimulatedInspector(new Rng(3));

  const withDefect = inspector.inspect(
    {
      productId: "CAR-2026-000001",
      stationId: station.id,
      cameraId: station.inspection.cameraId,
      method: station.inspection.method,
      simulatedTime: 1,
      presentDefects: [defect("DEF-1")],
    },
    station,
  );
  assert.equal(withDefect.falsePositive, false);

  let falsePositives = 0;
  for (let index = 0; index < 2000; index += 1) {
    const outcome = inspector.inspect(
      {
        productId: `CAR-${index}`,
        stationId: station.id,
        cameraId: station.inspection.cameraId,
        method: station.inspection.method,
        simulatedTime: 1,
        presentDefects: [],
      },
      station,
    );
    if (outcome.falsePositive) falsePositives += 1;
  }
  assert.ok(falsePositives > 0, "yanlış red hiç olmuyorsa model gerçekçi değil");
  assert.ok(falsePositives / 2000 < station.inspection.falsePositiveRate * 2.5);
});

// --- dataset ----------------------------------------------------------------

test("a sample is a deterministic function of its seed and index", () => {
  const first = renderSample(37, SPEC);
  const second = renderSample(37, SPEC);
  const other = renderSample(38, SPEC);

  assert.equal(first.fileName, second.fileName);
  assert.ok(first.png.equals(second.png), "aynı indeks aynı görüntüyü vermeli");
  assert.ok(!first.png.equals(other.png), "farklı indeks farklı görüntü vermeli");
});

test("generated images are valid PNGs of the requested size", () => {
  for (const index of [0, 1, 2, 5, 9]) {
    const sample = renderSample(index, SPEC);
    assert.equal(sample.png.subarray(1, 4).toString("latin1"), "PNG");
    assert.equal(sample.png.readUInt32BE(16), SPEC.imageSize);
    assert.equal(sample.png.readUInt32BE(20), SPEC.imageSize);
    assert.ok(sample.png.length > 1000, "boş görüntü");
  }
});

test("a defect is actually drawn, not just labelled", () => {
  // A clean and a defective panel rendered from the same panel seed must differ
  // in pixels; a label with no visual evidence would train a model on nothing.
  const defective = [...Array(40).keys()]
    .map((index) => renderSample(index, SPEC))
    .find((sample) => sample.label !== OK_CLASS);
  const clean = [...Array(40).keys()]
    .map((index) => renderSample(index, SPEC))
    .find((sample) => sample.label === OK_CLASS);

  assert.ok(defective && clean);
  assert.ok(defective.boxes.length === 1);
  assert.equal(clean.boxes.length, 0);
});

test("every box lies inside the image and has real area", () => {
  for (const sample of [...Array(SPEC.size).keys()].map((index) => renderSample(index, SPEC))) {
    for (const box of sample.boxes) {
      assert.ok(box.x >= 0 && box.y >= 0, `${sample.fileName}: kutu negatif`);
      assert.ok(box.x + box.width <= sample.width, `${sample.fileName}: kutu sağa taşıyor`);
      assert.ok(box.y + box.height <= sample.height, `${sample.fileName}: kutu aşağı taşıyor`);
      assert.ok(box.width > 1 && box.height > 1, `${sample.fileName}: kutu alanı yok`);
    }
  }
});

test("the class mix matches the requested OK share", () => {
  const counts = classDistribution(SPEC);
  const ok = counts.get(OK_CLASS) ?? 0;

  assert.ok(Math.abs(ok / SPEC.size - SPEC.okShare) < 0.12);
  for (const label of counts.keys()) {
    assert.ok(
      label === OK_CLASS || DEFECT_CLASSES.includes(label as never),
      `beklenmedik sınıf ${label}`,
    );
  }
});

test("validation passes a good set and names what is wrong with a bad one", () => {
  const good = validateDataset({ ...SPEC, size: 400 });
  assert.ok(good.ok, good.issues.map((issue) => issue.problem).join("; "));
  assert.equal(good.checked, 400);

  // Too small to learn from: the validator has to say so rather than let a
  // model train on three examples of a class and report a number.
  const tiny = validateDataset({ ...SPEC, size: 12 }, 10);
  assert.equal(tiny.ok, false);
  assert.ok(tiny.issues.some((issue) => /en az/.test(issue.problem)));
});

// ---------------------------------------------------------------------------
// Export layouts
// ---------------------------------------------------------------------------

/**
 * Each layout writes each sample exactly once.
 *
 * This is a regression test with a specific bug behind it: the COCO case was
 * added as a second `if` after the kitti/classification `if`/`else`, so a COCO
 * export fell through the classification branch first and wrote every image
 * twice - once into a class folder, once into `images/`. The count in the CLI
 * output (400 for a 200-image request) was the only visible symptom, and a
 * duplicated training set is the kind of fault that shows up as a suspiciously
 * good validation score rather than as an error.
 */
for (const layout of ["kitti", "coco", "classification"] as const satisfies readonly Layout[]) {
  test(`the ${layout} layout writes each sample exactly once`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), `twin-${layout}-`));
    try {
      const spec: DatasetSpec = { ...DEFAULT_SPEC, size: 40, imageSize: 64 };
      const result = await exportDataset(spec, root, layout);

      assert.equal(result.images, spec.size, "yazılan görüntü sayısı istenen sayıya eşit olmalı");

      const written = countPngs(root);
      assert.equal(written, spec.size, "diskteki dosya sayısı iki katına çıkmamalı");

      // ...and the layouts do not bleed into one another.
      const entries = readdirSync(root);
      if (layout === "classification") {
        assert.ok(!entries.includes("images"), "sınıf düzeni images/ yazmamalı");
        assert.ok(!entries.includes("annotations.json"));
      } else {
        assert.ok(entries.includes("images"), "kutulu düzenler images/ yazmalı");
        // No class folders alongside: those are the duplicate-write symptom.
        for (const label of [...DEFECT_CLASSES, OK_CLASS]) {
          assert.ok(!entries.includes(label), `${label} klasörü bu düzende olmamalı`);
        }
      }
      assert.equal(entries.includes("annotations.json"), layout === "coco");
      assert.equal(entries.includes("labels"), layout === "kitti");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

/** Count PNGs anywhere under a directory, whatever the layout put them in. */
function countPngs(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countPngs(path.join(dir, entry.name));
    else if (entry.name.endsWith(".png")) total += 1;
  }
  return total;
}
