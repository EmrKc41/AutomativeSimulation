import path from "node:path";
import { fileURLToPath } from "node:url";

import PDFDocument from "pdfkit";

import { BRAND } from "../brand.ts";

import { clock, type ReportModel } from "./model.ts";

/**
 * The one-page shift report.
 *
 * It is written to be printed and pinned to a board, so it answers the four
 * questions a supervisor asks at handover — how much did we build, what is
 * holding us back, what is open, and will the orders land on time — and stops
 * there. Anything that needs sorting or pivoting belongs in the workbook.
 *
 * The fonts are embedded rather than using PDFKit's built-ins: those use
 * WinAnsi encoding, which has no `ş`, `ğ`, `İ` or `ı`, and a Turkish report
 * rendered with them comes out mangled.
 */

const ASSET_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../assets");
const FONT_DIR = path.join(ASSET_DIR, "fonts");
const BRAND_MARK = path.join(ASSET_DIR, "brand", "logo-print.jpg");

const COLOURS = {
  ink: "#0f172a",
  muted: "#64748b",
  rule: "#cbd5e1",
  ok: "#16a34a",
  warn: "#ca8a04",
  risk: "#ea580c",
  critical: "#dc2626",
  logistics: "#2563eb",
} as const;

const PAGE = { size: "A4" as const, margin: 34 };
const WIDTH = 595.28 - PAGE.margin * 2;

function tone(value: number, target: number): string {
  if (value >= target) return COLOURS.ok;
  if (value >= target * 0.9) return COLOURS.warn;
  return COLOURS.risk;
}

function pct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `%${value.toFixed(digits).replace(".", ",").replace(/,0$/, "")}`;
}

function num(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits).replace(".", ",");
}

type Doc = InstanceType<typeof PDFDocument>;

function rule(doc: Doc, y: number): void {
  doc
    .moveTo(PAGE.margin, y)
    .lineTo(PAGE.margin + WIDTH, y)
    .lineWidth(0.5)
    .stroke(COLOURS.rule);
}

function heading(doc: Doc, y: number, text: string): number {
  doc
    .font("bold")
    .fontSize(9)
    .fillColor(COLOURS.ink)
    .text(text.toLocaleUpperCase("tr"), PAGE.margin, y, {
      characterSpacing: 0.8,
    });
  rule(doc, y + 12);
  return y + 18;
}

/** A fixed-column row writer; the report is a table, not flowing text. */
function row(
  doc: Doc,
  y: number,
  cells: ReadonlyArray<{
    text: string;
    width: number;
    colour?: string;
    bold?: boolean;
    align?: "left" | "right";
  }>,
  size = 8,
): number {
  let x = PAGE.margin;
  for (const cell of cells) {
    doc
      .font(cell.bold ? "bold" : "regular")
      .fontSize(size)
      .fillColor(cell.colour ?? COLOURS.ink)
      .text(cell.text, x, y, {
        width: cell.width,
        align: cell.align ?? "left",
        ellipsis: true,
        lineBreak: false,
      });
    x += cell.width;
  }
  return y + size + 3.5;
}

