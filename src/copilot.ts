import {
  explainBottleneck,
  explainMachineRisk,
  explainMaterial,
  explainOeeLoss,
  explainQuality,
  explainScheduleVariance,
  explainShipments,
  explainStatus,
  type Analysis,
  type Evidence,
  type Finding,
} from "./analytics.ts";
import type { Command } from "./domain.ts";
import { defectText, severityText } from "./labels.ts";
import type { SimulationState } from "./state.ts";

/**
 * The AI Factory Copilot.
 *
 * The division of labour here is the whole point. This module reads a question
 * and decides *which* analysis answers it. It never computes a number, never
 * summarises a metric in its own words, and never answers from anything but the
 * analysis it routed to. Every figure an operator sees came from arithmetic
 * over the published state.
 *
 * That boundary is also the upgrade path: a language model can replace the
 * intent step below and rephrase the output, and the answers stay exactly as
 * true as they are today — because the model still would not be the thing doing
 * the counting.
 *
 * Two safety properties are deliberate. A question that does not match a known
 * intent is refused rather than improvised, and the copilot proposes commands
 * but never issues them: changing the plan stays a human action.
 */

export type CopilotIntent =
  | "STATUS"
  | "BOTTLENECK"
  | "OEE_LOSS"
  | "SCHEDULE"
  | "MACHINE_RISK"
  | "QUALITY"
  | "MATERIAL"
  | "SHIPMENT"
  | "TRACE"
  | "UNKNOWN";

export interface CopilotAnswer {
  readonly question: string;
  readonly intent: CopilotIntent;
  /** False when the question fell outside what the data can support. */
  readonly answered: boolean;
  readonly title: string;
  readonly summary: string;
  readonly findings: readonly Finding[];
  readonly recommendation: string | null;
  /** Offered, never executed. */
  readonly suggestedCommand: Command | null;
  readonly caveats: readonly string[];
  readonly simulatedTime: number;
  /** The words that selected this intent, so the routing is auditable too. */
  readonly matchedTerms: readonly string[];
}

const MAX_QUESTION_LENGTH = 400;

/**
 * Fold a question to a comparable form.
 *
 * Turkish is a first-class input language here — the plant vocabulary an
 * operator actually uses is Turkish — so diacritics are folded rather than
 * relied upon. Someone typing "darbogaz" on an English keyboard must get the
 * same answer as someone typing "darboğaz".
 */
