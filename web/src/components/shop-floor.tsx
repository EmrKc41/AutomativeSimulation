"use client";

import { ArrowLeft, Tag } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AndonBanner } from "@/components/andon-banner";
import { StationDetail } from "@/components/station-detail";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fetchConfig, type FactoryDescriptor } from "@/lib/api";
import { plantClock } from "@/lib/format";
import { cameraBookmarks } from "@/lib/scene-layout";
import { useFactoryStream } from "@/lib/use-factory";

/**
 * The 3D view on its own, filling the screen.
 *
 * On the command centre the scene shares the page with eleven panels, so it
 * gets a pane and no more. That is the right trade for a shift supervisor
 * reading numbers, and the wrong one for the case this page exists for: a
 * screen on the wall, or someone who has just been told "go and look at the
 * paint shop" and wants to actually see it.
 *
 * Same socket, same frame, same selection behaviour. The andon banner comes
 * with it, because a stop must be visible wherever the plant is being watched —
 * a full-screen view that could hide a stopped station would be worse than no
 * view at all.
 */
const FactoryScene = dynamic(
  () => import("@/components/factory-scene").then((module) => module.FactoryScene),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full w-full" />,
  },
);

export function ShopFloor() {
  const { frame, connection } = useFactoryStream();
  const [config, setConfig] = useState<FactoryDescriptor | null>(null);
  // "line" diye bir görünüm yok; bu değer hiçbir düğmeyle eşleşmiyordu, yani
  // sayfa açıldığında hangi görünümde olunduğu üst çubukta görünmüyordu.
  const [bookmark, setBookmark] = useState<string>("overview");
  const [showLabels, setShowLabels] = useState(true);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchConfig(controller.signal)
      .then(setConfig)
      .catch(() => {
        // The banner below already covers "nothing to show"; a second error
        // surface on a wall display is noise.
      });
    return () => controller.abort();
  }, []);

  const bookmarks = config ? cameraBookmarks(config) : [];

  if (!frame || !config) {
    return (
      <main className="flex h-dvh items-center justify-center">
        <p className="text-muted-foreground text-sm">
          {connection === "offline" ? "Motora bağlanılamadı." : "Saha görünümü yükleniyor…"}
        </p>
      </main>
    );
  }

  return (
    <main className="flex h-dvh flex-col">
      <AndonBanner
        andon={frame.andon}
        simulatedTime={frame.simulatedTime}
        onFocusStation={setSelectedStation}
      />

      {/* A thin bar, not a header: everything else on this page is the floor. */}
      <div className="border-border/60 bg-card/60 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 backdrop-blur">
        <Link href="/" className="shrink-0">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="size-4" aria-hidden />
            Komuta Merkezi
          </Button>
        </Link>

        <div className="flex items-baseline gap-2">
          <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
            Fabrika Saati
          </span>
          <span className="tabular text-sm font-semibold">{plantClock(frame.simulatedTime)}</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <ToggleGroup
            value={[bookmark]}
            onValueChange={(value) => setBookmark(value[0] ?? bookmark)}
            aria-label="Kamera açısı"
            className="gap-1"
          >
            {bookmarks.map((view) => (
              <ToggleGroupItem key={view.id} value={view.id} className="px-2.5 text-xs">
                {view.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <Button
            variant={showLabels ? "secondary" : "ghost"}
            size="sm"
            className="gap-1.5"
            onClick={() => setShowLabels((current) => !current)}
            aria-pressed={showLabels}
          >
            <Tag className="size-4" aria-hidden />
            Etiketler
          </Button>
        </div>
      </div>

      {/* The whole remaining viewport. `min-h-0` is what lets it actually fill:
          without it the flex child grows to its content instead of the box. */}
      <div className="min-h-0 flex-1">
        <FactoryScene
          frame={frame}
          config={config}
          bookmark={bookmark}
          showLabels={showLabels}
          selectedStation={selectedStation}
          onSelectStation={setSelectedStation}
          onSelectProduct={() => {}}
        />
      </div>

      <StationDetail
        machineId={selectedStation}
        frame={frame}
        config={config}
        onOpenChange={(open) => {
          if (!open) setSelectedStation(null);
        }}
        onSelectProduct={() => {}}
      />
    </main>
  );
}
