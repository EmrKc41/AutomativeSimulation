"use client";

import { Box, Layers, Tag } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { LineFlow } from "@/components/line-flow";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame } from "@/lib/contract";
import { cameraBookmarks } from "@/lib/scene-layout";

/**
 * The primary viewport.
 *
 * Schematic and 3D are two readings of one state, not two features: the
 * schematic is faster to scan for buffer pressure, the 3D view is faster to
 * orient in when someone says "go look at the paint shop". Both render from the
 * same frame and both select into the same detail panels, so an operator never
 * has to reconcile them.
 *
 * Three.js is a large bundle that only matters once someone asks for it, so the
 * scene is loaded on demand rather than shipped with the first paint.
 */
const FactoryScene = dynamic(
  () => import("@/components/factory-scene").then((module) => module.FactoryScene),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <Skeleton className="h-full w-full" />
      </div>
    ),
  },
);

type ViewMode = "schematic" | "scene";

export function FactoryViewport({
  frame,
  config,
  onSelectStation,
  onSelectProduct,
  selectedStation,
}: {
  frame: FactoryFrame;
  config: FactoryDescriptor;
  onSelectStation: (machineId: string) => void;
  onSelectProduct: (productId: string) => void;
  selectedStation: string | null;
}) {
  const [mode, setMode] = useState<ViewMode>("schematic");
  const [bookmark, setBookmark] = useState("overview");
  const [showLabels, setShowLabels] = useState(true);
  const bookmarks = useMemo(() => cameraBookmarks(config), [config]);

  if (mode === "schematic") {
    return (
      <div className="relative">
        <LineFlow
          frame={frame}
          config={config}
          onSelectStation={onSelectStation}
          onSelectProduct={onSelectProduct}
          selectedStation={selectedStation}
        />
        <div className="absolute top-2 right-3">
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>
    );
  }

  return (
    <section aria-label="3B fabrika görünümü" className="bg-card overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2">
        <h2 className="font-heading text-xs font-semibold tracking-widest uppercase">
          Fabrika — {config.lines.length} hat
        </h2>

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-[10px] tracking-widest uppercase">Bakış</span>
          <ToggleGroup
            size="sm"
            value={[bookmark]}
            onValueChange={(value) => {
              const next = value[0];
              if (next) setBookmark(next);
            }}
            aria-label="Kamera açısı"
          >
            {bookmarks.map((mark) => (
              <ToggleGroupItem
                key={mark.id}
                value={mark.id}
                className="cursor-pointer px-2 text-[11px]"
              >
                {mark.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowLabels((value) => !value)}
            aria-pressed={showLabels}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] focus-visible:ring-2 focus-visible:outline-none"
          >
            <Tag aria-hidden className="size-3" />
            {showLabels ? "Etiketler açık" : "Etiketler kapalı"}
          </button>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>

      <div className="relative h-[30rem] w-full">
        <FactoryScene
          frame={frame}
          config={config}
          bookmark={bookmark}
          showLabels={showLabels}
          onSelectStation={onSelectStation}
          onSelectProduct={onSelectProduct}
          selectedStation={selectedStation}
        />
        <Legend />
      </div>

      <p className="text-muted-foreground border-t px-3 py-1.5 text-[10px]">
        Sürükleyerek döndürün, tekerlekle yakınlaştırın, sağ tuşla kaydırın. Bir makineye ya da araç
        gövdesine tıklayınca detayı açılır. Sahnedeki her konum ve renk o anki kareden okunur.
      </p>
    </section>
  );
}

function ModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <ToggleGroup
      size="sm"
      value={[mode]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "schematic" || next === "scene") onChange(next);
      }}
      aria-label="Görünüm modu"
    >
      <ToggleGroupItem value="schematic" className="cursor-pointer px-2 text-[11px]">
        <Layers aria-hidden className="size-3" />
        Şema
      </ToggleGroupItem>
      <ToggleGroupItem value="scene" className="cursor-pointer px-2 text-[11px]">
        <Box aria-hidden className="size-3" />
        3D
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/**
 * The scene's colours mean the same things as the rest of the screen, so the
 * legend restates the shared vocabulary rather than inventing a 3D-only one.
 */
function Legend() {
  const entries = [
    { label: "Çalışıyor", className: "bg-status-ok" },
    { label: "Besleme yok", className: "bg-status-warn" },
    { label: "Önü tıkalı", className: "bg-status-blocked" },
    { label: "Arızalı", className: "bg-status-critical" },
    { label: "Bakımda", className: "bg-status-risk" },
    { label: "Boşta", className: "bg-status-idle" },
    { label: "Lojistik", className: "bg-status-logistics" },
  ];

  return (
    <ul className="bg-card/80 pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-0.5 rounded border px-2 py-1 backdrop-blur">
      {entries.map((entry) => (
        <li key={entry.label} className="flex items-center gap-1 text-[10px]">
          <span aria-hidden className={`size-1.5 rounded-full ${entry.className}`} />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
