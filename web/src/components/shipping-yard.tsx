"use client";

import { Html } from "@react-three/drei";
import { useMemo } from "react";

import { ASSET_SCALE, MODEL, useModel } from "@/components/factory-models";
import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame } from "@/lib/contract";
import { placeCarriers, shippingBuildingPlacement, type PlacedCarrier } from "@/lib/scene-layout";
import { SHIPMENT_STATE, TONE } from "@/lib/status";

/**
 * Sevkiyat sahası: bitmiş araçları alıp götüren oto taşıyıcılar.
 *
 * Taşıyıcı sahneye konmuş bir nesne değil, **sevkiyatın kendisi**. Üstündeki
 * araç sayısı sevkiyatın gerçek yük listesi kadar; iki araç yüklendiyse
 * taşıyıcıda iki araba var. Yükleme bitmeden yola çıkmıyor ve teslim edilince
 * sahneden çıkıyor — teslim edilmiş bir sevkiyat artık fabrikada değildir.
 *
 * Kapalı dorse yerine açık kafes: bitmiş araba kapalı kasada gitmez, ve
 * fabrikadan çıkanın ne olduğu uzaktan görünmeli.
 */
export function ShippingYard({
  frame,
  config,
  showLabels,
}: {
  frame: FactoryFrame;
  config: FactoryDescriptor;
  showLabels: boolean;
}) {
  const carriers = useMemo(() => placeCarriers(config, frame), [config, frame]);
  const building = useMemo(() => shippingBuildingPlacement(config), [config]);

  return (
    <group>
      <ShippingBuilding position={building} />
      {carriers.map((carrier) => (
        <Carrier key={carrier.id} carrier={carrier} showLabels={showLabels} />
      ))}
    </group>
  );
}

/**
 * Sevkiyat binası — mal kabulle aynı mantık, ters yön.
 *
 * Sevkiyat da bağımsız bir alan olmalıydı: bitmiş ürün deposundan ayrı, kendi
 * cephesi, kendi kapıları ve kendi manevra sahasıyla. Kapılar +X'e bakıyor,
 * çünkü araç fabrikadan o yöne çıkıyor.
 */
function ShippingBuilding({ position }: { position: readonly [number, number, number] }) {
  const model = useModel(MODEL.shippingBuilding);
  return <primitive object={model} position={[position[0], 0, position[2]]} scale={ASSET_SCALE} />;
}

function Carrier({ carrier, showLabels }: { carrier: PlacedCarrier; showLabels: boolean }) {
  const model = useModel(MODEL.carrier);
  const state = SHIPMENT_STATE[carrier.status];

  return (
    <group position={carrier.position} rotation={[0, carrier.heading, 0]}>
      <primitive object={model} scale={ASSET_SCALE} />

      {/* Yüklenmiş araçlar. Sayı uydurulmuyor: sevkiyatın kendi listesi. */}
      {Array.from({ length: Math.min(carrier.loaded, 4) }, (_, index) => (
        <LoadedVehicle key={index} index={index} />
      ))}

      {showLabels ? (
        <Html position={[0, 4.4, 0]} center distanceFactor={30} zIndexRange={[10, 0]}>
          <div className="pointer-events-none rounded border border-white/15 bg-black/70 px-1.5 py-0.5 text-center whitespace-nowrap">
            <div className="text-[10px] leading-tight font-semibold text-white">
              {carrier.loaded}/{carrier.capacity} araç
            </div>
            <div className="text-[9px] leading-tight" style={{ color: TONE[state.tone].hex }}>
              {state.label} · {carrier.destination}
            </div>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

/**
 * Taşıyıcının üstündeki bir araç.
 *
 * İlk ikisi alt kata, sonraki ikisi üst kata. Gerçek bir oto taşıyıcı da böyle
 * yüklenir: alt kat önce dolar, üst kat rampayla.
 */
function LoadedVehicle({ index }: { index: number }) {
  const model = useModel(MODEL.vehicle);
  const upper = index >= 2;
  // Modelde alt kat 0.88 m, üst kat 2.7 m yükseklikte.
  const deck = (upper ? 2.8 : 0.98) * ASSET_SCALE;
  const along = (index % 2 === 0 ? 1.1 : -2.6) * ASSET_SCALE;

  return <primitive object={model} position={[along, deck, 0]} scale={ASSET_SCALE * 0.52} />;
}
