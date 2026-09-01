"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group } from "three";

import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame } from "@/lib/contract";
import { ASSET_SCALE, MODEL, SecurityGate, useModel } from "@/components/factory-models";
import {
  dockPlacement,
  incomingQcPlacement,
  entryGateOpenness,
  forkliftAt,
  placeForklifts,
  placeTrucks,
  productionGatePlacement,
  quarantinePlacement,
  securityGatePlacement,
  type PlacedForklift,
  type PlacedTruck,
} from "@/lib/scene-layout";
import { TONE } from "@/lib/status";

/**
 * Mal kabul sahası: rampa ve gelen tırlar.
 *
 * Buradaki her nesnenin motorda bir karşılığı var. Tır bir süs değil, teslimatı
 * getiren şeyin kendisi: boşaltması bitmeden depoya stok düşmüyor, çünkü
 * gerçekte de düşmüyor. Sahnedeki durumu (`ARRIVING` / `DOCKED` / `UNLOADING`)
 * motorun yayınladığı durumun aynısı; bu bileşen hiçbir aşama uydurmuyor.
 *
 * Modeller Blender ile üretiliyor (`npm run models`). `.glb` dosyaları depoda
 * duruyor, yani projeyi çalıştırmak için Blender gerekmiyor — yalnızca modeli
 * değiştirecekseniz gerekiyor.
 */

export function ReceivingYard({
  frame,
  config,
  showLabels,
  reducedMotion,
}: {
  frame: FactoryFrame;
  config: FactoryDescriptor;
  showLabels: boolean;
  reducedMotion: boolean;
}) {
  const trucks = useMemo(() => placeTrucks(config, frame), [config, frame]);
  const dock = useMemo(() => dockPlacement(config), [config]);
  const qc = useMemo(() => incomingQcPlacement(config), [config]);
  const quarantine = useMemo(() => quarantinePlacement(config), [config]);
  const gate = useMemo(() => productionGatePlacement(config), [config]);
  const security = useMemo(() => securityGatePlacement(config), [config]);
  // Bariyerin açıklığı uydurulmuyor: yolda kapıya yaklaşan tırın konumundan
  // hesaplanıyor, yani kol gerçekten geçen bir araç için kalkıyor.
  const gateOpen = useMemo(() => entryGateOpenness(config, frame), [config, frame]);
  // Tır köşede duruyor; malzemeyi içeri forklift taşıyor.
  const forklifts = useMemo(() => placeForklifts(config, frame), [config, frame]);

  // Karantinadaki parti sayısı — boşsa alan da boş görünmeli.
  const quarantined = frame.inventory.filter((balance) => balance.status === "QUARANTINE").length;

  return (
    <group>
      <SecurityGate
        position={security}
        passageAxis="z"
        openness={gateOpen}
        reducedMotion={reducedMotion}
      />
      <Dock position={dock} />
      <IncomingQc position={qc} />
      <ProductionGate position={gate} />
      <Quarantine position={quarantine} lots={quarantined} />
      {trucks.map((truck) => (
        <Truck key={truck.id} truck={truck} showLabels={showLabels} />
      ))}
      {forklifts.map((forklift) => (
        <Forklift key={forklift.id} forklift={forklift} />
      ))}
    </group>
  );
}

/**
 * Giriş kalite kontrol.
 *
 * Mal kabulden çıkan malzeme doğrudan depoya gitmez; akış
 * **mal kabul → giriş kalite → depo**. Tezgâh hattın kenarında, gelen malın
 * yanında — girdi kalitesi kapalı bir laboratuvarda değil, sahada yapılır.
 */
function IncomingQc({ position }: { position: readonly [number, number, number] }) {
  const bench = useModel(MODEL.qcBench);
  const inspector = useModel(MODEL.operator);
  return (
    <group position={[position[0], 0, position[2]]}>
      <primitive object={bench} scale={ASSET_SCALE} />
      <primitive
        object={inspector}
        position={[0, 0, 1.5]}
        rotation={[0, Math.PI, 0]}
        scale={ASSET_SCALE}
      />
    </group>
  );
}

/**
 * Onaylanan malzemenin üretime geçtiği açıklık.
 *
 * Giriş kalitesinden çıkan mal buradan hatta giriyor. Bu nokta planda yoktu ve
 * kontrol edilen malzeme sanki havada üretime ışınlanıyordu; onaylanan malın
 * nereden içeri girdiği görünmüyordu.
 */
function ProductionGate({ position }: { position: readonly [number, number, number] }) {
  const model = useModel(MODEL.productionGate);
  return <primitive object={model} position={[position[0], 0, position[2]]} scale={ASSET_SCALE} />;
}

/**
 * Karantina alanı.
 *
 * Giriş kalitesinden geçemeyen parti buraya alınır — akışın bir durağı değil,
 * kalitenin **sonucu**. Bu yüzden kapıda değil, kontrolün yanında duruyor.
 * Boşken yalnızca zemin işareti görünüyor: dolu bir karantina, boş bir
 * karantinadan bakışta ayırt edilebilmeli.
 */
