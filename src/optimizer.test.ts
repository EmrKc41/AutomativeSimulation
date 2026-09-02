import assert from "node:assert/strict";
import test from "node:test";

import { factoryConfig } from "./factory.ts";
import {
  LegacyOptimizer,
  NearestVehicleOptimizer,
  SlackAwareOptimizer,
  type DispatchView,
  type ReleaseView,
} from "./optimizer.ts";
import { compareOptimizers, runWith, summariseRun } from "./optimizer-compare.ts";
import { SolverOptimizer, buildRequest, type SolveResponse } from "./optimizer-service.ts";
import { scenarioKinds } from "./scenarios.ts";

/**
 * The planning seam.
 *
 * Two things are being protected here. The obvious one is that a policy returns
 * a sane plan. The one that matters more is that the **comparison** stays
 * honest: these tests fail if a policy silently starts making the plant worse,
 * which is the failure mode an optimisation phase is actually prone to.
 */

function release(overrides: Partial<ReleaseView> = {}): ReleaseView {
  return {
    time: 0,
    taktTime: 8,
    wip: 0,
    wipCap: 6,
    candidates: [
      {
        id: "WO-1",
        priority: 1,
        dueTick: 200,
        quantity: 20,
        released: 0,
        completed: 0,
        scrapped: 0,
      },
      {
        id: "WO-2",
        priority: 2,
        dueTick: 320,
        quantity: 20,
        released: 0,
        completed: 0,
        scrapped: 0,
      },
    ],
    ...overrides,
  };
}

