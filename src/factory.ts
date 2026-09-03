import type { FactoryConfig, LineConfig, StationConfig } from "./domain.ts";

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
  /** Onaylanan malzemenin üretime geçtiği açıklık. */
  productionGate: "PRODUCTION-GATE",
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
  // Mal kabul bağımsız bir alan: giriş kalitesinden 18 birim uzakta duruyor,
  // yani tırın manevra sahası üretim alanına girmiyor.
  [LOCATIONS.receiving]: [-20, 0],
  [LOCATIONS.incomingQc]: [-2, 0],
  // Onaylanan malzeme üretime buradan geçiyor. Bu nokta olmadan kontrol
  // edilen mal sanki havada hatta ışınlanıyordu.
  [LOCATIONS.productionGate]: [8, 0],
  [LOCATIONS.quarantine]: [-2, 20],
  [LOCATIONS.rawStock]: [20, 0],
  [LOCATIONS.finishedGoods]: [140, 0],
  // Sevkiyat da bağımsız: bitmiş ürün deposundan 32 birim ötede, kendi
  // binası ve kendi manevra sahasıyla.
  [LOCATIONS.shipping]: [172, 0],
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

/**
 * Hat kenarı kanban sipariş noktası.
 *
 * Tek hatlı tesiste 2 yeterliydi. Üç hat aynı depodan beslenince yetmedi:
 * kutular sıfıra düşüyor ve istasyonlar malzeme bekliyordu (480 dakikada
 * 4 tohum toplamında 199 kez). 3'e çıkarınca 45'e indi ve dört tohumun
 * dördünde de tam çıktı alındı.
 *
 * **Doli eklemek denendi ve işe yaramadı:** 9'dan 18'e çıkarıldığında bekleme
 * sayısı 199'da sabit kaldı, çünkü arabalar zaten boştaydı (%28 meşguliyet).
 * Kısıt taşıma kapasitesi değil, kutunun ne kadar boşalınca sipariş verdiği.
 *
 * Sipariş **miktarını** büyütmek de işi kötüleştiriyor: 3/8 kombinasyonu
 * 90 bekleme üretti, 3/6 ise 45. Büyük parti, depoyu tek seferde boşaltıyor.
 */
const KANBAN_SIPARIS_NOKTASI = 3;

