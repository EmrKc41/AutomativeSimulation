"use client";

import { Meter, StatusPill } from "@/components/status-pill";
import type { FactoryFrame } from "@/lib/contract";
import { minutes as minutesLabel, plantClock } from "@/lib/format";
import type { StatusTone } from "@/lib/status";

/**
 * The order book.
 *
 * Progress is shown against the due date rather than as a bare percentage,
 * because "60% done" means nothing without knowing whether the remaining 40%
 * fits in the time left.
 */
export function WorkOrders({ frame }: { frame: FactoryFrame }) {
  const takt = frame.metrics.taktTime;

  return (
    <section aria-label="İş emirleri" className="bg-card rounded-lg border">
      <h2 className="font-heading border-b px-3 py-2 text-xs font-semibold tracking-widest uppercase">
        İş Emirleri
      </h2>
      <ul className="divide-y">
        {frame.workOrders.map((order) => {
          const done = order.completed + order.scrapped;
          const remaining = order.quantity - done;
          const ticksLeft = order.dueTick - frame.simulatedTime;
          const feasible = remaining * takt <= ticksLeft;

          const tone: StatusTone =
            order.status === "COMPLETED"
              ? "ok"
              : ticksLeft <= 0
                ? "critical"
                : feasible
                  ? "ok"
                  : "risk";
          const label =
            order.status === "COMPLETED"
              ? order.completedAt !== null && order.completedAt > order.dueTick
                ? "Geç tamamlandı"
                : "Tamamlandı"
              : ticksLeft <= 0
                ? "Termin geçti"
                : feasible
                  ? "Yolunda"
                  : "Riskli";

          return (
            <li key={order.id} className="px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-heading text-[11px] font-medium">{order.id}</span>
                <StatusPill tone={tone} label={label} compact />
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Meter
                  value={done / order.quantity}
                  tone={tone}
                  label={`${order.id} ilerleme`}
                  className="flex-1"
                />
                <span className="tabular text-muted-foreground w-24 shrink-0 text-right text-[10px]">
                  {done}/{order.quantity} · termin {plantClock(order.dueTick)}
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                {order.productDefinitionId} · açılan {order.released} · hurda {order.scrapped}
                {order.status === "COMPLETED"
                  ? ""
                  : ` · ${remaining} adet kaldı, ${minutesLabel(Math.max(0, ticksLeft))} süre var`}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
