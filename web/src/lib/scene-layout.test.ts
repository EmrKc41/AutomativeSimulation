import { describe, expect, test } from "vitest";

import type { FactoryDescriptor } from "@/lib/api";
import type { Agv, FactoryFrame, Machine, ProductUnit, Shipment } from "@/lib/contract";
import {
  ZONES,
  bufferSlot,
  cameraBookmarks,
  incomingQcPlacement,
  machineSlot,
  placeAgvs,
  placeCarriers,
  placeTrucks,
  placeUnits,
  planPosition,
  productionGatePlacement,
  quarantinePlacement,
  shippingBuildingPlacement,
  stationWorld,
  toWorld,
} from "@/lib/scene-layout";
import { MACHINE_STATE, PRODUCT_STATE, SHIPMENT_STATE, TONE } from "@/lib/status";

// --- fixtures ---------------------------------------------------------------

function station(id: string, position: [number, number]): FactoryDescriptor["stations"][number] {
  return {
    id,
    name: id,
    workCenter: "Test",
    lineId: "LINE-01",
    cycleTicks: 4,
    cycleJitter: 1,
    bufferCapacity: 3,
    failureRatePerTick: 0,
    repairTicks: [1, 2],
    defectRate: 0,
    defectTypes: [],
    inspection: {
      enabled: false,
      method: "VISION",
      recall: 0,
      falsePositiveRate: 0,
      cameraId: null,
    },
    runEnergyKwhPerTick: 1,
    idleEnergyKwhPerTick: 0.1,
    consumes: [],
    reorderPoint: 2,
    reorderQuantity: 6,
    robotCount: 0,
    operatorCount: 1,
    position,
  };
}

const config: FactoryDescriptor = {
  line: {
    id: "LINE-01",
    route: ["PRESS-01", "WELD-04", "PAINT-01", "ASSEMBLY-01", "FINAL-QC"],
    reworkStationId: "REWORK-01",
    wipCap: 6,
    maxReworkPasses: 2,
    taktTime: 8,
    shiftTicks: 480,
    demandPerShift: 60,
  },
  stations: [
    station("PRESS-01", [40, 0]),
    station("WELD-04", [60, 0]),
    station("PAINT-01", [80, 0]),
    station("ASSEMBLY-01", [100, 0]),
    station("FINAL-QC", [120, 0]),
    station("REWORK-01", [100, 28]),
  ],
  materials: [],
  workOrders: [],
  locations: {
    "RECEIVING-DOCK": [-20, 0],
    "INCOMING-QC": [-2, 0],
    "PRODUCTION-GATE": [8, 0],
    QUARANTINE: [-2, 20],
    "RAW-STOCK-A": [20, 0],
    "FINISHED-GOODS": [140, 0],
    "SHIPPING-YARD": [172, 0],
  },
  scenarios: [],
};

function machine(id: string, overrides: Partial<Machine> = {}): Machine {
  return {
    id,
    station: id,
    lineId: "LINE-01",
    status: "IDLE",
    currentProductId: null,
    remainingTicks: 0,
    queue: [],
    runTicks: 0,
    idleTicks: 0,
    blockedTicks: 0,
    starvedTicks: 0,
    downtimeTicks: 0,
    repairTicksRemaining: 0,
    failureCount: 0,
    producedCount: 0,
    energyKwh: 0,
    availability: 1,
    utilization: 0,
    bottleneck: false,
    utilizationWindow: [],
    queueWindow: [],
    cycleWindow: [],
    ...overrides,
  };
}

function product(id: string, status: ProductUnit["status"]): ProductUnit {
  return {
    id,
    workOrderId: "WO-1",
    status,
    stageIndex: 0,
    reworkCount: 0,
    consumedMaterialBatchIds: [],
    defectIds: [],
    inspectionIds: [],
    history: [],
    releasedAt: 0,
    completedAt: null,
    scrappedAt: null,
    shipmentId: null,
    currentMachineId: null,
    operationStartedAt: null,
    remainingTicks: 0,
  };
}

