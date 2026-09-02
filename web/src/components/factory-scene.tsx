"use client";

import { CameraControls, Grid, Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Group, Mesh, MeshBasicMaterial } from "three";

import {
  ASSET_SCALE,
  BELT_HEIGHT,
  MODEL,
  StationBody,
  useModel,
} from "@/components/factory-models";
import { ReceivingYard } from "@/components/receiving-yard";
import { ShippingYard } from "@/components/shipping-yard";
import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame, Machine, StationConfig } from "@/lib/contract";
import {
  SCALE,
  SCENE_FOV_DEG,
  zonesOf,
  planPosition,
  cameraBookmarks,
  aisleZ,
  cameraFarPlane,
  carrierRoutes,
  forkliftRoute,
  maxCameraDistance,
  truckRoute,
  sceneDepth,
  placeAgvs,
  placeUnits,
  stationWorld,
  toWorld,
  type PlacedUnit,
  type World,
} from "@/lib/scene-layout";
import { MACHINE_STATE, TONE } from "@/lib/status";

/**
 * The 3D factory.
 *
 * Every object in this scene is a projection of the published frame. A machine
 * glows amber because the twin says it is starved, a body sits in a buffer slot
 * because that buffer holds it, an AGV is where its own `progress` puts it. The
 * scene interpolates between published states so motion looks continuous, but
 * it never invents a state the factory did not report.
 */

const FLOOR = "#171426";

export interface FactorySceneProps {
  readonly frame: FactoryFrame;
  readonly config: FactoryDescriptor;
  readonly bookmark: string;
  readonly showLabels: boolean;
  readonly onSelectStation: (machineId: string) => void;
  readonly onSelectProduct: (productId: string) => void;
  readonly selectedStation: string | null;
}

export function FactoryScene(props: FactorySceneProps) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <Canvas
      // Shadows earn their cost here: without them the machines float and the
      // hall reads as a diagram. One shadow-casting light is enough — a second
      // would double the cost for a difference nobody would name.
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [0, 24, 30], fov: SCENE_FOV_DEG, // Yakın düzlem 0,1 değil 0,5: kamera zaten 3 birimden yakına gelemiyor
      // (`minDistance`) ve 0,1 ile uzak düzlem arasındaki oran derinlik
      // tamponunun hassasiyetini boşa harcıyordu. Zemine yapışık düzlemlerin
      // bantlanmasında payı olan ikinci sebep buydu.
      near: 0.5, far: cameraFarPlane(props.config) }}
      // A dark hall: the scene must sit on the same ground as the rest of the UI.
      onCreated={({ gl }) => gl.setClearColor("#14121f")}
    >
      <SceneDepth config={props.config} />
      <ambientLight intensity={0.42} />
      <hemisphereLight args={["#9db2d4", "#0d0b16", 0.55]} />
      <directionalLight
        position={[26, 38, 18]}
        intensity={1.35}
        castShadow
        shadow-mapSize={[2048, 2048]}
        // Tight frustum around the hall: a loose one spends its whole shadow
        // map on empty floor and the edges turn to mush.
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-bias={-0.0006}
      />
      {/* Fill from the opposite side so the shadowed faces are readable rather
          than black. Deliberately cool and weak: it models bounce, not a lamp. */}
      <directionalLight position={[-26, 16, -14]} intensity={0.32} color="#8ea6ff" />
      {/* The line itself is the brightest thing in the hall, the way a real
          plant lights the work and leaves the aisles dim. */}
      <spotLight
        position={[0, 26, 0]}
        angle={0.75}
        penumbra={0.8}
        intensity={95}
        distance={70}
        color="#dce6ff"
      />

      <Ground />
      <Zones config={props.config} showLabels={props.showLabels} />
      <TruckRoad config={props.config} />
      <TugRoutes config={props.config} />
      <Conveyor config={props.config} />
      <Stations {...props} reducedMotion={reducedMotion} />
      <Units {...props} reducedMotion={reducedMotion} />
      <Agvs frame={props.frame} config={props.config} />
      {/* Mal kabul: rampa ve gelen tırlar. Blender'da üretilmiş modeller,
          motorun yayınladığı tır durumundan sürülüyor. */}
      <Suspense fallback={null}>
        <ReceivingYard
          frame={props.frame}
          config={props.config}
          showLabels={props.showLabels}
          reducedMotion={reducedMotion}
        />
      </Suspense>
      {/* Sevkiyat: bitmiş araçları alıp götüren oto taşıyıcılar. Üstündeki
          araç sayısı sevkiyatın gerçek yük listesi kadar. */}
      <Suspense fallback={null}>
        <ShippingYard
          frame={props.frame}
          config={props.config}
          showLabels={props.showLabels}
          reducedMotion={reducedMotion}
        />
      </Suspense>

      <BookmarkCamera
        config={props.config}
        bookmark={props.bookmark}
        reducedMotion={reducedMotion}
      />
    </Canvas>
  );
}

