"use client";

import { useEffect, useState } from "react";

import { StatusPill } from "@/components/status-pill";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchTraceability, type TraceabilityBundle } from "@/lib/api";
import { duration, percent, plantClock } from "@/lib/format";
import {
  INSPECTION_METHOD_LABEL,
  PRODUCT_STATE,
  TONE,
  defectLabel,
  eventLabel,
  eventTone,
} from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Traceability for one unit.
 *
 * This answers the question a quality engineer actually asks: what happened to
 * this car, which lots went into it, which camera looked at it, what did it
 * find, and where did it end up. It is fetched from the server rather than
 * reconstructed from the live frame, because the frame deliberately carries
 * only recent history.
 */
export function TraceSheet({
  productId,
  onOpenChange,
}: {
  productId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  // The result is tagged with the unit it was fetched for, so opening a second
  // unit can never show the first one's genealogy while the request is in
  // flight — and no state has to be cleared on the way in.
  const [loaded, setLoaded] = useState<{ id: string; bundle: TraceabilityBundle } | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (productId === null) return;
    const controller = new AbortController();
    fetchTraceability(productId, controller.signal)
      .then((bundle) => setLoaded({ id: productId, bundle }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setFailed({
          id: productId,
          message: cause instanceof Error ? cause.message : "could not load traceability",
        });
      });
    return () => controller.abort();
  }, [productId]);

  const bundle = loaded !== null && loaded.id === productId ? loaded.bundle : null;
  const error = failed !== null && failed.id === productId ? failed.message : null;
  const product = bundle?.product;
  const state = product ? PRODUCT_STATE[product.status] : null;

  return (
    <Sheet open={productId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle className="font-heading tabular text-base">{productId ?? "Araç"}</SheetTitle>
          <SheetDescription className="text-xs">
            Tam geçmiş: operasyonlar, kullanılan partiler, muayeneler ve sevkiyat.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 p-4 text-xs">
          {error ? <p className="text-status-critical">{error}</p> : null}
          {!bundle && !error ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : null}

          {bundle && product && state ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={state.tone} label={state.label} />
                {product.reworkCount > 0 ? (
                  <StatusPill tone="risk" label={`${product.reworkCount} tur tamir`} compact />
                ) : (
                  <StatusPill tone="ok" label="İlk seferde doğru" compact />
                )}
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <Row label="İş emri" value={bundle.workOrder?.id ?? "—"} />
                <Row label="Model" value={bundle.workOrder?.productDefinitionId ?? "—"} />
                <Row
                  label="Hatta giriş"
                  value={product.releasedAt === null ? "—" : plantClock(product.releasedAt)}
                />
                <Row
                  label="Tamamlanma"
                  value={product.completedAt === null ? "—" : plantClock(product.completedAt)}
                />
                <Row
                  label="Akış süresi"
                  value={
                    product.completedAt !== null && product.releasedAt !== null
                      ? duration(product.completedAt - product.releasedAt)
                      : "devam ediyor"
                  }
                />
                <Row label="Sevkiyat" value={bundle.shipment?.id ?? "—"} />
                <Row label="Varış" value={bundle.shipment?.destination ?? "—"} />
                <Row label="Anlamı" value={state.meaning} />
              </dl>

              <Section title="Kullanılan Partiler">
                {product.consumedMaterialBatchIds.length === 0 ? (
                  <p className="text-muted-foreground">Henüz malzeme çekilmemiş.</p>
                ) : (
                  <ul className="grid gap-0.5">
                    {product.consumedMaterialBatchIds.map((batchId) => (
                      <li key={batchId} className="tabular text-status-logistics">
                        {batchId}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Rota Geçmişi">
                {product.history.length === 0 ? (
                  <p className="text-muted-foreground">Henüz tamamlanan operasyon yok.</p>
                ) : (
                  <ol className="border-border ml-1 space-y-1 border-l pl-3">
                    {product.history.map((record, index) => (
                      <li key={`${record.stationId}-${index}`} className="relative">
                        <span
                          aria-hidden
                          className={cn(
                            "absolute -left-[1.05rem] top-1.5 size-1.5 rounded-full",
                            record.stationId === "REWORK-01" ? TONE.risk.dot : TONE.ok.dot,
                          )}
                        />
                        <span className="font-heading font-medium">{record.stationId}</span>
                        <span className="text-muted-foreground tabular">
                          {" "}
                          {plantClock(record.startedAt)} → {plantClock(record.completedAt)} (
                          {record.completedAt - record.startedAt} dk, {record.reworkPass}. tur)
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>

              <Section title="Muayeneler">
                {bundle.inspections.length === 0 ? (
                  <p className="text-muted-foreground">Henüz muayene edilmedi.</p>
                ) : (
                  <ul className="space-y-1">
                    {bundle.inspections.map((inspection) => (
                      <li key={inspection.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          <span className="font-heading">{inspection.stationId}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            {INSPECTION_METHOD_LABEL[inspection.method]} · {inspection.cameraId ?? "kamerasız"}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tabular text-muted-foreground">
                            p={percent(inspection.defectProbability, 0)}
                          </span>
                          <StatusPill
                            tone={inspection.result === "PASS" ? "ok" : "risk"}
                            label={
                              inspection.falsePositive
                                ? "RED (yanlış)"
                                : inspection.result === "PASS"
                                  ? "GEÇTİ"
                                  : "RED"
                            }
                            compact
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Hatalar">
                {bundle.defects.length === 0 ? (
                  <p className="text-status-ok">Bu araçta hiç hata oluşmadı.</p>
                ) : (
                  <ul className="space-y-1">
                    {bundle.defects.map((defect) => (
                      <li key={defect.id} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {defectLabel(defect.type)}
                          <span className="text-muted-foreground">
                            {" "}
                            · {defect.severity} · kaynak {defect.originStationId}
                          </span>
                        </span>
                        <StatusPill
                          tone={defect.resolved ? "ok" : defect.detected ? "risk" : "critical"}
                          label={
                            defect.resolved
                              ? "Giderildi"
                              : defect.detected
                                ? `${defect.detectedBy} yakaladı`
                                : "Yakalanmadı"
                          }
                          compact
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Olaylar">
                <ul className="space-y-0.5">
                  {bundle.events.slice(-40).map((event) => (
                    <li key={event.eventId} className="flex gap-2">
                      <span className="tabular text-muted-foreground w-10 shrink-0">
                        {plantClock(event.occurredAt)}
                      </span>
                      <span className={cn("truncate", TONE[eventTone(event.type)].text)}>
                        {eventLabel(event.type)}
                      </span>
                      <span className="text-muted-foreground truncate">{event.source}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-heading text-muted-foreground mb-1 text-[10px] tracking-widest uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
