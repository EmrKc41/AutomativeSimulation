import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame } from "@/lib/contract";
import { PRODUCT_STATE, type StatusTone } from "@/lib/status";

/**
 * The bridge between the factory's plan coordinates and the 3D scene.
 *
 * The layout is not invented here. `StationConfig.position` and the location
 * table already describe where things are on the plant floor; this module only
 * scales and centres them, and works out which slot a given unit currently
 * occupies. Nothing in the scene may place an object anywhere the twin has not
 * put it.
 */

/** Plan units are metres; the scene is scaled down so the line fits a viewport. */
export const SCALE = 0.35;
/** Plan Y of the main line, used to centre the floor on it. */
const LINE_Y = 8;
const CENTRE_X = 82.5;

export type World = [number, number, number];

export function toWorld(planX: number, planY: number, height = 0): World {
  return [(planX - CENTRE_X) * SCALE, height, (planY - LINE_Y) * SCALE];
}

/** Named plant locations plus line-side bins, resolved to plan coordinates. */
export function planPosition(
  config: FactoryDescriptor,
  location: string,
): readonly [number, number] {
  const fixed = config.locations[location];
  if (fixed) return fixed;
  const stationId = location.startsWith("LINE-SIDE/")
    ? location.slice("LINE-SIDE/".length)
    : location;
  const station = config.stations.find((candidate) => candidate.id === stationId);
  return station ? station.position : [0, 0];
}

/** Where a station's machine body sits. */
export function stationWorld(config: FactoryDescriptor, stationId: string): World {
  const station = config.stations.find((candidate) => candidate.id === stationId);
  if (!station) return toWorld(0, 0);
  return toWorld(station.position[0], station.position[1]);
}

/** The point a unit occupies while it is being worked on. */
export function machineSlot(config: FactoryDescriptor, stationId: string): World {
  const [x, , z] = stationWorld(config, stationId);
  return [x, 0.55, z];
}

/** Buffer slots queue up in front of the station, nearest first. */
export function bufferSlot(config: FactoryDescriptor, stationId: string, index: number): World {
  const [x, , z] = stationWorld(config, stationId);
  return [x - 1.6 - index * 1.15, 0.55, z];
}

/** Finished vehicles park in rows in the finished-goods yard. */
export function finishedSlot(config: FactoryDescriptor, index: number): World {
  const [planX, planY] = planPosition(config, "FINISHED-GOODS");
  const [x, , z] = toWorld(planX, planY);
  const row = Math.floor(index / 4);
  const column = index % 4;
  return [x + row * 1.3, 0.55, z - 1.8 + column * 1.2];
}

/** Loaded vehicles sit on their carrier in the shipping yard. */
export function shipmentSlot(config: FactoryDescriptor, lane: number, index: number): World {
  const [planX, planY] = planPosition(config, "SHIPPING-YARD");
  const [x, , z] = toWorld(planX, planY);
  return [x - 1.6 + index * 1.1, 1.15, z + lane * 2.6 - 2.6];
}

/**
 * AGVs run in an aisle in front of the line rather than through the machines.
 * Their position along a leg comes from `Agv.progress`, which the engine
 * publishes — the scene interpolates, it does not guess.
 */
export function agvWorld(config: FactoryDescriptor, location: string): World {
  const [planX, planY] = planPosition(config, location);
  const [x, , z] = toWorld(planX, planY + 6);
  return [x, 0.18, z];
}

export interface Zone {
  readonly id: string;
  readonly label: string;
  /** Plan-space rectangle: [x0, y0, x1, y1]. */
  readonly rect: readonly [number, number, number, number];
  readonly tone: StatusTone;
}

export const ZONES: readonly Zone[] = [
  { id: "inbound", label: "Mal Kabul & Hammadde", rect: [-6, -6, 30, 10], tone: "logistics" },
  { id: "quarantine", label: "Karantina", rect: [-6, 22, 12, 36], tone: "risk" },
  { id: "line", label: "Hat 01", rect: [32, -6, 130, 8], tone: "ok" },
  { id: "rework", label: "Tamir Hücresi", rect: [90, 20, 114, 36], tone: "risk" },
  { id: "finished", label: "Bitmiş Ürün", rect: [132, -8, 150, 10], tone: "ok" },
  { id: "shipping", label: "Sevkiyat Sahası", rect: [154, -10, 178, 12], tone: "logistics" },
];

export interface CameraBookmark {
  readonly id: string;
  readonly label: string;
  readonly position: World;
  readonly target: World;
}

