import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame, InboundTruck } from "@/lib/contract";
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
 * Doli koridorunun plan üzerindeki Y'si.
 *
 * Hattan ayrı: aynı hizada olsaydı doli ile araç aynı yerden geçerdi ve bu,
 * sahada ilk kaldırılacak şeydir. Zemine çizilen yol da bu değeri kullanıyor,
 * çünkü **çizilen yol ile gidilen yol aynı olmak zorunda** — ayrıldıklarında
 * koridor boş görünüyor, arabalar ise makinelerin arasında kayboluyordu.
 */
export const AISLE_PLAN_Y = 18;

/** Doli arabasının bir konumdaki duruş noktası: hücrenin/deponun hemen önü. */
export function agvWorld(config: FactoryDescriptor, location: string): World {
  const [planX, planY] = planPosition(config, location);
  const [x, , z] = toWorld(planX, planY + 6);
  return [x, 0.18, z];
}

/**
 * Bir hattın plan üzerindeki Y'si — istasyonlarının bulunduğu satır.
 *
 * Hatlar plan üzerinde alt alta; koridor da tamir hücresi de hattın kendi
 * satırına göre konumlanıyor. Tek bir sabit koridor, üç hattı da aynı yoldan
 * geçirirdi.
 */
export function linePlanY(config: FactoryDescriptor, lineId: string): number {
  const line = config.lines.find((candidate) => candidate.id === lineId);
  const first = line?.route[0];
  const station = config.stations.find((candidate) => candidate.id === first);
  return station?.position[1] ?? 0;
}

/** Bir hattın doli koridorunun dünya Z'si. */
export function aisleZ(config: FactoryDescriptor, lineId: string): number {
  return toWorld(0, linePlanY(config, lineId) + AISLE_PLAN_Y)[2];
}

/** Bir konumun ait olduğu hat; ortak alanlar için ilk hat. */
export function lineOfLocation(config: FactoryDescriptor, location: string): string {
  const stationId = location.startsWith("LINE-SIDE/")
    ? location.slice("LINE-SIDE/".length)
    : location;
  const station = config.stations.find((candidate) => candidate.id === stationId);
  return station?.lineId ?? config.lines[0]?.id ?? "";
}

/**
 * Doli arabasının izlediği yol: duraktan koridora, koridor boyunca, hedefe.
 *
 * Motor yalnızca "nereden nereye" ve "ne kadarı bitti" diyor; **hangi yoldan**
 * gidildiği sahnenin işi. Önceki sürüm iki nokta arasında düz çizgi çekiyordu,
 * yani araba makinelerin ve hattın üzerinden çapraz geçiyordu — üstelik zemine
 * çizili koridorun tamamen dışından. Koridor boş duruyor, hareket ise
 * görünmüyordu.
 */
function agvPath(from: World, to: World, koridor: number): readonly World[] {
  return [from, [from[0], from[1], koridor], [to[0], to[1], koridor], to];
}

/**
 * Çok parçalı bir yol üzerinde `t` oranındaki nokta ve o noktadaki yön.
 *
 * `t` parçalara **uzunlukları oranında** bölünüyor, yani araç köşelerde
 * hızlanmıyor. Sıfır uzunluklu parçalar atlanıyor: duraklar zaten koridorda
 * olduğunda yol iki noktaya iniyor ve bölme sıfıra düşerdi.
 */
function alongPath(points: readonly World[], t: number): { position: World; heading: number } {
  const legs: { from: World; to: World; length: number }[] = [];
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const length = Math.hypot(to[0] - from[0], to[2] - from[2]);
    if (length < 1e-6) continue;
    legs.push({ from, to, length });
    total += length;
  }

  const first = points[0]!;
  if (legs.length === 0 || total === 0) return { position: first, heading: 0 };

  let kalan = Math.max(0, Math.min(1, t)) * total;
  for (const leg of legs) {
    if (kalan > leg.length) {
      kalan -= leg.length;
      continue;
    }
    const oran = kalan / leg.length;
    return {
      position: [
        leg.from[0] + (leg.to[0] - leg.from[0]) * oran,
        leg.from[1],
        leg.from[2] + (leg.to[2] - leg.from[2]) * oran,
      ],
      heading: Math.atan2(leg.to[0] - leg.from[0], leg.to[2] - leg.from[2]),
    };
  }

  const son = legs[legs.length - 1]!;
  return {
    position: son.to,
    heading: Math.atan2(son.to[0] - son.from[0], son.to[2] - son.from[2]),
  };
}

export interface Zone {
  readonly id: string;
  readonly label: string;
  /** Plan-space rectangle: [x0, y0, x1, y1]. */
  readonly rect: readonly [number, number, number, number];
  readonly tone: StatusTone;
}

/**
 * Bölgeler malzemenin izlediği sıraya göre: dışarıdan içeri
 * **mal kabul → giriş kalite → depo → hat**.
 *
 * Karantina bu sıranın bir durağı değil, giriş kalitenin sonucu; o yüzden
 * kapıda değil, kalite kontrolün yanında. Önceki yerleşimde en dışarıdaydı ve
 * henüz kontrol edilmemiş malın oraya gittiğini ima ediyordu.
 */
