import type { FactoryConfig, StationConfig } from "./domain.ts";

/**
 * Seed master data for the reference line.
 *
 * The numbers are a deliberate engineering choice, not decoration:
 * final assembly is the slowest operation (6 ticks) so the line has a natural
 * constraint to find, while the nominal takt (8 ticks/unit) leaves just enough
 * headroom that a healthy line meets demand and a disrupted one does not.
 */

/** Named locations used by inventory, AGV move tasks and the 3D layout. */
export const LOCATIONS = {
  receiving: "RECEIVING-DOCK",
  incomingQc: "INCOMING-QC",
  quarantine: "QUARANTINE",
  rawStock: "RAW-STOCK-A",
  finishedGoods: "FINISHED-GOODS",
  shipping: "SHIPPING-YARD",
} as const;

/**
 * Tesis yerleşimi, malzemenin gerçekten izlediği sıraya göre.
 *
 * Akış dışarıdan içeri: **mal kabul → giriş kalite → depo → hat**. Karantina
 * bu akışın bir durağı değil, giriş kalitenin *sonucu*; o yüzden kapıda değil,
 * kalite kontrolün yanında duruyor. İlk yerleşimde karantina en dışarıdaydı ve
 * bu, henüz kontrol edilmemiş malın oraya gittiğini ima ediyordu — sahada
 * kimsenin yapmayacağı bir şey.
 */
export const LOCATION_POSITIONS: Readonly<Record<string, readonly [number, number]>> = {
  [LOCATIONS.receiving]: [0, 0],
  [LOCATIONS.incomingQc]: [11, 0],
  [LOCATIONS.quarantine]: [11, 20],
  [LOCATIONS.rawStock]: [22, 0],
  [LOCATIONS.finishedGoods]: [140, 0],
  [LOCATIONS.shipping]: [165, 0],
};

/** Line-side stock location for a station; the AGV replenishment target. */
export function lineSideLocation(stationId: string): string {
  return `LINE-SIDE/${stationId}`;
}

const noInspection = {
  enabled: false,
  method: "VISION",
  recall: 0,
  falsePositiveRate: 0,
  cameraId: null,
} as const;

const stations: readonly StationConfig[] = [
  {
    id: "PRESS-01",
    name: "Pres Hattı 01",
    workCenter: "Pres",
    lineId: "LINE-01",
    cycleTicks: 3,
    cycleJitter: 1,
    bufferCapacity: 3,
    failureRatePerTick: 0.006,
    repairTicks: [3, 8],
    defectRate: 0.04,
    defectTypes: ["DENT", "DIMENSIONAL", "SURFACE_DEFORMATION"],
    inspection: noInspection,
    runEnergyKwhPerTick: 4.2,
    idleEnergyKwhPerTick: 0.6,
    consumes: [{ materialId: "STEEL-COIL", quantity: 1 }],
    reorderPoint: 2,
    reorderQuantity: 6,
    robotCount: 2,
    operatorCount: 2,
    position: [40, 0],
  },
  {
    id: "WELD-04",
    name: "Gövde Kaynak 04",
    workCenter: "Gövde",
    lineId: "LINE-01",
    cycleTicks: 4,
    cycleJitter: 1,
    bufferCapacity: 3,
    failureRatePerTick: 0.009,
    repairTicks: [4, 10],
    defectRate: 0.06,
    defectTypes: ["WELD_DEFECT", "MISALIGNMENT", "DIMENSIONAL"],
    inspection: {
      enabled: true,
      method: "VISION",
      recall: 0.85,
      falsePositiveRate: 0.01,
      cameraId: "CAM-BODY-04",
    },
    runEnergyKwhPerTick: 6.8,
    idleEnergyKwhPerTick: 0.9,
    consumes: [{ materialId: "WELD-WIRE", quantity: 1 }],
    reorderPoint: 2,
    reorderQuantity: 6,
    robotCount: 6,
    operatorCount: 1,
    position: [60, 0],
  },
  {
    id: "PAINT-01",
    name: "Boyahane 01",
    workCenter: "Boya",
    lineId: "LINE-01",
    cycleTicks: 5,
    cycleJitter: 1,
    bufferCapacity: 3,
    failureRatePerTick: 0.005,
    repairTicks: [5, 12],
    defectRate: 0.05,
    defectTypes: ["PAINT_DEFECT", "SCRATCH", "SURFACE_DEFORMATION"],
    inspection: {
      enabled: true,
      method: "VISION",
      recall: 0.8,
      falsePositiveRate: 0.015,
      cameraId: "CAM-PAINT-01",
    },
    runEnergyKwhPerTick: 9.5,
    idleEnergyKwhPerTick: 2.4,
    consumes: [{ materialId: "PAINT-KIT", quantity: 1 }],
    reorderPoint: 2,
    reorderQuantity: 6,
    robotCount: 4,
    operatorCount: 1,
    position: [80, 0],
  },
  {
    id: "ASSEMBLY-01",
    name: "Son Montaj 01",
    workCenter: "Montaj",
    lineId: "LINE-01",
    cycleTicks: 6,
    cycleJitter: 2,
    bufferCapacity: 4,
    failureRatePerTick: 0.004,
    repairTicks: [3, 7],
    defectRate: 0.045,
    defectTypes: ["MISSING_PART", "WRONG_PART", "MISALIGNMENT"],
    inspection: noInspection,
    runEnergyKwhPerTick: 3.1,
    idleEnergyKwhPerTick: 0.8,
    consumes: [{ materialId: "TRIM-KIT", quantity: 1 }],
    reorderPoint: 2,
    reorderQuantity: 6,
    robotCount: 3,
    operatorCount: 8,
    position: [100, 0],
  },
  {
    id: "FINAL-QC",
    name: "Son Kalite Kontrol",
    workCenter: "Kalite",
    lineId: "LINE-01",
    cycleTicks: 2,
    cycleJitter: 0,
    bufferCapacity: 4,
    failureRatePerTick: 0.002,
    repairTicks: [2, 4],
    defectRate: 0,
    defectTypes: [],
    inspection: {
      enabled: true,
      method: "DIMENSIONAL",
      recall: 0.97,
      falsePositiveRate: 0.005,
      cameraId: "CAM-FINAL-QC",
    },
    runEnergyKwhPerTick: 1.2,
    idleEnergyKwhPerTick: 0.4,
    consumes: [],
    reorderPoint: 0,
    reorderQuantity: 0,
    robotCount: 1,
    operatorCount: 2,
    position: [120, 0],
  },
  {
    id: "REWORK-01",
    name: "Tamir Hücresi 01",
    workCenter: "Tamir",
    lineId: "LINE-01",
    cycleTicks: 4,
    cycleJitter: 2,
    bufferCapacity: 6,
    failureRatePerTick: 0.002,
    repairTicks: [2, 5],
    defectRate: 0,
    defectTypes: [],
    inspection: noInspection,
    runEnergyKwhPerTick: 2.0,
    idleEnergyKwhPerTick: 0.5,
    consumes: [],
    reorderPoint: 0,
    reorderQuantity: 0,
    robotCount: 0,
    operatorCount: 4,
    position: [100, 28],
  },
];

