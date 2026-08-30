"use client";

import { Html } from "@react-three/drei";
import { useMemo } from "react";

import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame } from "@/lib/contract";
import { ASSET_SCALE, MODEL, useModel } from "@/components/factory-models";
import {
  dockPlacement,
  incomingQcPlacement,
  placeTrucks,
  quarantinePlacement,
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
}: {
  frame: FactoryFrame;
  config: FactoryDescriptor;
  showLabels: boolean;
}) {
  const trucks = useMemo(() => placeTrucks(config, frame), [config, frame]);
  const dock = useMemo(() => dockPlacement(config), [config]);
  const qc = useMemo(() => incomingQcPlacement(config), [config]);
  const quarantine = useMemo(() => quarantinePlacement(config), [config]);

  // Karantinadaki parti sayısı — boşsa alan da boş görünmeli.
  const quarantined = frame.inventory.filter((balance) => balance.status === "QUARANTINE").length;

  return (
    <group>
      <Dock position={dock} />
      <IncomingQc position={qc} />
      <Quarantine position={quarantine} lots={quarantined} />
      {trucks.map((truck) => (
        <Truck key={truck.id} truck={truck} showLabels={showLabels} />
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

  // Boşaltılan yük: ilerlemeye göre tırdan rampaya taşınıyor. Tek palet
  // gösteriliyor çünkü söylenen şey "boşaltılıyor", "kaç palet" değil.
  const unloading = truck.status === "UNLOADING";

  return (
    <group position={truck.position} rotation={[0, truck.heading, 0]}>
      <primitive object={model} scale={ASSET_SCALE} />

      {unloading ? <UnloadedPallet progress={truck.unloadProgress} /> : null}

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

/** Boşaltılan palet: dorseden rampaya doğru kayıyor. */
function UnloadedPallet({ progress }: { progress: number }) {
  const model = useModel(MODEL.pallet);
  // Dorsenin arkasından çıkıp rampanın üstüne: yalnızca yatayda hareket,
  // çünkü forklift modellenmiş değil ve olmayan bir şeyi ima etmemeli.
  const z = -1.4 - progress * 2.2;
  return <primitive object={model} position={[-1.6, 0.5, z]} scale={ASSET_SCALE} />;
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