/**
 * Ortak alanlar: bütün hatların paylaştığı yerler.
 *
 * Sıra malzemenin izlediği yol: **mal kabul → giriş kalite → depo**, sonra
 * hatlar, sonra **bitmiş ürün → sevkiyat**. Karantina bu sıranın bir durağı
 * değil, giriş kalitenin sonucu; o yüzden kapıda değil, kalite kontrolün
 * yanında.
 */
const ORTAK_BOLGELER: readonly Zone[] = [
  // Mal kabul bağımsız bir alan: aradaki boşluk tırın manevra sahası ve
  // planda "burası ayrı bir bölge" demenin yolu.
  { id: "inbound", label: "Mal Kabul", rect: [-30, -12, -10, 12], tone: "logistics" },
  { id: "iqc", label: "Giriş Kalite", rect: [-8, -7, 4, 8], tone: "warn" },
  { id: "gate", label: "Üretime Geçiş", rect: [5, -6, 12, 7], tone: "ok" },
  { id: "quarantine", label: "Karantina", rect: [-8, 14, 4, 27], tone: "risk" },
  { id: "store", label: "İç Lojistik Deposu", rect: [14, -7, 28, 8], tone: "logistics" },
  { id: "finished", label: "Bitmiş Ürün", rect: [132, -8, 150, 10], tone: "ok" },
  // Sevkiyat da bağımsız, mal kabulle aynı mantık.
  { id: "shipping", label: "Sevkiyat", rect: [162, -12, 186, 12], tone: "logistics" },
];

/**
 * Bütün bölgeler: ortak alanlar, artı her hattın kendi şeridi ve tamir
 * hücresi.
 *
 * Hat bölgeleri elle yazılıyken tek hat vardı ve rakamlar dosyada sabitti.
 * Artık hattın gerçek istasyon konumundan hesaplanıyor: bir hattın yeri
 * değiştiğinde zemindeki alanı da onunla birlikte gidiyor.
 */
export function zonesOf(config: FactoryDescriptor): Zone[] {
  const hatBolgeleri = config.lines.flatMap<Zone>((line) => {
    const planY = linePlanY(config, line.id);
    const xs = line.route
      .map((id) => config.stations.find((station) => station.id === id)?.position[0])
      .filter((x): x is number => x !== undefined);
    if (xs.length === 0) return [];

    const rework = config.stations.find((station) => station.id === line.reworkStationId);
    const reworkY = rework?.position[1] ?? planY + 28;
    const reworkX = rework?.position[0] ?? Math.max(...xs);

    return [
      {
        id: `line:${line.id}`,
        // Model adı zeminde: üç şerit aynı görünüyor, üzerlerinden geçen araç
        // farklı.
        label: `${line.id} · ${line.model}`,
        rect: [Math.min(...xs) - 8, planY - 6, Math.max(...xs) + 10, planY + 8],
        tone: "ok",
      },
      {
        id: `rework:${line.id}`,
        label: "Tamir Hücresi",
        rect: [reworkX - 12, reworkY - 8, reworkX + 12, reworkY + 8],
        tone: "risk",
      },
    ];
  });

  return [...ORTAK_BOLGELER, ...hatBolgeleri];
}

export interface CameraBookmark {
  readonly id: string;
  readonly label: string;
  readonly position: World;
  readonly target: World;
}

/**
 * Sahnenin dikey görüş açısı.
 *
 * Sahne de bu sabiti kullanıyor. İki yerde ayrı ayrı yazılsaydı biri
 * değiştiğinde genel görünüm sessizce tesisi kırpardı — bu dosyadaki kamera
 * hatası da zaten böyle bir kopukluktan doğmuştu.
 */
export const SCENE_FOV_DEG = 40;
/**
 * Ekran oranı bilinmediğinde varsayılan.
 *
 * Sahne gerçek oranını biliyor ve onu veriyor; bu değer yalnızca kamera
 * noktalarını sahne dışında (örneğin görünüm listesini kurarken) hesaplayanlar
 * için. Sabit bırakıldığında dar bir pencerede tesis tamamen ekran dışında
 * kalıyordu.
 */
const OVERVIEW_ASPECT = 16 / 9;

/**
 * Ekran oranını kullanılabilir hâle getirir.
 *
 * Sayfa açılırken tuval bir kare boyunca 0 genişlikte ölçülebiliyor. O anda
 * oran 0 oluyor, yatay görüş açısı 0'a gidiyor ve gereken mesafe sonsuza
 * çıkıyor: kamera sonsuza yerleşiyor, ekran boş kalıyor ve boyut düzelse bile
 * bir daha toparlanmıyor. Bu yüzden anlamsız bir oran hesaba hiç girmiyor.
 */
