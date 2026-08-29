import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { run } from "./engine.ts";
import { buildPdf, buildReportModel, buildWorkbook, reportFileName } from "./report/index.ts";
import { isScenarioKind, scenarios } from "./scenarios.ts";
import { createSimulation } from "./state.ts";

/**
 * Produce both reports from a fresh, seeded run.
 *
 * Useful without the server: the same seed and horizon always yield the same
 * workbook figures, which is what makes a report comparable week to week.
 */
const args = process.argv.slice(2);
const flags = new Map<string, string>();
const positionals: string[] = [];
for (const arg of args) {
  if (arg.startsWith("--")) {
    const [key, value] = arg.slice(2).split("=");
    flags.set(key ?? "", value ?? "true");
  } else {
    positionals.push(arg);
  }
}

const kind = positionals[0] ?? "normal";
if (!isScenarioKind(kind)) {
  console.error(`Bilinmeyen senaryo "${kind}". Seçenekler: ${Object.keys(scenarios).join(", ")}`);
  process.exit(1);
}

const ticks = Number(flags.get("ticks") ?? 300);
const seed = Number(flags.get("seed") ?? 42);
const outputDir = flags.get("out") ?? "reports";

const state = run(createSimulation({ seed, scenario: scenarios[kind] }), ticks);
const model = buildReportModel(state, { simulationId: `cli-${kind}` });

await mkdir(outputDir, { recursive: true });
const xlsxName = reportFileName("xlsx", model.lineId, kind, model.simulatedMinutes);
const pdfName = reportFileName("pdf", model.lineId, kind, model.simulatedMinutes);

const [workbook, pdf] = await Promise.all([buildWorkbook(model), buildPdf(model)]);
await writeFile(path.join(outputDir, xlsxName), workbook);
await writeFile(path.join(outputDir, pdfName), pdf);

console.log(`Senaryo   : ${model.scenarioLabel} (${kind}), tohum ${seed}, ${ticks} dk`);
console.log(
  `Üretim    : ${model.metrics.productionOutput}/${model.metrics.plannedProduction} araç`,
);
console.log(`OEE       : %${(model.metrics.oee * 100).toFixed(1).replace(".", ",")}`);
console.log(
  `Excel     : ${path.join(outputDir, xlsxName)} (${(workbook.length / 1024).toFixed(0)} KB)`,
);
console.log(`PDF       : ${path.join(outputDir, pdfName)} (${(pdf.length / 1024).toFixed(0)} KB)`);