function agv(overrides: Partial<Agv> = {}): Agv {
  return {
    id: "AGV-01",
    status: "IDLE",
    taskId: null,
    cargoMaterialId: null,
    cargo: [],
    ticksRemaining: 0,
    legTicks: 0,
    progress: 0,
    fromLocation: "RAW-STOCK-A",
    toLocation: "RAW-STOCK-A",
    completedTasks: 0,
    travelTicks: 0,
    ...overrides,
  };
}

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "SHP-1",
    customer: "C",
    destination: "D",
    vehicle: "V",
    capacity: 4,
    productIds: [],
    status: "PLANNED",
    plannedDeparture: 0,
    actualDeparture: null,
    deliveredAt: null,
    ticksRemaining: 0,
    ...overrides,
  };
}

function frame(overrides: Partial<FactoryFrame> = {}): FactoryFrame {
  return {
    v: 1,
    simulationId: "sim-0001",
    sequence: 1,
    simulatedTime: 10,
    status: "paused",
    speed: 1,
    scenario: "normal",
    seed: 42,
    metrics: {} as FactoryFrame["metrics"],
    machines: [],
    agvs: [],
    shipments: [],
    workOrders: [],
    activeProducts: [],
    openAlerts: [],
    andon: { active: false, stops: [], raisedAt: null },
    inventory: [],
    events: [],
    eventsTotal: 0,
    trucks: [],
    ...overrides,
  };
}

// --- coordinates ------------------------------------------------------------

describe("plan-to-world mapping", () => {
  test("the plant is centred on the line, not on the origin of the plan", () => {
    const [x, y, z] = toWorld(82.5, 8);
    expect(x).toBeCloseTo(0);
    expect(y).toBe(0);
    expect(z).toBeCloseTo(0);
  });

  test("station positions come from the configuration, never from the scene", () => {
    const moved: FactoryDescriptor = {
      ...config,
      stations: config.stations.map((candidate) =>
        candidate.id === "WELD-04" ? station("WELD-04", [60, 20]) : candidate,
      ),
    };

    const before = stationWorld(config, "WELD-04");
    const after = stationWorld(moved, "WELD-04");

    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[2]).toBeGreaterThan(before[2]);
  });

  test("a line-side bin resolves to the station it feeds", () => {
    expect(planPosition(config, "LINE-SIDE/PAINT-01")).toEqual([80, 0]);
    // Depo 20'de: mal kabul (-20), giriş kalite (-2) ve geçiş (8) ondan önce.
    expect(planPosition(config, "RAW-STOCK-A")).toEqual([20, 0]);
  });

  test("an unknown location falls back to the plan origin instead of throwing", () => {
    expect(planPosition(config, "NOWHERE")).toEqual([0, 0]);
  });

  test("buffer slots queue up in front of the machine, nearest first", () => {
    const [machineX] = machineSlot(config, "PRESS-01");
    const first = bufferSlot(config, "PRESS-01", 0);
    const second = bufferSlot(config, "PRESS-01", 1);

    expect(first[0]).toBeLessThan(machineX);
    expect(second[0]).toBeLessThan(first[0]);
    expect(first[2]).toBeCloseTo(machineSlot(config, "PRESS-01")[2]);
  });
});

// --- unit placement ---------------------------------------------------------