function dispatch(overrides: Partial<DispatchView> = {}): DispatchView {
  return {
    time: 10,
    config: factoryConfig,
    vehicles: [
      { id: "AGV-1", location: "RAW-STOCK-A" },
      { id: "AGV-2", location: "LINE-SIDE/ASSEMBLY-01" },
    ],
    jobs: [
      {
        id: "MOV-1",
        materialId: "STEEL-COIL",
        from: "RAW-STOCK-A",
        to: "LINE-SIDE/PRESS-01",
        createdAt: 9,
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The contract every policy has to keep
// ---------------------------------------------------------------------------

const POLICIES = [
  new LegacyOptimizer(),
  new SlackAwareOptimizer(),
  new NearestVehicleOptimizer(),
] as const;

for (const policy of POLICIES) {
  test(`${policy.kind}: nothing to release means nothing is released`, () => {
    assert.equal(policy.nextRelease(release({ candidates: [] })), null);
  });

  test(`${policy.kind}: only ever names an order it was offered`, () => {
    const view = release();
    const chosen = policy.nextRelease(view);
    assert.ok(chosen !== null);
    assert.ok(
      view.candidates.some((candidate) => candidate.id === chosen),
      `${chosen} teklif edilenler arasında değil`,
    );
  });

  test(`${policy.kind}: never gives one vehicle two jobs or one job to two vehicles`, () => {
    const view = dispatch({
      jobs: [
        {
          id: "MOV-1",
          materialId: "A",
          from: "RAW-STOCK-A",
          to: "LINE-SIDE/PRESS-01",
          createdAt: 1,
        },
        {
          id: "MOV-2",
          materialId: "B",
          from: "RAW-STOCK-A",
          to: "LINE-SIDE/WELD-04",
          createdAt: 2,
        },
        {
          id: "MOV-3",
          materialId: "C",
          from: "RAW-STOCK-A",
          to: "LINE-SIDE/PAINT-01",
          createdAt: 3,
        },
      ],
    });
    const plan = policy.dispatch(view);

    assert.ok(plan.length <= view.vehicles.length, "araçtan fazla atama olamaz");
    assert.equal(new Set(plan.map((pair) => pair.agvId)).size, plan.length);
    assert.equal(new Set(plan.map((pair) => pair.taskId)).size, plan.length);
    for (const pair of plan) {
      assert.ok(view.vehicles.some((vehicle) => vehicle.id === pair.agvId));
      assert.ok(view.jobs.some((job) => job.id === pair.taskId));
    }
  });

  test(`${policy.kind}: the same situation always produces the same plan`, () => {
    // Determinism is the whole basis of the comparison: two policies can only
    // be told apart on one seed if neither of them is a coin flip.
    const view = dispatch();
    assert.deepEqual(policy.dispatch(view), policy.dispatch(view));
    assert.equal(policy.nextRelease(release()), policy.nextRelease(release()));
  });
}

// ---------------------------------------------------------------------------
// What the shipped policy actually does
// ---------------------------------------------------------------------------

test("with slack everywhere, the batch in progress is not interrupted", () => {
  const slack = new SlackAwareOptimizer();
  const baseline = new LegacyOptimizer();
  // Both orders can still make their dates comfortably, so the shipped policy
  // must agree with the old one rather than start shuffling.
  const view = release({ time: 0 });
  assert.equal(slack.nextRelease(view), baseline.nextRelease(view));
});

test("an order that can no longer make its date pre-empts a comfortable one", () => {
  const slack = new SlackAwareOptimizer();
  // WO-2 needs 20 × 8 = 160 minutes of takt and has 100 left: it cannot make
  // it. WO-1 has plenty of room despite its higher priority.
  const view = release({
    time: 100,
    candidates: [
      {
        id: "WO-1",
        priority: 1,
        dueTick: 900,
        quantity: 20,
        released: 0,
        completed: 0,
        scrapped: 0,
      },
      {
        id: "WO-2",
        priority: 9,
        dueTick: 200,
        quantity: 20,
        released: 0,
        completed: 0,
        scrapped: 0,
      },
    ],
  });

  assert.equal(slack.nextRelease(view), "WO-2");
  // The baseline cannot see this: priority 1 wins regardless of the clock.
  assert.equal(new LegacyOptimizer().nextRelease(view), "WO-1");
});

test("an order already past its date outranks one that is merely about to be", () => {
  const slack = new SlackAwareOptimizer();
  const view = release({
    time: 300,
    candidates: [
      {
        id: "LATE",
        priority: 5,
        dueTick: 250,
        quantity: 5,
        released: 0,
        completed: 0,
        scrapped: 0,
      },
      {
        id: "TIGHT",
        priority: 1,
        dueTick: 310,
        quantity: 5,
        released: 0,
        completed: 0,
        scrapped: 0,
      },
    ],
  });
  assert.equal(slack.nextRelease(view), "LATE");
});

test("the shipped policy leaves vehicle dispatch exactly as it was", () => {
  // Measured: choosing the nearest vehicle made travel worse on this layout.
  // The policy that ships therefore changes nothing here, and this test says so
  // out loud rather than leaving it to be rediscovered.
  const view = dispatch();
  assert.deepEqual(new SlackAwareOptimizer().dispatch(view), new LegacyOptimizer().dispatch(view));
});

// ---------------------------------------------------------------------------
// The result this phase claims
// ---------------------------------------------------------------------------

test("the shipped policy never costs output, on any scenario or seed", () => {
  for (const kind of scenarioKinds) {
    for (const seed of [1, 42, 907, 5150]) {
      const result = compareOptimizers(
        new LegacyOptimizer(),
        new SlackAwareOptimizer(),
        kind,
        600,
        seed,
      );
      assert.ok(
        result.delta.output >= 0,
        `${kind}/${seed}: üretim ${result.delta.output} araç düştü`,
      );
    }
  }
});

test("the shipped policy cuts lateness where the plant is under pressure", () => {
  // The demand surge is the only scenario with real lateness to remove; the
  // claim is specific and is checked as a specific number, not a vibe.
  let baseline = 0;
  let candidate = 0;
  let worstImproved = 0;
  for (const seed of [1, 42, 907, 5150]) {
    const result = compareOptimizers(
      new LegacyOptimizer(),
      new SlackAwareOptimizer(),
      "demand_surge",
      600,
      seed,
    );
    baseline += result.baseline.totalLatenessMinutes;
    candidate += result.candidate.totalLatenessMinutes;
    if (result.delta.maxLatenessMinutes < 0) worstImproved += 1;
  }

  assert.ok(baseline > 0, "taban zaten gecikmesizse test bir şey ölçmüyor");
  assert.ok(
    candidate < baseline * 0.75,
    `gecikme ${baseline} → ${candidate}; en az dörtte bir düşmeliydi`,
  );
  assert.equal(worstImproved, 4, "en kötü iş emri her tohumda iyileşmeliydi");
});

test("a scenario with no lateness to remove is left completely alone", () => {
  // A policy that fidgets with a healthy line is a liability. Byte-identical
  // outcomes are the strongest possible statement of "changed nothing".
  for (const kind of ["normal", "quality_failure"] as const) {
    const result = compareOptimizers(
      new LegacyOptimizer(),
      new SlackAwareOptimizer(),
      kind,
      600,
      42,
    );
    assert.deepEqual(result.delta, {
      output: 0,
      oee: 0,
      lateOrders: 0,
      totalLatenessMinutes: 0,
      maxLatenessMinutes: 0,
      agvTravelMinutes: 0,
      agvEmptyMinutes: 0,
      energyKwh: 0,
    });
  }
});

test("the rejected policy is still measurably worse, so the record stands", () => {
  /**
   * Bu test, yazılan gerekçenin sessizce eskimesini engellemek için var — ve
   * bir kez işini yaptı.
   *
   * Kural tek hatlı tesiste **üç** gerekçeyle reddedilmişti: gecikme, en kötü
   * iş emri ve doli yolu. Tesis üç hatta çıkınca üçüncüsü düştü: on iki hat
   * kenarı kutusu ve dokuz araba varken "en yakın aracı seç" gerçekten yol
   * kazandırıyor (600 dk, 4 tohum, bütün senaryolar: −1159 dk yol, −835 dk boş
   * yol).
   *
   * Ret **duruyor**, çünkü gecikme 1640 dk, en kötü iş emri 526 dk artıyor ve
   * tesis gecikmeyle ölçülüyor, doli kilometresiyle değil. Ama gerekçe artık
   * iki maddeli; üç yazmak, ölçümün söylemediğini söylemek olurdu.
   *
   * Aynı dört tohum: daha erken bir sürüm iki tohum kullanıyordu, bu da
   * koruduğu iddiadan küçük bir örneklemdi.
   */
  let lateness = 0;
  let worst = 0;
  let travel = 0;
  for (const kind of scenarioKinds) {
    for (const seed of [1, 42, 907, 5150]) {
      const result = compareOptimizers(
        new LegacyOptimizer(),
        new NearestVehicleOptimizer(),
        kind,
        600,
        seed,
      );
      lateness += result.delta.totalLatenessMinutes;
      worst += result.delta.maxLatenessMinutes;
      travel += result.delta.agvTravelMinutes;
    }
  }

  // Reddin ayakta duran iki gerekçesi.
  assert.ok(lateness > 0, `gecikme ${lateness} dk; reddedilme gerekçesi yenilenmeli`);
  assert.ok(worst > 0, `en kötü iş emri ${worst} dk; reddedilme gerekçesi yenilenmeli`);

  // Ve düşen gerekçe: yol artık kuralın *lehine*. Bu da bir ölçüm, o yüzden
  // o da korunuyor — geri dönerse kayıt yine yüksek sesle eskisin.
  assert.ok(
    travel < 0,
    `yol farkı ${travel} dk; üç hatlı tesiste kuralın yol kazancı kayboldu, gerekçe yenilenmeli`,
  );
});

test("empty running is measured in the same unit as travel", () => {
  // A first version compared grid units against minutes, so every run reported
  // zero empty running. A metric that is silently always zero hides the thing
  // it was added to show.
  const result = summariseRun(
    runWith(new LegacyOptimizer(), "normal", 600, 42),
    "legacy",
    "normal",
  );
  assert.ok(result.agvTravelMinutes > 0);
  assert.ok(result.agvEmptyMinutes > 0, "boş yol sıfır çıkıyor — birim uyuşmuyor");
  assert.ok(result.agvEmptyMinutes < result.agvTravelMinutes, "boş yol toplam yolu aşamaz");
});

// ---------------------------------------------------------------------------
// The solver adapter
// ---------------------------------------------------------------------------

function stubSolver(body: SolveResponse | null, status = 200) {
  const calls: unknown[] = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body ?? "{}")));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the solver is never waited on: the local rule answers immediately", () => {
  const hanging = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  const solver = new SolverOptimizer({ endpoint: "http://x", fetchImpl: hanging });

  const started = Date.now();
  const plan = solver.dispatch(dispatch());

  assert.ok(Date.now() - started < 100, "sevk kararı ağ beklememeli");
  assert.deepEqual(plan, new LegacyOptimizer().dispatch(dispatch()));
});