export function buildPdf(model: ReportModel): Promise<Buffer> {
  const doc = new PDFDocument({ size: PAGE.size, margin: PAGE.margin, bufferPages: true });
  doc.registerFont("regular", path.join(FONT_DIR, "FiraSans-Regular.ttf"));
  doc.registerFont("semibold", path.join(FONT_DIR, "FiraSans-SemiBold.ttf"));
  doc.registerFont("bold", path.join(FONT_DIR, "FiraSans-Bold.ttf"));

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const metrics = model.metrics;
  let y = PAGE.margin;

  // --- header ---------------------------------------------------------------
  // The mark is optional: a report that fails to print because a logo file
  // moved would be a bad trade.
  const markWidth = 74;
  let titleX = PAGE.margin;
  try {
    doc.image(BRAND_MARK, PAGE.margin, y - 2, { width: markWidth });
    titleX = PAGE.margin + markWidth + 12;
  } catch {
    titleX = PAGE.margin;
  }

  doc
    .font("bold")
    .fontSize(15)
    .fillColor(COLOURS.ink)
    .text(`${BRAND.NAME} — Vardiya Durum Raporu`, titleX, y);
  doc
    .font("regular")
    .fontSize(9)
    .fillColor(COLOURS.muted)
    .text(`${model.lineId}`, titleX, y + 17);
  y += 28;
  doc
    .font("regular")
    .fontSize(8)
    .fillColor(COLOURS.muted)
    .text(
      `Fabrika saati ${clock(model.simulatedMinutes)} (${model.simulatedMinutes} dk)  ·  Senaryo: ${model.scenarioLabel}  ·  Koşu ${model.simulationId}  ·  Tohum ${model.seed}  ·  Üretim zamanı ${model.generatedAt.toLocaleString("tr-TR")}`,
      titleX,
      y,
      { width: WIDTH - (titleX - PAGE.margin) },
    );
  y = Math.max(y + 14, PAGE.margin + 40);
  rule(doc, y);
  y += 10;

  // --- KPI strip ------------------------------------------------------------
  const oeeColour = tone(metrics.oee, 0.75);
  doc
    .font("bold")
    .fontSize(30)
    .fillColor(oeeColour)
    .text(pct(metrics.oee * 100), PAGE.margin, y);
  doc
    .font("regular")
    .fontSize(8)
    .fillColor(COLOURS.muted)
    .text("OEE", PAGE.margin, y + 32);

  const factors: ReadonlyArray<[string, number, number]> = [
    ["Kullanılabilirlik", metrics.availability, 0.95],
    ["Performans", metrics.performance, 0.9],
    ["Kalite", metrics.quality, 0.98],
  ];
  factors.forEach(([label, value, target], index) => {
    const x = PAGE.margin + 92 + index * 78;
    doc
      .font("semibold")
      .fontSize(13)
      .fillColor(tone(value, target))
      .text(pct(value * 100, 0), x, y + 6);
    doc
      .font("regular")
      .fontSize(7)
      .fillColor(COLOURS.muted)
      .text(label, x, y + 24, { width: 74 });
  });

  const tiles: ReadonlyArray<[string, string, string]> = [
    [
      "Üretim / Plan",
      `${metrics.productionOutput} / ${metrics.plannedProduction}`,
      tone(metrics.scheduleAdherence, 1),
    ],
    [
      "Çevrim / Takt",
      `${num(metrics.cycleTime, 1)} / ${num(metrics.taktTime, 1)} dk`,
      metrics.cycleTime <= metrics.taktTime ? COLOURS.ok : COLOURS.risk,
    ],
    ["İlk seferde doğru", pct(metrics.firstPassYield * 100, 0), tone(metrics.firstPassYield, 0.9)],
    ["Hattaki araç", String(metrics.wip), COLOURS.logistics],
    [
      "Duruş",
      `${Math.round(metrics.downtime)} dk`,
      metrics.downtime === 0 ? COLOURS.ok : COLOURS.risk,
    ],
    [
      "Açık alarm",
      String(metrics.openAlerts),
      metrics.openAlerts === 0 ? COLOURS.ok : COLOURS.warn,
    ],
  ];
  tiles.forEach(([label, value, colour], index) => {
    const x = PAGE.margin + 336 + (index % 3) * 64;
    const ty = y + (index < 3 ? 0 : 22);
    doc
      .font("semibold")
      .fontSize(11)
      .fillColor(colour)
      .text(value, x, ty + 2, { width: 62, lineBreak: false });
    doc
      .font("regular")
      .fontSize(6)
      .fillColor(COLOURS.muted)
      .text(label, x, ty + 14, { width: 62, lineBreak: false });
  });
  y += 48;
  rule(doc, y);
  y += 8;

  // --- constraint -----------------------------------------------------------
  const bottleneck = model.analyses.find((analysis) => analysis.title === "Hattı tutan istasyon");
  if (bottleneck) {
    y = heading(doc, y, "Hattı tutan istasyon");
    doc
      .font("semibold")
      .fontSize(9)
      .fillColor(COLOURS.ink)
      .text(bottleneck.summary, PAGE.margin, y, { width: WIDTH });
    y = doc.y + 3;
    if (bottleneck.recommendation) {
      doc
        .font("regular")
        .fontSize(8)
        .fillColor(COLOURS.risk)
        .text(`Öneri: ${bottleneck.recommendation}`, PAGE.margin, y, { width: WIDTH });
      y = doc.y + 6;
    }
  }

  // --- stations -------------------------------------------------------------
  y = heading(doc, y, "İstasyonlar");
  y = row(
    doc,
    y,
    [
      { text: "İstasyon", width: 92, bold: true },
      { text: "Durum", width: 68, bold: true },
      { text: "Doluluk", width: 48, bold: true, align: "right" },
      { text: "Kul.lab.", width: 48, bold: true, align: "right" },
      { text: "Kuyruk", width: 40, bold: true, align: "right" },
      { text: "Üretilen", width: 48, bold: true, align: "right" },
      { text: "Duruş", width: 44, bold: true, align: "right" },
      { text: "Enerji", width: 56, bold: true, align: "right" },
      { text: "Hattı tutan", width: 52, bold: true },
    ],
    7.5,
  );
  for (const station of model.stations) {
    y = row(doc, y, [
      { text: station.name, width: 92 },
      {
        text: station.status,
        width: 68,
        colour:
          station.status === "Arızalı"
            ? COLOURS.critical
            : station.status === "Çalışıyor"
              ? COLOURS.ok
              : COLOURS.muted,
      },
      { text: pct(station.utilisation * 100, 0), width: 48, align: "right" },
      {
        text: pct(station.availability * 100, 0),
        width: 48,
        align: "right",
        colour: tone(station.availability, 0.95),
      },
      { text: `${station.queueLength}/${station.bufferCapacity}`, width: 40, align: "right" },
      { text: String(station.produced), width: 48, align: "right" },
      {
        text: `${station.downMinutes} dk`,
        width: 44,
        align: "right",
        colour: station.downMinutes > 0 ? COLOURS.critical : COLOURS.ink,
      },
      { text: `${num(station.energyKwh, 0)} kWh`, width: 56, align: "right" },
      { text: station.isConstraint ? "EVET" : "", width: 52, colour: COLOURS.warn, bold: true },
    ]);
  }
  y += 6;

  // --- work orders ----------------------------------------------------------
  y = heading(doc, y, "İş emirleri");
  y = row(
    doc,
    y,
    [
      { text: "İş emri", width: 90, bold: true },
      { text: "Model", width: 56, bold: true },
      { text: "Durum", width: 84, bold: true },
      { text: "Tamamlanan", width: 70, bold: true, align: "right" },
      { text: "Hurda", width: 44, bold: true, align: "right" },
      { text: "Kalan", width: 44, bold: true, align: "right" },
      { text: "Termin", width: 52, bold: true, align: "right" },
      { text: "Kalan süre", width: 60, bold: true, align: "right" },
    ],
    7.5,
  );
  for (const order of model.workOrders) {
    const colour =
      order.status === "Riskli" || order.status === "Termin geçti"
        ? COLOURS.critical
        : order.status === "Geç tamamlandı"
          ? COLOURS.risk
          : COLOURS.ok;
    y = row(doc, y, [
      { text: order.id, width: 90 },
      { text: order.model, width: 56 },
      { text: order.status, width: 84, colour },
      { text: `${order.completed}/${order.quantity}`, width: 70, align: "right" },
      { text: String(order.scrapped), width: 44, align: "right" },
      { text: String(order.remaining), width: 44, align: "right" },
      { text: clock(order.dueMinute), width: 52, align: "right" },
      {
        text: order.minutesLeft <= 0 ? "geçti" : `${order.minutesLeft} dk`,
        width: 60,
        align: "right",
      },
    ]);
  }
  y += 6;

  // --- open alerts ----------------------------------------------------------
  const open = model.alerts.filter((alert) => alert.open);
  y = heading(doc, y, `Açık alarmlar (${open.length})`);
  if (open.length === 0) {
    doc
      .font("regular")
      .fontSize(8)
      .fillColor(COLOURS.ok)
      .text("Hatta açık bir sorun yok.", PAGE.margin, y);
    y += 12;
  } else {
    for (const alert of open.slice(0, 6)) {
      y = row(doc, y, [
        { text: clock(alert.minute), width: 40, colour: COLOURS.muted },
        {
          text: alert.code,
          width: 92,
          bold: true,
          colour: alert.severity === "kritik" ? COLOURS.critical : COLOURS.warn,
        },
        { text: alert.entityId, width: 78 },
        { text: alert.message, width: WIDTH - 210 },
      ]);
    }
    if (open.length > 6) {
      doc
        .font("regular")
        .fontSize(7)
        .fillColor(COLOURS.muted)
        .text(`… ve ${open.length - 6} tane daha`, PAGE.margin, y);
      y += 10;
    }
  }
  y += 4;

  // --- quality and risk -----------------------------------------------------
  y = heading(doc, y, "Kalite ve bakım riski");
  const quality = model.analyses.find((analysis) => analysis.title === "Kalite");
  const risk = model.analyses.find((analysis) => analysis.title === "Bakım riski");
  doc.font("regular").fontSize(8).fillColor(COLOURS.ink);
  if (quality) {
    doc.text(`Kalite: ${quality.summary}`, PAGE.margin, y, { width: WIDTH });
    y = doc.y + 2;
  }
  if (risk) {
    doc.text(`Bakım: ${risk.summary}`, PAGE.margin, y, { width: WIDTH });
    y = doc.y + 2;
  }
  const paretoLine = model.defects
    .slice(0, 4)
    .map((defect) => `${defect.type} ${defect.count}`)
    .join(" · ");
  if (paretoLine) {
    doc
      .fillColor(COLOURS.muted)
      .text(`En sık hatalar: ${paretoLine}`, PAGE.margin, y, { width: WIDTH });
    y = doc.y + 2;
  }
  if (metrics.escapedDefects > 0) {
    doc
      .font("semibold")
      .fillColor(COLOURS.critical)
      .text(
        `Dikkat: ${metrics.escapedDefects} hata son kapıdan geçip müşteriye gitti.`,
        PAGE.margin,
        y,
        { width: WIDTH },
      );
    y = doc.y + 2;
  }

  // --- footer ---------------------------------------------------------------
  const footerY = 841.89 - PAGE.margin - 22;
  rule(doc, footerY);
  doc
    .font("regular")
    .fontSize(6.5)
    .fillColor(COLOURS.muted)
    .text(
      `Bu rapor "${model.scenarioLabel}" senaryosunun ${model.seed} tohumlu koşusundan, ${clock(model.simulatedMinutes)} anındaki kayıtlardan üretilmiştir. Rakamlar o anın birikimli değerleridir; başka bir tohum aynı sürecin başka bir örneklemini verir. Detaylı veri analizi için Excel çalışma kitabına bakın.`,
      PAGE.margin,
      footerY + 5,
      { width: WIDTH },
    );

  doc.end();
  return done;
}
