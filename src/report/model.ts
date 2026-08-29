import { rankMachineRisk, runAllAnalyses, type Analysis, type MachineRisk } from "../analytics.ts";
import type {
  FactoryConfig,
  FactoryEvent,
  FactoryMetrics,
  MachineStatus,
  ProductStatus,
  ScenarioKind,
  ShipmentStatus,
} from "../domain.ts";
import { materialName, stationById } from "../factory.ts";
import {
  ALERT_TEXT,
  MACHINE_STATUS_TEXT,
  PAYLOAD_TEXT,
  locationText,
  payloadValueText,
  PRODUCT_STATUS_TEXT,
  SHIPMENT_STATUS_TEXT,
  defectText,
  eventText,
  severityText,
} from "../labels.ts";
import type { SimulationState } from "../state.ts";

/**
 * One shared model behind both reports.
 *
 * The spreadsheet and the PDF are built from this object, never independently
 * from the simulation, so the two can never disagree about a number. It is also
 * a projection and nothing else — reading it does not touch the run.
 */

export interface StationRow {
  readonly id: string;
  readonly name: string;
  readonly workCenter: string;
  readonly status: string;
  readonly isConstraint: boolean;
  readonly nominalCycle: number;
  readonly bufferCapacity: number;
  readonly queueLength: number;
  readonly produced: number;
  readonly failures: number;
  readonly runMinutes: number;
  readonly starvedMinutes: number;
  readonly blockedMinutes: number;
  readonly idleMinutes: number;
  readonly downMinutes: number;
  readonly utilisation: number;
  readonly availability: number;
  readonly energyKwh: number;
}

export interface DefectRow {
  readonly type: string;
  readonly count: number;
  readonly detected: number;
  readonly resolved: number;
  readonly escaped: number;
}

export interface GateRow {
  readonly stationId: string;
  readonly stationName: string;
  readonly camera: string;
  readonly method: string;
  readonly configuredRecall: number;
  readonly inspections: number;
  readonly rejections: number;
  readonly caught: number;
  readonly falseRejections: number;
}

export interface WorkOrderRow {
  readonly id: string;
  readonly model: string;
  readonly quantity: number;
  readonly released: number;
  readonly completed: number;
  readonly scrapped: number;
  readonly remaining: number;
  readonly dueMinute: number;
  readonly minutesLeft: number;
  readonly status: string;
}

export interface ShipmentRow {
  readonly id: string;
  readonly customer: string;
  readonly destination: string;
  readonly status: string;
  readonly loaded: number;
  readonly capacity: number;
  readonly plannedDeparture: number;
  readonly actualDeparture: number | null;
  readonly delayMinutes: number | null;
}

export interface InventoryRow {
  readonly materialId: string;
  readonly batchId: string;
  readonly location: string;
  readonly status: string;
  readonly quantity: number;
  readonly receivedAt: number;
}

export interface ProductRow {
  readonly id: string;
  readonly workOrderId: string;
  readonly model: string;
  readonly status: string;
  readonly releasedAt: number | null;
  readonly completedAt: number | null;
  readonly leadTime: number | null;
  readonly reworkPasses: number;
  readonly defects: number;
  readonly escapedDefects: number;
  readonly lots: string;
  readonly shipmentId: string;
  readonly route: string;
}

export interface EventRow {
  readonly minute: number;
  readonly clock: string;
  readonly type: string;
  readonly typeLabel: string;
  readonly source: string;
  readonly correlationId: string;
  readonly detail: string;
}

export interface AlertRow {
  readonly id: string;
  readonly minute: number;
  readonly code: string;
  readonly severity: string;
  readonly entityId: string;
  readonly message: string;
  readonly open: boolean;
  readonly acknowledged: boolean;
}

export interface ReportModel {
  readonly generatedAt: Date;
  readonly simulationId: string;
  readonly scenario: ScenarioKind;
  readonly scenarioLabel: string;
  readonly scenarioDescription: string;
  readonly seed: number;
  readonly lineId: string;
  readonly simulatedMinutes: number;
  readonly shiftMinutes: number;
  readonly metrics: FactoryMetrics;
  readonly stations: readonly StationRow[];
  readonly defects: readonly DefectRow[];
  readonly defectsByOrigin: ReadonlyArray<{ readonly stationId: string; readonly count: number }>;
  readonly gates: readonly GateRow[];
  readonly workOrders: readonly WorkOrderRow[];
  readonly shipments: readonly ShipmentRow[];
  readonly inventory: readonly InventoryRow[];
  readonly products: readonly ProductRow[];
  readonly events: readonly EventRow[];
  readonly alerts: readonly AlertRow[];
  readonly analyses: readonly Analysis[];
  readonly risk: readonly MachineRisk[];
}

