import type {
  AlertCode,
  DefectSeverity,
  DefectType,
  EventType,
  MachineStatus,
  ProductStatus,
  ShipmentStatus,
} from "./domain.ts";

/**
 * The plant's own words for every state the engine can be in.
 *
 * This is the single glossary. The analytics layer, the copilot, the reports
 * and the command centre all read it, so a status can never be called one thing
 * on a screen and another in a PDF. The enums stay English because they are
 * data; only what a human reads is translated.
 *
 * Terms Turkish plants already use in the original — OEE, takt, kanban, AGV,
 * WIP, FIFO, FEFO — are deliberately left alone. See `docs/TERMINOLOGY.md` for
 * the reasoning behind each choice.
 */

export interface Wording {
  readonly label: string;
  readonly meaning: string;
}

export const MACHINE_STATUS_TEXT: Record<MachineStatus, Wording> = {
  RUNNING: { label: "Çalışıyor", meaning: "Üzerinde araç var, işlem sürüyor." },
  IDLE: { label: "Boşta", meaning: "Bu istasyonu bekleyen iş yok." },
  STARVED: {
    label: "Besleme Yok",
    meaning: "Parça ya da hat kenarı malzeme bekliyor. Sorun yukarıda.",
  },
  BLOCKED: {
    label: "Önü Tıkalı",
    meaning: "Aracı bitirdi ama sonraki tampon dolu. Sorun aşağıda.",
  },
  DOWN: { label: "Arızalı", meaning: "Plansız duruş; onarım sürüyor." },
  MAINTENANCE: { label: "Bakımda", meaning: "Planlı bakım sürüyor." },
};

export const PRODUCT_STATUS_TEXT: Record<ProductStatus, Wording> = {
  WAITING_FOR_MATERIAL: {
    label: "Malzeme Bekliyor",
    meaning: "Hatta açıldı ama henüz başlamadı.",
  },
  QUEUED: { label: "Sırada", meaning: "Bir istasyonun tamponunda bekliyor." },
  IN_PRODUCTION: { label: "İşlemde", meaning: "Üzerinde çalışılıyor." },
  IN_REWORK: { label: "Tamirde", meaning: "Kapıdan geçemedi, düzeltiliyor." },
  READY_TO_SHIP: { label: "Sevke Hazır", meaning: "Son kaliteyi geçti." },
  LOADING: { label: "Yükleniyor", meaning: "Tıra yükleniyor." },
  DISPATCHED: { label: "Sevk Edildi", meaning: "Fabrikadan çıktı." },
  IN_TRANSIT: { label: "Yolda", meaning: "Müşteriye gidiyor." },
  DELIVERED: { label: "Teslim Edildi", meaning: "Müşteriye ulaştı." },
  SCRAPPED: { label: "Hurdaya Ayrıldı", meaning: "Tamir hakkı bitti, hurda olarak kaydedildi." },
};

export const SHIPMENT_STATUS_TEXT: Record<ShipmentStatus, Wording> = {
  PLANNED: { label: "Planlandı", meaning: "Biten araçları topluyor." },
  READY: { label: "Hazır", meaning: "Doldu, rampa bekliyor." },
  LOADING: { label: "Yükleniyor", meaning: "Yükleme sürüyor." },
  DISPATCHED: { label: "Sevk Edildi", meaning: "Sahadan çıktı." },
  IN_TRANSIT: { label: "Yolda", meaning: "Yolda." },
  DELIVERED: { label: "Teslim Edildi", meaning: "Teslimat onaylandı." },
};

export const ALERT_TEXT: Record<AlertCode, string> = {
  MACHINE_FAILURE: "Makine Arızası",
  BOTTLENECK: "Hattı Tutuyor",
  QUALITY_FAILURE: "Kalite Red",
  MATERIAL_SHORTAGE: "Malzeme Eksiği",
  SCRAP: "Hurda",
  SCHEDULE_RISK: "Termin Riski",
};

export const DEFECT_TEXT: Record<DefectType, string> = {
  SCRATCH: "Çizik",
  DENT: "Ezik",
  WELD_DEFECT: "Kaynak Hatası",
  PAINT_DEFECT: "Boya Kusuru",
  MISSING_PART: "Eksik Parça",
  WRONG_PART: "Yanlış Parça",
  SURFACE_DEFORMATION: "Yüzey Deformasyonu",
  MISALIGNMENT: "Hizalama Hatası",
  DIMENSIONAL: "Ölçü Sapması",
};

