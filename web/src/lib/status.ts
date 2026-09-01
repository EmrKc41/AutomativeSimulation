import {
  AGV_STATUS_TEXT,
  ALERT_TEXT,
  EVENT_TEXT,
  INSPECTION_METHOD_TEXT,
  MACHINE_STATUS_TEXT,
  PAYLOAD_TEXT,
  PRODUCT_STATUS_TEXT,
  SHIPMENT_STATUS_TEXT,
  defectText,
} from "@twin/labels";

import type {
  AgvStatus,
  AlertCode,
  FactoryEvent,
  InspectionMethod,
  MachineStatus,
  ProductStatus,
  ShipmentStatus,
} from "@/lib/contract";

/**
 * The single place where operational state becomes colour and words.
 *
 * The UI is not allowed to decide that something looks unhealthy: every colour
 * on screen is a lookup from a state the engine published. Each entry also
 * carries a text label, because colour alone must never be the only carrier of
 * meaning.
 *
 * The labels are the plant's own Turkish, not a literal translation of the
 * enum. "STARVED" is "Besleme Yok" rather than "Aç", because that is what a
 * supervisor says on the floor — and terms Turkish plants already use in the
 * original (OEE, takt, kanban, AGV, WIP) are left alone. The full mapping and
 * the reasoning behind each choice live in `docs/TERMINOLOGY.md`.
 */

export type StatusTone =
  "ok" | "warn" | "risk" | "critical" | "logistics" | "idle" | "blocked" | "neutral";

export interface ToneStyle {
  readonly text: string;
  readonly bg: string;
  readonly border: string;
  readonly dot: string;
  readonly bar: string;
  /**
   * The same colour as a literal, for WebGL materials.
   *
   * Three.js cannot read a Tailwind class or an `oklch()` custom property, so
   * the scene needs the raw value. It lives here, beside the classes it must
   * match, rather than in the 3D code where it could drift out of step with the
   * rest of the UI. Both come from the same palette in
   * `design-system/factory-command-center/MASTER.md`.
   */
  readonly hex: string;
}

/** Explicit class maps — Tailwind cannot see dynamically assembled names. */
export const TONE: Record<StatusTone, ToneStyle> = {
  ok: {
    text: "text-status-ok",
    bg: "bg-status-ok/12",
    border: "border-status-ok/40",
    dot: "bg-status-ok",
    bar: "bg-status-ok",
    hex: "#22c55e",
  },
  warn: {
    text: "text-status-warn",
    bg: "bg-status-warn/12",
    border: "border-status-warn/40",
    dot: "bg-status-warn",
    bar: "bg-status-warn",
    hex: "#eab308",
  },
  risk: {
    text: "text-status-risk",
    bg: "bg-status-risk/12",
    border: "border-status-risk/40",
    dot: "bg-status-risk",
    bar: "bg-status-risk",
    hex: "#f97316",
  },
  critical: {
    text: "text-status-critical",
    bg: "bg-status-critical/14",
    border: "border-status-critical/50",
    dot: "bg-status-critical",
    bar: "bg-status-critical",
    hex: "#ef4444",
  },
  logistics: {
    text: "text-status-logistics",
    bg: "bg-status-logistics/12",
    border: "border-status-logistics/40",
    dot: "bg-status-logistics",
    bar: "bg-status-logistics",
    hex: "#3b82f6",
  },
  idle: {
    text: "text-status-idle",
    bg: "bg-status-idle/12",
    border: "border-status-idle/35",
    dot: "bg-status-idle",
    bar: "bg-status-idle",
    hex: "#64748b",
  },
  blocked: {
    text: "text-status-blocked",
    bg: "bg-status-blocked/12",
    border: "border-status-blocked/40",
    dot: "bg-status-blocked",
    bar: "bg-status-blocked",
    hex: "#a855f7",
  },
  neutral: {
    text: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
    dot: "bg-muted-foreground",
    bar: "bg-muted-foreground",
    hex: "#94a3b8",
  },
};

export interface StateDescriptor {
  readonly label: string;
  readonly tone: StatusTone;
  readonly meaning: string;
}

function describe<K extends string>(
  wording: Record<K, { readonly label: string; readonly meaning: string }>,
  tones: Record<K, StatusTone>,
): Record<K, StateDescriptor> {
  const result = {} as Record<K, StateDescriptor>;
  for (const key of Object.keys(wording) as K[]) {
    result[key] = { ...wording[key], tone: tones[key] };
  }
  return result;
}

const MACHINE_TONE: Record<MachineStatus, StatusTone> = {
  RUNNING: "ok",
  IDLE: "idle",
  STARVED: "warn",
  BLOCKED: "blocked",
  DOWN: "critical",
  MAINTENANCE: "risk",
};

/**
 * Wording comes from the engine's glossary, tone is decided here. Keeping the
 * two apart means a report and a screen can never disagree about what a state
 * is called, while only the screen has to care what colour it is.
 */
export const MACHINE_STATE = describe(MACHINE_STATUS_TEXT, MACHINE_TONE);

const PRODUCT_TONE: Record<ProductStatus, StatusTone> = {
  WAITING_FOR_MATERIAL: "warn",
  QUEUED: "idle",
  IN_PRODUCTION: "ok",
  IN_REWORK: "risk",
  READY_TO_SHIP: "ok",
  LOADING: "logistics",
  DISPATCHED: "logistics",
  IN_TRANSIT: "logistics",
  DELIVERED: "neutral",
  SCRAPPED: "critical",
};

