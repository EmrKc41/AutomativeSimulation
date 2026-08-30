import assert from "node:assert/strict";
import test from "node:test";

import { run, snapshot } from "./engine.ts";
import { factoryConfig } from "./factory.ts";
import { scenarios } from "./scenarios.ts";
import { createSimulation } from "./state.ts";

/**
 * Mal kabul: tır, boşaltma ve girdi kalitesi.
 *
 * Buradaki testlerin çoğu tek bir iddiayı koruyor: **tır eklemek fabrikanın
 * davranışını değiştirmedi.** Tır bir süs olsaydı bu önemsiz olurdu; teslimatı
 * fiilen taşıdığı için önemli. Zamanlaması bir dakika kaysa bütün tedarik
 * programı kayardı ve bunu fark etmek zor olurdu.
 */

function normalRun(ticks: number) {
  const state = createSimulation({ seed: 42, scenario: scenarios.normal });
  run(state, ticks);
  return state;
}

test("stock still lands exactly on the supply schedule", () => {
  const state = normalRun(200);
  const result = snapshot(state);

  for (const material of factoryConfig.materials) {
    const minutes = result.events
      .filter(
        (event) =>
          event.type === "MATERIAL_RECEIVED" &&
          event.correlationId.startsWith(material.id) &&
          // Minute zero is the opening stock, which no truck brought.
          event.occurredAt > 0,
      )
      .map((event) => event.occurredAt);

    assert.ok(minutes.length > 0, `${material.id} hiç gelmedi`);
    for (const minute of minutes) {
      assert.equal(
        minute % material.supplyIntervalTicks,
        0,
        `${material.id} ${minute}. dakikada geldi; program ${material.supplyIntervalTicks} dakikada bir`,
      );
    }
  }
});

test("a truck walks its whole state machine, in order", () => {
  const state = createSimulation({ seed: 42, scenario: scenarios.normal });
  const seen: string[] = [];

  for (let minute = 0; minute < 30; minute += 1) {
    run(state, 1);
    const truck = state.trucks.find((candidate) => candidate.id === "TIR-0001");
    if (truck && seen.at(-1) !== truck.status) seen.push(truck.status);
  }

  assert.deepEqual(seen, ["ARRIVING", "DOCKED", "UNLOADING", "COMPLETED"]);
});

test("nothing is in the store until it has come off the truck", () => {
  const state = createSimulation({ seed: 42, scenario: scenarios.normal });

  // Opening stock exists from minute zero; this is about the first delivery.
  const opening = state.inventory.length;

  let unloadedAt: number | null = null;
  for (let minute = 0; minute < 30; minute += 1) {
    run(state, 1);
    const truck = state.trucks.find((candidate) => candidate.id === "TIR-0001");
    if (!truck) continue;

    if (truck.status !== "COMPLETED") {
      // A truck that is still driving or still being unloaded has not delivered
      // anything. If stock appeared here the truck would be theatre.
      assert.equal(
        state.inventory.length,
        opening,
        `${state.time}. dakikada tır ${truck.status} iken stok düştü`,
      );
    } else if (unloadedAt === null) {
      unloadedAt = state.time;
      assert.equal(state.inventory.length, opening + 1);
    }
  }

  assert.equal(unloadedAt, 24, "ilk çelik teslimatı 24. dakikada düşmeli");
});

test("the batch on the truck is the batch that reaches the store", () => {
  // Read while the truck is still on the dock: finished trucks are cleared a
  // few minutes after unloading so the scene can drive them away.
  const state = normalRun(26);
  const truck = state.trucks.find((candidate) => candidate.id === "TIR-0001");
  assert.ok(truck, "tır ayrılmadan okunmalı");

  // Traceability starts at the gate, not at the shelf: the id painted on the
  // truck in the 3D view is the id the lot keeps for the rest of its life.
  const lot = state.inventory.find((balance) => balance.batchId === truck.batchId);
  assert.ok(lot, `${truck.batchId} depoda bulunamadı`);
  assert.equal(lot.quantity, truck.quantity);
});

test("the truck reports what incoming quality decided, once it knows", () => {
  const state = normalRun(400);

  for (const truck of state.trucks) {
    if (truck.status !== "COMPLETED") {
      // Before unloading, the answer is not "pass", it is "not yet". A screen
      // that showed green here would be claiming a check that has not happened.
      assert.equal(truck.accepted, null, `${truck.id} boşaltmadan önce karar verdi`);
      continue;
    }
    assert.notEqual(truck.accepted, null);
    const lot = state.inventory.find((balance) => balance.batchId === truck.batchId);
    if (!lot) continue;
    assert.equal(
      truck.accepted,
      lot.status !== "QUARANTINE",
      `${truck.id} kararı stok durumuyla uyuşmuyor`,
    );
  }
});

test("finished trucks leave rather than piling up on the dock", () => {
  const state = normalRun(600);

  // Without a cleanup the array would grow for as long as the plant runs, and
  // the scene would draw every truck that ever arrived.
  const parked = state.trucks.filter((truck) => truck.status === "COMPLETED");
  assert.ok(state.trucks.length < 8, `rampada ${state.trucks.length} tır birikmiş`);
  for (const truck of parked) {
    assert.ok(truck.completedAt !== null);
    assert.ok(
      state.time - (truck.completedAt ?? 0) <= 4,
      `${truck.id} bittikten ${state.time - (truck.completedAt ?? 0)} dakika sonra hâlâ sahnede`,
    );
  }
});

test("a supply cut reaches the store one delivery late, because the load is already on the road", () => {
  // A deliberate behaviour change, recorded here so it is a decision rather
  // than a surprise.
  //
  // The shortage scenario cuts supply to 25% at minute 30. Before trucks
  // existed the delivery due at minute 30 was already reduced. Now that
  // delivery was dispatched at minute 22, when the supplier had not yet cut
  // anything — and a truck already loaded and driving does not lose pallets
  // because someone changed their mind. The cut bites on the next load.
  const state = createSimulation({ seed: 42, scenario: scenarios.material_shortage });
  run(state, 120);
  const result = snapshot(state);

  // Paint arrives every 30 minutes, so a delivery lands exactly on the cut.
  const paint = factoryConfig.materials.find((material) => material.id === "PAINT-KIT");
  assert.ok(paint);
  const full = paint.supplyQuantity;

  // Read from the events, not from inventory rows: a lot is split when part of
  // it moves to line side, so one delivery can be several balance rows.
  const delivered = new Map<number, number>();
  for (const event of result.events) {
    if (event.type !== "MATERIAL_RECEIVED") continue;
    if (!event.correlationId.startsWith("PAINT-KIT")) continue;
    if (event.occurredAt === 0) continue;
    delivered.set(event.occurredAt, Number(event.payload["quantity"]));
  }

  assert.equal(
    delivered.get(30),
    full,
    "30. dakikada inen yük 22. dakikada yüklendi; kesintiden etkilenmemeli",
  );
  assert.ok((delivered.get(60) ?? full) < full, "kesintiden sonra yüklenen tır az getirmeli");
});