test("a solver plan is used once it arrives for the situation it was solved for", async () => {
  const { impl } = stubSolver({ assignments: [{ vehicleId: "AGV-2", jobId: "MOV-1" }] });
  const solver = new SolverOptimizer({ endpoint: "http://x", fetchImpl: impl });

  solver.dispatch(dispatch());
  await settle();
  const plan = solver.dispatch(dispatch());

  // AGV-2 is the far vehicle; the local rule would have picked AGV-1, so this
  // can only have come from the solver.
  assert.deepEqual(plan, [{ agvId: "AGV-2", taskId: "MOV-1" }]);
  assert.equal(solver.used, 1);
});

test("a plan solved for a different situation is discarded, not reused", async () => {
  const { impl } = stubSolver({ assignments: [{ vehicleId: "AGV-2", jobId: "MOV-1" }] });
  const solver = new SolverOptimizer({ endpoint: "http://x", fetchImpl: impl });

  solver.dispatch(dispatch());
  await settle();

  // The fleet has moved on: a plan for where they used to be is a wrong answer,
  // not a stale optimum.
  const moved = dispatch({
    vehicles: [
      { id: "AGV-1", location: "LINE-SIDE/PAINT-01" },
      { id: "AGV-2", location: "LINE-SIDE/PRESS-01" },
    ],
  });
  assert.deepEqual(solver.dispatch(moved), new LegacyOptimizer().dispatch(moved));
});