describe("unit placement", () => {
  test("a unit under the tool sits on the machine and is marked active", () => {
    const placed = placeUnits(
      config,
      frame({
        machines: [machine("PAINT-01", { currentProductId: "CAR-1" })],
        activeProducts: [product("CAR-1", "IN_PRODUCTION")],
      }),
    );

    expect(placed).toHaveLength(1);
    expect(placed[0]?.position).toEqual(machineSlot(config, "PAINT-01"));
    expect(placed[0]?.active).toBe(true);
  });

  test("queued units occupy successive buffer slots of their own station", () => {
    const placed = placeUnits(
      config,
      frame({
        machines: [machine("WELD-04", { queue: ["CAR-1", "CAR-2"] })],
        activeProducts: [product("CAR-1", "QUEUED"), product("CAR-2", "QUEUED")],
      }),
    );

    expect(placed.map((unit) => unit.id)).toEqual(["CAR-1", "CAR-2"]);
    expect(placed[0]?.position).toEqual(bufferSlot(config, "WELD-04", 0));
    expect(placed[1]?.position).toEqual(bufferSlot(config, "WELD-04", 1));
    expect(placed.every((unit) => !unit.active)).toBe(true);
  });

  test("a unit is never drawn in two places at once", () => {
    const placed = placeUnits(
      config,
      frame({
        // A frame can only be inconsistent if the engine is; the scene must not
        // duplicate the body either way.
        machines: [
          machine("WELD-04", { currentProductId: "CAR-1" }),
          machine("PAINT-01", { queue: ["CAR-1"] }),
        ],
        activeProducts: [product("CAR-1", "IN_PRODUCTION")],
      }),
    );

    expect(placed).toHaveLength(1);
  });

  test("a unit the frame does not carry is not invented", () => {
    const placed = placeUnits(
      config,
      frame({
        machines: [machine("WELD-04", { queue: ["CAR-GHOST"] })],
        activeProducts: [],
      }),
    );

    expect(placed).toHaveLength(0);
  });

  test("finished units park in the yard and loaded units move onto a carrier", () => {
    const loaded = product("CAR-2", "LOADING");
    const placed = placeUnits(
      config,
      frame({
        machines: [],
        activeProducts: [product("CAR-1", "READY_TO_SHIP"), loaded],
        shipments: [shipment({ status: "LOADING", productIds: ["CAR-2"] })],
      }),
    );

    const ready = placed.find((unit) => unit.id === "CAR-1");
    const onTruck = placed.find((unit) => unit.id === "CAR-2");

    expect(ready).toBeDefined();
    expect(onTruck).toBeDefined();
    // The carrier deck is above the floor; the yard is on it.
    expect(onTruck!.position[1]).toBeGreaterThan(ready!.position[1]);
    expect(onTruck!.position[0]).toBeGreaterThan(ready!.position[0]);
  });

  test("colour comes from the published product state, not from the scene", () => {
    const placed = placeUnits(
      config,
      frame({
        machines: [machine("REWORK-01", { currentProductId: "CAR-1" })],
        activeProducts: [product("CAR-1", "IN_REWORK")],
      }),
    );

    expect(placed[0]?.tone).toBe(PRODUCT_STATE.IN_REWORK.tone);
    expect(placed[0]?.status).toBe(PRODUCT_STATE.IN_REWORK.label);
  });
});

// --- AGVs -------------------------------------------------------------------

