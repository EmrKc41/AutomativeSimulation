import type { ScenarioDefinition, ScenarioKind } from "./domain.ts";

/**
 * Scenarios are declarative schedules of disruptions.
 *
 * Modelling them as scheduled events — rather than branches inside the engine —
 * means the baseline and every what-if run share one code path, so any
 * difference in the KPI output is attributable to the disruption itself.
 */
export const scenarios: Readonly<Record<ScenarioKind, ScenarioDefinition>> = {
  normal: {
    kind: "normal",
    label: "Normal üretim",
    description: "Planlı program, normal tedarik, normal süreç yeterliliği.",
    events: [],
  },
  machine_failure: {
    kind: "machine_failure",
    label: "Kaynak istasyonu arızası",
    description:
      "40. dakikada Gövde Kaynak 04 duruyor ve 24 dakika kapalı kalıyor; hat ikinci operasyonunu kaybediyor.",
    events: [{ at: 40, kind: "MACHINE_BREAKDOWN", machineId: "WELD-04", durationTicks: 24 }],
  },
  material_shortage: {
    kind: "material_shortage",
    label: "Malzeme gelmiyor",
    description:
      "30. dakikadan itibaren gelen malzeme %25'e düşüyor, 150. dakikada normale dönüyor.",
    events: [
      { at: 30, kind: "SUPPLY_CHANGE", multiplier: 0.25 },
      { at: 150, kind: "SUPPLY_CHANGE", multiplier: 1 },
    ],
  },
  quality_failure: {
    kind: "quality_failure",
    label: "Kalite bozulması",
    description:
      "30. dakikadan itibaren hata oluşumu üç katına çıkıyor; tamir hücresi ve son kalite yükleniyor.",
    events: [{ at: 30, kind: "QUALITY_DEGRADATION", multiplier: 3 }],
  },
  demand_surge: {
    kind: "demand_surge",
    label: "Talep artışı",
    description: "20. dakikada dar terminli 30 araçlık ek bir sipariş düşüyor.",
    events: [{ at: 20, kind: "DEMAND_SURGE", extraUnits: 30, dueTick: 380 }],
  },
  line_stop: {
    kind: "line_stop",
    label: "Tüm hat duruşu",
    description: "60. dakikada hattın tamamı duruyor ve 40 dakika kapalı kalıyor.",
    events: [{ at: 60, kind: "LINE_STOP", lineId: "LINE-01", durationTicks: 40 }],
  },
};

export const scenarioKinds = Object.keys(scenarios) as readonly ScenarioKind[];

export function isScenarioKind(value: string): value is ScenarioKind {
  return Object.hasOwn(scenarios, value);
}
