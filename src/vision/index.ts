export {
  PerfectInspector,
  RecordedInspector,
  SimulatedInspector,
  scoreConfidence,
  type Inspector,
  type InspectionOutcome,
  type InspectionRequest,
} from "./inspector.ts";
export {
  DEFAULT_SPEC,
  DEFECT_CLASSES,
  OK_CLASS,
  classDistribution,
  generate,
  renderSample,
  type DatasetSpec,
  type Sample,
} from "./dataset.ts";
export {
  exportDataset,
  validateDataset,
  type ExportResult,
  type Layout,
  type ValidationReport,
} from "./export.ts";
export { Canvas, encodePng } from "./png.ts";
export {
  ServiceInspector,
  type ServiceDetection,
  type ServiceInspectorOptions,
  type ServiceResponse,
} from "./service.ts";
