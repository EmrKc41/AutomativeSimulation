"use client";

import { Html, useGLTF } from "@react-three/drei";
import { useMemo } from "react";

import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame } from "@/lib/contract";
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

const MODEL_TRUCK = "/models/tir.glb";
const MODEL_DOCK = "/models/rampa.glb";
const MODEL_PALLET = "/models/palet.glb";

// Sahne birimleri: varlıklar metre ölçeğinde modellendi, saha ondan küçük.
const ASSET_SCALE = 0.42;

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
  const { scene } = useGLTF(MODEL_DOCK);
  // Her rampa aynı geometriyi paylaşsın diye klonlanıyor; tek rampa var ama
  // ikincisi eklendiğinde bu satır değişmeyecek.
  const model = useMemo(() => scene.clone(true), [scene]);
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
  const { scene } = useGLTF(MODEL_TRUCK);
  const model = useMemo(() => scene.clone(true), [scene]);

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
  const { scene } = useGLTF(MODEL_PALLET);
  const model = useMemo(() => scene.clone(true), [scene]);
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

// Modeller sahne açılırken bir kez indirilsin; ilk tır geldiğinde beklenmesin.
useGLTF.preload(MODEL_TRUCK);
useGLTF.preload(MODEL_DOCK);
useGLTF.preload(MODEL_PALLET);
