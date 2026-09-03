"use client";

import { ChevronRight, CornerDownRight } from "lucide-react";

import { Meter, StatusPill } from "@/components/status-pill";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame, Machine, ProductUnit, StationConfig } from "@/lib/contract";
import { percent } from "@/lib/format";
import { MACHINE_STATE, PRODUCT_STATE, TONE } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * The line, drawn as the line.
 *
 * This is the 2D precursor to the 3D scene, and it obeys the same rule: nothing
 * here is decorative. A buffer slot is filled because a unit is waiting in it,
 * a progress bar moves because an operation is running, and the rework branch
 * only lights up when something is actually in it.
 */
export function LineFlow({
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
  const byId = new Map(frame.machines.map((machine) => [machine.id, machine]));
  const stationById = new Map(config.stations.map((station) => [station.id, station]));
  const productById = new Map(frame.activeProducts.map((product) => [product.id, product]));

  // Tesiste birden fazla hat var; her biri kendi akışını, kendi tamir
  // hücresini ve kendi modelini gösteriyor. Tek blok hâlinde birleştirmek,
  // farklı modelleri aynı hatta üretiliyormuş gibi gösterirdi.
  return (
    // `min-w-0`: grid ve flex çocukları varsayılan olarak `min-width: auto`
    // taşır, yani içeriğe göre uzarlar — kaydırmazlar. Hat akışı şeridi bu
    // yüzden telefonda kaydırılabilir olmak yerine bütün sayfayı 1030 piksele
    // itiyordu.
    <div className="grid min-w-0 gap-2">
      {config.lines.map((line) => (
        <LineRow
          key={line.id}
          line={line}
          maxReworkPasses={config.plant.maxReworkPasses}
          byId={byId}
          stationById={stationById}
          productById={productById}
          onSelectStation={onSelectStation}
          onSelectProduct={onSelectProduct}
          selectedStation={selectedStation}
        />
      ))}
    </div>
  );
}

function LineRow({
  line,
  maxReworkPasses,
  byId,
  stationById,
  productById,
  onSelectStation,
  onSelectProduct,
  selectedStation,
}: {
  line: FactoryDescriptor["lines"][number];
  maxReworkPasses: number;
  byId: Map<string, FactoryFrame["machines"][number]>;
  stationById: Map<string, FactoryDescriptor["stations"][number]>;
  productById: Map<string, FactoryFrame["activeProducts"][number]>;
  onSelectStation: (machineId: string) => void;
  onSelectProduct: (productId: string) => void;
  selectedStation: string | null;
}) {
  const rework = byId.get(line.reworkStationId);
  const reworkStation = stationById.get(line.reworkStationId);

  return (
    <section
      aria-label={`Üretim hattı ${line.id}`}
      className="bg-card min-w-0 rounded-lg border p-3"
    >
      <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <h2 className="font-heading text-xs font-semibold tracking-widest whitespace-nowrap uppercase">
          Hat Akışı — {line.id}
        </h2>
        <p className="text-muted-foreground min-w-0 text-[11px]">
          {/* Modelin adı başlıkta: üç hat aynı görünüyor, üzerlerinden geçen
              araç farklı. */}
          <span className="text-foreground font-medium">{line.model}</span> · hat tavanı{" "}
          {line.wipCap} araç · {line.route.length} operasyon
        </p>
      </div>

      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {line.route.map((stationId, index) => {
          const machine = byId.get(stationId);
          const station = stationById.get(stationId);
          if (!machine || !station) return null;
          return (
            <div key={stationId} className="flex items-stretch gap-1">
              <Buffer
                machine={machine}
                station={station}
                products={productById}
                onSelectProduct={onSelectProduct}
              />
              <StationCell
                machine={machine}
                station={station}
                product={
                  machine.currentProductId ? productById.get(machine.currentProductId) : undefined
                }
                selected={selectedStation === stationId}
                onSelect={() => onSelectStation(stationId)}
                onSelectProduct={onSelectProduct}
              />
              {index < line.route.length - 1 ? (
                <ChevronRight
                  aria-hidden
                  className="text-muted-foreground/50 my-auto size-4 shrink-0"
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {rework && reworkStation ? (
        // Telefonda alt alta: tamir hücresi ile açıklama yan yana sığmıyor ve
        // metin harf harf kırılıyordu.
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
          <CornerDownRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
          <span className="text-muted-foreground text-[10px] tracking-widest uppercase">
            Tamir Hattı
          </span>
          <Buffer
            machine={rework}
            station={reworkStation}
            products={productById}
            onSelectProduct={onSelectProduct}
          />
          <StationCell
            machine={rework}
            station={reworkStation}
            product={rework.currentProductId ? productById.get(rework.currentProductId) : undefined}
            selected={selectedStation === rework.id}
            onSelect={() => onSelectStation(rework.id)}
            onSelectProduct={onSelectProduct}
          />
          <p className="text-muted-foreground w-full text-[11px] sm:ml-2 sm:w-auto sm:flex-1">
            Araç, kendisini reddeden istasyona geri döner; {maxReworkPasses} turdan sonra hurdaya
            ayrılır.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Buffer({
  machine,
  station,
  products,
  onSelectProduct,
}: {
  machine: Machine;
  station: StationConfig;
  products: Map<string, ProductUnit>;
  onSelectProduct: (productId: string) => void;
}) {
  const slots = Array.from(
    { length: station.bufferCapacity },
    (_unused, index) => machine.queue[index] ?? null,
  );
  const full = machine.queue.length >= station.bufferCapacity;

  return (
    <Tooltip>
      <TooltipTrigger
        render={<div tabIndex={0} className="flex cursor-help flex-col justify-center gap-0.5" />}
      >
        <span className="sr-only">
          {station.name} tamponu: {station.bufferCapacity} yerin {machine.queue.length} tanesi dolu
        </span>
        {slots.map((productId, index) => (
          <button
            key={index}
            type="button"
            disabled={productId === null}
            onClick={() => productId && onSelectProduct(productId)}
            aria-label={productId ? `${productId} aracını aç` : "Boş tampon gözü"}
            className={cn(
              "focus-visible:ring-ring h-3.5 w-6 rounded-[3px] border transition-colors focus-visible:ring-2 focus-visible:outline-none",
              productId === null
                ? "border-border/60 bg-transparent"
                : cn(
                    "cursor-pointer",
                    full
                      ? "border-status-blocked bg-status-blocked/60"
                      : "border-status-logistics bg-status-logistics/50",
                  ),
            )}
          />
        ))}
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        {station.name} tamponu — {machine.queue.length}/{station.bufferCapacity}
        {full ? " (dolu: üst istasyon tıkandı)" : ""}
        {machine.queue.length > 0 ? (
          <span className="text-muted-foreground block">
            {machine.queue
              .slice(0, 4)
              .map((id) => products.get(id)?.id ?? id)
              .join(", ")}
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

function StationCell({
  machine,
  station,
  product,
  selected,
  onSelect,
  onSelectProduct,
}: {
  machine: Machine;
  station: StationConfig;
  product: ProductUnit | undefined;
  selected: boolean;
  onSelect: () => void;
  onSelectProduct: (productId: string) => void;
}) {
  const state = MACHINE_STATE[machine.status];
  const nominal = Math.max(1, station.cycleTicks + station.cycleJitter);
  const progress =
    machine.status === "RUNNING" ? 1 - Math.min(1, machine.remainingTicks / nominal) : 0;

  return (
    <div
      className={cn(
        "flex w-[9.5rem] shrink-0 flex-col gap-1 rounded-md border p-2 transition-colors",
        machine.bottleneck
          ? "border-status-warn ring-status-warn/30 ring-1"
          : TONE[state.tone].border,
        TONE[state.tone].bg,
        selected && "ring-ring ring-2",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${station.name} detayını aç`}
        className="focus-visible:ring-ring cursor-pointer text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <p className="font-heading truncate text-[11px] font-semibold">{station.id}</p>
        <p className="text-muted-foreground truncate text-[10px]">{station.workCenter}</p>
      </button>

      <StatusPill tone={state.tone} label={state.label} compact />

      <div className="min-h-[1.75rem]">
        {product ? (
          <button
            type="button"
            onClick={() => onSelectProduct(product.id)}
            className={cn(
              "focus-visible:ring-ring tabular w-full cursor-pointer truncate rounded border px-1 py-0.5 text-left text-[10px] focus-visible:ring-2 focus-visible:outline-none",
              TONE[PRODUCT_STATE[product.status].tone].border,
              TONE[PRODUCT_STATE[product.status].tone].text,
            )}
            aria-label={`${product.id} izlenebilirlik kaydını aç`}
          >
            {product.id.replace("CAR-2026-", "#")}
            {product.reworkCount > 0 ? ` ·R${product.reworkCount}` : ""}
          </button>
        ) : (
          <p className="text-muted-foreground/60 px-1 py-0.5 text-[10px] italic">araç yok</p>
        )}
        <Meter
          value={progress}
          tone={state.tone}
          label={`${station.name} işlem ilerlemesi`}
          className="mt-1"
        />
      </div>

      <div className="text-muted-foreground flex items-center justify-between text-[10px]">
        <span className="tabular">{percent(machine.utilization, 0)} dolu</span>
        <span className="tabular">{machine.producedCount} adet</span>
      </div>

      {machine.bottleneck ? (
        <p className="text-status-warn text-[10px] font-semibold tracking-wide uppercase">
          Hattı tutuyor
        </p>
      ) : null}
    </div>
  );
}