test("a failing solver never stops material moving", async () => {
  const failing = (async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;
  const solver = new SolverOptimizer({ endpoint: "http://x", fetchImpl: failing });

  solver.dispatch(dispatch());
  await settle();
  const plan = solver.dispatch(dispatch());

  assert.ok(solver.failures >= 1, "hata sayılmalı");
  assert.deepEqual(plan, new LegacyOptimizer().dispatch(dispatch()));
});

test("a plan naming a vehicle or job that was not offered is rejected", async () => {
  const { impl } = stubSolver({
    assignments: [
      { vehicleId: "AGV-99", jobId: "MOV-1" },
      { vehicleId: "AGV-1", jobId: "MOV-99" },
    ],
  });
  const solver = new SolverOptimizer({ endpoint: "http://x", fetchImpl: impl });

  solver.dispatch(dispatch());
  await settle();
  const plan = solver.dispatch(dispatch());

  // Nothing in the plan was real, so the local rule answers instead of the
  // vehicles being left parked.
  assert.deepEqual(plan, new LegacyOptimizer().dispatch(dispatch()));
});

test("a malformed solver body is a failure, not a plan", async () => {
  const impl = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }) as Response) as unknown as typeof fetch;
  const solver = new SolverOptimizer({ endpoint: "http://x", fetchImpl: impl });

  solver.dispatch(dispatch());
  await settle();

  assert.ok(solver.failures >= 1);
  assert.equal(solver.used, 0);
});

test("the solver is sent the same travel times the engine charges", () => {
  const view = dispatch();
  const request = buildRequest(view);
  const { locations, minutes } = request.costMatrix;

  assert.ok(locations.includes("RAW-STOCK-A"));
  assert.equal(minutes.length, locations.length);
  for (const row of minutes) assert.equal(row.length, locations.length);

  const from = locations.indexOf("RAW-STOCK-A");
  const to = locations.indexOf("LINE-SIDE/PRESS-01");
  assert.equal(minutes[from]![from], 0, "bir yerden kendine yol sıfır olmalı");
  // Optimising a distance the plant does not drive produces a plan that is
  // optimal for a factory that does not exist. That mistake was made once in
  // this phase already, which is why this is asserted.
  assert.ok(minutes[from]![to]! > 0);
});
