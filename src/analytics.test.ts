import assert from "node:assert/strict";
import test from "node:test";

import {
  explainBottleneck,
  explainMachineRisk,
  explainMaterial,
  explainOeeLoss,
  explainQuality,
  explainScheduleVariance,
  explainShipments,
  explainStatus,
  rankMachineRisk,
  runAllAnalyses,
  type Analysis,
} from "./analytics.ts";
import { run } from "./engine.ts";
import { factoryConfig, lineOfStation, routeStationIds } from "./factory.ts";
import { scenarios } from "./scenarios.ts";
import { createSimulation, type SimulationState } from "./state.ts";

function simulate(
  kind: keyof typeof scenarios = "normal",
  ticks = 300,
  seed = 42,
): SimulationState {
  return run(createSimulation({ seed, scenario: scenarios[kind] }), ticks);
}

test("every station's time ledger accounts for exactly the elapsed time", () => {
  // Every loss attribution in this module divides by elapsed time, so a station
  // that books more minutes than have passed would overstate every loss.
  for (const kind of ["normal", "machine_failure", "line_stop", "quality_failure"] as const) {
    const state = simulate(kind);
    for (const machine of state.machines) {
      const ledger =
        machine.runTicks +
        machine.starvedTicks +
        machine.blockedTicks +
        machine.idleTicks +
        machine.downtimeTicks;
      assert.equal(
        ledger,
        state.time,
        `${kind}/${machine.id} booked ${ledger} minutes of a ${state.time} minute run`,
      );
    }
  }
});

test("the OEE loss ledger is reported as shares of the elapsed time", () => {
  const state = simulate("machine_failure");
  const analysis = explainOeeLoss(state);
  const ledger = analysis.findings[0];

  assert.ok(ledger);
  // Percentages are rendered in Turkish: "(%83,6)".
  const percentages = [...ledger.detail.matchAll(/\(%(\d+,\d)\)/g)].map((match) =>
    Number((match[1] ?? "0").replace(",", ".")),
  );
  assert.ok(percentages.length >= 4);
  const total = percentages.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 100) < 0.6, `loss ledger sums to ${total}%`);
});

test("the constraint named is a real route station backed by its own record", () => {
  const state = simulate();
  const analysis = explainBottleneck(state);

  assert.ok(analysis.findings.length > 0);
  const machineEvidence = analysis.findings[0]?.evidence.find((item) => item.kind === "machine");
  assert.ok(machineEvidence);
  assert.ok(routeStationIds(factoryConfig).has(machineEvidence.id));
  assert.ok(state.machines.some((machine) => machine.id === machineEvidence.id));
});

test("the constraint analysis names what would not help, not only what would", () => {
  const state = simulate();
  const analysis = explainBottleneck(state);
  const headlines = analysis.findings.map((finding) => finding.headline).join(" | ");

  assert.match(headlines, /hattı tutmayan|bekleyen istasyonlar|Yukarıda bekletilen/);
  assert.ok(analysis.recommendation);
});

test("idle time is attributed to the right side of the constraint", () => {
  const state = simulate();
  const analysis = explainBottleneck(state);
  const constraint = analysis.findings[0]?.evidence.find((item) => item.kind === "machine");
  assert.ok(constraint);
  // Yukarı/aşağı yalnızca kısıtın kendi hattı içinde anlamlı: tesiste üç hat
  // var ve başka bir hattın makinesi bu rotada hiç bulunmaz.
  const line = lineOfStation(factoryConfig, constraint.id);
  const constraintIndex = line.route.indexOf(constraint.id);

  const downstream = analysis.findings.find((finding) =>
    finding.headline.includes("bekleyen istasyonlar"),
  );
  for (const evidence of downstream?.evidence ?? []) {
    assert.ok(
      line.route.indexOf(evidence.id) > constraintIndex,
      `${evidence.id} is not downstream of ${constraint.id}`,
    );
  }

  const upstream = analysis.findings.find((finding) =>
    finding.headline.includes("Yukarıda bekletilen"),
  );
  for (const evidence of upstream?.evidence ?? []) {
    assert.ok(
      line.route.indexOf(evidence.id) < constraintIndex,
      `${evidence.id} is not upstream of ${constraint.id}`,
    );
  }

  assert.ok(
    downstream !== undefined || upstream !== undefined,
    "a saturated line should show idle time on at least one side",
  );
});