describe("AGV placement", () => {
  test("an idle AGV stays where it is", () => {
    const [placed] = placeAgvs(config, frame({ agvs: [agv({ progress: 0.9 })] }));
    const origin = placeAgvs(config, frame({ agvs: [agv({ progress: 0 })] }))[0];

    expect(placed?.position).toEqual(origin?.position);
    expect(placed?.moving).toBe(false);
  });

  test("a travelling AGV sits at the fraction of the leg the engine published", () => {
    const half = placeAgvs(
      config,
      frame({
        agvs: [
          agv({
            status: "TO_DROP",
            fromLocation: "RAW-STOCK-A",
            toLocation: "LINE-SIDE/FINAL-QC",
            progress: 0.5,
          }),
        ],
      }),
    )[0];

    const from = placeAgvs(
      config,
      frame({
        agvs: [
          agv({
            status: "TO_DROP",
            fromLocation: "RAW-STOCK-A",
            toLocation: "LINE-SIDE/FINAL-QC",
            progress: 0,
          }),
        ],
      }),
    )[0];

    const to = placeAgvs(
      config,
      frame({
        agvs: [
          agv({
            status: "TO_DROP",
            fromLocation: "RAW-STOCK-A",
            toLocation: "LINE-SIDE/FINAL-QC",
            progress: 1,
          }),
        ],
      }),
    )[0];

    expect(half!.position[0]).toBeCloseTo((from!.position[0] + to!.position[0]) / 2);
    expect(half!.moving).toBe(true);
  });

  test("progress outside 0..1 is clamped rather than driving off the plant", () => {
    const over = placeAgvs(
      config,
      frame({
        agvs: [
          agv({
            status: "TO_PICKUP",
            fromLocation: "RAW-STOCK-A",
            toLocation: "LINE-SIDE/PRESS-01",
            progress: 4,
          }),
        ],
      }),
    )[0];

    const end = placeAgvs(
      config,
      frame({
        agvs: [
          agv({
            status: "TO_PICKUP",
            fromLocation: "RAW-STOCK-A",
            toLocation: "LINE-SIDE/PRESS-01",
            progress: 1,
          }),
        ],
      }),
    )[0];

    expect(over!.position[0]).toBeCloseTo(end!.position[0]);
  });

  test("AGVs drive in an aisle clear of the line", () => {
    const [placed] = placeAgvs(
      config,
      frame({ agvs: [agv({ status: "TO_DROP", toLocation: "LINE-SIDE/WELD-04" })] }),
    );
    const [, , lineZ] = stationWorld(config, "WELD-04");

    expect(placed!.position[2]).toBeGreaterThan(lineZ);
  });
});

// --- camera and colour vocabulary ------------------------------------------

