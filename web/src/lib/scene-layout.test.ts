import { describe, expect, test } from "vitest";

import type { FactoryDescriptor } from "@/lib/api";
import type {
  Agv,
  FactoryFrame,
  InboundTruck,
  Machine,
  ProductUnit,
  Shipment,
} from "@/lib/contract";
import {
  SCALE,
  SCENE_FOV_DEG,
  zonesOf,
  bufferSlot,
  maxCameraDistance,
  overviewExtent,
  AISLE_PLAN_Y,
  agvWorld,
  aisleZ,
  carrierRouteOf,
  finishedGoodsOf,
  linePlanY,
  carrierRoutes,
  shippingLaneZ,
  entryGateOpenness,
  exitGateOpenness,
  forkliftAt,
  forkliftRoute,
  placeForklifts,
  truckParkWorld,
  exitGatePlacement,
  securityGatePlacement,
  truckRoute,
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

function station(
  id: string,
  position: [number, number],
  lineId = "LINE-01",
): FactoryDescriptor["stations"][number] {
  return {
    id,
    name: id,
    workCenter: "Test",
    lineId,
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

/**
 * Kurgu üç hatlı: tesis de öyle.
 *
 * Tek hatlı bir kurgu, "hat başına" olması gereken her şeyi tek hat üzerinden
 * doğrulardı ve iki hattın birbirine karışması testten kaçardı.
 */
const HAT_ARALIGI = 46;

function hatIstasyonlari(lineId: string, planY: number, ekler: string) {
  return [
    station(`PRESS${ekler}`, [40, planY], lineId),
    station(`WELD${ekler}`, [60, planY], lineId),
    station(`PAINT${ekler}`, [80, planY], lineId),
    station(`ASSEMBLY${ekler}`, [100, planY], lineId),
    station(`FINAL-QC${ekler}`, [120, planY], lineId),
    station(`REWORK${ekler}`, [100, planY + 28], lineId),
  ];
}

const config: FactoryDescriptor = {
  lines: [
    {
      id: "LINE-01",
      model: "Meltem",
      route: ["PRESS-01", "WELD-04", "PAINT-01", "ASSEMBLY-01", "FINAL-QC"],
      reworkStationId: "REWORK-01",
      wipCap: 6,
      demandPerShift: 60,
      taktTime: 8,
    },
    {
      id: "LINE-02",
      model: "Poyraz",
      route: ["PRESS-02", "WELD-02", "PAINT-02", "ASSEMBLY-02", "FINAL-QC-02"],
      reworkStationId: "REWORK-02",
      wipCap: 6,
      demandPerShift: 60,
      taktTime: 8,
    },
    {
      id: "LINE-03",
      model: "Lodos",
      route: ["PRESS-03", "WELD-03", "PAINT-03", "ASSEMBLY-03", "FINAL-QC-03"],
      reworkStationId: "REWORK-03",
      wipCap: 6,
      demandPerShift: 60,
      taktTime: 8,
    },
  ],
  plant: { maxReworkPasses: 2, shiftTicks: 480, demandPerShift: 180, taktTime: 8 / 3 },
  stations: [
    station("PRESS-01", [40, 0]),
    station("WELD-04", [60, 0]),
    station("PAINT-01", [80, 0]),
    station("ASSEMBLY-01", [100, 0]),
    station("FINAL-QC", [120, 0]),
    station("REWORK-01", [100, 28]),
    ...hatIstasyonlari("LINE-02", HAT_ARALIGI, "-02"),
    ...hatIstasyonlari("LINE-03", HAT_ARALIGI * 2, "-03"),
  ],
  materials: [],
  workOrders: [],
  shipmentPlan: {
    customer: "EU-DEALER-NETWORK",
    destination: "Bremerhaven",
    vehicle: "Oto Taşıyıcı",
    capacity: 4,
    loadingTicks: 3,
    transitTicks: 12,
  },
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
    lineId: "LINE-01",
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
    lineId: "LINE-01",
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

  /**
   * Genel görünüm gerçekten geneli göstermeli.
   *
   * Önceki test yalnızca koordinatların sonlu olup olmadığına bakıyordu; bu
   * yüzden yerleşim büyüdüğünde kamera olduğu yerde kaldı ve mal kabul ile
   * sevkiyat ekranın dışına çıktı — testler yeşilken. Burada bölgelerin her
   * köşesi kameranın görüş piramidine geri yansıtılıyor: hesabın nasıl
   * yapıldığından bağımsız bir kontrol.
   */
  test.each([16 / 9, 21 / 9, 4 / 3, 582 / 682])(
    "the overview frames everything drawn at aspect %f",
    (aspect) => {
      const overview = cameraBookmarks(config, aspect).find((mark) => mark.id === "overview")!;

      const forward = normalise(subtract(overview.target, overview.position));
      const right = normalise(cross(forward, [0, 1, 0]));
      const up = cross(right, forward);

      const halfV = Math.tan((SCENE_FOV_DEG / 2) * (Math.PI / 180));
      const halfH = Math.tan(Math.atan(halfV * aspect));

      for (const point of overviewExtent(config)) {
        const v = subtract(point, overview.position);
        const depth = dot(v, forward);
        const nerede = `[${point[0].toFixed(1)}, ${point[2].toFixed(1)}]`;

        expect(depth, `${nerede} kameranın arkasında`).toBeGreaterThan(0);
        expect(Math.abs(dot(v, right)) / depth, `${nerede} yanlardan taşıyor`).toBeLessThanOrEqual(
          halfH,
        );
        expect(Math.abs(dot(v, up)) / depth, `${nerede} üstten/alttan taşıyor`).toBeLessThanOrEqual(
          halfV,
        );
      }
    },
  );

  /**
   * Kamera kontrolünün uzaklık sınırı, çerçevelemenin gerektirdiğinden kısa
   * olmamalı. Sabit 70 birimlik sınır, güvenlik kapısı eklenince genel
   * görünümü sessizce yakına çekiyor ve tesisin bir ucunu kırpıyordu.
   */
  test.each([16 / 9, 4 / 3, 582 / 682])(
    "the camera may pull back far enough for the overview at aspect %f",
    (aspect) => {
      const overview = cameraBookmarks(config, aspect).find((mark) => mark.id === "overview")!;
      const gerekli = Math.hypot(
        overview.position[1] - overview.target[1],
        overview.position[2] - overview.target[2],
      );

      expect(maxCameraDistance(config, aspect)).toBeGreaterThanOrEqual(gerekli);
    },
  );

  /**
   * Saha sayfası açılışta "overview" görünümünü seçiyor; öyle bir görünüm
   * yoksa üst çubukta hiçbir düğme seçili görünmüyor ve kamera hangi görünümde
   * olduğunu söylemiyor.
   */
  test("the view the shop floor opens with actually exists", () => {
    expect(cameraBookmarks(config).map((mark) => mark.id)).toContain("overview");
  });

  test("the overview frames everything drawn, gate and shipping included", () => {
    const overview = cameraBookmarks(config).find((mark) => mark.id === "overview")!;

    const forward = normalise(subtract(overview.target, overview.position));
    const right = normalise(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);

    const halfV = Math.tan((SCENE_FOV_DEG / 2) * (Math.PI / 180));
    // En dar makul ekran; daha geniş bir ekranda pay yalnızca artar.
    const halfH = Math.tan(Math.atan(halfV * (16 / 9)));

    for (const point of overviewExtent(config)) {
      const v = subtract(point, overview.position);
      const depth = dot(v, forward);
      const nerede = `[${point[0].toFixed(1)}, ${point[2].toFixed(1)}]`;

      expect(depth, `${nerede} kameranın arkasında`).toBeGreaterThan(0);
      expect(Math.abs(dot(v, right)) / depth, `${nerede} yanlardan taşıyor`).toBeLessThanOrEqual(
        halfH,
      );
      expect(Math.abs(dot(v, up)) / depth, `${nerede} üstten/alttan taşıyor`).toBeLessThanOrEqual(
        halfV,
      );
    }
  });

  /**
   * Alan görünümleri alanın kendisini göstermeli.
   *
   * "Sevkiyat" görünümü yerleşim revizyonundan sonra eski koordinatta kalmış,
   * sahayı değil onun 20 metre solundaki boşluğu gösteriyordu. Adlandırılmış
   * bir alanın kamerası artık tesisin konum tablosundan okunduğu için elle
   * yazılmış bir sayı geride kalamaz.
   */
  /**
   * Sevkiyat görünümü de çıkışın tamamını göstermeli: saha, yol, çıkış kapısı.
   * Mal kabulle aynı gereksinim, ters yön.
   */
  test("the shipping view frames the whole exit, yard to gate", () => {
    const mark = cameraBookmarks(config).find((candidate) => candidate.id === "shipping")!;

    const forward = normalise(subtract(mark.target, mark.position));
    const right = normalise(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const halfV = Math.tan((SCENE_FOV_DEG / 2) * (Math.PI / 180));
    const halfH = Math.tan(Math.atan(halfV * (16 / 9)));

    for (const point of [...carrierRoutes(config).flat(), exitGatePlacement(config)]) {
      const v = subtract(point, mark.position);
      const depth = dot(v, forward);
      const nerede = `[${point[0].toFixed(1)}, ${point[2].toFixed(1)}]`;

      expect(depth, `${nerede} kameranın arkasında`).toBeGreaterThan(0);
      expect(Math.abs(dot(v, right)) / depth, `${nerede} yanlardan taşıyor`).toBeLessThanOrEqual(
        halfH,
      );
      expect(Math.abs(dot(v, up)) / depth, `${nerede} üstten/alttan taşıyor`).toBeLessThanOrEqual(
        halfV,
      );
    }
  });

  /**
   * Mal kabul görünümü, girişin tamamını göstermeli.
   *
   * "Mal kabul" tek bir rampa değil, bir dizi: güvenlik kapısı → yol → dönüş →
   * rampa. Yalnızca rampaya bakan bir kamera hikâyenin sonunu gösteriyordu ve
   * güvenlik kapısı kadraja hiç girmiyordu.
   */
  test("the receiving view frames the whole entrance, gate to dock", () => {
    const mark = cameraBookmarks(config).find((candidate) => candidate.id === "receiving")!;

    const forward = normalise(subtract(mark.target, mark.position));
    const right = normalise(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const halfV = Math.tan((SCENE_FOV_DEG / 2) * (Math.PI / 180));
    const halfH = Math.tan(Math.atan(halfV * (16 / 9)));

    for (const point of truckRoute(config)) {
      const v = subtract(point, mark.position);
      const depth = dot(v, forward);
      const nerede = `[${point[0].toFixed(1)}, ${point[2].toFixed(1)}]`;

      expect(depth, `${nerede} kameranın arkasında`).toBeGreaterThan(0);
      expect(Math.abs(dot(v, right)) / depth, `${nerede} yanlardan taşıyor`).toBeLessThanOrEqual(
        halfH,
      );
      expect(Math.abs(dot(v, up)) / depth, `${nerede} üstten/alttan taşıyor`).toBeLessThanOrEqual(
        halfV,
      );
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
    const byId = new Map(zonesOf(config).map((zone) => [zone.id, zone]));
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
    const inbound = zonesOf(config).find((zone) => zone.id === "inbound")!;
    const iqc = zonesOf(config).find((zone) => zone.id === "iqc")!;

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

  /**
   * Tırın güzergâhı: güvenlik kapısından düz gelir, mal kabul hizasında sağa
   * döner, rampaya yanaşır.
   *
   * Her parça tek eksende — yani araç asla çapraz süzülmüyor — ama iki parça
   * var, çünkü gerçek bir tır kapıdan rampaya tek bir doğru üzerinde gelmez.
   */
  test("the inbound truck drives in a straight leg, then turns right into the dock", () => {
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

    const kapi = arriving(0);
    const rampa = arriving(1);

    // Giriş parçası: X sabit, yalnızca Z azalıyor — araç yol boyunca ilerliyor.
    expect(arriving(0.1).position[0]).toBeCloseTo(kapi.position[0], 6);
    expect(arriving(0.1).position[2]).toBeLessThan(kapi.position[2]);

    // Yanaşma parçası: Z sabit, X artıyor — sağa dönmüş durumda rampaya gidiyor.
    expect(arriving(0.95).position[2]).toBeCloseTo(rampa.position[2], 6);
    expect(arriving(0.95).position[0]).toBeLessThan(rampa.position[0]);

    // Dönüş sağa: köşe rampanın solunda, yani araç dönüşten sonra +X'e gidiyor.
    expect(kapi.position[0]).toBeLessThan(rampa.position[0]);
    expect(kapi.position[2]).toBeGreaterThan(rampa.position[2]);
  });

  /**
   * Açı gidilen yönü izlemeli.
   *
   * Kusur buydu: açı sabit 0'dı, yani tır bütün yol boyunca yüzü yana dönük,
   * yengeç gibi ilerliyordu. Model +X'e baktığı için yolda π/2, rampada 0
   * olmalı.
   */
  test("the inbound truck faces the way it is driving", () => {
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

    // Yolda: burun −Z'ye, yani gidiş yönüne dönük.
    expect(arriving(0).heading).toBeCloseTo(Math.PI / 2, 6);
    expect(arriving(0.2).heading).toBeCloseTo(Math.PI / 2, 6);

    // Rampada: burun +X'e, yani rampaya dönük.
    expect(arriving(1).heading).toBeCloseTo(0, 6);

    // Dönüş tek yönlü ve yumuşak: açı hiçbir yerde geri artmıyor.
    let onceki = Infinity;
    for (let i = 0; i <= 20; i += 1) {
      const aci = arriving(i / 20).heading;
      expect(aci).toBeLessThanOrEqual(onceki + 1e-9);
      onceki = aci;
    }
  });

  /**
   * Tır binaya girmemeli.
   *
   * Önceki sürümde rampaya kadar sürüyordu ve mal kabul cephesinin içine
   * girmiş gibi duruyordu. Sahada da öyle olmaz: dorse sahada durur, malı
   * içeri forklift taşır.
   */
  test("the truck parks in the yard, clear of the receiving building", () => {
    const park = truckParkWorld(config);
    const [, dock] = forkliftRoute(config);
    const bina = toWorld(...planPosition(config, "RECEIVING-DOCK"));

    // Park yeri binanın solunda ve ondan uzakta.
    expect(park[0]).toBeLessThan(bina[0]);
    expect(bina[0] - park[0]).toBeGreaterThan(8);

    // Tırın yolu park yerinde bitiyor, rampada değil.
    const yol = truckRoute(config);
    expect(yol.at(-1)).toEqual(park);
    expect(yol.at(-1)).not.toEqual(dock);

    // Ve asıl önemlisi: **yerleştirilen** tır da orada duruyor. Bu iki şey
    // ayrı hesaplanıyor; zemin çizgisini taşıyıp aracı olduğu yerde bırakmak
    // tam olarak buradaki hataydı.
    const duran = placeTrucks(
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
            progress: 1,
            dockId: "RECEIVING-DOCK",
            accepted: null,
            completedAt: null,
          },
        ],
      }),
    )[0]!;

    expect(duran.position[0]).toBeCloseTo(park[0], 6);
    expect(duran.position[2]).toBeCloseTo(park[2], 6);
    expect(bina[0] - duran.position[0]).toBeGreaterThan(8);
  });

  /**
   * Forklift, tırın park yeri ile mal kabul arasında gidip geliyor.
   *
   * Sefer sayısı uydurulmuyor: motorda boşaltma üç dakika sürüyor, forklift
   * de üç sefer yapıyor. Dolu gidiyor, boş dönüyor — hangi yönün iş, hangisinin
   * dönüş olduğunu söyleyen tek şey bu.
   */
  test("a forklift shuttles between the parked truck and receiving", () => {
    const bosaltan = (progress: number) =>
      placeForklifts(
        config,
        frame({
          trucks: [
            {
              id: "TIR-1",
              materialId: "M",
              batchId: "B",
              quantity: 1,
              status: "UNLOADING",
              dispatchedAt: 0,
              dueAt: 8,
              ticksRemaining: 2,
              legTicks: 3,
              progress,
              dockId: "RECEIVING-DOCK",
              accepted: null,
              completedAt: null,
            },
          ],
        }),
      );

    const [park, dock] = forkliftRoute(config);
    const gorev = bosaltan(0.5)[0]!;

    // Güzergâh: tırın park yerinden mal kabule.
    expect(gorev.from).toEqual(park);
    expect(gorev.to).toEqual(dock);

    // Seferin başında tırın yanında ve yüklü.
    const baslangic = forkliftAt(gorev, 0);
    expect(baslangic.position[0]).toBeCloseTo(park![0], 6);
    expect(baslangic.laden).toBe(true);

    // Yarısında mal kabule varmış, hâlâ yüklü.
    const varis = forkliftAt(gorev, 0.5 - 1e-9);
    expect(varis.position[0]).toBeCloseTo(dock![0], 5);
    expect(varis.laden).toBe(true);

    // Dönüşte boş ve arkası dönük.
    const donus = forkliftAt(gorev, 0.75);
    expect(donus.laden).toBe(false);
    expect(donus.heading).toBeCloseTo(Math.PI, 6);
    expect(donus.position[0]).toBeCloseTo((park![0] + dock![0]) / 2, 6);

    // Hiçbir noktada güzergâhın dışına çıkmıyor — kaç tur dönerse dönsün.
    for (let i = 0; i <= 60; i += 1) {
      const yerde = forkliftAt(gorev, i / 20);
      expect(yerde.position[0]).toBeGreaterThanOrEqual(Math.min(park![0], dock![0]) - 1e-6);
      expect(yerde.position[0]).toBeLessThanOrEqual(Math.max(park![0], dock![0]) + 1e-6);
    }
  });

  /**
   * Forklift şeridi tırın gövdesinin içinden geçmemeli.
   *
   * İlk sürümde şerit tırın kendi ekseni üzerindeydi: forklift yükü aldığı an
   * dorsenin içinde kalıyor, sonra tırın gövdesinin içinden geçip çıkıyordu.
   * Gerçekte forklift dorseye yandan yanaşır.
   */
  test("the forklift lane runs beside the parked truck, not through it", () => {
    const park = truckParkWorld(config);
    const [alis, birakis] = forkliftRoute(config);

    // Şerit tırın ekseninden ayrı: dorse yarı genişliğinden (~1,25 m) fazla,
    // yani forklift gövdenin yanından geçiyor. Eşik metre cinsinden yazılıyor;
    // dünya birimiyle yazılmış hâli, ölçek düzeltilince anlamını yitirmişti.
    expect(Math.abs(alis![2] - park[2])).toBeGreaterThan(3 * SCALE);
    // İki uç aynı şeritte: forklift çapraz süzülmüyor.
    expect(alis![2]).toBeCloseTo(birakis![2], 6);
    // Ve gerçekten bir mesafe kat ediyor.
    expect(Math.abs(birakis![0] - alis![0])).toBeGreaterThan(8);
  });

  test("there is no forklift unless a truck is actually being unloaded", () => {
    const durum = (status: InboundTruck["status"]) =>
      placeForklifts(
        config,
        frame({
          trucks: [
            {
              id: "TIR-1",
              materialId: "M",
              batchId: "B",
              quantity: 1,
              status,
              dispatchedAt: 0,
              dueAt: 8,
              ticksRemaining: 2,
              legTicks: 3,
              progress: 0.5,
              dockId: "RECEIVING-DOCK",
              accepted: null,
              completedAt: null,
            },
          ],
        }),
      );

    // İş bitince forklift orada beklemez.
    expect(durum("ARRIVING")).toHaveLength(0);
    expect(durum("DOCKED")).toHaveLength(0);
    expect(durum("COMPLETED")).toHaveLength(0);
    expect(durum("UNLOADING")).toHaveLength(1);
  });

  /**
   * Fabrikanın bir sınırı olmalı.
   *
   * Kapı olmadan tır doğrudan mal kabulün önünde beliriyordu; sahada hiçbir
   * araç kapıda durmadan içeri alınmaz. Kapı tesisin dışında, mal kabul
   * bölgesinin ötesinde durmalı.
   */
  test("trucks enter through a security gate outside the plant", () => {
    const gate = securityGatePlacement(config);
    const inbound = zonesOf(config).find((zone) => zone.id === "inbound")!;
    const [zoneX, , zoneZ] = toWorld(inbound.rect[0], inbound.rect[3]);

    // Kapı, mal kabul bölgesinin hem solunda hem önünde: tır önce oradan geçer.
    expect(gate[0]).toBeLessThan(zoneX);
    expect(gate[2]).toBeGreaterThan(zoneZ);

    // Ve genel görünüm onu çerçevelemeli — kapsam hesabına dahil.
    const extent = overviewExtent(config);
    expect(extent).toContainEqual(gate);
  });

  /**
   * Çıkışta da kapı olmalı.
   *
   * Bir fabrikadan araç kapıda durmadan çıkmaz. Yalnızca girişte kapı olsaydı
   * tesisin bir tarafı çitsiz kalırdı.
   */
  /**
   * Çıkış kapısı **bir tane** ve bütün şeritler ona bağlanıyor.
   *
   * Üç yükleme şeridinin her birine kapı koymak, tesisi üç ayrı çıkışı olan
   * bir yer yapardı. Şeritler ortak yolda birleşiyor, kapı o yolun ucunda.
   */
  test("every lane leaves through the same single security gate", () => {
    const gate = exitGatePlacement(config);

    for (const line of config.lines) {
      const yol = carrierRouteOf(config, line.id);
      const bas = yol[0]!;
      const son = yol.at(-1)!;

      // Şerit sahadan başlıyor, kapıdan sonra bitiyor.
      expect(gate[0]).toBeGreaterThan(bas[0]);
      expect(son[0]).toBeGreaterThan(gate[0]);

      // Ve son parça kapının hizasında: yani araç kapıdan geçiyor, yanından
      // değil.
      expect(son[2]).toBeCloseTo(gate[2], 6);
    }
  });

  /**
   * Her hattın kendi yükleme şeridi var ve şeritler ayrı.
   *
   * Tek şerit varken üç hattın taşıyıcısı aynı noktaya yerleşiyordu — yani üst
   * üste biniyorlardı.
   */
  /**
   * Her hattın kendi bitmiş ürün alanı olmalı.
   *
   * Tek bir mamul depo vardı ve o da birinci hattın hizasındaydı: ikinci ve
   * üçüncü hattın araçları kalite kapısından çıkar çıkmaz tesisin öbür ucuna
   * ışınlanıyordu.
   */
  test("every line has its own finished-goods area, on its own row", () => {
    const alanlar = config.lines.map((line) => finishedGoodsOf(config, line.id));

    // Üç ayrı alan, üçü de kendi hattının hizasında.
    expect(new Set(alanlar.map((alan) => alan[2])).size).toBe(config.lines.length);
    for (const [index, line] of config.lines.entries()) {
      expect(alanlar[index]![2]).toBeCloseTo(toWorld(0, linePlanY(config, line.id))[2], 6);
    }

    // Hepsi hattın bittiği yerin doğusunda, sevkiyattan önce.
    const sonIstasyon = stationWorld(config, config.lines[0]!.route.at(-1)!)[0];
    const saha = toWorld(...planPosition(config, "SHIPPING-YARD"))[0];
    for (const alan of alanlar) {
      expect(alan[0]).toBeGreaterThan(sonIstasyon);
      expect(alan[0]).toBeLessThan(saha);
    }
  });

  test("a finished vehicle waits in its own line's area", () => {
    const yerlesim = placeUnits(
      config,
      frame({
        machines: [],
        activeProducts: [
          { ...product("CAR-1", "READY_TO_SHIP"), lineId: "LINE-01" },
          { ...product("CAR-2", "READY_TO_SHIP"), lineId: "LINE-03" },
        ],
      }),
    );

    const birinci = yerlesim.find((unit) => unit.id === "CAR-1")!;
    const ucuncu = yerlesim.find((unit) => unit.id === "CAR-2")!;

    // Araç alanın **içinde**: park sırasının ilk gözünde durduğu için tam
    // merkezde değil, ama kendi hattının alanından çıkmıyor. Hatlar 16 dünya
    // birimi arayken bu kontrol, aracın komşu hatta düşmesini yakalar.
    const alanYariDerinlik = 9 * SCALE;
    expect(
      Math.abs(birinci.position[2] - finishedGoodsOf(config, "LINE-01")[2]),
    ).toBeLessThan(alanYariDerinlik);
    expect(
      Math.abs(ucuncu.position[2] - finishedGoodsOf(config, "LINE-03")[2]),
    ).toBeLessThan(alanYariDerinlik);
    // Ve birbirlerinin alanına girmiyorlar.
    expect(Math.abs(birinci.position[2] - ucuncu.position[2])).toBeGreaterThan(
      alanYariDerinlik * 2,
    );
    // Ve sayaç hat başına: üçüncü hattın ilk aracı birincinin arkasına
    // dizilmiyor, kendi alanının başında duruyor.
    expect(birinci.position[0]).toBeCloseTo(ucuncu.position[0], 6);
  });

  test("each line loads in its own lane", () => {
    const seritler = config.lines.map((line) => shippingLaneZ(config, line.id));
    expect(new Set(seritler).size).toBe(config.lines.length);

    // Şeritler bir taşıyıcı boyundan geniş aralıklı olmalı.
    const sirali = [...seritler].sort((a, b) => a - b);
    for (let i = 1; i < sirali.length; i += 1) {
      expect(sirali[i]! - sirali[i - 1]!).toBeGreaterThan(11 * SCALE);
    }
  });

  /**
   * Bekleyen taşıyıcılar iç içe geçmemeli.
   *
   * Aynı şeritte sıra bekleyenler kendi boylarından yakın dizilirse ekranda
   * birbirinin içinden geçerler.
   */
  test("carriers waiting in the same lane never overlap", () => {
    const bekleyenler = placeCarriers(
      config,
      frame({
        shipments: [
          shipment({ id: "SHP-1", status: "READY", productIds: ["CAR-1"] }),
          shipment({ id: "SHP-2", status: "READY", productIds: ["CAR-2"] }),
          shipment({ id: "SHP-3", status: "LOADING", productIds: ["CAR-3"] }),
          // Başka hat: kendi şeridinde, birincinin arkasına dizilmemeli.
          shipment({ id: "SHP-4", lineId: "LINE-02", status: "READY", productIds: ["CAR-4"] }),
        ],
      }),
    );

    for (const a of bekleyenler) {
      for (const b of bekleyenler) {
        if (a.id >= b.id) continue;
        const dx = Math.abs(a.position[0] - b.position[0]);
        const dz = Math.abs(a.position[2] - b.position[2]);
        expect(
          dx > 11 * SCALE || dz > 11 * SCALE,
          `${a.id} ile ${b.id} iç içe geçiyor`,
        ).toBe(true);
      }
    }

    // İkinci hattın taşıyıcısı kendi şeridinde, birincinin kuyruğunda değil.
    const ikinci = bekleyenler.find((carrier) => carrier.id === "SHP-4")!;
    const birinci = bekleyenler.find((carrier) => carrier.id === "SHP-1")!;
    expect(ikinci.position[0]).toBeCloseTo(birinci.position[0], 6);
    expect(ikinci.position[2]).not.toBeCloseTo(birinci.position[2], 3);
  });

  /**
   * Bariyer gerçekten geçen bir araç için kalkmalı.
   *
   * Açıklık sahnede uydurulmuyor: motorun yayınladığı araç konumundan
   * hesaplanıyor. Ortada araç yokken kalkan bir bariyer, sahnedeki her nesnenin
   * bir karşılığı olması kuralını bozardı.
   */
  test("the entry barrier lifts only for a truck that is actually at the gate", () => {
    const tir = (progress: number, status: InboundTruck["status"] = "ARRIVING") => ({
      id: "TIR-1",
      materialId: "M",
      batchId: "B",
      quantity: 1,
      status,
      dispatchedAt: 0,
      dueAt: 8,
      ticksRemaining: 2,
      legTicks: 4,
      progress,
      dockId: "RECEIVING-DOCK",
      accepted: null,
      completedAt: null,
    });

    // Ortada tır yok: kapalı.
    expect(entryGateOpenness(config, frame({ trucks: [] }))).toBe(0);

    // Tır tam kapıda: açık.
    expect(entryGateOpenness(config, frame({ trucks: [tir(0)] }))).toBeGreaterThan(0.9);

    // Tır rampaya varmış, kapıyı çoktan geçmiş: kapalı.
    expect(entryGateOpenness(config, frame({ trucks: [tir(1)] }))).toBe(0);

    // Rampada bekleyen tır kapıyı açık tutmaz — kapıdan geçen bir araç değil.
    expect(entryGateOpenness(config, frame({ trucks: [tir(0, "UNLOADING")] }))).toBe(0);
  });

  test("the exit barrier lifts only while a carrier is leaving", () => {
    // Yükleme sürüyor, taşıyıcı hâlâ sahada: kapalı.
    expect(
      exitGateOpenness(
        config,
        frame({ shipments: [shipment({ status: "LOADING", productIds: ["CAR-1"] })] }),
      ),
    ).toBe(0);

    // Yolun başında, henüz sahadan yeni çıkmış: kapı daha uzakta, kapalı.
    expect(
      exitGateOpenness(
        config,
        frame({
          shipments: [
            shipment({ status: "DISPATCHED", productIds: ["CAR-1"], ticksRemaining: 12 }),
          ],
        }),
      ),
    ).toBe(0);

    // Kapıya varmış: açık.
    const kapida = exitGateOpenness(
      config,
      frame({
        shipments: [shipment({ status: "IN_TRANSIT", productIds: ["CAR-1"], ticksRemaining: 3 })],
      }),
    );
    expect(kapida).toBeGreaterThan(0.5);
  });

  /**
   * Taşıyıcı çıkış yolunu **düzgün** kat etmeli.
   *
   * İlerleme, toplam yol süresi yerine kalan süreye bölünüyordu: 1 − r/(r+1).
   * 12 dakikalık yolun başında 0,08, sonunda 1. Yani taşıyıcı yolun neredeyse
   * tamamında yerinde duruyor, son dakikada fırlıyordu — çıkış kapısının
   * önünden görülemeyecek kadar hızlı.
   */
  test("a departing carrier crosses the exit road at a steady pace", () => {
    const nerede = (ticksRemaining: number) =>
      placeCarriers(
        config,
        frame({
          shipments: [shipment({ status: "IN_TRANSIT", productIds: ["CAR-1"], ticksRemaining })],
        }),
      )[0]!.position;

    /*
     * Hız **yol boyunca** ölçülüyor, X ekseninde değil.
     *
     * Çıkış artık düz bir çizgi değil: taşıyıcı önce kendi şeridinde doğuya,
     * sonra ortak yola, sonra kapıya gidiyor. Sadece X'e bakan bir kontrol,
     * orta parçada (yalnızca Z değişiyor) aracı durmuş sanardı.
     */
    // Yolun toplam uzunluğu, parça parça.
    const yol = carrierRouteOf(config, "LINE-01");
    const boy = yol
      .slice(1)
      .reduce(
        (toplam, nokta, i) =>
          toplam + Math.hypot(nokta[0] - yol[i]![0], nokta[2] - yol[i]![2]),
        0,
      );

    // Sık örnekleyip **yay uzunluğunu** topluyoruz: ardışık iki nokta arasını
    // doğrudan ölçmek, köşelerde kirişi ölçer ve aracı yavaşlamış sanar.
    const adim = 200;
    const noktalar = Array.from({ length: adim + 1 }, (_, i) => nerede(12 - (12 * i) / adim));
    const katedilen = noktalar
      .slice(1)
      .reduce(
        (toplam, nokta, i) =>
          toplam + Math.hypot(nokta[0] - noktalar[i]![0], nokta[2] - noktalar[i]![2]),
        0,
      );

    // Yolun tamamını kat etmiş olmalı. Örnekleme köşeleri kirişle kestiği için
    // ölçülen yay bir miktar kısa çıkıyor; tolerans onu karşılıyor.
    expect(katedilen).toBeCloseTo(boy, 0);

    // Ve yarı yolda gerçekten yarı yolda: hız sabit.
    const yariNoktalar = noktalar.slice(0, adim / 2 + 1);
    const yariMesafe = yariNoktalar
      .slice(1)
      .reduce(
        (toplam, nokta, i) =>
          toplam + Math.hypot(nokta[0] - yariNoktalar[i]![0], nokta[2] - yariNoktalar[i]![2]),
        0,
      );
    expect(yariMesafe).toBeCloseTo(boy / 2, 0);
  });

  /**
   * Doli arabaları zeminde çizili koridordan gitmeli.
   *
   * Çizgi bir yerde, arabalar başka yerdeydi: koridor plan y=18'e çiziliyor,
   * arabalar ise hücrenin 6 birim önünden düz çizgi hâlinde geçiyordu. Yani
   * işaretli yol hep boş, hareket ise makinelerin arasında görünmezdi.
   */
  test("tug carts travel along the aisle that is painted on the floor", () => {
    const yolda = (progress: number) =>
      placeAgvs(
        config,
        frame({
          agvs: [
            agv({
              id: "AGV-1",
              status: "TO_DROP",
              fromLocation: "RAW-STOCK-A",
              toLocation: "LINE-SIDE/ASSEMBLY-01",
              progress,
            }),
          ],
        }),
      )[0]!;

    // Yolun ortasında araba koridorda olmalı, iki durak arasındaki düz
    // çizginin üzerinde değil.
    expect(yolda(0.5).position[2]).toBeCloseTo(aisleZ(config, "LINE-01"), 6);
    expect(AISLE_PLAN_Y).toBeGreaterThan(8);

    // Ve **kendi hattının** koridorundan: ikinci hattın arabası birincinin
    // koridoruna girmemeli. Tek sabit koridor varken tam olarak bu oluyordu.
    const ikinciHat = placeAgvs(
      config,
      frame({
        agvs: [
          agv({
            id: "AGV-2",
            status: "TO_DROP",
            fromLocation: "RAW-STOCK-A",
            toLocation: "LINE-SIDE/ASSEMBLY-02",
            progress: 0.5,
          }),
        ],
      }),
    )[0]!;
    expect(ikinciHat.position[2]).toBeCloseTo(aisleZ(config, "LINE-02"), 6);
    expect(aisleZ(config, "LINE-02")).not.toBeCloseTo(aisleZ(config, "LINE-01"), 3);

    // Uçlar yerinde: depodan çıkıyor, hücrede bitiyor.
    const depo = agvWorld(config, "RAW-STOCK-A");
    const hucre = agvWorld(config, "LINE-SIDE/ASSEMBLY-01");
    expect(yolda(0).position[0]).toBeCloseTo(depo[0], 6);
    expect(yolda(0).position[2]).toBeCloseTo(depo[2], 6);
    expect(yolda(1).position[0]).toBeCloseTo(hucre[0], 6);
    expect(yolda(1).position[2]).toBeCloseTo(hucre[2], 6);
  });

  test("an idle tug cart stays put instead of jumping to the aisle", () => {
    const bosta = placeAgvs(
      config,
      frame({
        agvs: [
          agv({
            id: "AGV-1",
            status: "IDLE",
            fromLocation: "LINE-SIDE/PRESS-01",
            toLocation: "LINE-SIDE/PRESS-01",
            progress: 1,
          }),
        ],
      }),
    )[0]!;

    const durak = agvWorld(config, "LINE-SIDE/PRESS-01");
    expect(bosta.position[0]).toBeCloseTo(durak[0], 6);
    expect(bosta.position[2]).toBeCloseTo(durak[2], 6);
    expect(bosta.moving).toBe(false);
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

    // Rampada yüzü sağa dönük: yükleme o yönde.
    expect(waiting.heading).toBeCloseTo(0, 6);
    // Ve çıkarken kapıya doğru ilerlemiş.
    const kapi = exitGatePlacement(config);
    expect(Math.abs(leaving.position[0] - kapi[0])).toBeLessThan(
      Math.abs(waiting.position[0] - kapi[0]),
    );
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

// --- vector helpers, kept local to the test ---------------------------------

type Vec = readonly [number, number, number];

function subtract(a: Vec, b: Vec): Vec {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec, b: Vec): Vec {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalise(a: Vec): Vec {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
}