test("a stopped constraint is reported as a maintenance problem, not a capacity one", () => {
  const state = simulate("line_stop");
  const analysis = explainOeeLoss(state);

  assert.ok(analysis.recommendation);
  assert.match(analysis.recommendation, /bakım|beslemesiz|aşağı/i);
});

test("schedule variance compares output against takt, not against a guess", () => {
  const state = simulate();
  const analysis = explainScheduleVariance(state);
  const evidence = analysis.findings[0]?.evidence ?? [];

  const output = evidence.find((item) => item.id === "productionOutput");
  const expected = evidence.find((item) => item.id === "expected");
  assert.equal(output?.value, String(state.metrics.productionOutput));
  assert.equal(Number(expected?.value), Math.floor(state.time / state.metrics.taktTime));
});

test("a work order that cannot finish on time is named with its own numbers", () => {
  const state = simulate("demand_surge", 400);
  const analysis = explainScheduleVariance(state);
  const risky = analysis.findings.filter((finding) =>
    finding.headline.includes("terminine yetişmez"),
  );

  assert.ok(risky.length > 0, "the surge scenario must produce an unachievable order");
  for (const finding of risky) {
    const order = finding.evidence.find((item) => item.kind === "work-order");
    assert.ok(order);
    assert.ok(state.workOrders.some((candidate) => candidate.id === order.id));
  }
});

test("machine risk ranks observed history and says so", () => {
  const state = simulate("machine_failure");
  const ranked = rankMachineRisk(state);
  const analysis = explainMachineRisk(state);

  assert.ok(ranked.length > 0);
  for (let index = 1; index < ranked.length; index += 1) {
    assert.ok(ranked[index - 1]!.score >= ranked[index]!.score, "ranking must be ordered");
  }
  const welding = ranked.find((entry) => entry.machineId === "WELD-04");
  assert.ok(welding);
  assert.ok(welding.failures > 0, "the scenario stopped this station");
  assert.ok(
    analysis.caveats.some((caveat) => /Tahmin modeli değildir/i.test(caveat)),
    "the analysis must not present a ranking as a prediction",
  );
});

test("a machine's evidence is about that machine, not about the plant", () => {
  const state = simulate("machine_failure");
  const analysis = explainMachineRisk(state);
  const eventsById = new Map([...state.events].map((event) => [event.eventId, event]));

  for (const finding of analysis.findings) {
    const machine = finding.evidence.find((item) => item.kind === "machine");
    assert.ok(machine);
    for (const evidence of finding.evidence) {
      if (evidence.kind !== "event") continue;
      const event = eventsById.get(evidence.id);
      assert.ok(event);
      assert.equal(
        event.source,
        machine.id,
        `${finding.headline} cites an event from ${event.source}`,
      );
    }
  }
});

test("quality analysis reports the defect Pareto and any escapes it can prove", () => {
  const state = simulate("quality_failure");
  const analysis = explainQuality(state);

  assert.match(analysis.summary, /İlk seferde doğru/);
  const escapes = analysis.findings.find((finding) =>
    finding.headline.includes("müşteriye ulaştı"),
  );
  const escapedInState = state.defects.filter((defect) => {
    if (defect.detected || defect.resolved) return false;
    const product = state.productIndex.get(defect.productId);
    return product !== undefined && product.completedAt !== null;
  });
  assert.equal(escapes !== undefined, escapedInState.length > 0);
});

test("material analysis only claims a shortage when the log contains one", () => {
  /**
   * Özetin **kayıtla uyuşması** aranıyor, belirli bir cümle değil.
   *
   * Önceden "normal koşuda eksik olmaz" diye sabitlenmişti; bu, tek hatlı
   * tesiste doğruydu. Üç hat aynı depodan beslenince hat kenarında kısa
   * boşluklar oluşabiliyor — çıktıyı düşürmeyen ama gerçekten yaşanan
   * boşluklar. Beklentiyi sabit tutmak, doğru raporu yanlış saymak olurdu.
   */
  const sayim = (state: SimulationState) =>
    state.events.filter(
      (event) => event.type === "MATERIAL_SHORTAGE" || event.type === "STATION_STARVED",
    ).length;

  for (const kind of ["normal", "material_shortage"] as const) {
    const state = simulate(kind);
    const analysis = explainMaterial(state);
    const kayit = sayim(state);

    if (kayit === 0) {
      assert.match(analysis.summary, /malzeme eksiği olmadı/, `${kind}: kayıt boş ama özet dolu`);
    } else {
      assert.match(analysis.summary, new RegExp(`${kayit} kez`), `${kind}: özet kayıtla uyuşmuyor`);
    }
  }

  // Ve senaryo adını hak etmeli: malzeme senaryosu normalden fazla kesinti
  // üretmezse, senaryo anlattığı şeyi yapmıyor demektir.
  assert.ok(sayim(simulate("material_shortage")) > sayim(simulate("normal")));

  const starved = explainMaterial(simulate("material_shortage"));
  assert.ok(starved.suggestedCommand, "a reproducible condition may offer a scenario to re-run");
});