export const factoryConfig: FactoryConfig = {
  lineId: "LINE-01",
  route: ["PRESS-01", "WELD-04", "PAINT-01", "ASSEMBLY-01", "FINAL-QC"],
  reworkStationId: "REWORK-01",
  stations,
  materials: [
    {
      id: "STEEL-COIL",
      name: "Sac rulo",
      unit: "rulo",
      supplyIntervalTicks: 24,
      supplyQuantity: 4,
      incomingRejectRate: 0.03,
      shelfLifeTicks: null,
    },
    {
      id: "WELD-WIRE",
      name: "Kaynak teli makarası",
      unit: "makara",
      supplyIntervalTicks: 40,
      supplyQuantity: 7,
      incomingRejectRate: 0.02,
      shelfLifeTicks: null,
    },
    {
      id: "PAINT-KIT",
      name: "Çift bileşen boya seti",
      unit: "set",
      supplyIntervalTicks: 30,
      supplyQuantity: 5,
      incomingRejectRate: 0.04,
      // Paint has a pot life, so its lots are issued FEFO rather than FIFO.
      shelfLifeTicks: 600,
    },
    {
      id: "TRIM-KIT",
      name: "İç döşeme seti",
      unit: "set",
      supplyIntervalTicks: 30,
      supplyQuantity: 5,
      incomingRejectRate: 0.02,
      shelfLifeTicks: null,
    },
  ],
  workOrders: [
    { id: "WO-2026-001", productDefinitionId: "SEDAN-A", quantity: 20, priority: 1, dueTick: 200 },
    { id: "WO-2026-002", productDefinitionId: "SEDAN-A", quantity: 20, priority: 2, dueTick: 320 },
    { id: "WO-2026-003", productDefinitionId: "SUV-B", quantity: 20, priority: 3, dueTick: 460 },
  ],
  shipmentPlan: {
    customer: "EU-DEALER-NETWORK",
    destination: "Bremerhaven",
    vehicle: "Oto Taşıyıcı",
    capacity: 4,
    loadingTicks: 3,
    transitTicks: 12,
  },
  wipCap: 6,
  maxReworkPasses: 2,
  agvTicksPerDistance: 1,
  agvCount: 3,
  agvHandlingTicks: 1,
  analysisWindowTicks: 20,
  demandPerShift: 60,
  shiftTicks: 480,
};

export function stationById(config: FactoryConfig, id: string): StationConfig {
  const station = config.stations.find((candidate) => candidate.id === id);
  if (!station) throw new Error(`unknown station: ${id}`);
  return station;
}

/**
 * The name a store clerk would use, falling back to the code.
 *
 * Alert text reads better with "Sac rulo" than with "STEEL-COIL", but an alert
 * must never fail to be raised because a material is missing from the config —
 * so an unknown id degrades to the id rather than throwing.
 */
export function materialName(config: FactoryConfig, id: string): string {
  return config.materials.find((material) => material.id === id)?.name ?? id;
}

export function positionOf(config: FactoryConfig, location: string): readonly [number, number] {
  const fixed = LOCATION_POSITIONS[location];
  if (fixed) return fixed;
  const stationId = location.startsWith("LINE-SIDE/")
    ? location.slice("LINE-SIDE/".length)
    : location;
  const station = config.stations.find((candidate) => candidate.id === stationId);
  return station ? station.position : [0, 0];
}

/** Travel time between two named locations, in ticks. */
export function travelTicks(config: FactoryConfig, from: string, to: string): number {
  const [fromX, fromY] = positionOf(config, from);
  const [toX, toY] = positionOf(config, to);
  const distance = Math.hypot(toX - fromX, toY - fromY) / 20;
  return Math.max(1, Math.round(distance * config.agvTicksPerDistance));
}
