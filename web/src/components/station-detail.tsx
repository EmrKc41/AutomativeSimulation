"use client";

import { StatusPill } from "@/components/status-pill";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryFrame } from "@/lib/contract";
import { energy, minutes as minutesLabel, percent } from "@/lib/format";
import { INSPECTION_METHOD_LABEL, MACHINE_STATE, TONE, defectLabel } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Station detail with the recommended action.
 *
 * The recommendation is derived from the published state, not from a model
 * guess: a blocked station and a starved station look similar on a KPI tile but
 * need opposite responses, and saying which is which is the whole point of the
 * panel.
 */
export function StationDetail({
  machineId,
  frame,
  config,
  onOpenChange,
  onSelectProduct,
}: {
  machineId: string | null;
  frame: FactoryFrame;
  config: FactoryDescriptor;
  onOpenChange: (open: boolean) => void;
  onSelectProduct: (productId: string) => void;
}) {
  const machine = frame.machines.find((candidate) => candidate.id === machineId);
  const station = config.stations.find((candidate) => candidate.id === machineId);
  const state = machine ? MACHINE_STATE[machine.status] : null;

  return (
    <Sheet open={machineId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="font-heading text-base">{station?.name ?? machineId}</SheetTitle>
          <SheetDescription className="text-xs">
            {station ? `${station.workCenter} · ${station.id}` : "İstasyon"}
          </SheetDescription>
        </SheetHeader>

        {machine && station && state ? (
          <div className="space-y-4 p-4 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={state.tone} label={state.label} />
              {machine.bottleneck ? <StatusPill tone="warn" label="Hattı tutan istasyon" /> : null}
            </div>
            <p className="text-muted-foreground">{state.meaning}</p>

            <div
              className={cn(
                "rounded-md border p-2",
                TONE[recommendation(machine, station, config).tone].border,
                TONE[recommendation(machine, station, config).tone].bg,
              )}
            >
              <p className="text-muted-foreground text-[10px] tracking-widest uppercase">
                Önerilen Aksiyon
              </p>
              <p className="mt-0.5 leading-snug">{recommendation(machine, station, config).text}</p>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <Row
                label="Nominal çevrim"
                value={`${station.cycleTicks} ± ${station.cycleJitter} dk`}
              />
              <Row label="Tampon" value={`${machine.queue.length} / ${station.bufferCapacity}`} />
              <Row label="Doluluk" value={percent(machine.utilization, 1)} />
              <Row label="Kullanılabilirlik" value={percent(machine.availability, 1)} />
              <Row label="Üretilen" value={String(machine.producedCount)} />
              <Row label="Arıza sayısı" value={String(machine.failureCount)} />
              <Row label="Duruş" value={minutesLabel(machine.downtimeTicks)} />
              <Row label="Önü tıkalı" value={minutesLabel(machine.blockedTicks)} />
              <Row label="Besleme yok" value={minutesLabel(machine.starvedTicks)} />
              <Row label="Enerji" value={energy(machine.energyKwh)} />
              <Row label="Robot" value={String(station.robotCount)} />
              <Row label="Operatör" value={String(station.operatorCount)} />
            </dl>

            <section>
              <h3 className="font-heading text-muted-foreground mb-1 text-[10px] tracking-widest uppercase">
                Zaman Dağılımı
              </h3>
              <TimeBar machine={machine} simulatedTime={frame.simulatedTime} />
            </section>

            <section>
              <h3 className="font-heading text-muted-foreground mb-1 text-[10px] tracking-widest uppercase">
                Kalite Profili
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <Row label="Hata oranı" value={percent(station.defectRate, 1)} />
                <Row
                  label="Muayene"
                  value={
                    station.inspection.enabled
                      ? `${INSPECTION_METHOD_LABEL[station.inspection.method]} · ${station.inspection.cameraId ?? "—"}`
                      : "yok"
                  }
                />
                {station.inspection.enabled ? (
                  <>
                    <Row label="Yakalama oranı" value={percent(station.inspection.recall, 0)} />
                    <Row
                      label="Yanlış red"
                      value={percent(station.inspection.falsePositiveRate, 1)}
                    />
                  </>
                ) : null}
              </dl>
              {station.defectTypes.length > 0 ? (
                <p className="text-muted-foreground mt-1">
                  Çıkardığı hatalar: {station.defectTypes.map(defectLabel).join(", ")}
                </p>
              ) : null}
            </section>

            <section>
              <h3 className="font-heading text-muted-foreground mb-1 text-[10px] tracking-widest uppercase">
                İstasyondaki Araçlar
              </h3>
              {machine.currentProductId ? (
                <UnitButton
                  id={machine.currentProductId}
                  onSelect={onSelectProduct}
                  label="Makinede"
                />
              ) : (
                <p className="text-muted-foreground">İşlem gören araç yok.</p>
              )}
              {machine.queue.length > 0 ? (
                <div className="mt-1 space-y-0.5">
                  {machine.queue.map((productId, index) => (
                    <UnitButton
                      key={productId}
                      id={productId}
                      onSelect={onSelectProduct}
                      label={`Kuyrukta ${index + 1}. sıra`}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function UnitButton({
  id,
  label,
  onSelect,
}: {
  id: string;
  label: string;
  onSelect: (productId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className="hover:bg-accent focus-visible:ring-ring flex w-full cursor-pointer items-center justify-between rounded border px-2 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="tabular">{id}</span>
      <span className="text-muted-foreground text-[10px]">{label}</span>
    </button>
  );
}

function TimeBar({
  machine,
  simulatedTime,
}: {
  machine: FactoryFrame["machines"][number];
  simulatedTime: number;
}) {
  const total = Math.max(1, simulatedTime);
  const segments = [
    { label: "Çalışıyor", value: machine.runTicks, tone: "ok" as const },
    { label: "Besleme yok", value: machine.starvedTicks, tone: "warn" as const },
    { label: "Önü tıkalı", value: machine.blockedTicks, tone: "blocked" as const },
    { label: "Arızalı", value: machine.downtimeTicks, tone: "critical" as const },
    { label: "Boşta", value: machine.idleTicks, tone: "idle" as const },
  ];

  return (
    <div>
      <div
        className="bg-secondary flex h-3 w-full overflow-hidden rounded"
        role="img"
        aria-label={segments
          .map((segment) => `${segment.label} %${Math.round((segment.value / total) * 100)}`)
          .join(", ")}
      >
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={TONE[segment.tone].bar}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-1 grid grid-cols-2 gap-x-3">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-1.5 rounded-full", TONE[segment.tone].dot)} />
              {segment.label}
            </span>
            <span className="tabular text-muted-foreground">
              {minutesLabel(segment.value)} (%{Math.round((segment.value / total) * 100)})
            </span>
          </li>
        ))}
      </ul>
    </div>
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

/**
 * Depocunun kullandığı ad, yoksa kodun kendisi.
 *
 * "STEEL-COIL hat kenarı stoğunu kontrol edin" cümlesi sahada durup okunacak
 * bir cümle değil; "Sac rulo" ise doğrudan rafı işaret ediyor. Bilinmeyen bir
 * kod yüzünden uyarının hiç çıkmaması ise en kötüsü olurdu — o yüzden kod,
 * adı bulunamazsa olduğu gibi kalıyor.
 */
function materialName(config: FactoryDescriptor, id: string): string {
  return config.materials.find((material) => material.id === id)?.name ?? id;
}

/** Turn a published machine state into the action an operator should take. */
function recommendation(
  machine: FactoryFrame["machines"][number],
  station: FactoryDescriptor["stations"][number],
  config: FactoryDescriptor,
): { text: string; tone: "ok" | "warn" | "risk" | "critical" | "blocked" | "idle" } {
  if (machine.status === "DOWN") {
    return {
      text: `Onarım sürüyor, tahmini ${machine.repairTicksRemaining} dk kaldı. Alt istasyonlar beslemesiz kalacak, üst istasyonun tamponu dolup tıkanacak.`,
      tone: "critical",
    };
  }
  if (machine.status === "BLOCKED") {
    return {
      text: "Araç bitti ama sonraki tampon dolu. Hattı tutan yer aşağıda — buraya kapasite eklemek işe yaramaz.",
      tone: "blocked",
    };
  }
  if (machine.status === "STARVED") {
    return {
      text: `İşlenecek araç yok. ${station.consumes.map((item) => materialName(config, item.materialId)).join(", ") || "Bu istasyonun"} hat kenarı stoğunu ve üst istasyonun durup durmadığını kontrol edin.`,
      tone: "warn",
    };
  }
  if (machine.bottleneck) {
    return {
      text: "Hattı tutan istasyon burası. Üretim ancak buranın çevrim süresi düşerse ya da kullanılabilirliği artarsa yükselir.",
      tone: "warn",
    };
  }
  if (machine.availability < 0.9) {
    return {
      text: "Kullanılabilirlik hedefin altında. Vardiya eklemeden önce arıza geçmişine bakın — kaybedilen süre bakım kaynaklı, kapasite değil.",
      tone: "risk",
    };
  }
  return { text: "Normal çalışıyor. Aksiyon gerekmiyor.", tone: "ok" };
}