export const SEVERITY_TEXT: Record<DefectSeverity, string> = {
  minor: "hafif",
  major: "önemli",
  critical: "kritik",
};

/** Event names as a supervisor would read them off a board. */
export const EVENT_TEXT: Record<EventType, string> = {
  SCENARIO_APPLIED: "Senaryo Uygulandı",
  TRUCK_ARRIVED: "Tır Yolda",
  TRUCK_DOCKED: "Tır Rampaya Yanaştı",
  TRUCK_UNLOADED: "Tır Boşaltıldı",
  TRUCK_DEPARTED: "Tır Ayrıldı",
  MATERIAL_RECEIVED: "Malzeme Girişi",
  MATERIAL_ACCEPTED: "Girdi Kalite Kabul",
  MATERIAL_QUARANTINED: "Karantinaya Alındı",
  MATERIAL_SHORTAGE: "Malzeme Eksiği",
  MATERIAL_CONSUMED: "Malzeme Kullanıldı",
  KANBAN_SIGNAL: "Kanban Çağrısı",
  AGV_TASK_ASSIGNED: "AGV Görevi Verildi",
  AGV_TASK_COMPLETED: "AGV Görevi Bitti",
  WORK_ORDER_RELEASED: "İş Emri Açıldı",
  WORK_ORDER_COMPLETED: "İş Emri Tamamlandı",
  PRODUCTION_STARTED: "Üretime Alındı",
  MACHINE_STARTED: "İşlem Başladı",
  MACHINE_STOPPED: "Makine Durdu",
  OPERATION_COMPLETED: "Operasyon Bitti",
  STATION_BLOCKED: "İstasyon Tıkandı",
  STATION_STARVED: "İstasyon Beslemesiz",
  INSPECTION_COMPLETED: "Muayene Yapıldı",
  DEFECT_DETECTED: "Hata Tespit Edildi",
  DEFECT_ESCAPED: "Hata Kaçtı",
  QUALITY_CHECK_PASSED: "Kalite Onayı",
  QUALITY_CHECK_FAILED: "Kalite Red",
  REWORK_STARTED: "Tamire Alındı",
  REWORK_COMPLETED: "Tamir Bitti",
  PRODUCT_SCRAPPED: "Hurdaya Ayrıldı",
  MACHINE_FAILURE: "Makine Arızası",
  MAINTENANCE_STARTED: "Bakım Başladı",
  MAINTENANCE_COMPLETED: "Bakım Bitti",
  BOTTLENECK_DETECTED: "Hat Sıkıştı",
  BOTTLENECK_CLEARED: "Sıkışma Açıldı",
  PRODUCT_COMPLETED: "Araç Tamamlandı",
  SHIPMENT_CREATED: "Sevkiyat Açıldı",
  SHIPMENT_LOADING: "Yükleme Başladı",
  SHIPMENT_DISPATCHED: "Sevk Edildi",
  SHIPMENT_DELIVERED: "Teslim Edildi",
};

/** Payload keys worth showing on an event row, in the plant's own words. */
export const PAYLOAD_TEXT: Readonly<Record<string, string>> = {
  defect: "hata",
  severity: "şiddet",
  station: "istasyon",
  material: "malzeme",
  quantity: "adet",
  disposition: "karar",
  durationTicks: "süre dk",
  units: "araç",
  reason: "sebep",
  batch: "parti",
  workOrder: "iş emri",
  pass: "tur",
  reworkCount: "tamir",
  leadTimeTicks: "akış dk",
  result: "sonuç",
  method: "yöntem",
  destination: "varış",

  // Scheduling and work orders
  workOrderQty: "sipariş adedi",
  released: "hatta verilen",
  completed: "tamamlanan",
  scrapped: "hurda",
  dueTick: "termin dk",
  late: "gecikme dk",
  plannedTicks: "planlanan dk",
  definition: "araç tipi",
  product: "araç",

  // Flow and load
  queueLength: "kuyruk",
  queueGrowing: "kuyruk büyüyor",
  utilization: "doluluk",
  cycleDeviation: "çevrim sapması",
  capacity: "kapasite",
  required: "gereken",
  onHand: "eldeki stok",
  opening: "açılış stoğu",

  // Movement
  from: "nereden",
  to: "nereye",
  origin: "çıktığı istasyon",
  returnsTo: "döneceği istasyon",

  // Quality
  inspection: "muayene",
  detected: "yakalanan",
  falsePositive: "yanlış red",
  defectProbability: "hata olasılığı",
  final: "son kontrol",
  reworkPass: "tamir turu",
  reworkPasses: "tamir turu",

  // Maintenance
  corrective: "arıza bakımı",
  restored: "çalışır duruma geldi",
  cause: "sebep",

  // Shipment
  customer: "müşteri",
  plannedDeparture: "planlanan çıkış dk",
  actualDeparture: "gerçek çıkış dk",

  // Scenario events
  kind: "senaryo",
  at: "dakika",
};