export const PRODUCT_STATE = describe(PRODUCT_STATUS_TEXT, PRODUCT_TONE);

const SHIPMENT_TONE: Record<ShipmentStatus, StatusTone> = {
  PLANNED: "idle",
  READY: "ok",
  LOADING: "logistics",
  DISPATCHED: "logistics",
  IN_TRANSIT: "logistics",
  DELIVERED: "neutral",
};

export const SHIPMENT_STATE = describe(SHIPMENT_STATUS_TEXT, SHIPMENT_TONE);

const AGV_TONE: Record<AgvStatus, StatusTone> = {
  IDLE: "idle",
  TO_PICKUP: "logistics",
  LOADING: "logistics",
  TO_DROP: "logistics",
  UNLOADING: "logistics",
};

export const AGV_STATE = describe(AGV_STATUS_TEXT, AGV_TONE);

export const INSPECTION_METHOD_LABEL: Record<InspectionMethod, string> = INSPECTION_METHOD_TEXT;

export const ALERT_LABEL: Record<AlertCode, string> = ALERT_TEXT;

export const ALERT_TONE: Record<AlertCode, StatusTone> = {
  MACHINE_FAILURE: "critical",
  BOTTLENECK: "warn",
  QUALITY_FAILURE: "risk",
  MATERIAL_SHORTAGE: "warn",
  SCRAP: "critical",
  SCHEDULE_RISK: "risk",
};

export const defectLabel = defectText;

export const EVENT_LABEL: Record<FactoryEvent["type"], string> = EVENT_TEXT;

export function eventLabel(type: FactoryEvent["type"]): string {
  return EVENT_LABEL[type] ?? type;
}

export const PAYLOAD_LABEL: Readonly<Record<string, string>> = PAYLOAD_TEXT;

/**
 * The value side of a payload field, in words.
 *
 * Field names alone were translated first, which left the timeline reading
 * "yontem VISION - sonuc PASS". Half a translation is arguably worse than
 * none: it looks finished.
 */
export { locationText, payloadValueText } from "@twin/labels";

const EVENT_TONE: Partial<Record<FactoryEvent["type"], StatusTone>> = {
  MACHINE_FAILURE: "critical",
  PRODUCT_SCRAPPED: "critical",
  DEFECT_ESCAPED: "critical",
  MATERIAL_SHORTAGE: "warn",
  STATION_STARVED: "warn",
  STATION_BLOCKED: "blocked",
  BOTTLENECK_DETECTED: "warn",
  BOTTLENECK_CLEARED: "ok",
  DEFECT_DETECTED: "risk",
  QUALITY_CHECK_FAILED: "risk",
  REWORK_STARTED: "risk",
  MAINTENANCE_STARTED: "risk",
  MATERIAL_QUARANTINED: "risk",
  QUALITY_CHECK_PASSED: "ok",
  REWORK_COMPLETED: "ok",
  MAINTENANCE_COMPLETED: "ok",
  PRODUCT_COMPLETED: "ok",
  WORK_ORDER_COMPLETED: "ok",
  WORK_ORDER_RELEASED: "logistics",
  PRODUCTION_STARTED: "logistics",
  OPERATION_COMPLETED: "ok",
  MACHINE_STARTED: "ok",
  MACHINE_STOPPED: "critical",
  INSPECTION_COMPLETED: "neutral",
  MATERIAL_CONSUMED: "neutral",
  MATERIAL_RECEIVED: "logistics",
  MATERIAL_ACCEPTED: "logistics",
  KANBAN_SIGNAL: "logistics",
  AGV_TASK_ASSIGNED: "logistics",
  AGV_TASK_COMPLETED: "logistics",
  SHIPMENT_CREATED: "logistics",
  SHIPMENT_LOADING: "logistics",
  SHIPMENT_DISPATCHED: "logistics",
  SHIPMENT_DELIVERED: "logistics",
  SCENARIO_APPLIED: "blocked",
};

export function eventTone(type: FactoryEvent["type"]): StatusTone {
  return EVENT_TONE[type] ?? "neutral";
}

/** Event types that describe a decision or an exception, not routine motion. */
export const SIGNIFICANT_EVENTS = new Set<FactoryEvent["type"]>([
  "SCENARIO_APPLIED",
  "MACHINE_FAILURE",
  "MAINTENANCE_STARTED",
  "MAINTENANCE_COMPLETED",
  "BOTTLENECK_DETECTED",
  "BOTTLENECK_CLEARED",
  "DEFECT_DETECTED",
  "DEFECT_ESCAPED",
  "QUALITY_CHECK_FAILED",
  "REWORK_STARTED",
  "REWORK_COMPLETED",
  "PRODUCT_SCRAPPED",
  "PRODUCT_COMPLETED",
  "MATERIAL_SHORTAGE",
  "MATERIAL_QUARANTINED",
  "STATION_BLOCKED",
  "STATION_STARVED",
  "SHIPMENT_CREATED",
  "SHIPMENT_LOADING",
  "SHIPMENT_DISPATCHED",
  "SHIPMENT_DELIVERED",
  "WORK_ORDER_RELEASED",
  "WORK_ORDER_COMPLETED",
]);

/**
 * Tone for a ratio where higher is better, against an operational target.
 * Thresholds are stated once here so two panels cannot disagree about what
 * "good" means.
 */
export function ratioTone(value: number, target: number): StatusTone {
  if (value >= target) return "ok";
  if (value >= target * 0.9) return "warn";
  return "risk";
}