describe("scene vocabulary", () => {
  test("every camera bookmark resolves to finite coordinates", () => {
    const bookmarks = cameraBookmarks(config);

    expect(bookmarks.length).toBeGreaterThan(4);
    for (const mark of bookmarks) {
      for (const value of [...mark.position, ...mark.target]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(mark.label.length).toBeGreaterThan(0);
    }
  });

  test("every state the scene can render has both a colour and a word", () => {
    const states = [
      ...Object.values(MACHINE_STATE),
      ...Object.values(PRODUCT_STATE),
      ...Object.values(SHIPMENT_STATE),
    ];

    for (const state of states) {
      const tone = TONE[state.tone];
      expect(tone, `missing tone ${state.tone}`).toBeDefined();
      expect(tone.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(state.label.length).toBeGreaterThan(0);
      expect(state.meaning.length).toBeGreaterThan(0);
    }
  });

  test("the scene colour and the Tailwind class refer to the same status token", () => {
    // The literal exists only because WebGL cannot read a CSS custom property.
    // If the two ever drift, the 3D view and the boards disagree about health.
    const pairs: ReadonlyArray<[keyof typeof TONE, string]> = [
      ["ok", "status-ok"],
      ["warn", "status-warn"],
      ["risk", "status-risk"],
      ["critical", "status-critical"],
      ["logistics", "status-logistics"],
      ["idle", "status-idle"],
      ["blocked", "status-blocked"],
    ];

    for (const [tone, token] of pairs) {
      expect(TONE[tone].dot).toBe(`bg-${token}`);
      expect(TONE[tone].text).toBe(`text-${token}`);
    }
  });
});

describe("mal kabul, giriş kalite ve sevkiyat", () => {
  test("the inbound flow runs outside-in: receiving, then quality, then the store", () => {
    // Sıra yerleşimin kendisi. Karantina en dışarıdayken sahne, henüz kontrol
    // edilmemiş malın oraya gittiğini ima ediyordu — sahada kimsenin
    // yapmayacağı bir şey.
    const receiving = planPosition(config, "RECEIVING-DOCK")[0];
    const qc = planPosition(config, "INCOMING-QC")[0];
    const gate = planPosition(config, "PRODUCTION-GATE")[0];
    const store = planPosition(config, "RAW-STOCK-A")[0];

    expect(receiving).toBeLessThan(qc);
    expect(qc).toBeLessThan(gate);
    expect(gate).toBeLessThan(store);
  });

  test("quarantine sits beside incoming quality, not in front of receiving", () => {
    const qc = planPosition(config, "INCOMING-QC");
    const quarantine = planPosition(config, "QUARANTINE");
    const receiving = planPosition(config, "RECEIVING-DOCK");

    // Aynı hizada ama hattın dışında: karantina akışın durağı değil,
    // kalitenin sonucu.
    expect(quarantine[0]).toBe(qc[0]);
    expect(quarantine[1]).toBeGreaterThan(qc[1]);
    expect(quarantine[0]).toBeGreaterThan(receiving[0]);
  });

  test("the zones follow the same order and do not overlap the line", () => {
    const byId = new Map(ZONES.map((zone) => [zone.id, zone]));
    const inbound = byId.get("inbound");
    const iqc = byId.get("iqc");
    const store = byId.get("store");
    const quarantine = byId.get("quarantine");

    expect(inbound).toBeDefined();
    expect(iqc).toBeDefined();
    expect(store).toBeDefined();
    expect(quarantine).toBeDefined();
    // rect: [x0, y0, x1, y1] — bölgeler soldan sağa sırayla.
    expect(inbound!.rect[2]).toBeLessThanOrEqual(iqc!.rect[0]);
    expect(iqc!.rect[2]).toBeLessThanOrEqual(store!.rect[0]);
    // Karantina hattın kenarından uzakta.
    expect(quarantine!.rect[1]).toBeGreaterThan(iqc!.rect[3]);
  });

  test("the quality bench and the quarantine bay are placed where the plant says", () => {
    expect(incomingQcPlacement(config)).toEqual(toWorld(-2, 0));
    expect(quarantinePlacement(config)).toEqual(toWorld(-2, 20));
    expect(productionGatePlacement(config)).toEqual(toWorld(8, 0));
  });

  test("a carrier carries exactly the vehicles the shipment loaded", () => {
    const placed = placeCarriers(
      config,
      frame({
        shipments: [shipment({ status: "LOADING", productIds: ["CAR-1", "CAR-2", "CAR-3"] })],
      }),
    );

    expect(placed).toHaveLength(1);
    // Sayı uydurulmuyor: sevkiyatın kendi yük listesi.
    expect(placed[0]!.loaded).toBe(3);
    expect(placed[0]!.capacity).toBe(4);
  });

  test("a delivered shipment has left the plant, so it is not drawn", () => {
    const placed = placeCarriers(
      config,
      frame({
        shipments: [
          shipment({ id: "SHP-1", status: "DELIVERED", productIds: ["CAR-1"] }),
          shipment({ id: "SHP-2", status: "PLANNED" }),
          shipment({ id: "SHP-3", status: "LOADING", productIds: ["CAR-2"] }),
        ],
      }),
    );

    // Teslim edilmiş bir sevkiyat artık fabrikada değil; planlanan henüz
    // yüklenmemiş. Sahnede yalnızca sahada duran taşıyıcı olmalı.
    expect(placed.map((carrier) => carrier.id)).toEqual(["SHP-3"]);
  });

  test("a loading carrier waits at the yard; a dispatched one has moved toward the exit", () => {
    const waiting = placeCarriers(
      config,
      frame({ shipments: [shipment({ status: "LOADING", productIds: ["CAR-1"] })] }),
    )[0];
    const leaving = placeCarriers(
      config,
      frame({
        shipments: [shipment({ status: "IN_TRANSIT", productIds: ["CAR-1"], ticksRemaining: 2 })],
      }),
    )[0];

    expect(waiting).toBeDefined();
    expect(leaving).toBeDefined();
    // Çıkış +X yönünde: yola çıkan taşıyıcı sahadan uzaklaşmış olmalı.
    expect(leaving!.position[0]).toBeGreaterThan(waiting!.position[0]);
  });
});

describe("yerleşim revizyonu: bağımsız alanlar, düz tırlar, tanımlı güzergâh", () => {
  test("receiving is an area of its own, not folded into the production side", () => {
    const inbound = ZONES.find((zone) => zone.id === "inbound")!;
    const iqc = ZONES.find((zone) => zone.id === "iqc")!;

    // Aradaki boşluk tırın manevra sahası. Bitişik olsalardı mal kabul,
    // üretim alanının bir köşesi olurdu.
    expect(inbound.rect[2]).toBeLessThan(iqc.rect[0]);
    expect(iqc.rect[0] - inbound.rect[2]).toBeGreaterThanOrEqual(2);
  });

  test("the inbound truck stands straight, never at an angle", () => {
    const placed = placeTrucks(
      config,
      frame({
        trucks: [
          {
            id: "TIR-1",
            materialId: "M",
            batchId: "B",
            quantity: 1,
            status: "DOCKED",
            dispatchedAt: 0,
            dueAt: 8,
            ticksRemaining: 1,
            legTicks: 1,
            progress: 0,
            dockId: "RECEIVING-DOCK",
            accepted: null,
            completedAt: null,
          },
        ],
      }),
    );

    // Bir tır rampaya dik yanaşır; çapraz duran tır dorseyi kapıya
    // hizalayamaz.
    expect(placed).toHaveLength(1);
    expect(placed[0]!.heading).toBe(0);
  });

  test("the inbound truck drives straight in, so its path has no sideways jog", () => {
    const arriving = (progress: number) =>
      placeTrucks(
        config,
        frame({
          trucks: [
            {
              id: "TIR-1",
              materialId: "M",
              batchId: "B",
              quantity: 1,
              status: "ARRIVING",
              dispatchedAt: 0,
              dueAt: 8,
              ticksRemaining: 2,
              legTicks: 4,
              progress,
              dockId: "RECEIVING-DOCK",
              accepted: null,
              completedAt: null,
            },
          ],
        }),
      )[0]!;

    // Güzergâh tek eksende: X sabit, yalnızca Z değişiyor.
    expect(arriving(0).position[0]).toBeCloseTo(arriving(1).position[0], 6);
    expect(arriving(0).position[2]).not.toBeCloseTo(arriving(1).position[2], 6);
  });

  test("the outbound carrier faces right and leaves along the same straight line", () => {
    const waiting = placeCarriers(
      config,
      frame({ shipments: [shipment({ status: "LOADING", productIds: ["CAR-1"] })] }),
    )[0]!;
    const leaving = placeCarriers(
      config,
      frame({
        shipments: [shipment({ status: "IN_TRANSIT", productIds: ["CAR-1"], ticksRemaining: 1 })],
      }),
    )[0]!;

    expect(waiting.heading).toBe(0);
    expect(leaving.position[0]).toBeGreaterThan(waiting.position[0]);
    // Düz çıkış: yanal kayma yok.
    expect(leaving.position[2]).toBeCloseTo(waiting.position[2], 6);
  });

  test("shipping gets the same treatment as receiving: its own building, off the yard", () => {
    const yard = toWorld(...planPosition(config, "SHIPPING-YARD"));
    const building = shippingBuildingPlacement(config);

    // Bina sahanın arkasında: taşıyıcı önünde yükleniyor, içinde değil.
    expect(building[0]).toBeLessThan(yard[0]);
    expect(building[2]).toBe(yard[2]);
  });

  test("the finished-goods store and the shipping yard are separate places", () => {
    const store = planPosition(config, "FINISHED-GOODS")[0];
    const yard = planPosition(config, "SHIPPING-YARD")[0];

    // Sevkiyat bağımsız bir alan; depoyla iç içe olsaydı tır manevrası
    // depo trafiğine girerdi.
    expect(yard - store).toBeGreaterThanOrEqual(24);
  });
});
