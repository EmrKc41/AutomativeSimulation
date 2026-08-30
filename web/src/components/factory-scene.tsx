"use client";

import { CameraControls, Grid, Html } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Group, Mesh, MeshBasicMaterial } from "three";

import { ReceivingYard } from "@/components/receiving-yard";
import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame, Machine, StationConfig } from "@/lib/contract";
import {
  SCALE,
  ZONES,
  cameraBookmarks,
  placeAgvs,
  placeUnits,
  planPosition,
  stationWorld,
  toWorld,
  type PlacedUnit,
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

const FLOOR = "#111a2b";

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
      shadows={false}
      dpr={[1, 1.75]}
      camera={{ position: [0, 26, 26], fov: 42, near: 0.1, far: 400 }}
      // A dark room: the scene must sit on the same ground as the rest of the UI.
      onCreated={({ gl }) => gl.setClearColor("#0f172a")}
    >
      <fog attach="fog" args={["#0f172a", 45, 120]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#8ea6c8", "#0b1220", 0.5]} />
      <directionalLight position={[18, 30, 14]} intensity={1.1} />
      <directionalLight position={[-20, 14, -12]} intensity={0.35} color="#7aa2ff" />

      <Ground />
      <Zones showLabels={props.showLabels} />
      <Conveyor config={props.config} />
      <Stations {...props} />
      <Units {...props} reducedMotion={reducedMotion} />
      <Agvs frame={props.frame} config={props.config} />
      {/* Mal kabul: rampa ve gelen tırlar. Blender'da üretilmiş modeller,
          motorun yayınladığı tır durumundan sürülüyor. */}
      <Suspense fallback={null}>
        <ReceivingYard frame={props.frame} config={props.config} showLabels={props.showLabels} />
      </Suspense>
      <Trucks frame={props.frame} config={props.config} />

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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[160, 90]} />
        <meshStandardMaterial color={FLOOR} roughness={1} metalness={0} />
      </mesh>
      <Grid
        position={[0, 0, 0]}
        args={[160, 90]}
        cellSize={SCALE * 5}
        cellColor="#1e293b"
        sectionSize={SCALE * 20}
        sectionColor="#28324a"
        fadeDistance={90}
        fadeStrength={1.5}
        infiniteGrid={false}
      />
    </>
  );
}

function Zones({ showLabels }: { showLabels: boolean }) {
  return (
    <group>
      {ZONES.map((zone) => {
        const [x0, y0, x1, y1] = zone.rect;
        const [wx, , wz] = toWorld((x0 + x1) / 2, (y0 + y1) / 2);
        const width = (x1 - x0) * SCALE;
        const depth = (y1 - y0) * SCALE;
        return (
          <group key={zone.id}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[wx, 0.005, wz]}>
              <planeGeometry args={[width, depth]} />
              <meshBasicMaterial color={TONE[zone.tone].hex} transparent opacity={0.06} />
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

/** The transfer line itself, drawn from the route's first and last station. */
function Conveyor({ config }: { config: FactoryDescriptor }) {
  const first = config.line.route[0];
  const last = config.line.route[config.line.route.length - 1];
  if (!first || !last) return null;
  const [x0, , z] = stationWorld(config, first);
  const [x1] = stationWorld(config, last);
  const length = x1 - x0 + 6;

  return (
    <mesh position={[(x0 + x1) / 2, 0.12, z]}>
      <boxGeometry args={[length, 0.14, 1.5]} />
      <meshStandardMaterial color="#1c2740" roughness={0.9} metalness={0.1} />
    </mesh>
  );
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
}: FactorySceneProps) {
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
  onSelect,
}: {
  station: StationConfig;
  machine: Machine;
  showLabel: boolean;
  selected: boolean;
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
      <mesh
        position={[0, 0.6, 0]}
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
        <boxGeometry args={[2.4, 1.2, 2.4]} />
        <meshStandardMaterial
          color={selected || hovered ? "#3a4a68" : "#243149"}
          roughness={0.7}
          metalness={0.25}
        />
      </mesh>

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
      <mesh>
        <boxGeometry args={[1.05, 0.3, 0.55]} />
        {/* The unit under the tool is lit, so the eye finds the work in progress. */}
        <meshStandardMaterial
          color={colour}
          roughness={0.45}
          metalness={0.35}
          emissive={hovered || unit.active ? colour : "#000000"}
          emissiveIntensity={hovered ? 0.45 : unit.active ? 0.22 : 0}
        />
      </mesh>
      <mesh position={[-0.05, 0.24, 0]}>
        <boxGeometry args={[0.5, 0.22, 0.48]} />
        <meshStandardMaterial color={colour} roughness={0.35} metalness={0.4} />
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

function Agvs({ frame, config }: { frame: FactoryFrame; config: FactoryDescriptor }) {
  const placed = useMemo(() => placeAgvs(config, frame), [config, frame]);

  return (
    <group>
      {placed.map((agv) => (
        <group key={agv.id} position={agv.position} rotation={[0, agv.heading, 0]}>
          <mesh>
            <boxGeometry args={[0.7, 0.16, 0.5]} />
            <meshStandardMaterial
              color={agv.moving ? TONE.logistics.hex : "#334155"}
              roughness={0.5}
              metalness={0.3}
            />
          </mesh>
          {agv.loaded ? (
            <mesh position={[0, 0.22, 0]}>
              <boxGeometry args={[0.42, 0.28, 0.38]} />
              <meshStandardMaterial color="#8b5cf6" roughness={0.7} />
            </mesh>
          ) : null}
        </group>
      ))}
    </group>
  );
}

/** One carrier per shipment being loaded or dispatched from the yard. */
function Trucks({ frame, config }: { frame: FactoryFrame; config: FactoryDescriptor }) {
  const yard = frame.shipments
    .filter((shipment) => shipment.status === "LOADING" || shipment.status === "DISPATCHED")
    .slice(-2);
  const [planX, planY] = planPosition(config, "SHIPPING-YARD");
  const [x, , z] = toWorld(planX, planY);

  return (
    <group>
      {yard.map((shipment, lane) => (
        <group key={shipment.id} position={[x, 0, z + lane * 2.6 - 2.6]}>
          <mesh position={[-2.6, 0.5, 0]}>
            <boxGeometry args={[1, 1, 1.1]} />
            <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.3} />
          </mesh>
          <mesh position={[0, 0.55, 0]}>
            <boxGeometry args={[4, 0.2, 1.3]} />
            <meshStandardMaterial
              color={shipment.status === "DISPATCHED" ? TONE.logistics.hex : "#475569"}
              roughness={0.6}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

function BookmarkCamera({
  config,
  bookmark,
  reducedMotion,
}: {
  config: FactoryDescriptor;
  bookmark: string;
  reducedMotion: boolean;
}) {
  const controls = useRef<CameraControls>(null);
  const bookmarks = useMemo(() => cameraBookmarks(config), [config]);

  useEffect(() => {
    const target = bookmarks.find((candidate) => candidate.id === bookmark) ?? bookmarks[0];
    if (!target || !controls.current) return;
    const [px, py, pz] = target.position;
    const [tx, ty, tz] = target.target;
    void controls.current.setLookAt(px, py, pz, tx, ty, tz, !reducedMotion);
  }, [bookmark, bookmarks, reducedMotion]);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={3}
      maxDistance={70}
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
