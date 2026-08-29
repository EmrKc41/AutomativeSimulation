"use client";

import { Sparkline } from "@/components/sparkline";
import { Meter, StatusPill } from "@/components/status-pill";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FactoryDescriptor } from "@/lib/api";
import type { FactoryMetrics } from "@/lib/contract";
import type { KpiSample } from "@/lib/use-factory";
import { decimal, energy, integer, minutes, percent } from "@/lib/format";
import { TONE, ratioTone, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * The KPI rail.
 *
 * OEE gets the space because it is the number the plant is judged on, and its
 * three factors sit directly underneath it so a fall is immediately
 * attributable. Every tile states its own definition on hover: a KPI an
 * operator cannot define is a KPI they cannot act on.
 */
export function KpiRail({
  metrics,
  history,
  config,
}: {
  metrics: FactoryMetrics;
  history: readonly KpiSample[];
  config: FactoryDescriptor;
}) {
  const oeeTone = ratioTone(metrics.oee, 0.75);

  // The engine reports the constraining station by id. Everywhere else on this
  // screen a station is named, and an operator reads the name off the machine,
  // not the asset code.
  const holdingLine =
    config.stations.find((station) => station.id === metrics.bottleneck)?.name ??
    metrics.bottleneck;

  return (
    <section aria-label="Fabrika göstergeleri" className="grid gap-2 xl:grid-cols-4">
      <div
        className={cn(
          "bg-card flex flex-col justify-between rounded-lg border p-3",
          TONE[oeeTone].border,
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-muted-foreground text-[10px] tracking-widest uppercase">
              OEE — Toplam Ekipman Etkinliği
            </p>
            <p className={cn("tabular text-4xl leading-tight font-semibold", TONE[oeeTone].text)}>
              {percent(metrics.oee)}
            </p>
          </div>
          <StatusPill
            tone={oeeTone}
            label={
              oeeTone === "ok" ? "Hedefte" : oeeTone === "warn" ? "Hedef altı" : "Hedeften uzak"
            }
            compact
          />
        </div>
        {/* The number says where the line is; the trace says where it is going. */}
        <Sparkline
          values={history.map((sample) => sample.oee)}
          tone={oeeTone}
          label="OEE eğilimi"
          domain={[0, 1]}
          height={30}
          className="mt-1"
        />
        <Meter value={metrics.oee} tone={oeeTone} label="OEE" />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Factor label="Kullanılabilirlik" value={metrics.availability} target={0.95} />
          <Factor label="Performans" value={metrics.performance} target={0.9} />
          <Factor label="Kalite" value={metrics.quality} target={0.98} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:col-span-3 xl:grid-cols-5">
        <Tile
          label="Üretim / Plan"
          value={`${integer(metrics.productionOutput)} / ${integer(metrics.plannedProduction)}`}
          tone={ratioTone(metrics.scheduleAdherence, 1)}
          note={`Plana uyum ${percent(metrics.scheduleAdherence, 0)}`}
          definition="Son kalite kapısını geçen araç sayısı ile açık iş emirlerindeki toplam adet."
          trend={history.map((sample) => sample.output)}
          trendTone={ratioTone(metrics.scheduleAdherence, 1)}
        />
        <Tile
          label="Çevrim / Takt"
          value={`${decimal(metrics.cycleTime, 1)} / ${decimal(metrics.taktTime, 1)}`}
          unit="dk"
          tone={metrics.cycleTime <= metrics.taktTime ? "ok" : "risk"}
          note={metrics.cycleTime <= metrics.taktTime ? "Talebe yetişiyor" : "Talebin gerisinde"}
          definition="Çevrim süresi: hattan çıkan iki araç arasındaki ortalama süre. Takt: talebin dayattığı tempo."
        />
        <Tile
          label="İlk Seferde Doğru"
          value={percent(metrics.firstPassYield, 0)}
          tone={ratioTone(metrics.firstPassYield, 0.9)}
          note={`Tamir ${percent(metrics.reworkRate, 0)} · Hurda ${percent(metrics.scrapRate, 0)}`}
          definition="Biten araçlar içinde ne tamire ne hurdaya giden, ilk seferde doğru çıkanların payı (FPY)."
          trend={history.map((sample) => sample.firstPassYield)}
          trendTone={ratioTone(metrics.firstPassYield, 0.9)}
          trendDomain={[0, 1]}
        />
        <Tile
          label="Hattaki Araç"
          value={integer(metrics.wip)}
          tone="logistics"
          note="Hatta açık araç (WIP)"
          definition="Hatta açılmış ama henüz son kalite kapısını geçmemiş araçlar."
          trend={history.map((sample) => sample.wip)}
          trendTone="logistics"
        />
        <Tile
          label="Hattı Tutan"
          value={holdingLine ?? "Yok"}
          tone={metrics.bottleneck ? "warn" : "ok"}
          note={
            metrics.bottleneck
              ? "Önünde iş biriken, en yoğun çalışan istasyon"
              : "Hattı tutan istasyon yok"
          }
          definition="Yalnızca hattın en yoğun istasyonunun önünde iş birikiyorsa ya da işlemleri yavaşladıysa işaretlenir. Hattın hızını bu istasyon belirler."
        />
        <Tile
          label="Duruş"
          value={integer(metrics.downtime)}
          unit="dk"
          tone={metrics.downtime === 0 ? "ok" : "risk"}
          note={`Arızalar arası ${minutes(metrics.mtbf)} · Onarım ${minutes(metrics.mttr)}`}
          definition="Rota üzerindeki istasyonların toplam plansız duruş süresi."
        />
        <Tile
          label="Çıktı Hızı"
          value={decimal(metrics.throughput * 60, 2)}
          unit="araç/sa"
          tone="neutral"
          note={`Dakikada ${decimal(metrics.throughput, 3)} araç`}
          definition="Saatte hattan çıkan araç sayısı; kapıda hurdaya ayrılanlar dahil."
        />
        <Tile
          label="Hatalar"
          value={`${integer(metrics.detectedDefects)} / ${integer(metrics.escapedDefects)}`}
          tone={metrics.escapedDefects > 0 ? "critical" : "ok"}
          note="Yakalanan / kaçan"
          definition="Kaçan hata, son kapıdan fark edilmeden geçmiş demektir — müşteriye gider."
        />
        <Tile
          label="Enerji"
          value={energy(metrics.energyConsumptionKwh)}
          tone="neutral"
          note="Çalışma ve rölanti toplamı"
          definition="Tüm makinelerin çalışırken ve boşta harcadığı toplam elektrik."
        />
        <Tile
          label="Açık Alarm"
          value={integer(metrics.openAlerts)}
          tone={metrics.openAlerts === 0 ? "ok" : metrics.openAlerts > 3 ? "critical" : "warn"}
          note={`Eldeki stok ${integer(metrics.inventoryOnHand)}`}
          definition="Hâlâ çözülmemiş durumlar. Her durum için tek alarm açılır, her dakika yenisi değil."
        />
      </div>
    </section>
  );
}

function Factor({ label, value, target }: { label: string; value: number; target: number }) {
  const tone = ratioTone(value, target);
  return (
    <div>
      <p className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</p>
      <p className={cn("tabular text-sm font-semibold", TONE[tone].text)}>{percent(value, 0)}</p>
      <Meter value={value} tone={tone} label={label} className="mt-1" />
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  tone,
  note,
  definition,
  trend,
  trendTone,
  trendDomain,
}: {
  label: string;
  value: string;
  unit?: string;
  tone: StatusTone;
  note: string;
  definition: string;
  trend?: readonly number[];
  trendTone?: StatusTone;
  trendDomain?: readonly [number, number];
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            className="bg-card focus-visible:ring-ring flex cursor-help flex-col justify-between rounded-lg border p-2.5 text-left focus-visible:ring-2 focus-visible:outline-none"
          />
        }
      >
        <p className="text-muted-foreground text-[10px] tracking-widest uppercase">{label}</p>
        <p className={cn("tabular truncate text-xl leading-tight font-semibold", TONE[tone].text)}>
          {value}
          {unit ? <span className="text-muted-foreground ml-1 text-xs">{unit}</span> : null}
        </p>
        <p className="text-muted-foreground truncate text-[10px]">{note}</p>
        {trend && trend.length > 1 ? (
          <Sparkline
            values={trend}
            tone={trendTone ?? tone}
            label={label}
            height={16}
            className="mt-1"
            {...(trendDomain ? { domain: trendDomain } : {})}
          />
        ) : null}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{definition}</TooltipContent>
    </Tooltip>
  );
}
