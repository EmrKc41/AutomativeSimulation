"use client";

import { Box, Pause, Play, RotateCcw, SkipForward, Wifi, WifiOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { BRAND } from "@twin/brand";

import { assetUrl } from "@/lib/base-path";

import { ReportButtons } from "@/components/report-buttons";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ScenarioDescriptor } from "@/lib/api";
import type { Command, FactoryFrame, ScenarioKind } from "@/lib/contract";
import { plantClock, relativeAge } from "@/lib/format";
import type { ConnectionState } from "@/lib/use-factory";

const SPEEDS = [0.5, 1, 2, 4, 8, 16] as const;

/**
 * Simulation controls and the honesty strip.
 *
 * The connection badge is the one place allowed to say "LIVE", and it only does
 * so when a frame actually arrived recently. A paused clock says PAUSED and a
 * quiet running clock says STALE, because a dashboard that keeps claiming live
 * data after its feed dies is worse than one showing nothing.
 */
export function ControlBar({
  frame,
  lineId,
  scenarios,
  connection,
  stale,
  lastFrameAt,
  now,
  onCommand,
  onError,
  pending,
}: {
  frame: FactoryFrame | null;
  /** The line's own identifier, not a translated name — it appears in events. */
  lineId: string;
  scenarios: readonly ScenarioDescriptor[];
  connection: ConnectionState;
  stale: boolean;
  lastFrameAt: number | null;
  now: number;
  onCommand: (command: Command) => void;
  onError: (message: string) => void;
  pending: boolean;
}) {
  const [seed, setSeed] = useState("42");
  const running = frame?.status === "running";
  const scenario = frame?.scenario ?? "normal";
  const active = scenarios.find((candidate) => candidate.kind === scenario);

  const feed =
    connection !== "live"
      ? ({
          tone: "critical",
          label: connection === "offline" ? "BAĞLANTI YOK" : "YENİDEN BAĞLANIYOR",
        } as const)
      : stale
        ? ({ tone: "risk", label: "VERİ ESKİ" } as const)
        : running
          ? ({ tone: "ok", label: "CANLI" } as const)
          : ({ tone: "idle", label: "DURAKLATILDI" } as const);

  return (
    <header className="panel-glass sticky top-0 z-30 rounded-none border-x-0 border-t-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          {/*
            The mark is a rendered plaque with its own frame and backdrop, so it
            is set at nameplate height and left alone rather than tinted or
            recoloured to match the panel. It sits away from the status strip on
            purpose: its blue and purple are the same hues the board uses for
            logistics and blocked, and brand chrome must never be mistaken for a
            state.
          */}
          <Image
            src={assetUrl("/brand/logo.webp")}
            alt={BRAND.NAME}
            width={640}
            height={318}
            priority
            className="border-border/60 h-9 w-auto rounded-[3px] border shadow-sm"
          />
          <div className="min-w-0">
            <h1 className="font-heading truncate text-sm font-semibold tracking-tight">
              {BRAND.NAME}
            </h1>
            <p className="text-muted-foreground truncate text-[11px]">
              {BRAND.PRODUCT} · {lineId} · {frame?.simulationId ?? "—"} · tohum {frame?.seed ?? "—"}
            </p>
          </div>
        </div>

        <Separator orientation="vertical" className="hidden h-8 sm:block" />

        <div className="flex items-center gap-3">
          <div>
            <p className="text-muted-foreground text-[10px] tracking-widest uppercase">
              Fabrika Saati
            </p>
            <p className="tabular text-lg leading-none font-semibold">
              {plantClock(frame?.simulatedTime ?? 0)}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1">
            <StatusPill tone={feed.tone} label={feed.label} compact />
            <span className="text-muted-foreground text-[10px]">
              {connection === "live" ? (
                <span className="inline-flex items-center gap-1">
                  <Wifi aria-hidden className="size-3" />
                  {lastFrameAt === null ? "bekleniyor" : relativeAge(now - lastFrameAt)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <WifiOff aria-hidden className="size-3" />
                  veri akışı yok
                </span>
              )}
            </span>
          </div>
        </div>

        <Separator orientation="vertical" className="hidden h-8 md:block" />

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={running ? "secondary" : "default"}
            className="cursor-pointer"
            disabled={pending || !frame}
            onClick={() => onCommand({ type: running ? "PAUSE" : "PLAY" })}
            aria-label={running ? "Simülasyonu duraklat" : "Simülasyonu çalıştır"}
          >
            {running ? (
              <Pause aria-hidden className="size-4" />
            ) : (
              <Play aria-hidden className="size-4" />
            )}
            {running ? "Duraklat" : "Çalıştır"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            disabled={pending || !frame}
            onClick={() => onCommand({ type: "STEP", ticks: 10 })}
            aria-label="On dakika ilerlet"
          >
            <SkipForward aria-hidden className="size-4" />
            +10 dk
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            disabled={pending || !frame}
            onClick={() => onCommand({ type: "RESET", scenario, seed: Number(seed) || 42 })}
            aria-label="Koşuyu sıfırla"
          >
            <RotateCcw aria-hidden className="size-4" />
            Sıfırla
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-[10px] tracking-widest uppercase">Hız</span>
          <ToggleGroup
            size="sm"
            value={[String(frame?.speed ?? 1)]}
            onValueChange={(value) => {
              const next = value[0];
              if (next) onCommand({ type: "SET_SPEED", speed: Number(next) });
            }}
            aria-label="Simülasyon hızı"
          >
            {SPEEDS.map((speed) => (
              <ToggleGroupItem
                key={speed}
                value={String(speed)}
                className="tabular cursor-pointer px-2 text-xs"
                aria-label={`${speed} kat hız`}
              >
                {speed}×
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* Opens in its own tab on purpose: the floor view is for a second
            screen or a wall, not a replacement for the numbers. */}
        <Link href="/saha" target="_blank" rel="noopener">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Box className="size-4" aria-hidden />
            Saha Görünümü
          </Button>
        </Link>

        <ReportButtons onError={onError} />

        <div className="ml-auto flex items-center gap-2">
          <label
            className="text-muted-foreground text-[10px] tracking-widest uppercase"
            htmlFor="seed"
          >
            Tohum
          </label>
          <input
            id="seed"
            value={seed}
            inputMode="numeric"
            onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))}
            className="tabular border-input bg-secondary focus-visible:ring-ring h-8 w-16 rounded border px-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
          />
          <Select
            value={scenario}
            onValueChange={(value) =>
              onCommand({
                type: "LOAD_SCENARIO",
                scenario: value as ScenarioKind,
                seed: Number(seed) || 42,
              })
            }
          >
            <SelectTrigger className="h-8 w-[15rem] cursor-pointer text-xs" aria-label="Senaryo">
              <SelectValue placeholder="Senaryo" />
            </SelectTrigger>
            <SelectContent>
              {scenarios.map((item) => (
                <SelectItem key={item.kind} value={item.kind} className="cursor-pointer">
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {active && active.kind !== "normal" ? (
        <p className="border-status-risk/40 bg-status-risk/10 text-status-risk border-t px-4 py-1 text-[11px]">
          Senaryo etkin — {active.description}
        </p>
      ) : null}
    </header>
  );
}