test("shipment analysis measures lateness against the plan, not against now", () => {
  const state = simulate("normal", 400);
  const analysis = explainShipments(state);
  const departed = state.shipments.filter((shipment) => shipment.actualDeparture !== null);

  assert.ok(departed.length > 0);
  assert.match(analysis.summary, new RegExp(`${departed.length} tır sevk edildi`));
});

test("status reports the same numbers the metrics projection holds", () => {
  const state = simulate();
  const analysis = explainStatus(state);
  const evidence = analysis.findings[0]?.evidence ?? [];

  assert.equal(
    evidence.find((item) => item.id === "output")?.value,
    String(state.metrics.productionOutput),
  );
  assert.equal(
    evidence.find((item) => item.id === "downtime")?.value,
    `${Math.round(state.metrics.downtime)} dk`,
  );
});

test("no analysis invents an entity that is not in the run", () => {
  const state = simulate("quality_failure", 320);
  const machineIds = new Set(state.machines.map((machine) => machine.id));
  const productIds = new Set(state.products.map((product) => product.id));
  const eventIds = new Set([...state.events].map((event) => event.eventId));
  const orderIds = new Set(state.workOrders.map((order) => order.id));
  const alertIds = new Set(state.alerts.map((alert) => alert.id));
  const shipmentIds = new Set(state.shipments.map((shipment) => shipment.id));
  const defectIds = new Set(state.defects.map((defect) => defect.id));

  for (const analysis of runAllAnalyses(state)) {
    for (const finding of analysis.findings) {
      for (const evidence of finding.evidence) {
        switch (evidence.kind) {
          case "machine":
            assert.ok(machineIds.has(evidence.id), `unknown machine ${evidence.id}`);
            break;
          case "event":
            assert.ok(eventIds.has(evidence.id), `unknown event ${evidence.id}`);
            break;
          case "work-order":
            assert.ok(orderIds.has(evidence.id), `unknown work order ${evidence.id}`);
            break;
          case "alert":
            assert.ok(alertIds.has(evidence.id), `unknown alert ${evidence.id}`);
            break;
          case "shipment":
            assert.ok(shipmentIds.has(evidence.id), `unknown shipment ${evidence.id}`);
            break;
          case "product":
            assert.ok(
              productIds.has(evidence.id) || defectIds.has(evidence.id),
              `unknown product or defect ${evidence.id}`,
            );
            break;
          default:
            break;
        }
      }
    }
  }
});

test("every analysis carries its own caveats and never claims certainty it lacks", () => {
  const state = simulate();

  for (const analysis of runAllAnalyses(state)) {
    assert.ok(analysis.title.length > 0);
    assert.ok(analysis.summary.length > 0);
    assertNoFabricatedConfidence(analysis);
  }
});

function assertNoFabricatedConfidence(analysis: Analysis): void {
  const text = [analysis.summary, analysis.recommendation ?? ""].join(" ").toLowerCase();
  // Turkish and English alike: an analysis may not promise the future.
  for (const forbidden of ["kesinlikle", "garanti", "arızalanacak", "tahmin ediyor"]) {
    assert.ok(!text.includes(forbidden), `"${forbidden}" overstates what this analysis knows`);
  }
}

test("analysis never mutates the simulation it reads", () => {
  const state = simulate("machine_failure", 200);
  const before = JSON.stringify({
    time: state.time,
    metrics: state.metrics,
    machines: state.machines,
    products: state.products.length,
    events: state.events.length,
    alerts: state.alerts.length,
  });

  runAllAnalyses(state);

  const after = JSON.stringify({
    time: state.time,
    metrics: state.metrics,
    machines: state.machines,
    products: state.products.length,
    events: state.events.length,
    alerts: state.alerts.length,
  });
  assert.equal(after, before);
});

test("a run with no output declines to name a constraint", () => {
  const state = run(createSimulation({ seed: 42, scenario: scenarios.normal }), 3);
  const analysis = explainBottleneck(state);

  assert.equal(analysis.findings.length, 0);
  assert.match(analysis.summary, /kadar araç üretmedi/);
});
