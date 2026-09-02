import type { Command, Machine, ProductUnit } from "./domain.ts";
import { lineById, routeStationIds, stationById } from "./factory.ts";
import { ALERT_TEXT, defectText, eventText, severityText } from "./labels.ts";
import { windowedUtilization } from "./metrics.ts";
import type { SimulationState } from "./state.ts";

/**
 * Deterministic operational analysis.
 *
 * Everything here is arithmetic over the published state and the event log. No
 * model, no estimate presented as a fact, no number that cannot be traced back
 * to a machine record or an event. That is deliberate: the copilot on top of
 * this module may phrase an answer, but it must never be the thing that
 * computes it, or the plant would be taking advice from a guess.
 */

export type EvidenceKind =
  "metric" | "machine" | "product" | "event" | "work-order" | "alert" | "material" | "shipment";

/** One citation: what was looked at, and what it said. */
export interface Evidence {
  readonly kind: EvidenceKind;
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

export interface Finding {
  readonly headline: string;
  readonly detail: string;
  readonly severity: "info" | "warning" | "critical";
  readonly evidence: readonly Evidence[];
}

export interface Analysis {
  readonly title: string;
  readonly summary: string;
  readonly findings: readonly Finding[];
  readonly recommendation: string | null;
  /**
   * A command the operator may choose to run. The analysis never executes it —
   * a proposed plan has to become an explicit, human-pressed action.
   */
  readonly suggestedCommand: Command | null;
  readonly caveats: readonly string[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function elapsed(state: SimulationState): number {
  return Math.max(1, state.time);
}

function percent(value: number): string {
  return `%${(value * 100).toFixed(1).replace(".", ",")}`;
}

function minutes(ticks: number): string {
  return `${Math.round(ticks)} dk`;
}

function routeMachines(state: SimulationState): Machine[] {
  const ids = routeStationIds(state.config);
  return state.machines.filter((machine) => ids.has(machine.id));
}

/** The station holding the line back: the flagged one, or the busiest. */
function constraintOf(state: SimulationState): Machine | null {
  const machines = routeMachines(state);
  const flagged = machines.find((machine) => machine.bottleneck);
  if (flagged) return flagged;
  return machines.reduce<Machine | null>(
    (leader, machine) =>
      leader === null || windowedUtilization(machine) > windowedUtilization(leader)
        ? machine
        : leader,
    null,
  );
}

/**
 * Cite the most recent events of a type, optionally only those a given source
 * produced. Scoping matters: a failure at the paint shop is not evidence about
 * the body shop, however recent it is.
 */
function lastEvents(
  state: SimulationState,
  type: string,
  limit: number,
  source?: string,
): Evidence[] {
  return [...state.events]
    .filter((event) => event.type === type && (source === undefined || event.source === source))
    .slice(-limit)
    .map((event) => ({
      kind: "event" as const,
      id: event.eventId,
      label: `${eventText(event.type)} · ${event.occurredAt} dk`,
      value: `${event.correlationId} · ${event.source}`,
    }));
}

function machineEvidence(machine: Machine): Evidence {
  return {
    kind: "machine",
    id: machine.id,
    label: machine.station,
    value: `${machine.status} · doluluk ${percent(machine.utilization)} · kullanılabilirlik ${percent(machine.availability)} · kuyruk ${machine.queue.length}`,
  };
}

function metricEvidence(id: string, label: string, value: string): Evidence {
  return { kind: "metric", id, label, value };
}

const REPLAY_CAVEAT =
  "Rakamlar bu koşunun başından beri birikmiş değerlerdir. Aynı hat başka bir tohumla tekrar çalıştırılırsa sayılar değişir, çünkü arızalar ve hatalar her koşuda farklı yerlere düşer.";

// ---------------------------------------------------------------------------
// Bottleneck
// ---------------------------------------------------------------------------

/**
 * Explain the constraint, and — more usefully — explain what would *not* help.
 * The common mistake on a line is investing in a station that is busy but not
 * constraining, so this analysis names both.
 */
export function explainBottleneck(state: SimulationState): Analysis {
  const constraint = constraintOf(state);
  const machines = routeMachines(state);

  if (!constraint || state.metrics.productionOutput === 0) {
    return {
      title: "Hattı tutan istasyon",
      summary: "Hat, hangi istasyonun tuttuğunu söyleyecek kadar araç üretmedi.",
      findings: [],
      recommendation: null,
      suggestedCommand: null,
      caveats: ["Bunu okumadan önce hattı birkaç takt döngüsü çalıştırın."],
    };
  }

  const station = stationById(state.config, constraint.id);
  const utilisation = windowedUtilization(constraint);
  const avgQueue =
    constraint.queueWindow.length === 0
      ? 0
      : constraint.queueWindow.reduce((total, value) => total + value, 0) /
        constraint.queueWindow.length;
  const actualCycle =
    constraint.producedCount === 0 ? 0 : constraint.runTicks / constraint.producedCount;

  const findings: Finding[] = [
    {
      headline: `Hattı tutan istasyon: ${constraint.station}`,
      detail: `Son ${state.config.analysisWindowTicks} dakikanın ${percent(utilisation)} kadarında çalıştı ve önünde ortalama ${avgQueue.toFixed(1)} araç bekledi. Ölçülen çevrim süresi ${actualCycle.toFixed(1)} dk, nominal değer ${station.cycleTicks} dk.`,
      severity: constraint.bottleneck ? "warning" : "info",
      evidence: [
        machineEvidence(constraint),
        metricEvidence("windowUtilisation", "Son dönem doluluk", percent(utilisation)),
        metricEvidence("avgQueue", "Ortalama kuyruk", avgQueue.toFixed(2)),
        metricEvidence(
          "cycleTime",
          "Hat çevrim süresi",
          `${state.metrics.cycleTime.toFixed(2)} dk`,
        ),
        metricEvidence("taktTime", "Takt", `${state.metrics.taktTime.toFixed(2)} dk`),
      ],
    },
  ];

  // Stations that look busy but are not the constraint: the classic false lead.
  const busyButFree = machines
    .filter((machine) => machine.id !== constraint.id && machine.utilization > 0.6)
    .sort((left, right) => right.utilization - left.utilization)
    .slice(0, 2);

  if (busyButFree.length > 0) {
    findings.push({
      headline: "Yoğun çalışan ama hattı tutmayan istasyonlar",
      detail: `${busyButFree.map((machine) => `${machine.station} (${percent(machine.utilization)})`).join(" ve ")} yoğun çalışıyor ama hattı tutan bunlar değil. ${constraint.station} açılmadan oraya kapasite eklemek hiçbir şeyi değiştirmez.`,
      severity: "info",
      evidence: busyButFree.map(machineEvidence),
    });
  }

  // Idle time around a constraint has two different causes, and conflating them
  // sends an engineer to the wrong station. Downstream of the constraint,
  // stations starve because nothing reaches them. Upstream, they are either
  // blocked by a full buffer or throttled by the WIP cap — never starved by the
  // constraint itself.
  // "Yukarı" ve "aşağı" yalnızca kısıtın **kendi hattı** içinde anlamlı. Tesis
  // genelinde arandığında başka hattın makineleri rotada bulunamıyor ve
  // `indexOf` −1 döndürüyor: hepsi "yukarıda" sayılır, bulgu da o hatta hiç
  // olmayan bir sorunu anlatırdı.
  const line = lineById(state.config, constraint.lineId);
  const hatMakineleri = machines.filter((machine) => machine.lineId === line.id);
  const constraintIndex = line.route.indexOf(constraint.id);
  const threshold = elapsed(state) * 0.25;

  const downstreamStarved = hatMakineleri.filter(
    (machine) =>
      line.route.indexOf(machine.id) > constraintIndex && machine.starvedTicks > threshold,
  );
  if (downstreamStarved.length > 0) {
    findings.push({
      headline: "Yukarıdan parça gelmediği için bekleyen istasyonlar",
      detail: `${downstreamStarved.map((machine) => `${machine.station} ${minutes(machine.starvedTicks)} iş bekledi`).join(", ")}. Onlara ${constraint.station} bıraktığından daha hızlı araç gelmiyor; bu süre ayrı bir problem değil, o istasyonun sonucu.`,
      severity: "info",
      evidence: downstreamStarved.map(machineEvidence),
    });
  }

  const upstreamHeld = hatMakineleri.filter(
    (machine) =>
      line.route.indexOf(machine.id) < constraintIndex &&
      machine.blockedTicks + machine.starvedTicks > threshold,
  );
  if (upstreamHeld.length > 0) {
    const blocked = upstreamHeld.filter((machine) => machine.blockedTicks > machine.starvedTicks);
    findings.push({
      headline: "Yukarıda bekletilen istasyonlar",
      detail: `${upstreamHeld
        .map(
          (machine) =>
            `${machine.station} ${minutes(machine.blockedTicks)} tıkalı, ${minutes(machine.starvedTicks)} işsiz kaldı`,
        )
        .join(", ")}. ${
        blocked.length > 0
          ? "Tıkalı süre, aşağıdaki tamponun dolduğu anlamına gelir — bu istasyonları daha hızlı çalıştırmak sadece kuyruğu büyütür."
          : `${line.wipCap} araçlık hat tavanı tarafından kasıtlı olarak frenleniyorlar; stok bilerek hatta sokulmuyor.`
      }`,
      severity: "info",
      evidence: upstreamHeld.map(machineEvidence),
    });
  }

  const gain = actualCycle > 0 ? elapsed(state) / actualCycle - state.metrics.productionOutput : 0;

  return {
    title: "Hattı tutan istasyon",
    summary: `Hattın temposunu ${constraint.station} belirliyor: araç başına yaklaşık ${actualCycle.toFixed(1)} dk.`,
    findings,
    recommendation:
      constraint.availability < 0.95
        ? `${constraint.station} plansız duruşlara ${minutes(constraint.downtimeTicks)} kaybediyor. Bu kullanılabilirliği geri kazanmak, çevrim süresini kısaltmaktan hem daha değerli hem daha ucuz.`
        : `Üretim ancak ${constraint.station} çevrim süresi düşerse artar. Oradaki bir dakikalık iyileştirme bu sürede yaklaşık ${Math.max(0, gain).toFixed(0)} araç değerinde; aynı dakika başka bir istasyonda hiçbir şey etmez.`,
    suggestedCommand: null,
    caveats: [REPLAY_CAVEAT],
  };
}

// ---------------------------------------------------------------------------
// OEE loss
// ---------------------------------------------------------------------------

/**
 * Attribute the OEE gap to time, measured at the constraint.
 *
 * OEE loss is only meaningful where the loss actually costs output, which is
 * the constraint — an idle minute at a fast station costs nothing.
 */
export function explainOeeLoss(state: SimulationState): Analysis {
  const constraint = constraintOf(state);
  if (!constraint) {
    return {
      title: "OEE kaybı",
      summary: "Ölçüm yapılacak bir rota istasyonu yok.",
      findings: [],
      recommendation: null,
      suggestedCommand: null,
      caveats: [],
    };
  }

  const total = elapsed(state);
  const ledger = [
    { label: "Üretiyor", ticks: constraint.runTicks, kind: "value" as const },
    { label: "Plansız duruş", ticks: constraint.downtimeTicks, kind: "availability" as const },
    {
      label: "İş veya malzeme bekliyor",
      ticks: constraint.starvedTicks,
      kind: "performance" as const,
    },
    { label: "Önü tıkalı", ticks: constraint.blockedTicks, kind: "performance" as const },
    { label: "İş yok", ticks: constraint.idleTicks, kind: "idle" as const },
  ];

  const losses = ledger
    .filter((entry) => entry.kind !== "value" && entry.ticks > 0)
    .sort((left, right) => right.ticks - left.ticks);
  const biggest = losses[0];

  const reworked = state.products.filter(
    (product) => product.completedAt !== null && product.reworkCount > 0,
  ).length;
  const scrapped = state.products.filter((product) => product.status === "SCRAPPED").length;

  const findings: Finding[] = [
    {
      headline: `${constraint.station} istasyonunun ${minutes(total)} nereye gitti`,
      detail: ledger
        .map((entry) => `${entry.label} ${minutes(entry.ticks)} (${percent(entry.ticks / total)})`)
        .join(" · "),
      severity: "info",
      evidence: ledger.map((entry) =>
        metricEvidence(entry.label, entry.label, `${minutes(entry.ticks)}`),
      ),
    },
    {
      headline: "OEE bileşenleri",
      detail: `Kullanılabilirlik ${percent(state.metrics.availability)} × performans ${percent(state.metrics.performance)} × kalite ${percent(state.metrics.quality)} = OEE ${percent(state.metrics.oee)}.`,
      severity:
        state.metrics.oee < 0.6 ? "critical" : state.metrics.oee < 0.75 ? "warning" : "info",
      evidence: [
        metricEvidence("availability", "Kullanılabilirlik", percent(state.metrics.availability)),
        metricEvidence("performance", "Performans", percent(state.metrics.performance)),
        metricEvidence("quality", "Kalite", percent(state.metrics.quality)),
        metricEvidence("oee", "OEE", percent(state.metrics.oee)),
      ],
    },
  ];

  if (reworked > 0 || scrapped > 0) {
    findings.push({
      headline: "Kalite kayıpları",
      detail: `Biten araçların ${reworked} tanesi tamire girdi, ${scrapped} tanesi hurdaya ayrıldı. Tamir hem tamir hücresini hem de aracı reddeden kapıyı yeniden meşgul eder; yani hatta iki kez maliyet çıkarır.`,
      severity: scrapped > 0 ? "warning" : "info",
      evidence: [
        metricEvidence("reworkRate", "Tamir oranı", percent(state.metrics.reworkRate)),
        metricEvidence("scrapRate", "Hurda oranı", percent(state.metrics.scrapRate)),
        metricEvidence(
          "firstPassYield",
          "İlk seferde doğru",
          percent(state.metrics.firstPassYield),
        ),
        ...lastEvents(state, "PRODUCT_SCRAPPED", 3),
      ],
    });
  }

  return {
    title: "OEE kaybı",
    summary: biggest
      ? `Hattı tutan istasyondaki en büyük tek kayıp "${biggest.label}" kalemi: ${minutes(biggest.ticks)}.`
      : "Bu koşuda kısıtta kayıt edilmiş bir kayıp yok.",
    findings,
    recommendation: biggest
      ? biggest.kind === "availability"
        ? "Bu bir bakım problemi, kapasite problemi değil. Vardiya eklemeyi düşünmeden önce arıza geçmişine bakın."
        : biggest.label === "Blocked downstream"
          ? "Bu istasyonun önü tıkanıyor, yani hattı asıl tutan yer daha aşağıda. Analizi alt istasyon için tekrar çalıştırın."
          : "Bu istasyon parça bekliyor, yani hattı tutan o değil: tedariğe ve onu besleyen istasyona bakın."
      : null,
    suggestedCommand: null,
    caveats: [
      "Kayıp yalnızca hattı tutan istasyonda ölçülür; başka yerdeki boş dakikalar üretime mal olmaz.",
      REPLAY_CAVEAT,
    ],
  };
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export function explainScheduleVariance(state: SimulationState): Analysis {
  const takt = state.metrics.taktTime;
  const expected = takt === 0 ? 0 : Math.floor(elapsed(state) / takt);
  const actual = state.metrics.productionOutput;
  const gap = expected - actual;

  const findings: Finding[] = [
    {
      headline: gap > 0 ? `Takta göre ${gap} araç geride` : "Takta yetişiyor",
      detail: `${takt.toFixed(1)} dk takt ile hat, ${minutes(elapsed(state))} içinde ${expected} araç üretmeliydi; ${actual} üretti. Ölçülen çevrim süresi ${state.metrics.cycleTime.toFixed(2)} dk.`,
      severity: gap > 3 ? "critical" : gap > 0 ? "warning" : "info",
      evidence: [
        metricEvidence("productionOutput", "Üretim", String(actual)),
        metricEvidence("expected", "Takta göre beklenen", String(expected)),
        metricEvidence("cycleTime", "Çevrim süresi", `${state.metrics.cycleTime.toFixed(2)} dk`),
        metricEvidence("taktTime", "Takt süresi", `${takt.toFixed(2)} dk`),
      ],
    },
  ];

  for (const order of state.workOrders) {
    if (order.status === "COMPLETED") continue;
    const remaining = order.quantity - order.completed - order.scrapped;
    const ticksLeft = order.dueTick - state.time;
    const needed = remaining * takt;
    if (needed <= ticksLeft) continue;
    findings.push({
      headline: `${order.id} bu tempoda terminine yetişmez`,
      detail: `${remaining} araç kaldı, terminine ${Math.max(0, ticksLeft)} dk var. Bu tempoda yaklaşık ${minutes(needed)} gerekiyor.`,
      severity: ticksLeft <= 0 ? "critical" : "warning",
      evidence: [
        {
          kind: "work-order",
          id: order.id,
          label: order.id,
          value: `${order.completed}/${order.quantity} tamam, ${order.scrapped} hurda, termin ${order.dueTick} dk`,
        },
        metricEvidence("shortfall", "Açık", minutes(needed - Math.max(0, ticksLeft))),
      ],
    });
  }

  const constraint = constraintOf(state);

  return {
    title: "Termin sapması",
    summary:
      gap > 0
        ? `Hat, talebin dayattığı tempodan ${gap} araç geride.`
        : "Hat, talebin dayattığı tempoyu tutturuyor.",
    findings,
    recommendation:
      gap > 0 && constraint
        ? `Açığı ${constraint.station} belirliyor. Planlama tarafında yapılacak hiçbir şey bunu kapatmaz — ya o istasyonun çevrim süresi ya kullanılabilirliği ya da terminin kendisi değişecek.`
        : null,
    suggestedCommand: null,
    caveats: [
      "Takt, tanımlı vardiya talebinden hesaplanır; müşteri sipariş defterinden değil.",
      REPLAY_CAVEAT,
    ],
  };
}

// ---------------------------------------------------------------------------
// Maintenance risk
// ---------------------------------------------------------------------------

export interface MachineRisk {
  readonly machineId: string;
  readonly station: string;
  readonly score: number;
  readonly failures: number;
  readonly downtimeTicks: number;
  readonly minutesSinceLastFailure: number | null;
  readonly meanTimeBetweenFailures: number | null;
  readonly reason: string;
}

/**
 * Rank machines by observed risk.
 *
 * This is a ranking of what has already happened, not a prediction: the score
 * combines failure frequency, lost time, and how far past its own mean time
 * between failures a machine is currently running. Calling it a prediction
 * would be dressing up arithmetic as a model.
 */
export function rankMachineRisk(state: SimulationState): MachineRisk[] {
  const total = elapsed(state);

  return routeMachines(state)
    .map((machine) => {
      const failures = [...state.events].filter(
        (event) => event.type === "MACHINE_FAILURE" && event.source === machine.id,
      );
      const last = failures.at(-1);
      const sinceLast = last ? state.time - last.occurredAt : null;
      const mtbf =
        machine.failureCount > 0 ? (total - machine.downtimeTicks) / machine.failureCount : null;

      const frequency = machine.failureCount / (total / 100);
      const lostShare = machine.downtimeTicks / total;
      const overdue = mtbf !== null && sinceLast !== null ? Math.max(0, sinceLast / mtbf - 1) : 0;
      const score = frequency * 0.5 + lostShare * 3 + overdue * 0.6;

      const reason =
        machine.failureCount === 0
          ? "Bu koşuda plansız duruş kaydedilmedi."
          : overdue > 0.2
            ? `Son duruşundan bu yana ${minutes(sinceLast ?? 0)} çalışıyor; kendi ortalaması olan ${minutes(mtbf ?? 0)} süreyi aştı.`
            : `Şu ana kadar ${machine.failureCount} duruş, toplam ${minutes(machine.downtimeTicks)} kayıp.`;

      return {
        machineId: machine.id,
        station: machine.station,
        score: Number(score.toFixed(3)),
        failures: machine.failureCount,
        downtimeTicks: machine.downtimeTicks,
        minutesSinceLastFailure: sinceLast,
        meanTimeBetweenFailures: mtbf === null ? null : Number(mtbf.toFixed(1)),
        reason,
      };
    })
    .sort((left, right) => right.score - left.score);
}

export function explainMachineRisk(state: SimulationState): Analysis {
  const ranked = rankMachineRisk(state);
  const top = ranked.filter((entry) => entry.score > 0).slice(0, 3);
  const constraint = constraintOf(state);

  const findings: Finding[] = top.map((entry) => ({
    headline: `${entry.station} — risk puanı ${entry.score}`,
    detail: `${entry.reason}${entry.machineId === constraint?.id ? " Bu aynı zamanda hattı tutan istasyon; buradaki her duruş dakikası doğrudan araç kaybına dönüşür." : ""}`,
    severity: entry.machineId === constraint?.id && entry.score > 0.5 ? "critical" : "warning",
    evidence: [
      {
        kind: "machine",
        id: entry.machineId,
        label: entry.station,
        value: `${entry.failures} arıza · ${minutes(entry.downtimeTicks)} kayıp · arızalar arası ${entry.meanTimeBetweenFailures ?? "—"} dk`,
      },
      ...lastEvents(state, "MACHINE_FAILURE", 2, entry.machineId),
    ],
  }));

  return {
    title: "Bakım riski",
    summary:
      top.length === 0
        ? "Bu koşuda hiçbir istasyonda plansız duruş kaydedilmedi."
        : `Gözlenen en yüksek risk ${top[0]?.station} istasyonunda.`,
    findings,
    recommendation:
      top.length > 0 && top[0]?.machineId === constraint?.id
        ? `${top[0]?.station} için koruyucu bakımı hat zaten dururken planlayın. Hem en çok arıza veren istasyon hem de hattı tutan istasyon olduğu için duruşu doğrudan kayıp araca dönüşüyor.`
        : top.length > 0
          ? `${top[0]?.station} en çok arıza veren istasyon ama hattı tutan o değil — duruşlarını tamponlar kısmen yutuyor. Bunu bir bakım önceliği olarak ele alın, kapasite acili olarak değil.`
          : null,
    suggestedCommand: null,
    caveats: [
      "Bu sıralama geçmiş gözlemlere dayanır. Tahmin modeli değildir; titreşim, sıcaklık ya da başka bir durum sinyali kullanmaz.",
      REPLAY_CAVEAT,
    ],
  };
}

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

export function explainQuality(state: SimulationState): Analysis {
  const byType = new Map<string, number>();
  const byOrigin = new Map<string, number>();
  for (const defect of state.defects) {
    byType.set(defect.type, (byType.get(defect.type) ?? 0) + 1);
    byOrigin.set(defect.originStationId, (byOrigin.get(defect.originStationId) ?? 0) + 1);
  }

  const pareto = [...byType.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4);
  const origins = [...byOrigin.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3);

  const escaped = state.defects.filter((defect) => {
    if (defect.detected || defect.resolved) return false;
    const product = state.productIndex.get(defect.productId);
    return product !== undefined && product.completedAt !== null;
  });

  const gates = state.config.stations.filter((station) => station.inspection.enabled);
  const gateFindings: Finding[] = gates.map((station) => {
    const inspections = state.inspections.filter(
      (inspection) => inspection.stationId === station.id,
    );
    const failed = inspections.filter((inspection) => inspection.result === "FAIL");
    const falsePositives = inspections.filter((inspection) => inspection.falsePositive);
    const caught = state.defects.filter(
      (defect) => defect.detectedBy === (station.inspection.cameraId ?? station.id),
    );

    return {
      headline: `${station.name} kapısı`,
      detail: `${inspections.length} muayene, ${failed.length} red, ${caught.length} hata yakalandı, ${falsePositives.length} yanlış red. Tanımlı yakalama oranı ${percent(station.inspection.recall)}.`,
      severity: falsePositives.length > caught.length ? "warning" : "info",
      evidence: [
        metricEvidence(`${station.id}-inspections`, "Muayene", String(inspections.length)),
        metricEvidence(`${station.id}-caught`, "Yakalanan hata", String(caught.length)),
        metricEvidence(`${station.id}-falsePositive`, "Yanlış red", String(falsePositives.length)),
      ],
    };
  });

  const findings: Finding[] = [
    {
      headline:
        pareto.length === 0
          ? "Bu koşuda hiç hata oluşmadı"
          : `En sık görülen hata: ${defectText(pareto[0]?.[0] ?? "")}`,
      detail:
        pareto.length === 0
          ? "Süreç şu ana kadar hiç hata üretmedi."
          : `${pareto.map(([type, count]) => `${defectText(type)} ${count}`).join(" · ")}. Kaynak istasyonlar: ${origins.map(([id, count]) => `${id} ${count}`).join(" · ")}.`,
      severity: "info",
      evidence: [
        metricEvidence("detectedDefects", "Yakalanan", String(state.metrics.detectedDefects)),
        metricEvidence("escapedDefects", "Kaçan", String(state.metrics.escapedDefects)),
        metricEvidence(
          "firstPassYield",
          "İlk seferde doğru",
          percent(state.metrics.firstPassYield),
        ),
        ...lastEvents(state, "DEFECT_DETECTED", 3),
      ],
    },
    ...gateFindings,
  ];

  if (escaped.length > 0) {
    findings.push({
      headline: `${escaped.length} hata müşteriye ulaştı`,
      detail: `Bunlar son kapıdan fark edilmeden geçti: ${escaped
        .slice(0, 5)
        .map(
          (defect) =>
            `${defect.productId} aracında ${defectText(defect.type)} (kaynak ${defect.originStationId})`,
        )
        .join("; ")}.`,
      severity: "critical",
      evidence: escaped.slice(0, 5).map((defect) => ({
        kind: "product" as const,
        id: defect.productId,
        label: defect.productId,
        value: `${defectText(defect.type)} · ${severityText(defect.severity)} · kaynak ${defect.originStationId}`,
      })),
    });
  }

  const worstOrigin = origins[0];

  return {
    title: "Kalite",
    summary: `İlk seferde doğru ${percent(state.metrics.firstPassYield)}, tamir ${percent(state.metrics.reworkRate)}, hurda ${percent(state.metrics.scrapRate)}.`,
    findings,
    recommendation: worstOrigin
      ? `Hataların çoğu ${worstOrigin[0]} kaynaklı. Oradaki süreci iyileştirmek hem tamir yükünü hem kapının yükünü azaltır; sadece kapıyı sıkılaştırmak kaçan hatayı tamire çevirmekten öteye gitmez.`
      : null,
    suggestedCommand: null,
    caveats: [
      "Muayene, tanımlı bir yakalama ve yanlış red oranıyla modellenmiştir; eğitilmiş bir görü modeliyle değil.",
      REPLAY_CAVEAT,
    ],
  };
}

// ---------------------------------------------------------------------------
// Material and logistics
// ---------------------------------------------------------------------------

export function explainMaterial(state: SimulationState): Analysis {
  const shortages = [...state.events].filter(
    (event) => event.type === "MATERIAL_SHORTAGE" || event.type === "STATION_STARVED",
  );
  const quarantined = [...state.events].filter((event) => event.type === "MATERIAL_QUARANTINED");
  const starvedMinutes = routeMachines(state).reduce(
    (total, machine) => total + machine.starvedTicks,
    0,
  );

  const lowBins = state.config.stations.flatMap((station) =>
    station.consumes
      .map((item) => {
        const onHand = state.inventory
          .filter(
            (balance) =>
              balance.materialId === item.materialId &&
              balance.location === `LINE-SIDE/${station.id}` &&
              balance.status === "AVAILABLE",
          )
          .reduce((total, balance) => total + balance.quantity, 0);
        return {
          station: station.id,
          material: item.materialId,
          onHand,
          point: station.reorderPoint,
        };
      })
      .filter((bin) => bin.onHand <= bin.point),
  );

  const findings: Finding[] = [
    {
      headline: `İstasyonlar toplam ${minutes(starvedMinutes)} iş veya malzeme bekledi`,
      detail: `${shortages.length} eksiklik veya beslemesizlik olayı kaydedildi. Tüm lokasyonlardaki eldeki stok ${state.metrics.inventoryOnHand} birim.`,
      severity: starvedMinutes > elapsed(state) ? "warning" : "info",
      evidence: [
        metricEvidence("starved", "Toplam beslemesiz süre", minutes(starvedMinutes)),
        metricEvidence("inventoryOnHand", "Eldeki stok", String(state.metrics.inventoryOnHand)),
        ...lastEvents(state, "MATERIAL_SHORTAGE", 3),
      ],
    },
  ];

  if (lowBins.length > 0) {
    findings.push({
      headline: `${lowBins.length} hat kenarı kutusu sipariş noktasında veya altında`,
      detail: lowBins
        .map(
          (bin) => `${bin.station} · ${bin.material}: ${bin.onHand} (sipariş noktası ${bin.point})`,
        )
        .join(" · "),
      severity: lowBins.some((bin) => bin.onHand === 0) ? "critical" : "warning",
      evidence: lowBins.map((bin) => ({
        kind: "material" as const,
        id: `${bin.station}/${bin.material}`,
        label: `${bin.station} · ${bin.material}`,
        value: `${bin.onHand} adet`,
      })),
    });
  }

  if (quarantined.length > 0) {
    findings.push({
      headline: `${quarantined.length} gelen parti girdi kalitesinden geçemedi`,
      detail: "Karantinaya alınan partiler hatta hiç verilmez; fiili tedariği düşürürler.",
      severity: "warning",
      evidence: lastEvents(state, "MATERIAL_QUARANTINED", 4),
    });
  }

  return {
    title: "Malzeme tedariği",
    summary:
      shortages.length === 0
        ? "Bu koşuda hattı kısıtlayan bir malzeme eksiği olmadı."
        : `Malzeme hattı ${shortages.length} kez kesintiye uğrattı.`,
    findings,
    recommendation:
      lowBins.length > 0
        ? "Hat kenarı emniyet stoğu ince. Ya sipariş noktasını yükseltip kanbanı erken tetikleyin ya da bir AGV ekleyin — kutular dolduruldukları hızdan daha çabuk boşalıyor."
        : null,
    suggestedCommand:
      shortages.length > 0
        ? { type: "LOAD_SCENARIO", scenario: "material_shortage", seed: state.seed }
        : null,
    caveats: [REPLAY_CAVEAT],
  };
}

// ---------------------------------------------------------------------------
// Shipment
// ---------------------------------------------------------------------------

export function explainShipments(state: SimulationState): Analysis {
  const departed = state.shipments.filter((shipment) => shipment.actualDeparture !== null);
  const late = departed.filter(
    (shipment) => (shipment.actualDeparture ?? 0) > shipment.plannedDeparture,
  );
  const lateness = late.map(
    (shipment) => (shipment.actualDeparture ?? 0) - shipment.plannedDeparture,
  );
  const averageLateness =
    lateness.length === 0
      ? 0
      : lateness.reduce((total, value) => total + value, 0) / lateness.length;

  return {
    title: "Sevkiyat",
    summary:
      departed.length === 0
        ? "Sahadan henüz araç çıkmadı."
        : `${departed.length} tır sevk edildi, ${late.length} tanesi ortalama ${averageLateness.toFixed(0)} dk gecikmeyle.`,
    findings: [
      {
        headline: `${state.shipments.length} sevkiyat açıldı`,
        detail: state.shipments
          .slice(-4)
          .map(
            (shipment) =>
              `${shipment.id}: ${shipment.status}, ${shipment.productIds.length}/${shipment.capacity} yüklendi, plan ${shipment.plannedDeparture} dk${shipment.actualDeparture === null ? "" : `, çıkış ${shipment.actualDeparture} dk`}`,
          )
          .join(" · "),
        severity: late.length > departed.length / 2 ? "warning" : "info",
        evidence: state.shipments.slice(-4).map((shipment) => ({
          kind: "shipment" as const,
          id: shipment.id,
          label: shipment.id,
          value: `${shipment.status} · ${shipment.productIds.length}/${shipment.capacity}`,
        })),
      },
    ],
    recommendation:
      late.length > 0
        ? "Tırlar geç çıkıyor çünkü geç doluyor; gecikme sahada değil, hattın yukarısında. Yükleme sürecini düzeltmek bunu geri kazandırmaz."
        : null,
    suggestedCommand: null,
    caveats: [
      "Bir sevkiyat, takt hızında dolacak şekilde artı yükleme süresiyle planlanır; hat yavaşlarsa her tır geç kalır.",
      REPLAY_CAVEAT,
    ],
  };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function explainStatus(state: SimulationState): Analysis {
  const constraint = constraintOf(state);
  const open = state.alerts.filter((alert) => alert.resolvedAt === null);
  const wip: ProductUnit[] = state.products.filter(
    (product) =>
      product.status === "QUEUED" ||
      product.status === "IN_PRODUCTION" ||
      product.status === "IN_REWORK",
  );

  return {
    title: "Fabrika durumu",
    summary: `${minutes(state.time)} itibarıyla: ${state.metrics.plannedProduction} araçlık planın ${state.metrics.productionOutput} tanesi üretildi, OEE ${percent(state.metrics.oee)}, hatta ${wip.length} araç, ${open.length} açık alarm.`,
    findings: [
      {
        headline: "Mevcut durum",
        detail: `Kullanılabilirlik ${percent(state.metrics.availability)}, performans ${percent(state.metrics.performance)}, kalite ${percent(state.metrics.quality)}. Çevrim ${state.metrics.cycleTime.toFixed(1)} dk, takt ${state.metrics.taktTime.toFixed(1)} dk. Hattı tutan: ${constraint?.station ?? "yok"}.`,
        severity: state.metrics.oee < 0.6 ? "warning" : "info",
        evidence: [
          metricEvidence("oee", "OEE", percent(state.metrics.oee)),
          metricEvidence("output", "Üretim", String(state.metrics.productionOutput)),
          metricEvidence("wip", "Hattaki araç", String(wip.length)),
          metricEvidence("downtime", "Duruş", minutes(state.metrics.downtime)),
        ],
      },
      ...(open.length > 0
        ? [
            {
              headline: `${open.length} durum ilgi bekliyor`,
              detail: open
                .slice(0, 4)
                .map((alert) => `${alert.entityId}: ${alert.message}`)
                .join(" · "),
              severity: open.some((alert) => alert.severity === "critical")
                ? ("critical" as const)
                : ("warning" as const),
              evidence: open.slice(0, 4).map((alert) => ({
                kind: "alert" as const,
                id: alert.id,
                label: ALERT_TEXT[alert.code],
                value: alert.message,
              })),
            },
          ]
        : []),
    ],
    recommendation: null,
    suggestedCommand: null,
    caveats: [REPLAY_CAVEAT],
  };
}

/** Every analysis at once, for a dashboard or a shift report. */
export function runAllAnalyses(state: SimulationState): readonly Analysis[] {
  return [
    explainStatus(state),
    explainBottleneck(state),
    explainOeeLoss(state),
    explainScheduleVariance(state),
    explainMachineRisk(state),
    explainQuality(state),
    explainMaterial(state),
    explainShipments(state),
  ];
}