function kullanilabilirOran(aspect: number): number {
  return Number.isFinite(aspect) && aspect > 0.05 ? aspect : OVERVIEW_ASPECT;
}
/** Kenarlarda bırakılan pay: bina cepheleri tam sınıra dayanmasın. */
const OVERVIEW_MARGIN = 1.12;
/** Kameranın yere bakış açısı. Dik bakış plan çizimine, alçak bakış tünele benzer. */
const OVERVIEW_PITCH_DEG = 38;

/**
 * Bütün tesisi çerçeveleyen görünüm.
 *
 * Bu nokta elle yazılmıştı ve yerleşim revizyonundan sonra sessizce yanlış
 * kaldı: mal kabul solda, sevkiyat sağda ekranın dışındaydı — yani "genel
 * görünüm" tesisin genelini göstermiyordu. Artık bölgelerin gerçek sınırından
 * hesaplanıyor, çünkü "her şey görünsün" bir koordinat değil bir kural; bir
 * sonraki yerleşim değişikliğinde de kendiliğinden doğru kalmalı.
 */
/**
 * Genel görünümün kapsaması gereken her şey, dünya koordinatında.
 *
 * Yalnızca `ZONES` yetmiyor: güvenlik kapısı ve giriş yolu bilerek bölgelerin
 * *dışında* — gerçek bir fabrikada da kapı tesisin sınırındadır, binaların
 * içinde değil. Kamera çizilen şeyi çerçevelemeli, yalnızca bölgelenmiş olanı
 * değil.
 */
export function overviewExtent(config: FactoryDescriptor): readonly World[] {
  const points: World[] = [];
  for (const zone of zonesOf(config)) {
    const [x0, y0, x1, y1] = zone.rect;
    points.push(toWorld(x0, y0), toWorld(x1, y0), toWorld(x0, y1), toWorld(x1, y1));
  }
  // Tırın yolu: güvenlik kapısı, dönüş köşesi ve rampa.
  points.push(gateWorld(config), turnWorld(config), dockWorld(config));
  // Çıkış yolu: sevkiyat sahası, çıkış kapısı ve dışarısı.
  points.push(...carrierRoute(config), exitGatePlacement(config));
  return points;
}

function overviewBookmark(config: FactoryDescriptor, rawAspect: number): CameraBookmark {
  const aspect = kullanilabilirOran(rawAspect);
  const points = overviewExtent(config);
  const xs = points.map((point) => point[0]);
  const zs = points.map((point) => point[2]);
  const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centreZ = (Math.min(...zs) + Math.max(...zs)) / 2;

  const tanV = Math.tan((SCENE_FOV_DEG / 2) * (Math.PI / 180));
  const tanH = Math.tan(Math.atan(tanV * aspect));
  const pitch = OVERVIEW_PITCH_DEG * (Math.PI / 180);

  /*
   * Gereken mesafe, tek tek her noktadan çıkarılıyor.
   *
   * İlk hâli tesisin yalnızca genişliğine bakıyordu ve güvenlik kapısını
   * kırpıyordu: kapı kameraya yakın olduğu için aynı yanal kaçıklık orada çok
   * daha büyük bir açıya karşılık geliyor. Yani "en geniş nokta" değil, "en
   * zorlayan nokta" belirlemeli.
   *
   * Kamera hedefin d kadar gerisinde ve `pitch` açısıyla bakıyor. Bir nokta
   * için derinlik `d − cos(pitch)·dz`, yanal kaçıklık `dx`, dikey kaçıklık ise
   * `sin(pitch)·dz`. İkisini de görüş açısına sığdıran en küçük d aranıyor.
   */
  let distance = 0;
  for (const point of points) {
    const dx = Math.abs(point[0] - centreX);
    const dz = point[2] - centreZ;
    const zemin = Math.cos(pitch) * dz;
    distance = Math.max(distance, dx / tanH + zemin, (Math.sin(pitch) * Math.abs(dz)) / tanV + zemin);
  }
  distance *= OVERVIEW_MARGIN;

  return {
    id: "overview",
    label: "Genel",
    position: [centreX, distance * Math.sin(pitch), centreZ + distance * Math.cos(pitch)],
    target: [centreX, 0, centreZ],
  };
}

/**
 * Mal kabul görünümü: kapıdan rampaya kadar bütün giriş.
 *
 * Yalnızca rampaya bakan bir kamera hikâyenin sonunu gösteriyordu. Malzemenin
 * tesise nasıl girdiği — güvenlik kapısı, yol, dönüş, rampa — tek karede
 * görünmeli; "mal kabul" dediğimiz şey bu dizinin tamamı.
 */
function receivingView(config: FactoryDescriptor): { position: World; target: World } {
  const [gate, corner, dock] = truckRoute(config);
  if (!gate || !corner || !dock) return { position: [0, 10, 20], target: [0, 0, 0] };

  const centreX = (corner[0] + dock[0]) / 2;
  const centreZ = (gate[2] + corner[2]) / 2;
  // Yolun iki ucunu da alacak kadar geri: en uzun bacak ne kadarsa o kadar.
  const yayilim = Math.max(Math.abs(gate[2] - corner[2]), Math.abs(dock[0] - corner[0]));

  return {
    position: [centreX - yayilim * 0.5, yayilim * 1.15, centreZ + yayilim * 1.5],
    target: [centreX, 0.6, centreZ],
  };
}