/**
 * Fixed places in the plant, as the people working there name them.
 *
 * Line-side stores are not listed: there is one per station and the name is
 * derived, not fixed. `locationText` handles that.
 */
export const LOCATION_TEXT: Readonly<Record<string, string>> = {
  "RECEIVING-DOCK": "Mal Kabul",
  "INCOMING-QC": "Giriş Kalite",
  QUARANTINE: "Karantina",
  "RAW-STOCK-A": "Ham Depo",
  "FINISHED-GOODS": "Mamul Depo",
  "SHIPPING-YARD": "Sevkiyat Sahası",
};

/**
 * Enum values that reach the screen, keyed by the payload field they belong to.
 *
 * Keyed by field rather than flat, because the same word means different things
 * in different fields and a flat table would silently pick one of them.
 */
export const PAYLOAD_VALUE_TEXT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  method: {
    VISION: "Görsel kontrol",
    DIMENSIONAL: "Ölçü kontrolü",
    MANUAL: "Elle kontrol",
  },
  result: {
    PASS: "Geçti",
    FAIL: "Kaldı",
  },
  disposition: {
    REWORK: "Tamire",
    SCRAP: "Hurdaya",
    RELEASE: "Serbest",
  },
  cause: {
    random: "kendiliğinden",
    scenario: "senaryo gereği",
    "scenario:line-stop": "senaryo: hat duruşu",
  },
  reason: {
    "downstream-buffer-full": "sonraki istasyon dolu",
    "demand-surge": "talep artışı",
    "material-shortage": "malzeme yok",
  },
  kind: {
    MACHINE_BREAKDOWN: "Makine arızası",
    SUPPLY_CHANGE: "Tedarik değişikliği",
    QUALITY_DEGRADATION: "Kalite bozulması",
    DEMAND_SURGE: "Talep artışı",
    LINE_STOP: "Hat duruşu",
  },
};

/**
 * A location's name, including the derived line-side stores.
 *
 * `LINE-SIDE/PAINT-01` is one string in the engine but two facts on the floor:
 * which station, and that it is the material kept at that station rather than
 * in the store. Both belong in the name.
 */
export function locationText(location: string, stationName?: string): string {
  const fixed = LOCATION_TEXT[location];
  if (fixed) return fixed;
  if (location.startsWith("LINE-SIDE/")) {
    const stationId = location.slice("LINE-SIDE/".length);
    return `${stationName ?? stationId} hat kenarı`;
  }
  return location;
}

/**
 * Turn one payload value into words.
 *
 * Anything without a mapping is returned as it is: identifiers (CAR-2026-000042,
 * WO-2026-001, lot numbers) are meant to stay as they are, and an unmapped enum
 * is better shown raw than dropped from a shift report.
 */
export function payloadValueText(field: string, value: unknown): string {
  if (value === true) return "evet";
  if (value === false) return "hayır";
  if (typeof value !== "string") return String(value);

  const table = PAYLOAD_VALUE_TEXT[field];
  if (table && table[value]) return table[value];
  if (field === "defect") return defectText(value);
  if (field === "severity") return severityText(value);
  return value;
}

export function defectText(type: string): string {
  return DEFECT_TEXT[type as DefectType] ?? type;
}

export function severityText(severity: string): string {
  return SEVERITY_TEXT[severity as DefectSeverity] ?? severity;
}

export function eventText(type: string): string {
  return EVENT_TEXT[type as EventType] ?? type;
}
