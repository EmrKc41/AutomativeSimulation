"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group, Object3D } from "three";

/**
 * Blender'da üretilmiş fabrika varlıkları.
 *
 * Sahnedeki her makine bir kutuydu; pres ile boyahane arasındaki fark yalnızca
 * etiketti. Şartnamenin istediği bu değil ve haklı olarak da değil: presse
 * bakan biri presi görmeli.
 *
 * Modeller `tools/models/build_assets.py` içinde kod olarak duruyor,
 * `npm run models` ile üretiliyor. `.glb` dosyaları depoda; projeyi çalıştırmak
 * için Blender gerekmiyor.
 *
 * **Hangi model nereye:** istasyonun `workCenter` alanına göre seçiliyor, id'ye
 * göre değil. Rotaya yeni bir kaynak istasyonu eklendiğinde tek satır kod
 * yazmadan doğru modeli alıyor — şartnamenin "mimari yeni istasyonların kolayca
 * eklenmesine uygun olmalı" maddesi bunu gerektiriyor.
 */

export const MODEL = {
  truck: "/models/tir.glb",
  carrier: "/models/oto-tasiyici.glb",
  qcBench: "/models/iqc-masa.glb",
  productionGate: "/models/gecis.glb",
  shippingBuilding: "/models/sevkiyat.glb",
  tugCart: "/models/doli.glb",
  dock: "/models/rampa.glb",
  pallet: "/models/palet.glb",
  rack: "/models/raf.glb",
  conveyor: "/models/konveyor.glb",
  press: "/models/pres.glb",
  pressRam: "/models/pres-koc.glb",
  robot: "/models/robot.glb",
  paintBooth: "/models/boyahane.glb",
  gantry: "/models/montaj.glb",
  qualityGate: "/models/kalite.glb",
  reworkCell: "/models/tamir.glb",
  operator: "/models/operator.glb",
  vehicle: "/models/arac.glb",
} as const;

/**
 * Blender +Z yukarı çalışır, glTF ve Three.js +Y yukarı.
 *
 * Dışa aktarım `export_yup` ile bunu çeviriyor, yani modeller doğru yönde
 * geliyor. Buradaki ölçek yalnızca metre cinsinden modellenmiş varlıkları
 * sahnenin daha küçük birimine indiriyor.
 */
export const ASSET_SCALE = 1.05;

/**
 * Konveyör bandının yüksekliği, sahne biriminde.
 *
 * Araç bandın *üstünde* durmalı. İlk sürümde zemine konulmuştu ve gövde
 * banda gömülü göründü — kaporta yerine düz bir plaka gibi.
 */
export const BELT_HEIGHT = 0.68 * ASSET_SCALE;

/**
 * Aynı geometriyi paylaşan bağımsız bir kopya, gölgeye açılmış hâlde.
 *
 * glTF'ten gelen mesh'ler varsayılan olarak gölge vermez ve almaz; işaretlemek
 * gerekiyor. Bunu unutmak sahneyi "ışık var ama hiçbir şey gölge yapmıyor"
 * hâline sokar ve nesneler zeminin üstünde yüzüyormuş gibi durur.
 */
export function useModel(url: string): Object3D {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const copy = scene.clone(true);
    copy.traverse((node) => {
      if (!(node as { isMesh?: boolean }).isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
    });
    return copy;
  }, [scene]);
}

/**
 * İş merkezine göre makine gövdesi.
 *
 * `Pres` → pres, `Gövde` → kaynak robotları, `Boya` → kabin, `Montaj` → köprü,
 * `Kalite` → kapı, `Tamir` → tezgâh alanı. Tanımadığı bir iş merkezi için
 * konveyör dönüyor: yeni bir istasyon eklendiğinde sahne boş kalmıyor, hattın
 * bir parçası gibi duruyor ve modeli sonra eklenebiliyor.
 */
export function StationBody({
  workCenter,
  running,
  progress,
  reducedMotion,
}: {
  workCenter: string;
  running: boolean;
  progress: number;
  reducedMotion: boolean;
}) {
  switch (workCenter) {
    case "Pres":
      return <PressBody running={running} progress={progress} reducedMotion={reducedMotion} />;
    case "Gövde":
      return <WeldCell running={running} reducedMotion={reducedMotion} />;
    case "Boya":
      return <PaintBooth running={running} reducedMotion={reducedMotion} />;
    case "Montaj":
      return <AssemblyBay running={running} reducedMotion={reducedMotion} />;
    case "Kalite":
      return <QualityGate />;
    case "Tamir":
      return <ReworkCell />;
    default:
      return <Simple url={MODEL.conveyor} />;
  }
}

function Simple({ url, position }: { url: string; position?: [number, number, number] }) {
  const model = useModel(url);
  return <primitive object={model} position={position ?? [0, 0, 0]} scale={ASSET_SCALE} />;
}

/**
 * Pres: gövde sabit, koç kafası çalışırken iniyor.
 *
 * Hareket süslemek için değil, operasyonu göstermek için: koç aşağıdayken sac
 * şekilleniyor. Hız istasyonun kendi ilerlemesinden geliyor, sabit bir
 * animasyondan değil — duran bir pres duruyor.
 */