/**
 * Sevkiyat görünümü: sahadan çıkış kapısına kadar bütün çıkış.
 *
 * Mal kabulle aynı mantık, ters yön. Yalnızca rampaya bakan bir kamera
 * güvenlik kapısını kadraja hiç almıyordu; oysa "sevkiyat" dediğimiz şey
 * yükleme + çıkış yolu + kapının tamamı.
 */
function shippingView(config: FactoryDescriptor): { position: World; target: World } {
  const [yard, exit] = carrierRoute(config);
  if (!yard || !exit) return { position: [0, 10, 20], target: [0, 0, 0] };

  const centreX = (yard[0] + exit[0]) / 2;
  const yayilim = Math.abs(exit[0] - yard[0]);

  return {
    position: [centreX + yayilim * 0.3, yayilim * 0.8, yard[2] + yayilim * 1.05],
    target: [centreX, 0.6, yard[2]],
  };
}

/** Named viewpoints an operator would actually ask for. */
export function cameraBookmarks(
  config: FactoryDescriptor,
  aspect: number = OVERVIEW_ASPECT,
): readonly CameraBookmark[] {
  const look = (stationId: string, offset: World): CameraBookmark["position"] => {
    const [x, , z] = stationWorld(config, stationId);
    return [x + offset[0], offset[1], z + offset[2]];
  };
  const at = (stationId: string): World => {
    const [x, , z] = stationWorld(config, stationId);
    return [x, 0.6, z];
  };
  return [
    overviewBookmark(config, aspect),
    { id: "receiving", label: "Mal Kabul", ...receivingView(config) },
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
    { id: "shipping", label: "Sevkiyat", ...shippingView(config) },
  ];
}

/**
 * Kameranın hedefe olan en büyük uzaklığı.
 *
 * Sahnedeki kontrol bunu sınırlıyor. Sabit bir sınır (70) genel görünümün
 * gerektirdiği mesafeden kısa kalınca kamera sessizce yakına çekiliyor ve
 * tesisin bir kısmı ekran dışında kalıyordu — hesaplanan görünüm doğru olsa
 * bile. Sınır, çerçevelemenin kendisinden gelmeli.
 */
export function maxCameraDistance(config: FactoryDescriptor, aspect: number): number {
  return overviewDistance(config, aspect) * 1.15;
}

/** Genel görünümde kameranın hedefe uzaklığı. */
export function overviewDistance(config: FactoryDescriptor, aspect: number): number {
  const overview = overviewBookmark(config, aspect);
  return Math.hypot(
    overview.position[1] - overview.target[1],
    overview.position[2] - overview.target[2],
  );
}

/**
 * Sisin başladığı ve bittiği uzaklık, artı kameranın görüş menzili.
 *
 * Üçü de elle yazılıydı (55 / 140 / 400) ve kamera ~35 birim uzaktayken
 * ayarlanmıştı. Güvenlik kapısı eklenip kamera 168 birime çekilince tesisin
 * tamamı sisin *ötesinde* kaldı ve ekran tek renk boşluğa döndü — sahne
 * çiziliyordu, yalnızca hiçbir şey görünmüyordu.
 *
 * Sis derinlik hissi için var, mesafeyi gizlemek için değil; o yüzden
 * kameranın kendi uzaklığına göre ölçekleniyor.
 */
export function sceneDepth(
  config: FactoryDescriptor,
  aspect: number,
): { fogNear: number; fogFar: number } {
  const distance = overviewDistance(config, aspect);
  return { fogNear: distance * 1.15, fogFar: distance * 2.6 };
}

/**
 * Kameranın görüş menzili.
 *
 * Ekran oranından bağımsız tek bir değer, çünkü kamera nesnesi kurulduktan
 * sonra değiştirilmiyor — değiştirmek React derleyicisinin haklı olarak
 * yasakladığı bir mutasyon olurdu. O yüzden en zorlayan orana göre, yani en
 * dar pencerede bile yetecek şekilde hesaplanıyor. Fazladan menzil bedava
 * değil ama bu aralıkta derinlik tamponu için sorun çıkarmıyor.
 */
const EN_DAR_ORAN = 0.5;

export function cameraFarPlane(config: FactoryDescriptor): number {
  return overviewDistance(config, EN_DAR_ORAN) * 3.2;
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
    // Araba **hangi hatta hizmet ediyorsa** o hattın koridorundan gidiyor.
    // Uçlardan biri depo (ortak), diğeri hücre; hattı hücre söylüyor.
    const hat = agv.toLocation.startsWith("LINE-SIDE/")
      ? lineOfLocation(config, agv.toLocation)
      : lineOfLocation(config, agv.fromLocation);
    const { position, heading } = alongPath(agvPath(from, to, aisleZ(config, hat)), t);
    return {
      id: agv.id,
      position,
      loaded: agv.status === "TO_DROP" || agv.status === "UNLOADING",
      moving: agv.status === "TO_PICKUP" || agv.status === "TO_DROP",
      heading,
    };
  });
}