function Quarantine({
  position,
  lots,
}: {
  position: readonly [number, number, number];
  lots: number;
}) {
  const pallet = useModel(MODEL.pallet);
  return (
    <group position={[position[0], 0, position[2]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <planeGeometry args={[9, 7]} />
        <meshBasicMaterial color={TONE.critical.hex} transparent opacity={0.12} />
      </mesh>
      {Array.from({ length: Math.min(lots, 4) }, (_, index) => (
        <primitive
          key={index}
          object={index === 0 ? pallet : pallet.clone(true)}
          position={[(index % 2) * 2 - 1, 0, Math.floor(index / 2) * 2 - 1]}
          scale={ASSET_SCALE}
        />
      ))}
    </group>
  );
}

function Dock({ position }: { position: readonly [number, number, number] }) {
  // Her rampa aynı geometriyi paylaşsın diye klonlanıyor; tek rampa var ama
  // ikincisi eklendiğinde bu satır değişmeyecek.
  const model = useModel(MODEL.dock);
  return (
    <primitive
      object={model}
      position={[position[0], 0, position[2]]}
      scale={ASSET_SCALE}
      // Cephe -X'e bakıyor: mal kabul tesisin en dışı ve tırlar oradan geliyor.
      rotation={[0, Math.PI, 0]}
    />
  );
}

function Truck({ truck, showLabels }: { truck: PlacedTruck; showLabels: boolean }) {
  const model = useModel(MODEL.truck);

  return (
    <group position={truck.position} rotation={[0, truck.heading, 0]}>
      <primitive object={model} scale={ASSET_SCALE} />

      {showLabels ? (
        <Html position={[0, 2.6, 0]} center distanceFactor={26} zIndexRange={[10, 0]}>
          <div className="pointer-events-none rounded border border-white/15 bg-black/70 px-1.5 py-0.5 text-center whitespace-nowrap">
            <div className="text-[10px] leading-tight font-semibold text-white">{truck.id}</div>
            <div className="text-[9px] leading-tight" style={{ color: TONE[truckTone(truck)].hex }}>
              {TRUCK_TEXT[truck.status]}
            </div>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

/**
 * Forklift: malzemeyi tırdan mal kabule taşıyan şey.
 *
 * Önceden palet, dorsenin arkasından rampaya doğru kendi kendine kayıyordu —
 * kodun yorumu bunu "forklift modellenmiş değil, olmayan bir şeyi ima
 * etmemeli" diye kabul ediyordu. Artık taşıyan şey belli, ve seferleri
 * motorun saydığı boşaltma dakikaları kadar.
 *
 * Dolu giderken çatalda palet var, boş dönerken yok. Bu ayrım süs değil:
 * hangi yönün iş, hangisinin dönüş olduğunu söyleyen tek şey.
 */
function Forklift({ forklift }: { forklift: PlacedForklift }) {
  const model = useModel(MODEL.forklift);
  const pallet = useModel(MODEL.pallet);
  const govde = useRef<Group>(null);
  const yuk = useRef<Group>(null);

  // Bir gidiş-dönüş bu kadar sürüyor. Motorun modelinde sefer sayısı yok
  // (orada boşaltma tek bir süre), o yüzden tempo burada — ve öyle olduğu
  // `placeForklifts` içinde yazıyor.
  const SEFER_SANIYE = 4.5;

  useFrame((state) => {
    const { position, heading, laden } = forkliftAt(
      forklift,
      state.clock.elapsedTime / SEFER_SANIYE,
    );
    if (govde.current) {
      govde.current.position.set(position[0], position[1], position[2]);
      govde.current.rotation.y = heading;
    }
    if (yuk.current) yuk.current.visible = laden;
  });

  return (
    <group ref={govde}>
      <primitive object={model} scale={ASSET_SCALE} />
      {/* Çatalın üstünde: modelde çatallar +X'te 1.25, yerden 0.2 yükseklikte. */}
      <group ref={yuk} position={[1.25 * ASSET_SCALE, 0.28 * ASSET_SCALE, 0]}>
        <primitive object={pallet} scale={ASSET_SCALE} />
      </group>
    </group>
  );
}

const TRUCK_TEXT: Record<PlacedTruck["status"], string> = {
  ARRIVING: "Yolda",
  DOCKED: "Rampada",
  UNLOADING: "Boşaltılıyor",
  COMPLETED: "Tamamlandı",
};

/**
 * Renk operasyonel anlam taşır, dekor değil.
 *
 * Boşaltma bitene kadar mavi (lojistik hareketi). Bittikten sonra girdi
 * kalitesinin kararı: kabul yeşil, karantina kırmızı. Bir operatör rampaya
 * bakıp partinin geçip geçmediğini görebilmeli.
 */
function truckTone(truck: PlacedTruck): "logistics" | "ok" | "critical" {
  if (truck.status !== "COMPLETED") return "logistics";
  return truck.accepted === false ? "critical" : "ok";
}
