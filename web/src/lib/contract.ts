/**
 * The API contract, taken straight from the engine.
 *
 * These are type-only re-exports: nothing from the simulation is bundled into
 * the browser. The UI is a client of the running twin, never a second
 * implementation of it — which is what stops the dashboard from inventing
 * numbers the factory never produced.
 */
export type {
  Agv,
  AgvStatus,
  InboundTruck,
  Alert,
  AndonState,
  AndonStop,
  AlertCode,
  Command,
  CommandResult,
  Defect,
  DefectType,
  ExecutionRecord,
  FactoryEvent,
  FactoryFrame,
  FactoryMetrics,
  Inspection,
  InspectionMethod,
  InventorySummary,
  Machine,
  MachineMetric,
  MachineStatus,
  MaterialConfig,
  ProductStatus,
  ProductUnit,
  RuntimeStatus,
  ScenarioKind,
  Shipment,
  ShipmentPlanConfig,
  ShipmentStatus,
  StationConfig,
  WorkOrder,
} from "@twin/domain";

export type { Analysis, Evidence, EvidenceKind, Finding } from "@twin/analytics";
export type { CopilotAnswer, CopilotIntent } from "@twin/copilot";
