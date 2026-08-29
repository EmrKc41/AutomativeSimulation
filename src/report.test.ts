import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";

import { run } from "./engine.ts";
import { buildPdf, buildReportModel, buildWorkbook, reportFileName } from "./report/index.ts";
import { scenarios } from "./scenarios.ts";
import { createSimulation, type SimulationState } from "./state.ts";

function simulate(kind: keyof typeof scenarios = "quality_failure", ticks = 300): SimulationState {
  return run(createSimulation({ seed: 42, scenario: scenarios[kind] }), ticks);
}

async function openWorkbook(state: SimulationState): Promise<ExcelJS.Workbook> {
  const buffer = await buildWorkbook(buildReportModel(state, { simulationId: "test" }));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ArrayBuffer);
  return book;
}

test("the report model reads the run without changing it", () => {
  const state = simulate();
  const before = JSON.stringify({
    time: state.time,
    metrics: state.metrics,
    events: state.events.length,
    products: state.products.length,
  });

  buildReportModel(state);

  assert.equal(
    JSON.stringify({
      time: state.time,
      metrics: state.metrics,
      events: state.events.length,
      products: state.products.length,
    }),
    before,
  );
});

test("the model carries every event and every unit, not a sample", () => {
  const state = simulate();
  const model = buildReportModel(state);

  assert.equal(model.events.length, state.events.length);
  assert.equal(model.products.length, state.products.length);
  assert.equal(model.alerts.length, state.alerts.length);
  assert.equal(model.stations.length, state.machines.length);
});

test("the workbook has the sheets a plant would look for", async () => {
  const book = await openWorkbook(simulate());
  const names = book.worksheets.map((sheet) => sheet.name);

  for (const expected of [
    "Özet",
    "İstasyonlar",
    "Kalite",
    "İş Emirleri",
    "Sevkiyat",
    "Stok",
    "Araçlar",
    "Alarmlar",
    "Bakım Riski",
    "Olay Kaydı",
  ]) {
    assert.ok(names.includes(expected), `eksik sayfa: ${expected}`);
  }
});

test("KPIs are written as numbers with formats, not as pre-formatted text", async () => {
  // A percentage written as "%82,0" looks right and cannot be charted, summed
  // or compared. The workbook has to stay analysable.
  const state = simulate();
  const book = await openWorkbook(state);
  const summary = book.getWorksheet("Özet");
  assert.ok(summary);

  const oee = summary.getCell("B12");
  assert.equal(typeof oee.value, "number");
  assert.ok(Math.abs((oee.value as number) - state.metrics.oee) < 1e-9);
  assert.equal(oee.numFmt, "0.0%");
});

test("station shares are live formulas, so a filtered sheet still adds up", async () => {
  const book = await openWorkbook(simulate());
  const stations = book.getWorksheet("İstasyonlar");
  assert.ok(stations);

  const share = stations.getCell("T2").value as { formula?: string } | null;
  assert.ok(share && typeof share.formula === "string");
  assert.match(share.formula, /^M2\/\d+$/);
});

test("the Pareto sheet computes its own cumulative column", async () => {
  const book = await openWorkbook(simulate());
  const quality = book.getWorksheet("Kalite");
  assert.ok(quality);

  const cumulative = quality.getCell("D3").value as { formula?: string } | null;
  assert.ok(cumulative && typeof cumulative.formula === "string");
  assert.match(cumulative.formula, /SUM\(\$C\$3:C3\)/);
});

test("station rows match the machine records they came from", async () => {
  const state = simulate();
  const book = await openWorkbook(state);
  const sheet = book.getWorksheet("İstasyonlar");
  assert.ok(sheet);

  state.machines.forEach((machine, index) => {
    const row = sheet.getRow(index + 2);
    assert.equal(row.getCell(1).value, machine.id);
    assert.equal(row.getCell(11).value, machine.producedCount);
    assert.equal(row.getCell(13).value, machine.runTicks);
    assert.equal(row.getCell(17).value, machine.downtimeTicks);
  });
});

test("the event log sheet carries the whole audit trail", async () => {
  const state = simulate();
  const book = await openWorkbook(state);
  const sheet = book.getWorksheet("Olay Kaydı");
  assert.ok(sheet);

  // Header row plus one row per event.
  assert.equal(sheet.rowCount, state.events.length + 1);
  assert.ok(sheet.autoFilter, "an analyst needs to filter this sheet");
});

test("the PDF is a real PDF and embeds a font that can spell Turkish", async () => {
  const pdf = await buildPdf(buildReportModel(simulate(), { simulationId: "test" }));

  assert.ok(pdf.length > 5000, `beklenmedik boyut: ${pdf.length}`);
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(pdf.subarray(-6).toString("latin1").trim(), "%%EOF");
  // PDFKit's built-in fonts are WinAnsi and have no ş/ğ/İ/ı; the report has to
  // ship its own.
  assert.match(pdf.toString("latin1"), /FiraSans/);
});

test("a report can be produced from an untouched run without throwing", async () => {
  const fresh = createSimulation({ seed: 1, scenario: scenarios.normal });
  const model = buildReportModel(fresh, { simulationId: "fresh" });

  assert.equal(model.events.length, fresh.events.length);
  const pdf = await buildPdf(model);
  const book = await openWorkbook(fresh);
  assert.ok(pdf.length > 3000);
  assert.ok(book.worksheets.length >= 10);
});

test("two runs of the same seed produce identical report figures", async () => {
  const first = buildReportModel(simulate(), { generatedAt: new Date(0), simulationId: "a" });
  const second = buildReportModel(simulate(), { generatedAt: new Date(0), simulationId: "a" });

  assert.deepEqual(second.metrics, first.metrics);
  assert.deepEqual(second.stations, first.stations);
  assert.deepEqual(second.defects, first.defects);
});

test("file names are ASCII and stamped with the plant clock", () => {
  const name = reportFileName("xlsx", "LINE-01", "quality_failure", 305);

  assert.equal(name, "uretim-analizi_LINE-01_quality_failure_0505.xlsx");
  // Anything outside ASCII breaks Content-Disposition on older clients.
  assert.ok(/^[\x20-\x7e]+$/.test(name));
  assert.equal(
    reportFileName("pdf", "LINE-01", "normal", 60),
    "vardiya-raporu_LINE-01_normal_0100.pdf",
  );
});