/** Elapsed plant time as HH:MM, the way the command centre shows it. */
export function clock(minute: number): string {
  const hours = Math.floor(minute / 60);
  return `${String(hours).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/**
 * The event's detail column, in the same words the screen uses.
 *
 * This used to print the engine's own vocabulary — "plannedDeparture=56
 * material=STEEL-COIL method=VISION" — which is readable to whoever wrote the
 * engine and to nobody else. The report goes to a production meeting, so both
 * the field names and the values come from the shared glossary.
 *
 * Identifiers are deliberately left alone. `CAR-2026-000042` and `WO-2026-001`
 * are what a traceability query is run against; translating them would make the
 * report unusable for the one job it exists to support.
 */
function payloadSummary(event: FactoryEvent, config: FactoryConfig): string {
  return Object.entries(event.payload)
    .map(([key, value]) => `${PAYLOAD_TEXT[key] ?? key}: ${payloadDetail(key, value, config)}`)
    .join(" · ");
}

function payloadDetail(field: string, value: unknown, config: FactoryConfig): string {
  if (field === "material") return materialName(config, String(value));
  if (field === "from" || field === "to") {
    const location = String(value);
    const stationId = location.startsWith("LINE-SIDE/")
      ? location.slice("LINE-SIDE/".length)
      : null;
    return locationText(location, stationId ? stationName(config, stationId) : undefined);
  }
  if (field === "origin" || field === "returnsTo" || field === "station") {
    return stationName(config, String(value));
  }
  // A ratio reads as a ratio on screen and as a percentage on paper.
  if (field === "utilization" && typeof value === "number") {
    return `%${Math.round(value * 100)}`;
  }
  return payloadValueText(field, value);
}

/** Station name by id, degrading to the id: a report must never fail to print. */
function stationName(config: FactoryConfig, id: string): string {
  return config.stations.find((station) => station.id === id)?.name ?? id;
}

export interface ReportOptions {
  /** Wall-clock time the report was produced, for the document header. */
  readonly generatedAt?: Date;
  /** The run's identity, which the runtime owns rather than the state. */
  readonly simulationId?: string;
}

export function buildReportModel(state: SimulationState, options: ReportOptions = {}): ReportModel {
  const generatedAt = options.generatedAt ?? new Date();
  const elapsed = Math.max(1, state.time);
  const takt = state.config.shiftTicks / state.config.demandPerShift;

  const stations: StationRow[] = state.machines.map((machine) => {
    const station = stationById(state.config, machine.id);
    return {
      id: machine.id,
      name: station.name,
      workCenter: station.workCenter,
      status: MACHINE_STATUS_TEXT[machine.status as MachineStatus].label,
      isConstraint: machine.bottleneck,
      nominalCycle: station.cycleTicks,
      bufferCapacity: station.bufferCapacity,
      queueLength: machine.queue.length,
      produced: machine.producedCount,
      failures: machine.failureCount,
      runMinutes: machine.runTicks,
      starvedMinutes: machine.starvedTicks,
      blockedMinutes: machine.blockedTicks,
      idleMinutes: machine.idleTicks,
      downMinutes: machine.downtimeTicks,
      utilisation: machine.utilization,
      availability: machine.availability,
      energyKwh: Number(machine.energyKwh.toFixed(2)),
    };
  });

  const byType = new Map<string, DefectRow>();
  const byOrigin = new Map<string, number>();
  for (const defect of state.defects) {
    const product = state.productIndex.get(defect.productId);
    const escaped =
      !defect.detected && !defect.resolved && product !== undefined && product.completedAt !== null;
    const key = defect.type;
    const existing = byType.get(key) ?? {
      type: defectText(key),
      count: 0,
      detected: 0,
      resolved: 0,
      escaped: 0,
    };
    byType.set(key, {
      type: existing.type,
      count: existing.count + 1,
      detected: existing.detected + (defect.detected ? 1 : 0),
      resolved: existing.resolved + (defect.resolved ? 1 : 0),
      escaped: existing.escaped + (escaped ? 1 : 0),
    });
    byOrigin.set(defect.originStationId, (byOrigin.get(defect.originStationId) ?? 0) + 1);
  }

  const gates: GateRow[] = state.config.stations
    .filter((station) => station.inspection.enabled)
    .map((station) => {
      const inspections = state.inspections.filter(
        (inspection) => inspection.stationId === station.id,
      );
      const camera = station.inspection.cameraId ?? station.id;
      return {
        stationId: station.id,
        stationName: station.name,
        camera,
        method: station.inspection.method,
        configuredRecall: station.inspection.recall,
        inspections: inspections.length,
        rejections: inspections.filter((inspection) => inspection.result === "FAIL").length,
        caught: state.defects.filter((defect) => defect.detectedBy === camera).length,
        falseRejections: inspections.filter((inspection) => inspection.falsePositive).length,
      };
    });

  const workOrders: WorkOrderRow[] = state.workOrders.map((order) => {
    const remaining = order.quantity - order.completed - order.scrapped;
    const minutesLeft = order.dueTick - state.time;
    return {
      id: order.id,
      model: order.productDefinitionId,
      quantity: order.quantity,
      released: order.released,
      completed: order.completed,
      scrapped: order.scrapped,
      remaining,
      dueMinute: order.dueTick,
      minutesLeft,
      status:
        order.status === "COMPLETED"
          ? order.completedAt !== null && order.completedAt > order.dueTick
            ? "Geç tamamlandı"
            : "Tamamlandı"
          : minutesLeft <= 0
            ? "Termin geçti"
            : remaining * takt <= minutesLeft
              ? "Yolunda"
              : "Riskli",
    };
  });

  const shipments: ShipmentRow[] = state.shipments.map((shipment) => ({
    id: shipment.id,
    customer: shipment.customer,
    destination: shipment.destination,
    status: SHIPMENT_STATUS_TEXT[shipment.status as ShipmentStatus].label,
    loaded: shipment.productIds.length,
    capacity: shipment.capacity,
    plannedDeparture: shipment.plannedDeparture,
    actualDeparture: shipment.actualDeparture,
    delayMinutes:
      shipment.actualDeparture === null
        ? null
        : shipment.actualDeparture - shipment.plannedDeparture,
  }));

  const inventory: InventoryRow[] = state.inventory
    .filter((balance) => balance.quantity > 0)
    .map((balance) => ({
      materialId: balance.materialId,
      batchId: balance.batchId,
      location: balance.location,
      status: balance.status === "QUARANTINE" ? "Karantina" : "Kullanılabilir",
      quantity: balance.quantity,
      receivedAt: balance.receivedAt,
    }));

  const products: ProductRow[] = state.products.map((product) => {
    const order = state.workOrders.find((candidate) => candidate.id === product.workOrderId);
    const defects = state.defects.filter((defect) => defect.productId === product.id);
    return {
      id: product.id,
      workOrderId: product.workOrderId,
      model: order?.productDefinitionId ?? "—",
      status: PRODUCT_STATUS_TEXT[product.status as ProductStatus].label,
      releasedAt: product.releasedAt,
      completedAt: product.completedAt,
      leadTime:
        product.completedAt !== null && product.releasedAt !== null
          ? product.completedAt - product.releasedAt
          : null,
      reworkPasses: product.reworkCount,
      defects: defects.length,
      escapedDefects: defects.filter(
        (defect) => !defect.detected && !defect.resolved && product.completedAt !== null,
      ).length,
      lots: product.consumedMaterialBatchIds.join(", "),
      shipmentId: product.shipmentId ?? "",
      route: product.history.map((record) => record.stationId).join(" → "),
    };
  });

  const events: EventRow[] = [...state.events].map((event) => ({
    minute: event.occurredAt,
    clock: clock(event.occurredAt),
    type: event.type,
    typeLabel: eventText(event.type),
    source: event.source,
    correlationId: event.correlationId,
    detail: payloadSummary(event, state.config),
  }));

  const alerts: AlertRow[] = state.alerts.map((alert) => ({
    id: alert.id,
    minute: alert.occurredAt,
    code: ALERT_TEXT[alert.code],
    severity:
      alert.severity === "critical" ? "kritik" : alert.severity === "warning" ? "uyarı" : "bilgi",
    entityId: alert.entityId,
    message: alert.message,
    open: alert.resolvedAt === null,
    acknowledged: alert.acknowledged,
  }));

  return {
    generatedAt,
    simulationId: options.simulationId ?? "—",
    scenario: state.scenario.kind,
    scenarioLabel: state.scenario.label,
    scenarioDescription: state.scenario.description,
    seed: state.seed,
    lineId: state.config.lineId,
    simulatedMinutes: elapsed,
    shiftMinutes: state.config.shiftTicks,
    metrics: state.metrics,
    stations,
    defects: [...byType.values()].sort((left, right) => right.count - left.count),
    defectsByOrigin: [...byOrigin.entries()]
      .map(([stationId, count]) => ({ stationId, count }))
      .sort((left, right) => right.count - left.count),
    gates,
    workOrders,
    shipments,
    inventory,
    products,
    events,
    alerts,
    analyses: runAllAnalyses(state),
    risk: rankMachineRisk(state),
  };
}

export { severityText };