// ---------------------------------------------------------------------------
// Static plant
// ---------------------------------------------------------------------------

function Ground() {
  return (
    <>
      {/* receiveShadow is what makes the machines sit on the floor rather than
          hover above it. Without it the lighting is decorative. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[160, 90]} />
        <meshStandardMaterial color={FLOOR} roughness={0.95} metalness={0.05} />
      </mesh>
      <Grid
        position={[0, 0, 0]}
        args={[160, 90]}
        // Izgara aralığı tesisin boyuna göre. 5 metrelik hücreler tek hatlı,
        // kısa bir tesiste okunaklıydı; üç hatlı 300 metrelik sahada kamera
        // geriye çekilince aynı çizgiler ekranda birkaç piksele düşüyor ve
        // moiré deseni üretiyor. Zemin ölçek versin diye var, doku olsun diye
        // değil.
        cellSize={SCALE * 20}
        cellColor="#1e293b"
        sectionSize={SCALE * 100}
        sectionColor="#28324a"
        fadeDistance={220}
        fadeStrength={1}
        infiniteGrid={false}
      />
    </>
  );
}

/**
 * Zemine serilen saydam kaplamaların malzemesi.
 *
 * `depthWrite` **kapalı**. Bölgeler, tır yolları, doli koridorları ve forklift
 * şeridi hepsi zemine yapışık düzlemler ve köşelerde birbirinin üstünden
 * geçiyorlar. Aynı yükseklikte iki düzlem derinlik tamponunda yarışınca
 * ekranda düzenli koyu-açık bantlar çıkıyor — kullanıcının gördüğü "çizgili
 * çizgili" görüntü buydu; kare hızıyla ilgisi yok, her karede aynı yerde
 * duruyor.
 *
 * Derinliğe yazmayan bir kaplama kendisiyle yarışmaz; hangisinin üstte
 * çizileceğini `renderOrder` söylüyor.
 */
function ZeminKaplamasi({
  renk,
  opaklik,
  sira,
}: {
  renk: string;
  opaklik: number;
  sira: number;
}) {
  return (
    <meshBasicMaterial
      color={renk}
      transparent
      opacity={opaklik}
      depthWrite={false}
      polygonOffset
      polygonOffsetFactor={-sira}
      polygonOffsetUnits={-sira}
    />
  );
}

/** Kaplama katmanları; büyük olan üstte çizilir. */
const KAT_BOLGE = 1;
const KAT_TIR_YOLU = 2;
const KAT_FORKLIFT = 3;
const KAT_DOLI = 4;

function Zones({ config, showLabels }: { config: FactoryDescriptor; showLabels: boolean }) {
  return (
    <group>
      {zonesOf(config).map((zone) => {
        const [x0, y0, x1, y1] = zone.rect;
        const [wx, , wz] = toWorld((x0 + x1) / 2, (y0 + y1) / 2);
        const width = (x1 - x0) * SCALE;
        const depth = (y1 - y0) * SCALE;
        return (
          <group key={zone.id}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[wx, 0.01, wz]}>
              <planeGeometry args={[width, depth]} />
              <ZeminKaplamasi renk={TONE[zone.tone].hex} opaklik={0.06} sira={KAT_BOLGE} />
            </mesh>
            {showLabels ? (
              <Html
                position={[wx, 0.05, wz + depth / 2 + 0.4]}
                center
                distanceFactor={26}
                zIndexRange={[10, 0]}
              >
                <span className="text-muted-foreground pointer-events-none text-[10px] tracking-widest whitespace-nowrap uppercase">
                  {zone.label}
                </span>
              </Html>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}

/**
 * Doli güzergâhları — zemine çizilmiş yol çizgileri.
 *
 * Talep açıktı: bu arabaların güzergâhı tanımsız kalmamalı. Motorda zaten
 * tanımlı — her taşıma işi **iç lojistik deposundan ilgili hücrenin hat
 * kenarına** gidiyor ve başka bir yere gitmiyor. Eksik olan, bunun planda
 * görünmemesiydi.
 *
 * Gerçek bir fabrikada bu çizgiler zemine boyanır; hem güzergâhı tanımlar hem
 * de yaya ile aracın nerede karşılaşacağını belli eder. Burada aynı işi
 * yapıyorlar: bir doli bu çizginin dışına çıkmaz.
 */
function TugRoutes({ config }: { config: FactoryDescriptor }) {
  const [storeX, , storeZ] = toWorld(...planPosition(config, "RAW-STOCK-A"));
  // Depo ortak ve hatlar alt alta; arabaların depodan kendi koridorlarına
  // çıktığı **bağlantı yolu** çizilmemişti. Çizgi olmayınca ikinci ve üçüncü
  // hattın arabaları boşlukta beliriyor gibi görünüyordu.
  const koridorlar = config.lines.map((line) => aisleZ(config, line.id));
  const enUzak = koridorlar.reduce((a, b) => (Math.abs(b - storeZ) > Math.abs(a - storeZ) ? b : a), storeZ);

  return (
    <group>
      {/* Depodan en uzak koridora kadar uzanan dikey bağlantı. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[storeX, 0.01, (storeZ + enUzak) / 2]}
      >
        <planeGeometry args={[0.5, Math.abs(enUzak - storeZ)]} />
        <ZeminKaplamasi renk={TONE.logistics.hex} opaklik={0.26} sira={KAT_DOLI} />
      </mesh>
      {config.lines.map((line) => (
        <TugRoute key={line.id} config={config} lineId={line.id} />
      ))}
    </group>
  );
}

function TugRoute({ config, lineId }: { config: FactoryDescriptor; lineId: string }) {
  const [storeX] = toWorld(...planPosition(config, "RAW-STOCK-A"));
  const line = config.lines.find((candidate) => candidate.id === lineId);

  // Ana koridor deponun önünden hattın sonuna kadar; ondan her hücreye bir
  // sapma çıkıyor.
  const targets = config.stations
    .filter((station) => line?.route.includes(station.id))
    .map((station) => toWorld(station.position[0], station.position[1]));
  const lastX = targets.at(-1)?.[0] ?? storeX;
  // Koridorun yeri `scene-layout` içinde tanımlı, burada değil: çizgiyi bir
  // yerde, arabaları başka bir yerde konumlandırmak tam olarak buradaki
  // hataydı — zemindeki koridor boş duruyor, arabalar hattın dibinden
  // geçiyordu.
  const koridorZ = aisleZ(config, lineId);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(storeX + lastX) / 2, 0.01, koridorZ]}>
        <planeGeometry args={[lastX - storeX + 4, 0.5]} />
        <ZeminKaplamasi renk={TONE.logistics.hex} opaklik={0.28} sira={KAT_DOLI} />
      </mesh>
      {targets.map(([x, , z], index) => (
        <mesh key={index} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.01, (koridorZ + z) / 2]}>
          <planeGeometry args={[0.5, Math.abs(koridorZ - z)]} />
          <ZeminKaplamasi renk={TONE.logistics.hex} opaklik={0.22} sira={KAT_DOLI} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Tırın yolu, zemine çizili.
 *
 * Güvenlik kapısından dönüş köşesine, oradan rampaya. İki düz parça, tıpkı
 * aracın gittiği gibi. Yol çizilmediğinde kapı sahanın dışında boşlukta
 * duruyor gibi görünüyordu; oysa fabrikanın sınırı ile mal kabul arasında
 * gerçekten bir yol var ve tır onu izliyor.
 *
 * Doli koridorlarından daha geniş, çünkü tır daha geniş — genişlik burada süs
 * değil, hangi aracın geçtiğini söyleyen şey.
 */
/**
 * Çok parçalı bir güzergâhı zemine çiz.
 *
 * Her parça kendi ekseninde düz bir şerit; köşelerde parçalar bir şerit
 * genişliği kadar örtüşüyor ki yol kesintili görünmesin.
 */
function Yol({
  nokta,
  genislik,
  opaklik = 0.16,
}: {
  nokta: readonly World[];
  genislik: number;
  opaklik?: number;
}) {
  return (
    <group>
      {nokta.slice(0, -1).map((bas, index) => {
        const son = nokta[index + 1]!;
        const dx = Math.abs(son[0] - bas[0]);
        const dz = Math.abs(son[2] - bas[2]);
        if (dx < 1e-6 && dz < 1e-6) return null;
        return (
          <mesh
            key={index}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[(bas[0] + son[0]) / 2, 0.01, (bas[2] + son[2]) / 2]}
          >
            <planeGeometry args={[dx + genislik, dz + genislik]} />
            <ZeminKaplamasi renk={TONE.logistics.hex} opaklik={opaklik} sira={KAT_TIR_YOLU} />
          </mesh>
        );
      })}
    </group>
  );
}

function TruckRoad({ config }: { config: FactoryDescriptor }) {
  const [gate, corner, park] = truckRoute(config);
  const [alis, birakis] = forkliftRoute(config);
  if (!gate || !corner || !park || !alis || !birakis) return null;

  const genislik = 3.4;

  return (
    <group>
      {/*
        Çıkış yolları: her hattın yükleme şeridi doğuya gidiyor, üçü ortak
        yolda birleşiyor ve tek kapıdan çıkıyor. Şeritleri ayrı ayrı çizmek,
        hangi taşıyıcının nereden geldiğini okunur kılıyor.
      */}
      {carrierRoutes(config).map((yol, index) => (
        <Yol key={index} nokta={yol} genislik={genislik} />
      ))}
      {/* Giriş yolu: kapıdan köşeye, Z ekseninde. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[gate[0], 0.01, (gate[2] + corner[2]) / 2]}>
        <planeGeometry args={[genislik, Math.abs(gate[2] - corner[2]) + genislik]} />
        <ZeminKaplamasi renk={TONE.logistics.hex} opaklik={0.16} sira={KAT_TIR_YOLU} />
      </mesh>
      {/* Yanaşma yolu: köşeden park yerine, X ekseninde. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(corner[0] + park[0]) / 2, 0.01, corner[2]]}>
        <planeGeometry args={[Math.abs(park[0] - corner[0]) + genislik, genislik]} />
        <ZeminKaplamasi renk={TONE.logistics.hex} opaklik={0.16} sira={KAT_TIR_YOLU} />
      </mesh>
      {/*
        Forklift şeridi: tırın park yerinden mal kabule. Tır yolundan dar,
        çünkü buradan geçen araç da dar — genişlik hangi aracın geçtiğini
        söyleyen şey.
      */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(alis[0] + birakis[0]) / 2, 0.01, alis[2]]}
      >
        <planeGeometry args={[Math.abs(birakis[0] - alis[0]), genislik * 0.55]} />
        <ZeminKaplamasi renk={TONE.logistics.hex} opaklik={0.12} sira={KAT_FORKLIFT} />
      </mesh>
    </group>
  );
}

/**
 * The transfer line, as repeated conveyor sections rather than one long slab.
 *
 * A single stretched box reads as a painted stripe on the floor. Real belt
 * sections with rails and rollers read as a line a car travels along, and that
 * is the whole point of this view.
 */
/**
 * İstasyonun bant için boş bıraktığı yarı genişlik, dünya biriminde.
 *
 * İstasyonlar birbirinden 7 birim uzakta, makine gövdeleri ise ~4,2 birim.
 * Yani aradaki koridor dar; açıklığı 2,6'ya kurmak bandı tamamen yok etti
 * (kalan 1,8 birim bir bant parçasından kısa). 1,7 ile bant makinenin
 * kenarına kadar geliyor, içinden geçmiyor — anlatmak istediğimiz de bu.
 */
const ISTASYON_ACIKLIGI = 1.7;

function Conveyor({ config }: { config: FactoryDescriptor }) {
  return (
    <group>
      {config.lines.map((line) => (
        <ConveyorLine key={line.id} config={config} route={line.route} />
      ))}
    </group>
  );
}

function ConveyorLine({
  config,
  route,
}: {
  config: FactoryDescriptor;
  route: readonly string[];
}) {
  const first = route[0];
  const last = route[route.length - 1];
  if (!first || !last) return null;
  const [x0, , z] = stationWorld(config, first);
  const [x1] = stationWorld(config, last);

  /*
   * Bant istasyonların **arasında** akıyor, içinden değil.
   *
   * Önceki sürümde tek bir kesintisiz bant baştan sona uzanıyordu ve
   * makinelerin gövdesinden geçip çıkıyordu: pres gövdesinin ortasından bir
   * bant görünüyordu. Sahada bant prese *girer* ve presten *çıkar*; istasyonun
   * altından geçmez.
   *
   * Her istasyonun etrafında bir açıklık bırakılıyor; bant o boşluklarda değil,
   * yalnızca aradaki koridorlarda çiziliyor.
   */
  const bosluk = ISTASYON_ACIKLIGI;
  const duraklar = route.map((id) => stationWorld(config, id)[0]);

  // Bandın parçaları: hattın başından ilk istasyona, istasyonlar arasına ve
  // son istasyondan hattın sonuna.
  const araliklar: [number, number][] = [];
  araliklar.push([x0 - 4, (duraklar[0] ?? x0) - bosluk]);
  for (let i = 0; i + 1 < duraklar.length; i += 1) {
    araliklar.push([duraklar[i]! + bosluk, duraklar[i + 1]! - bosluk]);
  }
  araliklar.push([x1 + bosluk, x1 + 4]);

  const uzunluk = 4 * ASSET_SCALE;

  return (
    <Suspense fallback={null}>
      <group>
        {araliklar.flatMap(([bas, son], aralikIndex) => {
          const genislik = son - bas;
          // Kısa koridorlarda bile en az bir parça: bandın makineye girip
          // çıktığı görünmeli, yoksa istasyonlar birbirine bağlanmamış gibi
          // duruyor.
          if (genislik <= 0) return [];
          const adet = Math.max(1, Math.round(genislik / uzunluk));
          const adim = genislik / adet;
          return Array.from({ length: adet }, (_, index) => (
            <ConveyorSection
              key={`${aralikIndex}-${index}`}
              position={[bas + adim / 2 + index * adim, 0, z]}
            />
          ));
        })}
      </group>
    </Suspense>
  );
}

function ConveyorSection({ position }: { position: [number, number, number] }) {
  const model = useModel(MODEL.conveyor);
  return <primitive object={model} position={position} scale={ASSET_SCALE} />;
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

function Stations({
  frame,
  config,
  showLabels,
  onSelectStation,
  selectedStation,
  reducedMotion,
}: FactorySceneProps & { reducedMotion: boolean }) {
  const byId = new Map(frame.machines.map((machine) => [machine.id, machine]));

  return (
    <group>
      {config.stations.map((station) => {
        const machine = byId.get(station.id);
        if (!machine) return null;
        return (
          <StationMesh
            key={station.id}
            station={station}
            machine={machine}
            showLabel={showLabels}
            selected={selectedStation === station.id}
            reducedMotion={reducedMotion}
            onSelect={() => onSelectStation(station.id)}
          />
        );
      })}
    </group>
  );
}

function StationMesh({
  station,
  machine,
  showLabel,
  selected,
  reducedMotion,
  onSelect,
}: {
  station: StationConfig;
  machine: Machine;
  showLabel: boolean;
  selected: boolean;
  reducedMotion: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const state = MACHINE_STATE[machine.status];
  const colour = TONE[state.tone].hex;
  const [x, , z] = toWorld(station.position[0], station.position[1]);
  const nominal = Math.max(1, station.cycleTicks + station.cycleJitter);
  const progress =
    machine.status === "RUNNING" ? 1 - Math.min(1, machine.remainingTicks / nominal) : 0;

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  return (
    <group position={[x, 0, z]}>
      {/* The machine itself, chosen by work centre: a press looks like a
          press, a body shop has robots either side of the line. The invisible
          box in front of it is the click target — picking against the real
          geometry would make thin parts like a robot torch impossible to hit. */}
      <group>
        <Suspense fallback={null}>
          <StationBody
            workCenter={station.workCenter}
            running={machine.status === "RUNNING"}
            progress={progress}
            reducedMotion={reducedMotion}
          />
        </Suspense>
      </group>

      <mesh
        position={[0, 1.1, 0]}
        visible={false}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[3.4, 2.2, 3.4]} />
      </mesh>

      {/* Selection ring on the floor rather than a tint on the body: a machine
          that changed colour when picked would collide with the status colour,
          which is the one thing on this screen that must never be ambiguous. */}
      {selected || hovered ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[1.85, 2.1, 32]} />
          <meshBasicMaterial color={selected ? "#e2e8f0" : "#94a3b8"} transparent opacity={0.7} />
        </mesh>
      ) : null}

      {/* Status beacon: the machine's own state, nothing else. */}
      <mesh position={[0, 1.45, 0]}>
        <boxGeometry args={[2.4, 0.16, 2.4]} />
        <meshBasicMaterial color={colour} />
      </mesh>
      <mesh position={[0, 1.95, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 0.7, 8]} />
        <meshBasicMaterial color={colour} />
      </mesh>

      {/*
        A stopped station is made physically obvious: a red beacon on a mast,
        a red floor ring, and a slow pulse. This is the one place the scene is
        allowed to shout, because a stop nobody notices is the failure the whole
        andon rule exists to prevent.
      */}
      {machine.status === "DOWN" ? <AndonBeacon /> : null}

      {machine.bottleneck ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[1.9, 2.2, 32]} />
          <meshBasicMaterial color={TONE.warn.hex} transparent opacity={0.8} />
        </mesh>
      ) : null}

      {/* Operation progress, scaled by the ticks the twin says are left. */}
      <group position={[0, 0.05, 1.35]}>
        <mesh>
          <boxGeometry args={[2.2, 0.06, 0.16]} />
          <meshBasicMaterial color="#1e293b" />
        </mesh>
        {progress > 0 ? (
          <mesh position={[-1.1 + (2.2 * progress) / 2, 0.01, 0]}>
            <boxGeometry args={[Math.max(0.02, 2.2 * progress), 0.08, 0.18]} />
            <meshBasicMaterial color={colour} />
          </mesh>
        ) : null}
      </group>

      <Robots count={station.robotCount} running={machine.status === "RUNNING"} colour={colour} />
      {station.inspection.enabled ? <InspectionCamera colour={colour} /> : null}

      {showLabel ? (
        <Html position={[0, 2.5, 0]} center distanceFactor={22} zIndexRange={[20, 0]}>
          <div className="pointer-events-none flex flex-col items-center whitespace-nowrap">
            <span className="font-heading text-[10px] font-semibold">{station.id}</span>
            <span className="text-[9px]" style={{ color: colour }}>
              {state.label}
            </span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

/**
 * The stop beacon.
 *
 * Under `prefers-reduced-motion` the light holds steady instead of pulsing —
 * still unmistakable, without the flashing that triggers people.
 */
function AndonBeacon() {
  const lamp = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  const reduced = usePrefersReducedMotion();

  useFrame((state) => {
    const pulse = reduced ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(state.clock.elapsedTime * 3));
    const lampMaterial = lamp.current?.material as MeshBasicMaterial | undefined;
    if (lampMaterial) lampMaterial.opacity = pulse;
    const ringMaterial = ring.current?.material as MeshBasicMaterial | undefined;
    if (ringMaterial) ringMaterial.opacity = 0.25 + pulse * 0.45;
  });

  return (
    <group>
      <mesh position={[1.05, 1.9, 1.05]}>
        <cylinderGeometry args={[0.05, 0.05, 1.2, 6]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh ref={lamp} position={[1.05, 2.62, 1.05]}>
        <sphereGeometry args={[0.24, 12, 12]} />
        <meshBasicMaterial color={TONE.critical.hex} transparent opacity={1} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[2.1, 2.9, 40]} />
        <meshBasicMaterial color={TONE.critical.hex} transparent opacity={0.5} depthWrite={false} />
      </mesh>
      <Html position={[0, 3.15, 0]} center distanceFactor={20} zIndexRange={[40, 0]}>
        <span className="bg-status-critical text-background pointer-events-none rounded px-1.5 py-0.5 text-[10px] font-bold tracking-widest whitespace-nowrap">
          DURUŞ
        </span>
      </Html>
    </group>
  );
}

/** Robot arms sweep only while the station is actually running. */
function Robots({ count, running, colour }: { count: number; running: boolean; colour: string }) {
  const group = useRef<Group>(null);
  const arms = Math.min(count, 4);

  useFrame((state) => {
    if (!group.current) return;
    const sweep = running ? Math.sin(state.clock.elapsedTime * 1.6) * 0.5 : 0;
    group.current.children.forEach((child, index) => {
      child.rotation.y = sweep * (index % 2 === 0 ? 1 : -1);
    });
  });

  if (arms === 0) return null;

  return (
    <group ref={group} position={[0, 1.2, 0]}>
      {Array.from({ length: arms }, (_unused, index) => {
        const side = index < 2 ? -1 : 1;
        const offset = index % 2 === 0 ? -0.7 : 0.7;
        return (
          <group key={index} position={[offset, 0, side * 1.5]}>
            <mesh position={[0, 0.25, 0]}>
              <cylinderGeometry args={[0.12, 0.16, 0.5, 8]} />
              <meshStandardMaterial color="#3b4a68" roughness={0.6} metalness={0.4} />
            </mesh>
            <mesh position={[0, 0.6, -side * 0.35]} rotation={[side * 0.7, 0, 0]}>
              <boxGeometry args={[0.16, 0.16, 0.9]} />
              <meshStandardMaterial color="#4a5b7d" roughness={0.5} metalness={0.5} />
            </mesh>
            <mesh position={[0, 0.9, -side * 0.7]}>
              <sphereGeometry args={[0.1, 8, 8]} />
              <meshBasicMaterial color={running ? colour : "#334155"} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** A camera body over the gate, with the volume it inspects. */
function InspectionCamera({ colour }: { colour: string }) {
  return (
    <group position={[0, 0, -1.5]}>
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 3.2, 6]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[0, 3.1, 0.3]}>
        <boxGeometry args={[0.35, 0.28, 0.5]} />
        <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 2.0, 0.9]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[1.1, 2.2, 4, 1, true]} />
        <meshBasicMaterial color={colour} transparent opacity={0.07} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Moving entities
// ---------------------------------------------------------------------------

function Units({
  frame,
  config,
  onSelectProduct,
  reducedMotion,
}: FactorySceneProps & { reducedMotion: boolean }) {
  const placed = useMemo(() => placeUnits(config, frame), [config, frame]);

  return (
    <group>
      {placed.map((unit) => (
        <UnitMesh
          key={unit.id}
          unit={unit}
          reducedMotion={reducedMotion}
          onSelect={() => onSelectProduct(unit.id)}
        />
      ))}
    </group>
  );
}

/**
 * The car itself, loaded once and cloned per unit.
 *
 * `placeUnits` reports a slot height of 0.55, which was tuned for the old
 * 0.3-high box. The body is offset so its wheels meet the belt rather than
 * hovering above it or sinking through it.
 */
function VehicleBody() {
  const model = useModel(MODEL.vehicle);
  return (
    <primitive object={model} scale={ASSET_SCALE * 0.62} position={[0, BELT_HEIGHT - 0.55, 0]} />
  );
}

/**
 * A vehicle body.
 *
 * The mesh eases toward the position the twin published rather than jumping to
 * it, so a unit moving from a buffer into a station reads as travel. The target
 * is always the reported state; the easing only fills the gap between ticks.
 */
function UnitMesh({
  unit,
  reducedMotion,
  onSelect,
}: {
  unit: PlacedUnit;
  reducedMotion: boolean;
  onSelect: () => void;
}) {
  const group = useRef<Group>(null);
  const settled = useRef(false);
  const [hovered, setHovered] = useState(false);
  const colour = TONE[unit.tone].hex;

  useFrame((_state, delta) => {
    const node = group.current;
    if (!node) return;
    const [tx, ty, tz] = unit.position;
    if (!settled.current || reducedMotion) {
      node.position.set(tx, ty, tz);
      settled.current = true;
      return;
    }
    const factor = 1 - Math.exp(-8 * delta);
    node.position.x += (tx - node.position.x) * factor;
    node.position.y += (ty - node.position.y) * factor;
    node.position.z += (tz - node.position.z) * factor;
  });

  return (
    <group
      ref={group}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {/* An actual car body. The status colour moved off the paintwork and
          onto a floor pad underneath, because a vehicle that turns red is
          read as "painted red", not as "in trouble". */}
      <Suspense fallback={null}>
        <VehicleBody />
      </Suspense>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, BELT_HEIGHT - 0.54, 0]}>
        <planeGeometry args={[2.4, 1.5]} />
        <meshBasicMaterial
          color={colour}
          transparent
          opacity={hovered ? 0.85 : unit.active ? 0.6 : 0.32}
        />
      </mesh>
      {unit.reworkCount > 0 ? (
        <mesh position={[0, 0.45, 0]}>
          <sphereGeometry args={[0.09, 8, 8]} />
          <meshBasicMaterial color={TONE.risk.hex} />
        </mesh>
      ) : null}
      {hovered ? (
        <Html position={[0, 0.7, 0]} center distanceFactor={16} zIndexRange={[30, 0]}>
          <div className="bg-popover pointer-events-none rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap">
            <span className="tabular">{unit.id}</span>
            <span className="text-muted-foreground"> · {unit.status}</span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

/**
 * Doli arabaları — iç lojistik taşıma arabaları.
 *
 * Hücrelere parça besleyen şey bunlar. Güzergâh rastgele değil ve hep aynı
 * yönde: **iç lojistik deposu → ilgili hücrenin hat kenarı**. Bunu motor
 * belirliyor (`assignMoveTasks`), sahne yalnızca çiziyor — yani bir doli asla
 * gitmesi gereken yerden başka bir yere gitmiyor.
 *
 * Önceden düz bir kutuydu. Araba, çeki oku ve tekerlekleriyle araba.
 */
function Agvs({ frame, config }: { frame: FactoryFrame; config: FactoryDescriptor }) {
  const placed = useMemo(() => placeAgvs(config, frame), [config, frame]);

  return (
    <Suspense fallback={null}>
      <group>
        {placed.map((agv) => (
          <group key={agv.id} position={agv.position} rotation={[0, agv.heading, 0]}>
            <TugCart />
            {agv.loaded ? (
              <mesh position={[0, 0.62 * ASSET_SCALE, 0]}>
                <boxGeometry args={[1.3 * ASSET_SCALE, 0.7 * ASSET_SCALE, 0.9 * ASSET_SCALE]} />
                {/* Yük lojistik mavisi: hareket eden malzeme, makine durumu
                    değil. */}
                <meshStandardMaterial color={TONE.logistics.hex} roughness={0.6} metalness={0.2} />
              </mesh>
            ) : null}
          </group>
        ))}
      </group>
    </Suspense>
  );
}

function TugCart() {
  const model = useModel(MODEL.tugCart);
  return <primitive object={model} scale={ASSET_SCALE} />;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/**
 * Sisi ve görüş menzilini sahnenin boyutuna göre ayarlar.
 *
 * Sabit değerlerle yazılmıştı ve kamera geriye çekildiğinde tesisin tamamı
 * sisin ötesinde kalıyordu: sahne çiziliyor, ekranda tek renk boşluk
 * görünüyordu. En sinsi hata türü — hiçbir yerde hata mesajı yok.
 */
function SceneDepth({ config }: { config: FactoryDescriptor }) {
  const aspect = useThree((state) => state.size.width / state.size.height);
  const { fogNear, fogFar } = useMemo(() => sceneDepth(config, aspect), [config, aspect]);

  return <fog attach="fog" args={["#14121f", fogNear, fogFar]} />;
}

function BookmarkCamera({
  config,
  bookmark,
  reducedMotion,
}: {
  config: FactoryDescriptor;
  bookmark: string;
  reducedMotion: boolean;
}) {
  // Ref değil state: kontrol bağlandığı anda efektin *yeniden* çalışması
  // gerekiyor. Ref ile ilk çalışmada `controls.current` henüz null oluyordu ve
  // efekt sessizce vazgeçiyordu — sayfa açıldığında sahne varsayılan görünüme
  // hiç gitmiyor, `Canvas` üzerindeki başlangıç kamerasında kalıyordu.
  const [controls, setControls] = useState<CameraControls | null>(null);
  // Çerçeveleme ekran oranına bağlı: dar bir pencerede kamera daha geriden
  // bakmak zorunda. Sabit bir oran varsayıldığında dikey bir panelde tesis
  // tamamen ekran dışında kalıyordu.
  const aspect = useThree((state) => state.size.width / state.size.height);
  const bookmarks = useMemo(() => cameraBookmarks(config, aspect), [config, aspect]);
  const maxDistance = useMemo(() => maxCameraDistance(config, aspect), [config, aspect]);

  // İlk yerleştirme animasyonsuz.
  //
  // Animasyonlu çağrı, kontrol daha yeni bağlanmışken sessizce boşa gidiyordu:
  // sayfa açılıyor, "Genel" seçili görünüyor, ekran boş kalıyordu. Zaten
  // doğrusu da bu — açılışta kameranın bir yerden uçarak gelmesi için bir sebep
  // yok; uçuş yalnızca görünümler *arasında* geçerken anlamlı.
  const yerlesti = useRef(false);

  useEffect(() => {
    const target = bookmarks.find((candidate) => candidate.id === bookmark) ?? bookmarks[0];
    if (!target || !controls) return;
    const [px, py, pz] = target.position;
    const [tx, ty, tz] = target.target;
    const gecis = yerlesti.current && !reducedMotion;
    yerlesti.current = true;
    void controls.setLookAt(px, py, pz, tx, ty, tz, gecis);
  }, [bookmark, bookmarks, controls, reducedMotion]);

  return (
    <CameraControls
      ref={setControls}
      makeDefault
      minDistance={3}
      maxDistance={maxDistance}
      maxPolarAngle={Math.PI / 2.15}
      smoothTime={reducedMotion ? 0 : 0.35}
    />
  );
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The media query is an external store, so it is read through
 * `useSyncExternalStore` rather than mirrored into state. Reduced motion here
 * means real suppression: units snap to their published position instead of
 * easing, and camera moves are instant.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}