// ---------------------------------------------------------------------------
// Mal kabul — gelen tırlar
// ---------------------------------------------------------------------------

export interface PlacedTruck {
  readonly id: string;
  readonly position: World;
  /** Radyan; +Z'ye bakan varlık bu açıyla döndürülür. */
  readonly heading: number;
  readonly status: InboundTruck["status"];
  readonly batchId: string;
  readonly materialId: string;
  /** Boşaltma sırasında 0..1; sahne palet animasyonunu buna bağlar. */
  readonly unloadProgress: number;
  /** Girdi kalitesi henüz karar vermediyse null. */
  readonly accepted: boolean | null;
}

/**
 * Tırın izlediği yol, iki düz parça hâlinde.
 *
 * Gerçek bir tır fabrikaya doğrudan dalmaz: **önce güvenlik kapısından geçer**,
 * yol boyunca ilerler, mal kabul hizasına gelince **sağa döner** ve rampaya
 * yanaşır. Önceki sürümde tek düz parça vardı ve tır bütün yol boyunca yan yan
 * gidiyordu — hareketi Z ekseninde, yüzü ise +X'te sabitti.
 *
 * `APPROACH_Z` giriş yolunun uzunluğu, `TURN_OFFSET_X` dönüş köşesinin
 * rampadan ne kadar solda olduğu. Köşe, tırın kendi boyundan uzakta durmalı;
 * aksi hâlde dönüşü rampanın içinde tamamlar.
 */
const APPROACH_Z = 22;
const TURN_OFFSET_X = 20;
/**
 * Dönüşün yayvanlaştığı pay.
 *
 * Tır köşeye gelmeden direksiyonu kırmaya başlar. Sıfır olsaydı açı köşede bir
 * kare içinde 90° atlardı ve 17 birimlik bir araçta bu, dönmek gibi değil
 * yerinde takla atmak gibi görünürdü.
 */
const TURN_BLEND = 0.16;

/**
 * Tırın park ettiği nokta: sahanın köşesi.
 *
 * Tır **binaya girmiyor**. Önceki sürümde rampaya kadar sürüyordu ve mal kabul
 * cephesinin içine girmiş gibi duruyordu; sahada da öyle olmaz — dorse
 * boşaltılacağı yere yanaşır, malı içeri forklift taşır.
 *
 * Köşenin hemen sağında: dönüşü tamamlayacak kadar ileride, binaya değmeyecek
 * kadar geride.
 */
const PARK_OFFSET_X = 5;

export function truckParkWorld(config: FactoryDescriptor): World {
  const [x, , z] = turnWorld(config);
  return [x + PARK_OFFSET_X, 0, z];
}

/** Rampada malzemenin indirildiği nokta — rampanın önü, hattın dışında. */
function dockWorld(config: FactoryDescriptor): World {
  const [x, y] = planPosition(config, "RECEIVING-DOCK");
  const [wx, , wz] = toWorld(x, y);
  // Rampanın önü. Tır buraya dorse önde yanaşıyor.
  return [wx + 4, 0, wz + 3];
}

/** Tırın sağa döndüğü köşe: rampanın hizasında, ama solunda. */
function turnWorld(config: FactoryDescriptor): World {
  const [x, , z] = dockWorld(config);
  return [x - TURN_OFFSET_X, 0, z];
}

/**
 * Güvenlik kapısı: tesise girişin ilk noktası.
 *
 * Giriş yolunun ucunda, dönüş köşesinin tam karşısında. Tır buradan içeri
 * giriyor, yani sahnede fabrikanın bir sınırı var — önceki sürümde tır
 * doğrudan mal kabulün önünde beliriyordu.
 */
function gateWorld(config: FactoryDescriptor): World {
  const [x, , z] = turnWorld(config);
  return [x, 0, z + APPROACH_Z];
}

/** Güvenlik kapısı yapısının sahnedeki yeri. */
export function securityGatePlacement(config: FactoryDescriptor): World {
  return gateWorld(config);
}

/**
 * Tırın izlediği yol: kapı → dönüş köşesi → rampa.
 *
 * Zemine çizilmesi için. Doli koridorları zaten işaretli; tırın yolu
 * işaretsizken güvenlik kapısı sahanın dışında boşlukta duruyor gibi
 * görünüyordu — oysa aralarında bir yol var.
 */
export function truckRoute(config: FactoryDescriptor): readonly World[] {
  return [gateWorld(config), turnWorld(config), truckParkWorld(config)];
}