/** Named viewpoints an operator would actually ask for. */
export function cameraBookmarks(config: FactoryDescriptor): readonly CameraBookmark[] {
  const look = (stationId: string, offset: World): CameraBookmark["position"] => {
    const [x, , z] = stationWorld(config, stationId);
    return [x + offset[0], offset[1], z + offset[2]];
  };
  const at = (stationId: string): World => {
    const [x, , z] = stationWorld(config, stationId);
    return [x, 0.6, z];
  };

  return [
    { id: "overview", label: "Genel", position: [0, 26, 26], target: [0, 0, 0] },
    { id: "press", label: "Pres", position: look("PRESS-01", [-5, 5, 8]), target: at("PRESS-01") },
    {
      id: "body",
      label: "Gövde",
      position: look("WELD-04", [-4, 5, 8]),
      target: at("WELD-04"),
    },
    { id: "paint", label: "Boya", position: look("PAINT-01", [-4, 5, 8]), target: at("PAINT-01") },
    {
      id: "assembly",
      label: "Montaj",
      position: look("ASSEMBLY-01", [-4, 5, 8]),
      target: at("ASSEMBLY-01"),
    },
    {
      id: "quality",
      label: "Kalite Kapısı",
      position: look("FINAL-QC", [-3, 4.5, 7]),
      target: at("FINAL-QC"),
    },
    {
      id: "rework",
      label: "Tamir",
      position: look("REWORK-01", [-4, 5, 8]),
      target: at("REWORK-01"),
    },
    { id: "shipping", label: "Sevkiyat", position: [26, 8, 12], target: [24, 0.6, -2.8] },
  ];
}

export interface PlacedUnit {
  readonly id: string;
  readonly position: World;
  readonly tone: StatusTone;
  readonly status: string;
  readonly reworkCount: number;
  /** True while the unit is being worked on, used for the operation highlight. */
  readonly active: boolean;
}

/**
 * Resolve every visible unit to a floor position.
 *
 * Positions are read from the machines' own queues and current units, which are
 * the authoritative record of where work physically is — not from the product
 * list, which knows its status but not its place in a line.
 */
export function placeUnits(config: FactoryDescriptor, frame: FactoryFrame): PlacedUnit[] {
  const products = new Map(frame.activeProducts.map((product) => [product.id, product]));
  const placed: PlacedUnit[] = [];
  const seen = new Set<string>();

  const push = (productId: string, position: World, active: boolean): void => {
    const product = products.get(productId);
    if (!product || seen.has(productId)) return;
    seen.add(productId);
    placed.push({
      id: product.id,
      position,
      tone: PRODUCT_STATE[product.status].tone,
      status: PRODUCT_STATE[product.status].label,
      reworkCount: product.reworkCount,
      active,
    });
  };

  for (const machine of frame.machines) {
    if (machine.currentProductId !== null) {
      push(machine.currentProductId, machineSlot(config, machine.id), true);
    }
    machine.queue.forEach((productId, index) => {
      push(productId, bufferSlot(config, machine.id, index), false);
    });
  }

  // Units that passed the gate but have not been assigned to a carrier yet.
  let finished = 0;
  for (const product of frame.activeProducts) {
    if (seen.has(product.id)) continue;
    if (product.status !== "READY_TO_SHIP") continue;
    push(product.id, finishedSlot(config, finished), false);
    finished += 1;
  }

  // Units on a carrier in the yard, one lane per shipment being handled.
  const yardShipments = frame.shipments.filter(
    (shipment) => shipment.status === "LOADING" || shipment.status === "DISPATCHED",
  );
  yardShipments.slice(-2).forEach((shipment, lane) => {
    shipment.productIds.forEach((productId, index) => {
      push(productId, shipmentSlot(config, lane, index), false);
    });
  });

  return placed;
}

export interface PlacedAgv {
  readonly id: string;
  readonly position: World;
  readonly loaded: boolean;
  readonly moving: boolean;
  readonly heading: number;
}

/** Interpolate each AGV along its current leg using the published progress. */
export function placeAgvs(config: FactoryDescriptor, frame: FactoryFrame): PlacedAgv[] {
  return frame.agvs.map((agv) => {
    const from = agvWorld(config, agv.fromLocation);
    const to = agvWorld(config, agv.toLocation);
    const t = agv.status === "IDLE" ? 0 : Math.max(0, Math.min(1, agv.progress));
    const position: World = [
      from[0] + (to[0] - from[0]) * t,
      from[1],
      from[2] + (to[2] - from[2]) * t,
    ];
    return {
      id: agv.id,
      position,
      loaded: agv.status === "TO_DROP" || agv.status === "UNLOADING",
      moving: agv.status === "TO_PICKUP" || agv.status === "TO_DROP",
      heading: Math.atan2(to[0] - from[0], to[2] - from[2]),
    };
  });
}
