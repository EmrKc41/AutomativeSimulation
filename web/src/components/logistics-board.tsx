"use client";

import { Meter, StatusPill } from "@/components/status-pill";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame } from "@/lib/contract";
import { integer, plantClock } from "@/lib/format";
import { AGV_STATE, SHIPMENT_STATE, TONE } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Intralogistics and delivery.
 *
 * AGVs, line-side stock and shipments share a panel because they are one chain:
 * a starved station is usually an AGV story, and a late shipment is usually a
 * line story.
 */
export function LogisticsBoard({
  frame,
  config,
}: {
  frame: FactoryFrame;
  config: FactoryDescriptor;
}) {
  // Line-side bins are listed from the factory's bill of materials, not from
  // the frame, so an empty bin still appears. An omitted row is exactly the row
  // an operator needs when a station is starved.
  const onHand = new Map(
    frame.inventory
      .filter((balance) => balance.location.startsWith("LINE-SIDE/"))
      .map((balance) => [`${balance.location}|${balance.materialId}`, balance.quantity]),
  );
  const lineSide = config.stations.flatMap((station) =>
    station.consumes.map((item) => ({
      stationId: station.id,
      materialId: item.materialId,
      reorderPoint: station.reorderPoint,
      quantity: onHand.get(`LINE-SIDE/${station.id}|${item.materialId}`) ?? 0,
    })),
  );
  const store = frame.inventory.filter((balance) => !balance.location.startsWith("LINE-SIDE/"));

  // Stok listeleri malzeme *kodunu* yazıyordu: "STEEL-COIL". Depocu ona sac
  // rulo der. Kod ise ekranda kalmalı, çünkü irsaliye ve etiket onunla eşleşir
  // — o yüzden ad görünür, kod ipucunda duruyor.
  const materialNames = new Map(config.materials.map((material) => [material.id, material.name]));
  const materialName = (id: string) => materialNames.get(id) ?? id;

  return (
    <section aria-label="Lojistik" className="grid gap-2 lg:grid-cols-2">
      <div className="bg-card rounded-lg border">
        <h2 className="font-heading border-b px-3 py-2 text-xs font-semibold tracking-widest uppercase">
          Sevkiyatlar
        </h2>
        {frame.shipments.length === 0 ? (
          <p className="text-muted-foreground px-3 py-4 text-xs">
            Henüz sevkiyat açılmadı. İlk araç son kaliteyi geçer geçmez bir tane açılır.
          </p>
        ) : (
          <ul className="divide-y">
            {[...frame.shipments]
              .reverse()
              .slice(0, 6)
              .map((shipment) => {
                const state = SHIPMENT_STATE[shipment.status];
                const late =
                  shipment.actualDeparture !== null &&
                  shipment.actualDeparture > shipment.plannedDeparture;
                return (
                  <li key={shipment.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-heading text-[11px] font-medium">{shipment.id}</span>
                        <StatusPill tone={state.tone} label={state.label} compact />
                        {late ? <StatusPill tone="risk" label="Geç" compact /> : null}
                      </div>
                      <p className="text-muted-foreground truncate text-[10px]">
                        {shipment.destination} · {shipment.vehicle} · planlanan{" "}
                        {plantClock(shipment.plannedDeparture)}
                        {shipment.actualDeparture !== null
                          ? ` · çıkış ${plantClock(shipment.actualDeparture)}`
                          : ""}
                      </p>
                    </div>
                    <div className="w-20 shrink-0">
                      <p className="tabular text-right text-[10px]">
                        {shipment.productIds.length}/{shipment.capacity}
                      </p>
                      <Meter
                        value={shipment.productIds.length / shipment.capacity}
                        tone={state.tone}
                        label={`${shipment.id} doluluk`}
                      />
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </div>

      <div className="bg-card rounded-lg border">
        <h2 className="font-heading border-b px-3 py-2 text-xs font-semibold tracking-widest uppercase">
          İç Lojistik
        </h2>

        <div className="grid grid-cols-3 gap-1 px-3 py-2">
          {frame.agvs.map((agv) => {
            const state = AGV_STATE[agv.status];
            const moving = agv.status !== "IDLE";
            return (
              <Tooltip key={agv.id}>
                <TooltipTrigger
                  render={
                    <div
                      tabIndex={0}
                      className={cn(
                        "focus-visible:ring-ring cursor-help rounded border p-1.5 focus-visible:ring-2 focus-visible:outline-none",
                        moving ? TONE.logistics.border : "border-border",
                      )}
                    />
                  }
                >
                  <p className="font-heading text-[10px] font-medium">{agv.id}</p>
                  <p
                    className={cn(
                      "truncate text-[10px]",
                      moving ? TONE.logistics.text : "text-muted-foreground",
                    )}
                  >
                    {state.label}
                  </p>
                  <Meter
                    value={moving ? agv.progress : 0}
                    tone={moving ? "logistics" : "idle"}
                    label={`${agv.id} yol ilerlemesi`}
                    className="mt-1"
                  />
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  {agv.id} — {state.meaning}
                  <span className="text-muted-foreground block">
                    {agv.completedTasks} taşıma tamamlandı
                  </span>
                  {moving ? (
                    <span className="text-muted-foreground block">
                      {agv.cargoMaterialId ? `${materialName(agv.cargoMaterialId)} · ` : ""}
                      {agv.fromLocation} → {agv.toLocation}
                    </span>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="border-t px-3 py-2">
          <p className="text-muted-foreground mb-1 text-[10px] tracking-widest uppercase">
            Hat Kenarı Stok
          </p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {lineSide.map((bin) => (
              <li
                key={`${bin.stationId}${bin.materialId}`}
                className="flex items-baseline justify-between gap-2 text-[10px]"
              >
                <span
                  className="text-muted-foreground truncate"
                  title={`${bin.stationId} · ${bin.materialId}`}
                >
                  {bin.stationId} · {materialName(bin.materialId)}
                </span>
                <span
                  className={cn(
                    "tabular font-medium",
                    bin.quantity === 0
                      ? TONE.critical.text
                      : bin.quantity <= bin.reorderPoint
                        ? TONE.warn.text
                        : TONE.ok.text,
                  )}
                >
                  {bin.quantity === 0 ? "boş" : bin.quantity}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t px-3 py-2">
          <p className="text-muted-foreground mb-1 text-[10px] tracking-widest uppercase">
            Depolar
          </p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {store.map((balance) => (
              <li
                key={`${balance.materialId}${balance.location}${balance.status}`}
                className="flex items-baseline justify-between gap-2 text-[10px]"
              >
                <span className="text-muted-foreground truncate" title={balance.materialId}>
                  {materialName(balance.materialId)}
                  {balance.status === "QUARANTINE" ? (
                    <span className="text-status-risk"> (karantina)</span>
                  ) : null}
                </span>
                <span className="tabular font-medium">{integer(balance.quantity)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
