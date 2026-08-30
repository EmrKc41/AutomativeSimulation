"use client";

import { Html } from "@react-three/drei";
import { useMemo } from "react";

import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame } from "@/lib/contract";
import { ASSET_SCALE, MODEL, useModel } from "@/components/factory-models";
import { dockPlacement, placeTrucks, type PlacedTruck } from "@/lib/scene-layout";
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

  return (
    <group>
      <Dock position={dock} />
      {trucks.map((truck) => (
        <Truck key={truck.id} truck={truck} showLabels={showLabels} />
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
      position={[position[0], 0, position[2] + 4]}
      scale={ASSET_SCALE}
      rotation={[0, Math.PI / 2, 0]}
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