/**
 * Forkliftin seferi: tırın park yerinden mal kabul rampasına.
 *
 * Tır köşede duruyor, malzeme içeri forkliftle giriyor. Bu güzergâh sahnenin
 * uydurduğu bir şey değil, tırın boşaltılması sırasında gerçekten olması
 * gereken hareket — motor boşaltmayı bitirmeden depoya stok da düşmüyor.
 */
/**
 * Forkliftin çalıştığı şerit, tırın **yanında**.
 *
 * İlk sürümde şerit tırın kendi ekseni üzerindeydi: forklift, yükü aldığı anda
 * dorsenin içinde kalıyor, sonra tırın gövdesinin içinden geçip çıkıyordu.
 * Gerçekte forklift dorseye yandan yanaşır.
 *
 * Şerit binaların tarafında (−Z): hem tırla çakışmıyor hem de hareket
 * kameradan görünüyor.
 */
const FORKLIFT_LANE_Z = -3.4;

export function forkliftRoute(config: FactoryDescriptor): readonly World[] {
  const park = truckParkWorld(config);
  const [dockX, , ] = dockWorld(config);
  const z = park[2] + FORKLIFT_LANE_Z;
  // Yükleme noktası dorsenin hizasında: kabin +X'te, dorse geride.
  return [
    [park[0] - 5, 0, z],
    [dockX, 0, z],
  ];
}

export interface PlacedForklift {
  readonly id: string;
  /** Yükün alındığı yer: tırın park ettiği nokta. */
  readonly from: World;
  /** Yükün bırakıldığı yer: mal kabul. */
  readonly to: World;
  /** Aynı anda birden fazla forklift varsa yan yana çalışsınlar. */
  readonly lane: number;
}

/**
 * Boşaltılan her tır için bir forklift.
 *
 * Motorun söylediği şey şu: bu tır **şu anda boşaltılıyor** ve boşaltma bitene
 * kadar depoya stok düşmüyor. Forkliftin var olması, nereden nereye taşıdığı ve
 * iş bitince ortadan kalkması bunun doğrudan karşılığı.
 *
 * Kaç sefer yaptığı ise motorun modelinde yok — orada boşaltma tek bir süre.
 * O yüzden gidiş-gelişin *temposu* sahnede üretiliyor ve öyle olduğu burada
 * yazıyor. Denemesi yapıldı: sefer sayısını yayınlanan ilerlemeye bağlamak,
 * boşaltma üç dakika sürdüğü için forklifti her karede tam sefer başında
 * yakalıyor ve araç yerinde donuyordu.
 */
export function placeForklifts(config: FactoryDescriptor, frame: FactoryFrame): PlacedForklift[] {
  const [park, dock] = forkliftRoute(config);
  if (!park || !dock) return [];

  return frame.trucks
    .filter((truck) => truck.status === "UNLOADING")
    .map((truck, index) => ({
      id: `FL-${truck.id}`,
      from: park,
      to: dock,
      lane: index * 2.4,
    }));
}

/**
 * Bir seferin `cycle` (0..1) anındaki forklift durumu.
 *
 * İlk yarısı **dolu gidiş**, ikinci yarısı **boş dönüş**. Yüklü olup olmaması
 * süs değil: hangi yönün iş, hangisinin dönüş olduğunu söyleyen tek şey.
 * Hareketin kendisi burada, bileşende değil — çünkü test edilebilecek olan
 * kısım bu.
 */
export function forkliftAt(
  assignment: PlacedForklift,
  cycle: number,
): { position: World; heading: number; laden: boolean } {
  const tur = ((cycle % 1) + 1) % 1;
  const donuyor = tur >= 0.5;
  const t = donuyor ? 1 - (tur - 0.5) * 2 : tur * 2;
  const { from, to, lane } = assignment;

  return {
    position: [from[0] + (to[0] - from[0]) * t, 0, from[2] + (to[2] - from[2]) * t + lane],
    // Model +X'e bakıyor; dönüşte arkasını dönüyor.
    heading: donuyor ? Math.PI : 0,
    laden: !donuyor,
  };
}

/**
 * Yol üzerinde `t` oranındaki nokta ve o noktadaki yön.
 *
 * İki düz parça: kapıdan köşeye (−Z yönünde sürüş), köşeden rampaya (+X
 * yönünde sürüş). `t` iki parçaya uzunlukları oranında bölünüyor, böylece hız
 * köşede ne yavaşlıyor ne hızlanıyor.
 *
 * Açı, gidilen yönden **hesaplanıyor** — sabit değil. Tırın modeli +X'e
 * baktığı için −Z yönünde sürerken açı π/2, +X yönünde sürerken 0.
 */
