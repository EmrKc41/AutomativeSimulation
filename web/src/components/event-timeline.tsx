"use client";

import { useMemo, useState } from "react";

import { StatusDot } from "@/components/status-pill";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { FactoryEvent } from "@/lib/contract";
import { plantClock } from "@/lib/format";
import type { FactoryDescriptor } from "@/lib/api";
import {
  PAYLOAD_LABEL,
  SIGNIFICANT_EVENTS,
  TONE,
  eventLabel,
  eventTone,
  locationText,
  payloadValueText,
} from "@/lib/status";
import { cn } from "@/lib/utils";

type Filter = "decisions" | "quality" | "logistics" | "all";

const FILTERS: ReadonlyArray<{ id: Filter; label: string; hint: string }> = [
  { id: "decisions", label: "Kararlar", hint: "Sadece istisnalar ve verilen kararlar" },
  { id: "quality", label: "Kalite", hint: "Muayene, hata, tamir ve hurda" },
  { id: "logistics", label: "Lojistik", hint: "Malzeme, AGV ve sevkiyat hareketleri" },
  { id: "all", label: "Tümü", hint: "Rutin operasyonlar dahil her olay" },
];

const QUALITY_EVENTS = new Set<FactoryEvent["type"]>([
  "INSPECTION_COMPLETED",
  "DEFECT_DETECTED",
  "DEFECT_ESCAPED",
  "QUALITY_CHECK_PASSED",
  "QUALITY_CHECK_FAILED",
  "REWORK_STARTED",
  "REWORK_COMPLETED",
  "PRODUCT_SCRAPPED",
  "MATERIAL_QUARANTINED",
]);

const LOGISTICS_EVENTS = new Set<FactoryEvent["type"]>([
  "MATERIAL_RECEIVED",
  "MATERIAL_ACCEPTED",
  "MATERIAL_QUARANTINED",
  "MATERIAL_SHORTAGE",
  "MATERIAL_CONSUMED",
  "KANBAN_SIGNAL",
  "AGV_TASK_ASSIGNED",
  "AGV_TASK_COMPLETED",
  "SHIPMENT_CREATED",
  "SHIPMENT_LOADING",
  "SHIPMENT_DISPATCHED",
  "SHIPMENT_DELIVERED",
]);

/**
 * The operational log.
 *
 * "Decisions" is the default because the raw stream is dominated by routine
 * starts and completions, and an operator scanning for a problem should not
 * have to filter that noise by eye. Every row stays clickable through to the
 * unit it concerns.
 */
export function EventTimeline({
  events,
  config,
  onSelectProduct,
}: {
  events: readonly FactoryEvent[];
  config: FactoryDescriptor;
  onSelectProduct: (productId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("decisions");

  const visible = useMemo(() => {
    const predicate = (event: FactoryEvent): boolean => {
      switch (filter) {
        case "decisions":
          return SIGNIFICANT_EVENTS.has(event.type);
        case "quality":
          return QUALITY_EVENTS.has(event.type);
        case "logistics":
          return LOGISTICS_EVENTS.has(event.type);
        default:
          return true;
      }
    };
    return events.filter(predicate).slice(-160).reverse();
  }, [events, filter]);

  return (
    <section aria-label="Olay akışı" className="bg-card flex flex-col rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="font-heading text-xs font-semibold tracking-widest uppercase">Olay Akışı</h2>
        <ToggleGroup
          size="sm"
          value={[filter]}
          onValueChange={(value) => {
            const next = value[0];
            if (next) setFilter(next as Filter);
          }}
          aria-label="Olay filtresi"
        >
          {FILTERS.map((option) => (
            <ToggleGroupItem
              key={option.id}
              value={option.id}
              title={option.hint}
              className="cursor-pointer px-2 text-[11px]"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <ScrollArea className="h-[22rem]">
        {visible.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-xs">
            Bu filtreye uyan olay yok. Simülasyonu çalıştırınca akış dolar.
          </p>
        ) : (
          <ul className="divide-y">
            {visible.map((event) => {
              const tone = eventTone(event.type);
              const isProduct = event.correlationId.startsWith("CAR-");
              return (
                <li key={event.eventId} className="flex items-start gap-2 px-3 py-1.5">
                  <span className="tabular text-muted-foreground w-10 shrink-0 pt-0.5 text-[10px]">
                    {plantClock(event.occurredAt)}
                  </span>
                  <span className="pt-1">
                    <StatusDot tone={tone} label={`${eventLabel(event.type)}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-[11px] font-medium", TONE[tone].text)}>
                      {eventLabel(event.type)}
                    </p>
                    <p className="text-muted-foreground truncate text-[10px]">
                      {isProduct ? (
                        <button
                          type="button"
                          onClick={() => onSelectProduct(event.correlationId)}
                          className="focus-visible:ring-ring cursor-pointer underline decoration-dotted underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {event.correlationId}
                        </button>
                      ) : (
                        event.correlationId
                      )}
                      <span aria-hidden> · </span>
                      {event.source}
                      {describePayload(event, config)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </section>
  );
}

/** Show the payload fields that change what an operator would do next. */
function describePayload(event: FactoryEvent, config: FactoryDescriptor): string {
  const parts: string[] = [];
  for (const [key, label] of Object.entries(PAYLOAD_LABEL)) {
    const value = event.payload[key];
    if (value === undefined) continue;
    parts.push(`${label} ${describeValue(key, value, config)}`);
  }
  return parts.length === 0 ? "" : ` · ${parts.join(" · ")}`;
}

/**
 * A payload value in the words used everywhere else on this screen.
 *
 * The shift report already did this; the timeline did not, so the same event
 * read "malzeme WELD-WIRE" here and "malzeme Kaynak teli makarası" on paper.
 * One of those is the plant's language and the other is the engine's.
 */
function describeValue(field: string, value: unknown, config: FactoryDescriptor): string {
  const text = String(value);
  if (field === "material") {
    return config.materials.find((material) => material.id === text)?.name ?? text;
  }
  if (field === "station" || field === "origin" || field === "returnsTo") {
    return stationName(config, text);
  }
  if (field === "from" || field === "to") {
    const stationId = text.startsWith("LINE-SIDE/") ? text.slice("LINE-SIDE/".length) : null;
    return locationText(text, stationId ? stationName(config, stationId) : undefined);
  }
  return payloadValueText(field, value);
}

/** Names never fall back to nothing: an unknown id prints as the id. */
function stationName(config: FactoryDescriptor, id: string): string {
  return config.stations.find((station) => station.id === id)?.name ?? id;
}