function PressBody({
  running,
  progress,
  reducedMotion,
}: {
  running: boolean;
  progress: number;
  reducedMotion: boolean;
}) {
  const body = useModel(MODEL.press);
  const ram = useModel(MODEL.pressRam);
  const ramRef = useRef<Group>(null);

  useFrame(() => {
    const node = ramRef.current;
    if (!node) return;
    // Bir çevrimde bir kez in-çık: ilerlemenin sinüsü, tepe noktada aşağıda.
    const stroke = running && !reducedMotion ? Math.sin(progress * Math.PI) : 0;
    node.position.y = (1.35 - stroke * 0.78) * ASSET_SCALE;
  });

  return (
    <group>
      <primitive object={body} scale={ASSET_SCALE} />
      <group ref={ramRef}>
        <primitive object={ram} scale={ASSET_SCALE} />
      </group>
    </group>
  );
}

/**
 * Kaynak hücresi: iki robot, karşılıklı.
 *
 * Gerçek bir gövde hattında robotlar aracın iki yanında durur ve aynı noktaya
 * farklı açılardan gelir. Karşılıklı yerleştirme bunu anlatıyor.
 */
function WeldCell({ running, reducedMotion }: { running: boolean; reducedMotion: boolean }) {
  return (
    <group>
      <Simple url={MODEL.conveyor} />
      <RobotArm
        position={[-0.1, 0, 1.35]}
        rotation={-Math.PI / 2}
        running={running}
        reducedMotion={reducedMotion}
        phase={0}
      />
      <RobotArm
        position={[-0.1, 0, -1.35]}
        rotation={Math.PI / 2}
        running={running}
        reducedMotion={reducedMotion}
        phase={Math.PI}
      />
      <Operator position={[1.6, 0, 1.7]} />
    </group>
  );
}

/**
 * Robot kolu.
 *
 * Çalışırken gövdesi ekseni etrafında salınıyor — sabit bir açıyla duran kol
 * heykel gibi görünür. Salınım küçük ve yavaş: robot kolu hızlı savrulmaz,
 * noktadan noktaya gider.
 */
export function RobotArm({
  position,
  rotation,
  running,
  reducedMotion,
  phase = 0,
}: {
  position: [number, number, number];
  rotation: number;
  running: boolean;
  reducedMotion: boolean;
  phase?: number;
}) {
  const model = useModel(MODEL.robot);
  const group = useRef<Group>(null);

  useFrame((state) => {
    const node = group.current;
    if (!node) return;
    if (!running || reducedMotion) {
      node.rotation.y = rotation;
      return;
    }
    node.rotation.y = rotation + Math.sin(state.clock.elapsedTime * 1.4 + phase) * 0.34;
  });

  return (
    <group ref={group} position={position} rotation={[0, rotation, 0]}>
      <primitive object={model} scale={ASSET_SCALE} />
    </group>
  );
}

/** Boya kabini: içeride bir boya robotu, dışarıda kabuk. */
function PaintBooth({ running, reducedMotion }: { running: boolean; reducedMotion: boolean }) {
  return (
    <group>
      <Simple url={MODEL.paintBooth} />
      <RobotArm
        position={[-0.5, 0, 0.85]}
        rotation={-Math.PI / 2}
        running={running}
        reducedMotion={reducedMotion}
      />
    </group>
  );
}

/** Montaj: üstten köprü, hat üstünde konveyör, yanda iki operatör. */
function AssemblyBay({ running, reducedMotion }: { running: boolean; reducedMotion: boolean }) {
  return (
    <group>
      <Simple url={MODEL.conveyor} />
      <Simple url={MODEL.gantry} />
      <RobotArm
        position={[-1.5, 0, -1.3]}
        rotation={Math.PI / 2}
        running={running}
        reducedMotion={reducedMotion}
      />
      <Operator position={[1.5, 0, 1.5]} />
      <Operator position={[-0.2, 0, 1.7]} />
    </group>
  );
}

/** Kalite kapısı: araç altından geçiyor, yanında kontrolör. */
function QualityGate() {
  return (
    <group>
      <Simple url={MODEL.conveyor} />
      <Simple url={MODEL.qualityGate} />
      <Operator position={[1.4, 0, 1.5]} />
    </group>
  );
}

/** Tamir hücresi: açık tezgâh alanı ve iki tamirci. */
function ReworkCell() {
  return (
    <group>
      <Simple url={MODEL.reworkCell} />
      <Operator position={[-0.6, 0, 1.1]} />
      <Operator position={[0.9, 0, -1.1]} />
    </group>
  );
}

/** İnsan silüeti. Sabit duruyor: yürüyen bir figür yanlış bilgi verirdi. */
export function Operator({ position }: { position: [number, number, number] }) {
  const model = useModel(MODEL.operator);
  return (
    <primitive object={model} position={position} scale={ASSET_SCALE} rotation={[0, Math.PI, 0]} />
  );
}

// Sahne açılırken hepsi bir kez indirilsin; istasyon görünür olduğunda beklenmesin.
for (const url of Object.values(MODEL)) useGLTF.preload(url);