const HAT_1_ISTASYONLARI: readonly StationConfig[] = [
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
    reorderPoint: KANBAN_SIPARIS_NOKTASI,
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
    reorderPoint: KANBAN_SIPARIS_NOKTASI,
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
    reorderPoint: KANBAN_SIPARIS_NOKTASI,
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
    reorderPoint: KANBAN_SIPARIS_NOKTASI,
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

/**
 * Bir hattın istasyon kimlikleri.
 *
 * Hat 1'inkiler olduğu gibi bırakıldı: bu kimlikler kayıtlı veri kümelerinde,
 * senaryolarda ve testlerde geçiyor ve onları yeniden numaralandırmak, işe
 * yaramayan bir değişiklik için doksan küsur yeri elden geçirmek olurdu.
 * Kaynak kodda gördüğünüz numaralar bu yüzden tesis genelinde sıralı: sahada da
 * kaynak hücreleri hat hat değil, tesis genelinde numaralanır.
 */
interface HatTanimi {
  readonly id: string;
  readonly model: string;
  /** Şablondaki sıraya karşılık gelen istasyon kimlikleri. */
  readonly istasyonlar: readonly string[];
  /** Hattın plan üzerindeki Y'si; istasyonların X'i şablondan geliyor. */
  readonly planY: number;
  readonly demandPerShift: number;
}

/**
 * Tesisteki üç hat.
 *
 * Üçü de **aynı mantıkla** çalışıyor: aynı rota, aynı tamir kuralı, aynı
 * tampon boyutları. Fark tek bir şeyde: ürettikleri model. Sahada da böyle
 * olur — hatlar birbirinin kopyasıdır, üzerlerinden geçen araç değişir.
 *
 * Model adları kurgusal; KOÇ OTOMOTİV'in kendi ürün ailesi.
 */
const HATLAR: readonly HatTanimi[] = [
  {
    id: "LINE-01",
    model: "Meltem",
    istasyonlar: ["PRESS-01", "WELD-04", "PAINT-01", "ASSEMBLY-01", "FINAL-QC", "REWORK-01"],
    planY: 0,
    demandPerShift: 60,
  },
  {
    id: "LINE-02",
    model: "Poyraz",
    istasyonlar: ["PRESS-02", "WELD-05", "PAINT-02", "ASSEMBLY-02", "FINAL-QC-02", "REWORK-02"],
    planY: 46,
    demandPerShift: 60,
  },
  {
    id: "LINE-03",
    model: "Lodos",
    istasyonlar: ["PRESS-03", "WELD-06", "PAINT-03", "ASSEMBLY-03", "FINAL-QC-03", "REWORK-03"],
    planY: 92,
    demandPerShift: 60,
  },
];

/**
 * Hat aralığı.
 *
 * Bir hattın kendi doli koridoru (+18) ve tamir hücresi (+28) var; bir sonraki
 * hat bunların ötesinde başlamalı, yoksa bir hattın tamir hücresi diğerinin
 * içine girer. Aradaki 18 birim, yaya ve forklift geçişi için bırakılan pay.
 */
export const HAT_ARALIGI = 46;

/** Bir hattın istasyonlarını şablondan üret. */
function hatIstasyonlari(hat: HatTanimi): StationConfig[] {
  return HAT_1_ISTASYONLARI.map((sablon, index) => {
    const id = hat.istasyonlar[index];
    if (!id) throw new Error(`${hat.id}: ${sablon.id} için istasyon kimliği tanımlanmamış`);
    // Addaki numara **kimliğin** numarası, hattın değil.
    //
    // Önce hat numarası yazılıyordu ve ekranda "Gövde Kaynak 01" görünürken
    // kimliği `WELD-04` oluyordu: aynı istasyonu iki farklı numarayla anan bir
    // pano, sahada telsizle konuşan iki kişiyi karşı karşıya getirir. Kaynak
    // hücreleri tesis genelinde numaralı (04/05/06), presler hat bazında
    // (01/02/03); ad hangisiyse onu söylüyor.
    //
    // Kimliğinde numara olmayan istasyon ("FINAL-QC") adında da numarasız
    // kalıyor; diğer hatlarınki `FINAL-QC-02` olduğu için karışma olmuyor.
    const kimlikNo = /(\d+)$/.exec(id)?.[1];
    const numarali = /\d+$/.test(sablon.name);

    return {
      ...sablon,
      id,
      name: numarali
        ? kimlikNo
          ? sablon.name.replace(/\d+$/, kimlikNo)
          : sablon.name.replace(/\s*\d+$/, "")
        : kimlikNo
          ? `${sablon.name} ${kimlikNo}`
          : sablon.name,
      lineId: hat.id,
      // X şablondan (rota boyunca sıra), Y hattan.
      position: [sablon.position[0], sablon.position[1] + hat.planY] as [number, number],
    };
  });
}

const stations: readonly StationConfig[] = HATLAR.flatMap(hatIstasyonlari);

const lines: readonly LineConfig[] = HATLAR.map((hat) => ({
  id: hat.id,
  route: hat.istasyonlar.slice(0, -1),
  reworkStationId: hat.istasyonlar[hat.istasyonlar.length - 1]!,
  wipCap: 6,
  demandPerShift: hat.demandPerShift,
  model: hat.model,
}));

/**
 * Her hatta üç iş emri, hepsi o hattın kendi modeli.
 *
 * Miktarlar ve terminler hatlar arasında aynı: üç hat da aynı yükü çekiyor, ki
 * aralarındaki fark performanstan gelsin, plandan değil. Hat 1'in emir
 * numaraları korundu — senaryolar ve testler onlara referans veriyor.
 */
const IS_EMRI_SABLONU = [
  { quantity: 20, priority: 1, dueTick: 200 },
  { quantity: 20, priority: 2, dueTick: 320 },
  { quantity: 20, priority: 3, dueTick: 460 },
] as const;

const workOrders = HATLAR.flatMap((hat, hatIndex) =>
  IS_EMRI_SABLONU.map((sablon, index) => ({
    id: `WO-2026-${String(hatIndex * IS_EMRI_SABLONU.length + index + 1).padStart(3, "0")}`,
    lineId: hat.id,
    productDefinitionId: hat.model.toLocaleUpperCase("tr-TR"),
    ...sablon,
  })),
);

export const factoryConfig: FactoryConfig = {
  lines,
  stations,
  materials: [
    {
      id: "STEEL-COIL",
      name: "Sac rulo",
      unit: "rulo",
      supplyIntervalTicks: 24,
      supplyQuantity: 4 * HATLAR.length,
      incomingRejectRate: 0.03,
      shelfLifeTicks: null,
    },
    {
      id: "WELD-WIRE",
      name: "Kaynak teli makarası",
      unit: "makara",
      supplyIntervalTicks: 40,
      supplyQuantity: 7 * HATLAR.length,
      incomingRejectRate: 0.02,
      shelfLifeTicks: null,
    },
    {
      id: "PAINT-KIT",
      name: "Çift bileşen boya seti",
      unit: "set",
      supplyIntervalTicks: 30,
      supplyQuantity: 5 * HATLAR.length,
      incomingRejectRate: 0.04,
      // Paint has a pot life, so its lots are issued FEFO rather than FIFO.
      shelfLifeTicks: 600,
    },
    {
      id: "TRIM-KIT",
      name: "İç döşeme seti",
      unit: "set",
      supplyIntervalTicks: 30,
      supplyQuantity: 5 * HATLAR.length,
      incomingRejectRate: 0.02,
      shelfLifeTicks: null,
    },
  ],
  workOrders,
  shipmentPlan: {
    customer: "EU-DEALER-NETWORK",
    destination: "Bremerhaven",
    vehicle: "Oto Taşıyıcı",
    capacity: 4,
    loadingTicks: 3,
    transitTicks: 12,
  },
  maxReworkPasses: 2,
  agvTicksPerDistance: 1,
  // Doli sayısı hat başına üç.
  //
  // Üretimi üçe katlayıp lojistiği olduğu yerde bırakmak, iki hat eklemek
  // değil iki *aç* hat eklemek olurdu: ölçüldü, hatlar besleme bekleyerek
  // birbirinin önünü kesiyordu.
  agvCount: 3 * HATLAR.length,
  agvHandlingTicks: 1,
  analysisWindowTicks: 20,
  shiftTicks: 480,
};

export function lineById(config: FactoryConfig, id: string): LineConfig {
  const line = config.lines.find((candidate) => candidate.id === id);
  if (!line) throw new Error(`unknown line: ${id}`);
  return line;
}

/** Bir istasyonun bağlı olduğu hat. */
export function lineOfStation(config: FactoryConfig, stationId: string): LineConfig {
  return lineById(config, stationById(config, stationId).lineId);
}

/** Tesisin toplam vardiya talebi — takt hesabı bunun üzerinden. */
export function totalDemandPerShift(config: FactoryConfig): number {
  return config.lines.reduce((total, line) => total + line.demandPerShift, 0);
}

/** Rotada olan bütün istasyonlar; tamir hücreleri hariç. */
export function routeStationIds(config: FactoryConfig): Set<string> {
  return new Set(config.lines.flatMap((line) => line.route));
}

/** Bu istasyon bir tamir hücresi mi? */
export function isReworkStation(config: FactoryConfig, stationId: string): boolean {
  return config.lines.some((line) => line.reworkStationId === stationId);
}

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