function truckOnRoute(config: FactoryDescriptor, t: number): { position: World; heading: number } {
  const gate = gateWorld(config);
  const corner = turnWorld(config);
  // Tır **park yerine** gidiyor, rampaya değil: sahada durur, malı içeri
  // forklift taşır.
  const dock = truckParkWorld(config);

  const girisUzunluk = Math.abs(gate[2] - corner[2]);
  const yanasmaUzunluk = Math.abs(dock[0] - corner[0]);
  const toplam = girisUzunluk + yanasmaUzunluk;
  const donusNoktasi = girisUzunluk / toplam;

  const position: World =
    t <= donusNoktasi
      ? [gate[0], 0, gate[2] + (corner[2] - gate[2]) * (t / donusNoktasi)]
      : [
          corner[0] + (dock[0] - corner[0]) * ((t - donusNoktasi) / (1 - donusNoktasi)),
          0,
          corner[2],
        ];

  // Açı köşenin iki yanında yumuşatılıyor: π/2 (yol boyunca) → 0 (rampaya).
  const blend = Math.max(0, Math.min(1, (t - (donusNoktasi - TURN_BLEND)) / (2 * TURN_BLEND)));
  const heading = (Math.PI / 2) * (1 - blend);

  return { position, heading };
}

/**
 * Tırları yerleştir.
 *
 * `ARRIVING` boyunca kapıdan rampaya interpolasyon, sonrasında rampada sabit.
 * Ayrılan tır aynı yolu geri gidiyor: gelişi ve gidişi aynı güzergâh olması,
 * izleyicinin "bu az önce gelen tır" diye bağ kurmasını sağlıyor.
 */
export function placeTrucks(config: FactoryDescriptor, frame: FactoryFrame): PlacedTruck[] {
  return frame.trucks.map((truck) => {
    const gelis = truck.status === "ARRIVING";
    const t = gelis ? Math.max(0, Math.min(1, truck.progress)) : 1;
    const { position, heading } = truckOnRoute(config, t);
    return {
      id: truck.id,
      position,
      // Açı gidilen yönden geliyor. Sabit olsaydı — ki öyleydi — tır yol
      // boyunca yüzü yana dönük, yengeç gibi ilerlerdi.
      heading,
      status: truck.status,
      batchId: truck.batchId,
      materialId: truck.materialId,
      unloadProgress: truck.status === "UNLOADING" ? Math.max(0, Math.min(1, truck.progress)) : 0,
      accepted: truck.accepted,
    };
  });
}

/** Mal kabul rampasının kendisi — sahnede sabit bir yapı. */
export function dockPlacement(config: FactoryDescriptor): World {
  const [x, y] = planPosition(config, "RECEIVING-DOCK");
  return toWorld(x, y);
}

// ---------------------------------------------------------------------------
// Sevkiyat — çıkan oto taşıyıcılar
// ---------------------------------------------------------------------------

export interface PlacedCarrier {
  readonly id: string;
  readonly position: World;
  readonly heading: number;
  readonly status: FactoryFrame["shipments"][number]["status"];
  /** Üstündeki araç sayısı — sevkiyatın gerçek yük listesi kadar. */
  readonly loaded: number;
  readonly capacity: number;
  readonly destination: string;
}

/** Sevkiyat sahasında taşıyıcının yüklendiği nokta. */
function carrierDock(config: FactoryDescriptor): World {
  const [x, y] = planPosition(config, "SHIPPING-YARD");
  return toWorld(x, y);
}

/**
 * Fabrika çıkışı.
 *
 * Rampanın tam sağında: taşıyıcı yüzü sağa dönük yükleniyor ve aynı hat
 * üzerinde düz çıkıyor. Önceki sürümde çıkış hem sağda hem ileride olduğu için
 * taşıyıcı çapraz duruyordu.
 */
const EXIT_ROAD_X = 34;

function carrierExit(config: FactoryDescriptor): World {
  const [x, , z] = carrierDock(config);
  return [x + EXIT_ROAD_X, 0, z];
}

/**
 * Çıkış güvenlik kapısı.
 *
 * Girişte olan çıkışta da olmalı: bir fabrikadan araç, kapıda durmadan
 * çıkmaz. Çıkış yolunun üzerinde, sahanın dışında.
 */
export function exitGatePlacement(config: FactoryDescriptor): World {
  const [x, , z] = carrierDock(config);
  return [x + EXIT_ROAD_X * 0.78, 0, z];
}

/** Taşıyıcının çıkış yolu: rampadan kapıya ve dışarı. */
export function carrierRoute(config: FactoryDescriptor): readonly World[] {
  return [carrierDock(config), carrierExit(config)];
}

/**
 * Kapının açık olması gereken an.
 *
 * "Geçiş onayı" bir buton değil, aracın kapıdan geçtiği an: bariyer araç
 * yaklaşırken kalkar, geçtikten sonra iner. Oran 0..1 — sahne bunu kolun
 * açısına çeviriyor.
 */
function kapiAcikligi(mesafe: number, pencere: number): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(mesafe) / pencere));
}

/** Geçiş penceresi: aracın kapının bu kadar yakınında olması bariyeri kaldırır. */
const GATE_WINDOW = 14;

/**
 * Giriş bariyeri ne kadar açık?
 *
 * Yolda kapıya yaklaşan bir tır varsa kalkıyor. Birden fazla tır varsa en
 * yakın olanı belirliyor — kapı bir tanesi için açıksa açıktır.
 */