function normalise(text: string): string {
  return text
    .slice(0, MAX_QUESTION_LENGTH)
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface IntentRule {
  readonly intent: CopilotIntent;
  /**
   * Word stems, matched against the start of each token.
   *
   * Turkish glues its suffixes on: tutuyor, tutan, tuttuğu, tutar all start
   * with "tut". Matching whole words would need every inflection listed;
   * matching a stem prefix handles the whole family.
   */
  readonly stems: readonly string[];
  /** Multi-word phrases, matched anywhere in the question and weighted higher. */
  readonly phrases?: readonly string[];
  /**
   * Phrases that describe the *form* of the question rather than its subject.
   *
   * "Zamanında mı" and "yetişir mi" ask whether something is on time; they do
   * not say what. Scored below a single domain word on purpose, so "sevkiyat
   * zamanında mı" is answered as a shipment question and not as a schedule one.
   * Alone, they still carry the question to this rule.
   */
  readonly shapes?: readonly string[];
  readonly analyse: (state: SimulationState) => Analysis;
}

/**
 * Intent routing.
 *
 * Questions are scored, not pattern-matched. A supervisor asks "hattı hangi
 * istasyon tutuyor", "nerede sıkışıyoruz" and "hat neden yavaş" to mean the
 * same thing, and a rule table built on exact substrings answers the first and
 * shrugs at the other two. Scoring each rule against the question's word stems
 * lets the words appear in any order, with any suffix, separated by anything.
 */
const RULES: readonly IntentRule[] = [
  {
    intent: "BOTTLENECK",
    stems: [
      "tut",
      "sikis",
      "tikan",
      "darbogaz",
      "kisit",
      "yavaslat",
      "kistir",
      "bottleneck",
      "constraint",
      "limit",
      "slowest",
    ],
    phrases: [
      "hangi istasyon",
      "en yavas",
      "nerede sikisiyoruz",
      "hat neden yavas",
      "hangi makine tutuyor",
      "holding up",
      "hatti tutan",
    ],
    analyse: explainBottleneck,
  },
  {
    intent: "OEE_LOSS",
    stems: [
      "oee",
      "kullanilabilirlik",
      "verimlilik",
      "etkinlik",
      "kayip",
      "kaybettik",
      "availability",
      "performance",
      "effectiveness",
    ],
    phrases: [
      "zaman kaybi",
      "sure nereye",
      "nereye gitti",
      "where did the time go",
      "lost time",
      "hangi kayip",
      "kayip nerede",
    ],
    analyse: explainOeeLoss,
  },
  {
    intent: "SCHEDULE",
    stems: [
      "gerisinde",
      "geride",
      "hedef",
      "gecikme",
      "geciktik",
      "termin",
      "takt",
      "yetis",
      "yetismez",
      "programa",
      "plan",
      "siparis",
      // Plain output vocabulary. "Kaç araç çıktı" is the most common question
      // on a shop floor and it used to come back unanswered.
      "uretim",
      "urettik",
      "uretildi",
      "cikti",
      "ciktik",
      "cikan",
      "tamamlanan",
      "tamamladik",
      "bitirdik",
      "adet",
      "rakam",
      "behind",
      "target",
      "schedule",
      "due",
      "output",
      "produced",
    ],
    phrases: [
      "is emri",
      "kac arac kaldi",
      "kac arac cikti",
      "kac arac urettik",
      "kac tane cikti",
      "ne kadar urettik",
      "vardiya sonu",
      "work order",
      "planin gerisinde",
      "how many cars",
    ],
    shapes: ["zamaninda mi", "yetisir mi", "on time"],
    analyse: explainScheduleVariance,
  },
  {
    intent: "MACHINE_RISK",
    stems: [
      "ariza",
      "arizali",
      "bozul",
      "bakim",
      "risk",
      "guvenil",
      "mtbf",
      "onarim",
      "fail",
      "breakdown",
      "maintenance",
      "reliable",
    ],
    phrases: [
      "hangi makine",
      "arizalanma ihtimali",
      "bakim gerekiyor",
      "en cok bozulan",
      "at risk",
    ],
    analyse: explainMachineRisk,
  },
  {
    intent: "QUALITY",
    stems: [
      "kalite",
      "hata",
      "hatali",
      "kusur",
      "hurda",
      "tamir",
      "muayene",
      "kamera",
      "fire",
      "ret",
      "red",
      "fpy",
      "quality",
      "defect",
      "scrap",
      "rework",
      "yield",
      "inspection",
      "camera",
    ],
    phrases: ["ilk seferde", "yeniden isleme", "kalite orani", "kac hata", "kacan hata"],
    shapes: ["neden dustu"],
    analyse: explainQuality,
  },
  {
    intent: "MATERIAL",
    stems: [
      "malzeme",
      "stok",
      "tedarik",
      "eksik",
      "envanter",
      "parca",
      "besleme",
      "kanban",
      "agv",
      "depo",
      "material",
      "inventory",
      "supply",
      "shortage",
      "starved",
    ],
    phrases: ["hat kenari", "stok yeterli", "malzeme var mi", "short of material"],
    analyse: explainMaterial,
  },
  {
    intent: "SHIPMENT",
    stems: [
      "sevkiyat",
      "sevk",
      "teslimat",
      "gonderi",
      "tir",
      "kamyon",
      "musteri",
      "yukleme",
      "rampa",
      "shipment",
      "ship",
      "delivery",
      "dispatch",
      "carrier",
      "truck",
      "customer",
    ],
    phrases: ["zamaninda cikiyor", "leaving on time", "kac tir"],
    analyse: explainShipments,
  },
  {
    intent: "STATUS",
    stems: ["durum", "ozet", "genel", "status", "overview", "summary"],
    phrases: [
      "ne oluyor",
      "su an",
      "simdi ne",
      "nasil gidiyor",
      "what is happening",
      "whats happening",
      "right now",
      "how are we",
      "son durum",
    ],
    analyse: explainStatus,
  },
];

const PRODUCT_PATTERN = /\bCAR-\d{4}-\d{6}\b/i;

export interface IntentMatch {
  readonly intent: CopilotIntent;
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

/** A question is only as long as its meaningful words. */
function tokenise(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
}

/**
 * Words that carry no intent. Dropping them stops "hangi", "nerede" and "mi"
 * from pulling every question towards whichever rule happens to list them.
 */
const STOP_WORDS = new Set([
  "bir",
  "bu",
  "su",
  "ne",
  "mi",
  "mu",
  "mi",
  "midir",
  "icin",
  "ile",
  "ve",
  "veya",
  "ama",
  "cok",
  "daha",
  "en",
  "gibi",
  "kadar",
  "sonra",
  "once",
  "var",
  "yok",
  "olan",
  "oldu",
  "olur",
  "bana",
  "bize",
  "lutfen",
  "acaba",
  "the",
  "a",
  "an",
  "is",
  "are",
  "do",
  "we",
  "our",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "and",
  "or",
  "any",
  "what",
  "how",
  "why",
  "where",
  "which",
]);

export function detectIntent(question: string): IntentMatch {
  if (PRODUCT_PATTERN.test(question)) {
    const matched = PRODUCT_PATTERN.exec(question)?.[0] ?? "";
    return { intent: "TRACE", score: 10, matchedTerms: [matched.toUpperCase()] };
  }

  const text = normalise(question);
  if (text.length === 0) return { intent: "UNKNOWN", score: 0, matchedTerms: [] };
  const tokens = tokenise(question);

  let best: IntentMatch = { intent: "UNKNOWN", score: 0, matchedTerms: [] };
  let fallback: IntentMatch = { intent: "UNKNOWN", score: 0, matchedTerms: [] };
  for (const rule of RULES) {
    const matched: string[] = [];
    let score = 0;

    for (const stem of rule.stems) {
      const hit = tokens.find((token) => token.startsWith(stem));
      if (hit === undefined) continue;
      matched.push(stem);
      score += stem.length;
    }
    // A phrase names a subject, so it is stronger evidence than a loose word.
    for (const phrase of rule.phrases ?? []) {
      if (!text.includes(phrase)) continue;
      matched.push(phrase);
      score += phrase.length * 2;
    }
    // A shape names no subject, so it must not outweigh one that is present.
    for (const shape of rule.shapes ?? []) {
      if (!text.includes(shape)) continue;
      matched.push(shape);
      score += shape.length * 0.5;
    }

    if (score === 0) continue;
    // STATUS is a question *shape*, not a subject: "nasıl gidiyor" asks how
    // something is going, and the something is the domain word beside it.
    // Letting it compete on score meant "kalite nasıl gidiyor" landed on the
    // general board, because a phrase scores double and beat the word "kalite".
    if (rule.intent === "STATUS") {
      if (score > fallback.score) {
        fallback = { intent: rule.intent, score, matchedTerms: matched };
      }
      continue;
    }
    if (score > best.score) best = { intent: rule.intent, score, matchedTerms: matched };
  }
  return best.intent === "UNKNOWN" ? fallback : best;
}

/** Genealogy for one unit, answered from the record rather than summarised. */
function traceAnswer(state: SimulationState, productId: string): Analysis {
  const product = state.productIndex.get(productId.toUpperCase());
  if (!product) {
    return {
      title: "Araç geçmişi",
      summary: `Bu koşuda ${productId} numaralı bir araç yok.`,
      findings: [],
      recommendation: null,
      suggestedCommand: null,
      caveats: ["Araç numaraları koşuya özeldir; sıfırlama numaralandırmayı baştan başlatır."],
    };
  }

  const defects = state.defects.filter((defect) => defect.productId === product.id);
  const inspections = state.inspections.filter((inspection) => inspection.productId === product.id);
  const evidence: Evidence[] = [
    {
      kind: "product",
      id: product.id,
      label: "Durum",
      value: `${product.status} · ${product.reworkCount} tur tamir`,
    },
    ...product.consumedMaterialBatchIds.map((batchId) => ({
      kind: "material" as const,
      id: batchId,
      label: "Kullanılan parti",
      value: batchId,
    })),
    ...inspections.map((inspection) => ({
      kind: "event" as const,
      id: inspection.id,
      label: `${inspection.stationId} ${inspection.method}`,
      value: `${inspection.result} · hata olasılığı ${inspection.defectProbability}`,
    })),
  ];

  const leadTime =
    product.completedAt !== null && product.releasedAt !== null
      ? `${product.completedAt - product.releasedAt} dk`
      : "devam ediyor";

  return {
    title: `Araç ${product.id}`,
    summary: `${product.status}, hatta giriş ${product.releasedAt ?? "?"} dk, akış süresi ${leadTime}, ${defects.length} hata kaydı.`,
    findings: [
      {
        headline: "Rota",
        detail:
          product.history.length === 0
            ? "Henüz tamamlanan operasyon yok."
            : product.history
                .map(
                  (record) =>
                    `${record.stationId} ${record.startedAt}→${record.completedAt} dk (${record.reworkPass}. tur)`,
                )
                .join(" · "),
        severity: "info",
        evidence,
      },
      ...(defects.length > 0
        ? [
            {
              headline: `${defects.length} hata`,
              detail: defects
                .map(
                  (defect) =>
                    `${defectText(defect.type)} (${severityText(defect.severity)}), kaynak ${defect.originStationId}, ${defect.resolved ? "tamirde giderildi" : defect.detected ? `${defect.detectedBy} yakaladı` : "hiç yakalanmadı"}`,
                )
                .join(" · "),
              severity: defects.some((defect) => !defect.detected && !defect.resolved)
                ? ("critical" as const)
                : ("warning" as const),
              evidence: defects.map((defect) => ({
                kind: "product" as const,
                id: defect.id,
                label: defectText(defect.type),
                value: `${defect.severity} · ${defect.originStationId}`,
              })),
            },
          ]
        : []),
    ],
    recommendation: null,
    suggestedCommand: null,
    caveats: [],
  };
}

const UNANSWERABLE: Analysis = {
  title: "Bu veriyle cevaplanamıyor",
  summary: "Bu soruyu ikizin kaydettiği hiçbir şeye bağlayamadım, o yüzden cevaplamıyorum.",
  findings: [
    {
      headline: "Neleri cevaplayabilirim",
      detail:
        "Hattı hangi istasyonun tuttuğu ve neyin işe yaramayacağı; OEE süresinin nereye gittiği; hattın takta yetişip yetişmediği ve hangi iş emirlerinin riskte olduğu; hangi makinelerin gözlenen arıza riskinin yüksek olduğu; hata Pareto'su, kalite kapılarının performansı ve kaçan hatalar; malzeme eksikleri ve hat kenarı stok durumu; sevkiyatların zamanında çıkıp çıkmadığı; numarasıyla tek bir aracın tüm geçmişi; ve fabrikanın anlık durumu.",
      severity: "info",
      evidence: [],
    },
  ],
  recommendation: null,
  suggestedCommand: null,
  caveats: [
    "Bu asistan yalnızca simülasyon ve operasyon verisinden cevap verir. Maliyet modeli, tedarikçi verisi, personel verisi ve dış bağlam bilgisi yoktur.",
  ],
};

export function ask(state: SimulationState, question: string): CopilotAnswer {
  // The question is data. It is matched against a fixed table of intents and is
  // never interpreted as an instruction, whatever it contains.
  const match = detectIntent(question);

  const analysis =
    match.intent === "TRACE"
      ? traceAnswer(state, match.matchedTerms[0] ?? "")
      : match.intent === "UNKNOWN"
        ? UNANSWERABLE
        : (RULES.find((rule) => rule.intent === match.intent)?.analyse(state) ?? UNANSWERABLE);

  return {
    question: question.slice(0, MAX_QUESTION_LENGTH),
    intent: match.intent,
    answered: match.intent !== "UNKNOWN",
    title: analysis.title,
    summary: analysis.summary,
    findings: analysis.findings,
    recommendation: analysis.recommendation,
    suggestedCommand: analysis.suggestedCommand,
    caveats: analysis.caveats,
    simulatedTime: state.time,
    matchedTerms: match.matchedTerms,
  };
}

/** Starter questions, in the language the plant is run in. */
export const SUGGESTED_QUESTIONS: readonly string[] = [
  "Hattı hangi istasyon tutuyor?",
  "Bugün neden üretim hedefinin gerisindeyiz?",
  "Hangi makinenin arıza riski yüksek?",
  "Kalite oranı neden düştü?",
  "OEE süresi nereye gitti?",
  "Malzeme eksiğimiz var mı?",
  "Sevkiyatlar zamanında çıkıyor mu?",
];
