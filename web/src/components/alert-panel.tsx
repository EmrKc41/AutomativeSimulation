"use client";

import { Check, ShieldCheck } from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Alert, Command } from "@/lib/contract";
import { plantClock } from "@/lib/format";
import { ALERT_LABEL, ALERT_TONE, TONE } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Open conditions, newest first.
 *
 * The engine raises one alert per *condition*, not per tick, and closes it when
 * the condition clears — so this list is short enough to act on. Acknowledging
 * marks that a human has seen it; it never closes the underlying problem.
 */
export function AlertPanel({
  alerts,
  onCommand,
}: {
  alerts: readonly Alert[];
  onCommand: (command: Command) => void;
}) {
  const ordered = [...alerts].sort((left, right) => right.occurredAt - left.occurredAt);

  return (
    <section aria-label="Açık alarmlar" className="bg-card flex flex-col rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="font-heading text-xs font-semibold tracking-widest uppercase">Alarmlar</h2>
        <span
          role="status"
          aria-atomic="true"
          className={cn(
            "tabular rounded px-1.5 py-0.5 text-[11px]",
            ordered.length === 0 ? "text-status-ok" : "text-status-warn",
          )}
        >
          {ordered.length} açık
        </span>
      </div>

      {ordered.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 px-3 py-6 text-xs">
          <ShieldCheck aria-hidden className="text-status-ok size-4" />
          Hatta açık bir sorun yok.
        </p>
      ) : (
        <ScrollArea className="h-[13rem]">
          <ul className="divide-y">
            {ordered.map((alert) => {
              const tone = ALERT_TONE[alert.code];
              return (
                <li key={alert.id} className={cn("px-3 py-2", TONE[tone].bg)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill tone={tone} label={ALERT_LABEL[alert.code]} compact />
                        <span className="tabular text-muted-foreground text-[10px]">
                          {plantClock(alert.occurredAt)} · {alert.entityId}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-snug">{alert.message}</p>
                    </div>
                    {alert.acknowledged ? (
                      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-[10px]">
                        <Check aria-hidden className="size-3" />
                        görüldü
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 shrink-0 cursor-pointer px-1.5 text-[10px]"
                        onClick={() => onCommand({ type: "ACKNOWLEDGE_ALERT", alertId: alert.id })}
                        aria-label={`${alert.entityId} alarmını gördüm olarak işaretle`}
                      >
                        Gördüm
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </section>
  );
}