export function entryGateOpenness(config: FactoryDescriptor, frame: FactoryFrame): number {
  const gate = gateWorld(config);
  let acik = 0;
  for (const truck of frame.trucks) {
    if (truck.status !== "ARRIVING") continue;
    const { position } = truckOnRoute(config, Math.max(0, Math.min(1, truck.progress)));
    acik = Math.max(acik, kapiAcikligi(position[2] - gate[2], GATE_WINDOW));
  }
  return acik;
}

/** Çıkış bariyeri: sahadan çıkan bir taşıyıcı kapıya yaklaştığında kalkıyor. */
export function exitGateOpenness(config: FactoryDescriptor, frame: FactoryFrame): number {
  const gate = exitGatePlacement(config);
  let acik = 0;
  for (const carrier of placeCarriers(config, frame)) {
    if (carrier.status !== "DISPATCHED" && carrier.status !== "IN_TRANSIT") continue;
    acik = Math.max(acik, kapiAcikligi(carrier.position[0] - gate[0], GATE_WINDOW));
  }
  return acik;
}

/**
 * Sevkiyatları oto taşıyıcı olarak yerleştir.
 *
 * Tır uydurulmuş bir nesne değil: **sevkiyatın kendisi**. Üstündeki araç sayısı
 * `productIds` uzunluğu, yani yüklenmiş gerçek araç sayısı. Yüklenirken
 * rampada duruyor, yola çıkınca çıkışa doğru ilerliyor, teslim edilince
 * sahneden çıkıyor — çünkü teslim edilmiş bir sevkiyat artık fabrikada değil.
 */
export function placeCarriers(config: FactoryDescriptor, frame: FactoryFrame): PlacedCarrier[] {
  const dock = carrierDock(config);
  const exit = carrierExit(config);
  // Yüzü sağa dönük, düz. Taşıyıcının burnu +X'e bakıyor ve modelin uzunluk
  // ekseni de +X, yani ek bir döndürme gerekmiyor.
  const heading = 0;

  const visible = frame.shipments.filter(
    (shipment) =>
      shipment.status === "READY" ||
      shipment.status === "LOADING" ||
      shipment.status === "DISPATCHED" ||
      shipment.status === "IN_TRANSIT",
  );

  return visible.map((shipment, index) => {
    // Yolda olan taşıyıcı kalan süresine göre çıkışa doğru ilerliyor.
    const leaving = shipment.status === "DISPATCHED" || shipment.status === "IN_TRANSIT";
    // Toplam yol süresi sevkiyat planından geliyor.
    //
    // Önceden bölen olarak **kalan süre** kullanılıyordu; o zaman ilerleme
    // 1 − r/(r+1) oluyor, yani 12 dakikalık yolun başında 0,08, sonunda 1.
    // Taşıyıcı yolun neredeyse tamamında yerinde duruyor, son dakikada
    // fırlıyordu — üstelik çıkış kapısının önünden görülemeyecek kadar hızlı.
    const transit = Math.max(1, config.shipmentPlan.transitTicks);
    const t = leaving ? Math.max(0, Math.min(1, 1 - shipment.ticksRemaining / transit)) : 0;

    // Rampada bekleyenler arka arkaya dizilsin, üst üste binmesin. Kapılar
    // Z ekseni boyunca sıralandığı için sıra da o yönde.
    const queue = leaving ? 0 : index * 7;

    return {
      id: shipment.id,
      position: [
        dock[0] + (exit[0] - dock[0]) * t,
        0,
        dock[2] + (exit[2] - dock[2]) * t + queue,
      ] as World,
      heading,
      status: shipment.status,
      loaded: shipment.productIds.length,
      capacity: shipment.capacity,
      destination: shipment.destination,
    };
  });
}

/** Giriş kalite tezgâhının yeri. */
export function incomingQcPlacement(config: FactoryDescriptor): World {
  const [x, y] = planPosition(config, "INCOMING-QC");
  return toWorld(x, y);
}

/** Karantina alanının yeri. */
export function quarantinePlacement(config: FactoryDescriptor): World {
  const [x, y] = planPosition(config, "QUARANTINE");
  return toWorld(x, y);
}

/**
 * Giriş kaliteden üretime geçiş noktası.
 *
 * Onaylanan malzemenin hatta girdiği açıklık. Bu nokta planda yoktu ve
 * kontrol edilen mal sanki havada üretime ışınlanıyordu.
 */
export function productionGatePlacement(config: FactoryDescriptor): World {
  const [x, y] = planPosition(config, "PRODUCTION-GATE");
  return toWorld(x, y);
}

/** Sevkiyat binasının yeri. */
export function shippingBuildingPlacement(config: FactoryDescriptor): World {
  const [x, y] = planPosition(config, "SHIPPING-YARD");
  const [wx, , wz] = toWorld(x, y);
  // Bina rampanın arkasında: taşıyıcı önünde yükleniyor.
  return [wx - 6, 0, wz];
}
