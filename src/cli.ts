import type { FactoryEvent, ProductUnit, SimulationResult } from "./domain.ts";
import { scenarioKinds, isScenarioKind, scenarios } from "./scenarios.ts";
import { compareScenarios, runScenario } from "./simulation.ts";

/**
 * Local inspector for the simulation.
 *
 * This is intentionally a terminal report rather than a dashboard: the point of
 * this phase is to make the operational model verifiable before any pixel of
 * the command centre is drawn.
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

const ticks = Number(flags.get("ticks") ?? 240);
const seed = Number(flags.get("seed") ?? 42);
const kindArg = positionals[0] ?? "normal";

if (flags.has("help")) {
  console.log(
    [
      "Usage: npm run scenario -- [scenario] [--ticks=240] [--seed=42] [--json] [--compare]",
      `Scenarios: ${scenarioKinds.join(", ")}`,
    ].join("\n"),
  );
  process.exit(0);
}

if (flags.has("compare")) {
  const rows = compareScenarios(scenarioKinds, ticks, seed);
  console.log(`Scenario comparison — ${ticks} ticks, seed ${seed}\n`);
  console.log(
    table(
      [
        "Scenario",
        "Output",
        "Δ vs base",
        "OEE",
        "FPY",
        "Scrap",
        "Downtime",
        "Schedule",
        "Shipped",
        "Bottleneck",
      ],
      rows.map((row) => [
        row.scenario,
        String(row.output),
        row.outputDeltaVsBaseline === 0 ? "—" : formatSigned(row.outputDeltaVsBaseline),
        percent(row.oee),
        percent(row.firstPassYield),
        percent(row.scrapRate),
        String(row.downtime),
        percent(row.scheduleAdherence),
        String(row.shipmentsDispatched),
        row.bottleneck ?? "—",
      ]),
    ),
  );
  process.exit(0);
}

if (!isScenarioKind(kindArg)) {
  console.error(`Unknown scenario "${kindArg}". Available: ${scenarioKinds.join(", ")}`);
  process.exit(1);
}

const result = runScenario({ kind: kindArg, ticks, seed });

if (flags.has("json")) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

report(result);

// ---------------------------------------------------------------------------

function report(run: SimulationResult): void {
  const scenario = scenarios[run.scenario];
  const metrics = run.metrics;

  console.log(`\n=== ${scenario.label} (${run.scenario}) ===`);
  console.log(scenario.description);
  console.log(`Horizon: ${run.simulatedTime} ticks · seed ${run.seed}\n`);

  console.log("-- Plant KPIs --");
  console.log(
    kv([
      ["OEE", percent(metrics.oee)],
      ["Availability", percent(metrics.availability)],
      ["Performance", percent(metrics.performance)],
      ["Quality", percent(metrics.quality)],
      ["Output / planned", `${metrics.productionOutput} / ${metrics.plannedProduction}`],
      ["Schedule adherence", percent(metrics.scheduleAdherence)],
      ["First pass yield", percent(metrics.firstPassYield)],
      ["Rework rate", percent(metrics.reworkRate)],
      ["Scrap rate", percent(metrics.scrapRate)],
      [
        "Cycle time / takt",
        `${metrics.cycleTime.toFixed(2)} / ${metrics.taktTime.toFixed(2)} ticks`,
      ],
      ["Throughput", `${metrics.throughput.toFixed(3)} units/tick`],
      ["WIP", String(metrics.wip)],
      ["Downtime", `${metrics.downtime} ticks`],
      ["MTBF / MTTR", `${metrics.mtbf.toFixed(1)} / ${metrics.mttr.toFixed(1)} ticks`],
      ["Energy", `${metrics.energyConsumptionKwh.toFixed(1)} kWh`],
      ["Inventory on hand", String(metrics.inventoryOnHand)],
      ["Defects detected / escaped", `${metrics.detectedDefects} / ${metrics.escapedDefects}`],
      ["Bottleneck", metrics.bottleneck ?? "none"],
    ]),
  );

  console.log("\n-- Stations --");
  console.log(
    table(
      ["Machine", "Status", "Util", "Avail", "Queue", "Done", "Down", "Constraint"],
      metrics.machines.map((machine) => [
        machine.machineId,
        machine.status,
        percent(machine.utilization),
        percent(machine.availability),
        String(machine.queueLength),
        String(machine.producedCount),
        String(machine.downtime),
        machine.bottleneck ? "YES" : "",
      ]),
    ),
  );

  console.log("\n-- Shipments --");
  console.log(
    table(
      ["Shipment", "Status", "Units", "Planned", "Actual", "Destination"],
      run.shipments.map((shipment) => [
        shipment.id,
        shipment.status,
        String(shipment.productIds.length),
        String(shipment.plannedDeparture),
        shipment.actualDeparture === null ? "—" : String(shipment.actualDeparture),
        shipment.destination,
      ]),
    ),
  );

  const openAlerts = run.alerts.filter((alert) => alert.resolvedAt === null);
  console.log(`\n-- Alerts (${openAlerts.length} open / ${run.alerts.length} total) --`);
  for (const alert of run.alerts.slice(-8)) {
    const state = alert.resolvedAt === null ? "OPEN" : `closed@${alert.resolvedAt}`;
    console.log(
      `  t=${alert.occurredAt} [${alert.severity}] ${alert.code} ${state} — ${alert.message}`,
    );
  }

  const traced = pickTraceableProduct(run);
  if (traced) {
    console.log(`\n-- Traceability: ${traced.id} --`);
    console.log(
      kv([
        ["Work order", traced.workOrderId],
        ["Status", traced.status],
        ["Released / completed", `${traced.releasedAt ?? "—"} / ${traced.completedAt ?? "—"}`],
        [
          "Lead time",
          traced.completedAt !== null && traced.releasedAt !== null
            ? `${traced.completedAt - traced.releasedAt} ticks`
            : "—",
        ],
        ["Rework passes", String(traced.reworkCount)],
        ["Material lots", traced.consumedMaterialBatchIds.join(", ") || "—"],
        ["Shipment", traced.shipmentId ?? "—"],
      ]),
    );
    for (const record of traced.history) {
      console.log(
        `  ${record.stationId.padEnd(12)} ${record.startedAt}→${record.completedAt} (pass ${record.reworkPass})`,
      );
    }
    for (const inspectionId of traced.inspectionIds) {
      const inspection = run.inspections.find((candidate) => candidate.id === inspectionId);
      if (!inspection) continue;
      console.log(
        `  ${inspection.stationId.padEnd(12)} ${inspection.method} ${inspection.result} p(defect)=${inspection.defectProbability}`,
      );
    }
  }

  console.log("\n-- Event mix --");
  const counts = new Map<string, number>();
  for (const event of run.events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  console.log(
    table(
      ["Event", "Count"],
      sorted.map(([type, count]) => [type, String(count)]),
    ),
  );

  console.log("\n-- Last operational events --");
  for (const event of significantEvents(run.events).slice(-12)) {
    console.log(
      `  t=${String(event.occurredAt).padStart(3)} ${event.type.padEnd(22)} ${event.correlationId}`,
    );
  }
  console.log("");
}

function pickTraceableProduct(run: SimulationResult): ProductUnit | undefined {
  return (
    run.products.find((product) => product.reworkCount > 0 && product.completedAt !== null) ??
    run.products.find((product) => product.completedAt !== null) ??
    run.products[0]
  );
}

function significantEvents(events: readonly FactoryEvent[]): FactoryEvent[] {
  const noisy = new Set(["MATERIAL_CONSUMED", "MACHINE_STARTED", "OPERATION_COMPLETED"]);
  return events.filter((event) => !noisy.has(event.type));
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function kv(rows: ReadonlyArray<readonly [string, string]>): string {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`).join("\n");
}

function table(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const line = (cells: readonly string[]): string =>
    "  " + cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join(
    "\n",
  );
}
