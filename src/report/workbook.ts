import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";

import { BRAND } from "../brand.ts";

import { clock, type ReportModel } from "./model.ts";

/**
 * The analysis workbook.
 *
 * This is not a screenshot of the dashboard in a grid. Every figure is written
 * as a real number with an Excel number format, shares and cumulative columns
 * are written as live formulas, and every sheet has a frozen header and an
 * autofilter. The point is that an engineer can pivot, sort and re-slice it —
 * which they cannot do with a page of pre-formatted text.
 *
 * Number formats are locale-independent codes; Turkish Excel renders `0.0%` as
 * `%94,7` on its own. Formatting the numbers as Turkish strings here would look
 * right and be useless.
 */

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E293B" },
};
const TITLE_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0F172A" },
};

const BRAND_MARK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../assets/brand/logo-print.jpg",
);

const PERCENT = "0.0%";
const MINUTES = '#,##0" dk"';
const NUMBER = "#,##0";
const DECIMAL = "#,##0.0";

interface Column {
  readonly header: string;
  readonly key: string;
  readonly width: number;
  readonly format?: string;
}

/** A row of any report shape; the table writer only ever reads by column key. */
type Row = Readonly<Record<string, unknown>>;

function addTable(
  sheet: ExcelJS.Worksheet,
  columns: readonly Column[],
  rows: readonly Row[],
  startRow = 1,
): void {
  sheet.columns = columns.map((column) => ({ key: column.key, width: column.width }));

  const header = sheet.getRow(startRow);
  columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column.header;
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFF8FAFC" }, size: 10 };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FF475569" } } };
  });
  header.height = 26;

  rows.forEach((row, rowIndex) => {
    const target = sheet.getRow(startRow + 1 + rowIndex);
    columns.forEach((column, index) => {
      const cell = target.getCell(index + 1);
      cell.value = (row[column.key] ?? null) as ExcelJS.CellValue;
      if (column.format) cell.numFmt = column.format;
      cell.font = { size: 10 };
    });
  });

  sheet.views = [{ state: "frozen", ySplit: startRow }];
  if (rows.length > 0) {
    sheet.autoFilter = {
      from: { row: startRow, column: 1 },
      to: { row: startRow + rows.length, column: columns.length },
    };
  }
}

/** Colour a numeric column by value, so a bad row is visible without reading it. */
function colourScale(sheet: ExcelJS.Worksheet, column: string, firstRow: number, lastRow: number) {
  if (lastRow < firstRow) return;
  sheet.addConditionalFormatting({
    ref: `${column}${firstRow}:${column}${lastRow}`,
    rules: [
      {
        type: "colorScale",
        priority: 1,
        cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }],
        color: [{ argb: "FFEF4444" }, { argb: "FFEAB308" }, { argb: "FF22C55E" }],
      },
    ],
  });
}

function sectionTitle(sheet: ExcelJS.Worksheet, row: number, text: string, span = 6): void {
  sheet.mergeCells(row, 1, row, span);
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.fill = TITLE_FILL;
  cell.font = { bold: true, size: 11, color: { argb: "FFF8FAFC" } };
  cell.alignment = { vertical: "middle" };
  sheet.getRow(row).height = 22;
}

// ---------------------------------------------------------------------------

function buildSummary(book: ExcelJS.Workbook, model: ReportModel): void {
  const sheet = book.addWorksheet("Özet", { properties: { tabColor: { argb: "FF22C55E" } } });
  sheet.columns = [
    { width: 34 },
    { width: 16 },
    { width: 16 },
    { width: 60 },
    { width: 14 },
    { width: 14 },
  ];

  // The mark is decoration, and the sheet has to open without it if the file is
  // ever missing.
  try {
    const image = book.addImage({
      buffer: readFileSync(BRAND_MARK) as unknown as ExcelJS.Buffer,
      extension: "jpeg",
    });
    sheet.addImage(image, { tl: { col: 5.1, row: 0.2 }, ext: { width: 150, height: 75 } });
  } catch {
    // no mark; the report is unaffected
  }

  sectionTitle(sheet, 1, `${BRAND.NAME} — ${model.lineId} Üretim Analiz Raporu`);
  const meta: ReadonlyArray<[string, string]> = [
    ["Senaryo", `${model.scenarioLabel} (${model.scenario})`],
    ["Senaryo açıklaması", model.scenarioDescription],
    ["Koşu kimliği", model.simulationId],
    ["Tohum (tekrarlanabilirlik)", String(model.seed)],
    ["Fabrika saati", `${clock(model.simulatedMinutes)} (${model.simulatedMinutes} dk)`],
    ["Vardiya uzunluğu", `${model.shiftMinutes} dk`],
    ["Rapor üretim zamanı", model.generatedAt.toLocaleString("tr-TR")],
  ];
  meta.forEach(([label, value], index) => {
    const row = sheet.getRow(3 + index);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, size: 10 };
    row.getCell(2).value = value;
    row.getCell(2).font = { size: 10 };
    sheet.mergeCells(3 + index, 2, 3 + index, 4);
  });

  const kpiStart = 12;
  sectionTitle(sheet, kpiStart - 1, "Göstergeler");
  const kpis: ReadonlyArray<[string, number, string, string]> = [
    ["OEE", model.metrics.oee, PERCENT, "Kullanılabilirlik × Performans × Kalite"],
    ["Kullanılabilirlik", model.metrics.availability, PERCENT, "Duruşsuz geçen sürenin payı"],
    ["Performans", model.metrics.performance, PERCENT, "Açık kalan sürede beklenen hıza uyum"],
    ["Kalite", model.metrics.quality, PERCENT, "Hurdasız çıkan araç payı"],
    ["Üretim (adet)", model.metrics.productionOutput, NUMBER, "Son kaliteyi geçen araç"],
    ["Plan (adet)", model.metrics.plannedProduction, NUMBER, "Açık iş emirlerindeki toplam"],
    ["Plana uyum", model.metrics.scheduleAdherence, PERCENT, "Takta göre beklenene oran"],
    ["İlk seferde doğru (FPY)", model.metrics.firstPassYield, PERCENT, "Ne tamir ne hurda"],
    ["Tamir oranı", model.metrics.reworkRate, PERCENT, "Tamire giren araç payı"],
    ["Hurda oranı", model.metrics.scrapRate, PERCENT, "Hurdaya ayrılan araç payı"],
    ["Çevrim süresi", model.metrics.cycleTime, DECIMAL, "İki araç arası ortalama dakika"],
    ["Takt süresi", model.metrics.taktTime, DECIMAL, "Talebin dayattığı tempo"],
    ["Çıktı hızı (araç/sa)", model.metrics.throughput * 60, DECIMAL, "Saatte hattan çıkan araç"],
    ["Hattaki araç (WIP)", model.metrics.wip, NUMBER, "Hatta açık, bitmemiş araç"],
    ["Duruş", model.metrics.downtime, MINUTES, "Rota istasyonlarının plansız duruşu"],
    ["Arızalar arası süre", model.metrics.mtbf, MINUTES, "MTBF"],
    ["Onarım süresi", model.metrics.mttr, MINUTES, "MTTR"],
    ["Enerji (kWh)", model.metrics.energyConsumptionKwh, DECIMAL, "Çalışma + rölanti"],
    ["Eldeki stok", model.metrics.inventoryOnHand, NUMBER, "Tüm lokasyonlar"],
    ["Yakalanan hata", model.metrics.detectedDefects, NUMBER, "Muayenede bulunan"],
    ["Kaçan hata", model.metrics.escapedDefects, NUMBER, "Son kapıyı geçen"],
  ];

  kpis.forEach(([label, value, format, note], index) => {
    const row = sheet.getRow(kpiStart + index);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, size: 10 };
    const cell = row.getCell(2);
    cell.value = value;
    cell.numFmt = format;
    cell.font = { size: 10 };
    row.getCell(4).value = note;
    row.getCell(4).font = { size: 9, color: { argb: "FF64748B" } };
  });

  const findingsStart = kpiStart + kpis.length + 2;
  sectionTitle(sheet, findingsStart - 1, "Öne çıkan bulgular");
  let cursor = findingsStart;
  for (const analysis of model.analyses) {
    const row = sheet.getRow(cursor);
    row.getCell(1).value = analysis.title;
    row.getCell(1).font = { bold: true, size: 10 };
    sheet.mergeCells(cursor, 2, cursor, 4);
    row.getCell(2).value = analysis.summary;
    row.getCell(2).font = { size: 10 };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    cursor += 1;
    if (analysis.recommendation) {
      const advice = sheet.getRow(cursor);
      advice.getCell(1).value = "Öneri";
      advice.getCell(1).font = { size: 9, italic: true, color: { argb: "FF64748B" } };
      sheet.mergeCells(cursor, 2, cursor, 4);
      advice.getCell(2).value = analysis.recommendation;
      advice.getCell(2).font = { size: 9, italic: true, color: { argb: "FF334155" } };
      advice.getCell(2).alignment = { wrapText: true, vertical: "top" };
      cursor += 1;
    }
    cursor += 1;
  }
}

function buildStations(book: ExcelJS.Workbook, model: ReportModel): void {
  const sheet = book.addWorksheet("İstasyonlar");
  const rows = model.stations.map((station) => ({
    ...station,
    kısıt: station.isConstraint ? "EVET" : "",
  }));

  addTable(
    sheet,
    [
      { header: "İstasyon", key: "id", width: 14 },
      { header: "Ad", key: "name", width: 20 },
      { header: "Bölüm", key: "workCenter", width: 14 },
      { header: "Durum", key: "status", width: 14 },
      { header: "Hattı tutuyor", key: "kısıt", width: 13 },
      { header: "Doluluk", key: "utilisation", width: 10, format: PERCENT },
      { header: "Kullanılabilirlik", key: "availability", width: 14, format: PERCENT },
      { header: "Nominal çevrim", key: "nominalCycle", width: 13, format: MINUTES },
      { header: "Kuyruk", key: "queueLength", width: 8, format: NUMBER },
      { header: "Tampon", key: "bufferCapacity", width: 8, format: NUMBER },
      { header: "Üretilen", key: "produced", width: 10, format: NUMBER },
      { header: "Arıza", key: "failures", width: 8, format: NUMBER },
      { header: "Çalışma", key: "runMinutes", width: 11, format: MINUTES },
      { header: "Besleme yok", key: "starvedMinutes", width: 12, format: MINUTES },
      { header: "Önü tıkalı", key: "blockedMinutes", width: 11, format: MINUTES },
      { header: "Boşta", key: "idleMinutes", width: 10, format: MINUTES },
      { header: "Arızalı", key: "downMinutes", width: 10, format: MINUTES },
      { header: "Enerji (kWh)", key: "energyKwh", width: 12, format: DECIMAL },
    ],
    rows,
  );

  // Time-share formulas: the ledger sums to the elapsed time, so these add to 100%.
  const shareStart = 20;
  sheet.getCell(1, shareStart).value = "Çalışma %";
  sheet.getCell(1, shareStart + 1).value = "Besleme yok %";
  sheet.getCell(1, shareStart + 2).value = "Önü tıkalı %";
  sheet.getCell(1, shareStart + 3).value = "Arızalı %";
  for (let offset = 0; offset < 4; offset += 1) {
    const cell = sheet.getCell(1, shareStart + offset);
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFF8FAFC" }, size: 10 };
    sheet.getColumn(shareStart + offset).width = 13;
  }
  rows.forEach((_row, index) => {
    const excelRow = index + 2;
    const total = model.simulatedMinutes;
    sheet.getCell(excelRow, shareStart).value = { formula: `M${excelRow}/${total}` };
    sheet.getCell(excelRow, shareStart + 1).value = { formula: `N${excelRow}/${total}` };
    sheet.getCell(excelRow, shareStart + 2).value = { formula: `O${excelRow}/${total}` };
    sheet.getCell(excelRow, shareStart + 3).value = { formula: `Q${excelRow}/${total}` };
    for (let offset = 0; offset < 4; offset += 1) {
      sheet.getCell(excelRow, shareStart + offset).numFmt = PERCENT;
    }
  });

  colourScale(sheet, "F", 2, rows.length + 1);
  colourScale(sheet, "G", 2, rows.length + 1);
}

function buildQuality(book: ExcelJS.Workbook, model: ReportModel): void {
  const sheet = book.addWorksheet("Kalite");
  sheet.columns = [
    { width: 24 },
    { width: 10 },
    { width: 12 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 12 },
    { width: 14 },
  ];

  sectionTitle(sheet, 1, "Hata Pareto", 6);
  const paretoHeader = ["Hata tipi", "Adet", "Pay", "Kümülatif", "Yakalanan", "Kaçan"];
  paretoHeader.forEach((text, index) => {
    const cell = sheet.getCell(2, index + 1);
    cell.value = text;
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFF8FAFC" }, size: 10 };
  });

  const total = model.defects.reduce((sum, row) => sum + row.count, 0);
  model.defects.forEach((row, index) => {
    const excelRow = 3 + index;
    sheet.getCell(excelRow, 1).value = row.type;
    sheet.getCell(excelRow, 2).value = row.count;
    // Live formulas so the Pareto still holds if someone filters or edits.
    sheet.getCell(excelRow, 3).value = {
      formula: `B${excelRow}/SUM($B$3:$B$${2 + model.defects.length})`,
    };
    sheet.getCell(excelRow, 4).value = { formula: `SUM($C$3:C${excelRow})` };
    sheet.getCell(excelRow, 5).value = row.detected;
    sheet.getCell(excelRow, 6).value = row.escaped;
    sheet.getCell(excelRow, 3).numFmt = PERCENT;
    sheet.getCell(excelRow, 4).numFmt = PERCENT;
  });
  if (model.defects.length > 0) {
    const totalRow = 3 + model.defects.length;
    sheet.getCell(totalRow, 1).value = "Toplam";
    sheet.getCell(totalRow, 1).font = { bold: true };
    sheet.getCell(totalRow, 2).value = { formula: `SUM(B3:B${totalRow - 1})` };
    sheet.getCell(totalRow, 2).font = { bold: true };
  } else {
    sheet.getCell(3, 1).value = "Bu koşuda hata oluşmadı.";
  }

  const originStart = 5 + Math.max(1, model.defects.length) + 2;
  sectionTitle(sheet, originStart - 1, "Kaynak istasyon dağılımı", 4);
  ["İstasyon", "Adet", "Pay"].forEach((text, index) => {
    const cell = sheet.getCell(originStart, index + 1);
    cell.value = text;
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFF8FAFC" }, size: 10 };
  });
  model.defectsByOrigin.forEach((row, index) => {
    const excelRow = originStart + 1 + index;
    sheet.getCell(excelRow, 1).value = row.stationId;
    sheet.getCell(excelRow, 2).value = row.count;
    sheet.getCell(excelRow, 3).value = total === 0 ? 0 : row.count / total;
    sheet.getCell(excelRow, 3).numFmt = PERCENT;
  });

  const gateStart = originStart + model.defectsByOrigin.length + 3;
  sectionTitle(sheet, gateStart - 1, "Kalite kapıları", 8);
  const gateHeader = [
    "İstasyon",
    "Kamera",
    "Yöntem",
    "Tanımlı yakalama",
    "Muayene",
    "Red",
    "Yakalanan hata",
    "Yanlış red",
  ];
  gateHeader.forEach((text, index) => {
    const cell = sheet.getCell(gateStart, index + 1);
    cell.value = text;
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFF8FAFC" }, size: 10 };
  });
  model.gates.forEach((gate, index) => {
    const excelRow = gateStart + 1 + index;
    sheet.getCell(excelRow, 1).value = gate.stationName;
    sheet.getCell(excelRow, 2).value = gate.camera;
    sheet.getCell(excelRow, 3).value = gate.method;
    sheet.getCell(excelRow, 4).value = gate.configuredRecall;
    sheet.getCell(excelRow, 4).numFmt = PERCENT;
    sheet.getCell(excelRow, 5).value = gate.inspections;
    sheet.getCell(excelRow, 6).value = gate.rejections;
    sheet.getCell(excelRow, 7).value = gate.caught;
    sheet.getCell(excelRow, 8).value = gate.falseRejections;
  });
}

function buildWorkOrders(book: ExcelJS.Workbook, model: ReportModel): void {
  const sheet = book.addWorksheet("İş Emirleri");
  addTable(
    sheet,
    [
      { header: "İş emri", key: "id", width: 16 },
      { header: "Model", key: "model", width: 12 },
      { header: "Durum", key: "status", width: 16 },
      { header: "Plan", key: "quantity", width: 9, format: NUMBER },
      { header: "Açılan", key: "released", width: 9, format: NUMBER },
      { header: "Tamamlanan", key: "completed", width: 12, format: NUMBER },
      { header: "Hurda", key: "scrapped", width: 9, format: NUMBER },
      { header: "Kalan", key: "remaining", width: 9, format: NUMBER },
      { header: "Termin (dk)", key: "dueMinute", width: 12, format: NUMBER },
      { header: "Kalan süre", key: "minutesLeft", width: 12, format: MINUTES },
    ],
    model.workOrders as unknown as readonly Row[],
  );

  sheet.getCell(1, 11).value = "Gereken süre";
  sheet.getCell(1, 12).value = "Yetişir mi";
  for (const column of [11, 12]) {
    const cell = sheet.getCell(1, column);
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFF8FAFC" }, size: 10 };
    sheet.getColumn(column).width = 14;
  }
  model.workOrders.forEach((_order, index) => {
    const row = index + 2;
    sheet.getCell(row, 11).value = { formula: `H${row}*${model.metrics.taktTime}` };
    sheet.getCell(row, 11).numFmt = MINUTES;
    sheet.getCell(row, 12).value = { formula: `IF(K${row}<=J${row},"Yolunda","Riskli")` };
  });
}

function buildShipments(book: ExcelJS.Workbook, model: ReportModel): void {
  const sheet = book.addWorksheet("Sevkiyat");
  addTable(
    sheet,
    [
      { header: "Sevkiyat", key: "id", width: 16 },
      { header: "Müşteri", key: "customer", width: 22 },
      { header: "Varış", key: "destination", width: 16 },
      { header: "Durum", key: "status", width: 14 },
      { header: "Yüklenen", key: "loaded", width: 10, format: NUMBER },
      { header: "Kapasite", key: "capacity", width: 10, format: NUMBER },
      { header: "Planlanan çıkış (dk)", key: "plannedDeparture", width: 18, format: NUMBER },
      { header: "Gerçek çıkış (dk)", key: "actualDeparture", width: 16, format: NUMBER },
      { header: "Gecikme", key: "delayMinutes", width: 12, format: MINUTES },
    ],
    model.shipments as unknown as readonly Row[],
  );
}

function buildInventory(book: ExcelJS.Workbook, model: ReportModel): void {
  const sheet = book.addWorksheet("Stok");
  addTable(
    sheet,
    [
      { header: "Malzeme", key: "materialId", width: 16 },
      { header: "Parti", key: "batchId", width: 22 },
      { header: "Lokasyon", key: "location", width: 24 },
      { header: "Durum", key: "status", width: 14 },
      { header: "Adet", key: "quantity", width: 10, format: NUMBER },
      { header: "Giriş (dk)", key: "receivedAt", width: 12, format: NUMBER },
    ],
    model.inventory as unknown as readonly Row[],
  );
}

function buildProducts(book: ExcelJS.Workbook, model: ReportModel): void {
  const sheet = book.addWorksheet("Araçlar");
  addTable(
    sheet,
    [
      { header: "Araç", key: "id", width: 18 },
      { header: "İş emri", key: "workOrderId", width: 16 },
      { header: "Model", key: "model", width: 11 },
      { header: "Durum", key: "status", width: 16 },
      { header: "Hatta giriş (dk)", key: "releasedAt", width: 15, format: NUMBER },
      { header: "Tamamlanma (dk)", key: "completedAt", width: 16, format: NUMBER },
      { header: "Akış süresi", key: "leadTime", width: 13, format: MINUTES },
      { header: "Tamir turu", key: "reworkPasses", width: 11, format: NUMBER },
      { header: "Hata", key: "defects", width: 8, format: NUMBER },
      { header: "Kaçan hata", key: "escapedDefects", width: 11, format: NUMBER },
      { header: "Sevkiyat", key: "shipmentId", width: 16 },
      { header: "Kullanılan partiler", key: "lots", width: 52 },
      { header: "Rota", key: "route", width: 60 },
    ],
    model.products as unknown as readonly Row[],
  );
}

function buildEvents(book: ExcelJS.Workbook, model: ReportModel): void {
  const sheet = book.addWorksheet("Olay Kaydı");
  addTable(
    sheet,
    [
      { header: "Dakika", key: "minute", width: 9, format: NUMBER },
      { header: "Saat", key: "clock", width: 9 },
      { header: "Olay", key: "typeLabel", width: 22 },
      { header: "Olay kodu", key: "type", width: 24 },
      { header: "Kaynak", key: "source", width: 20 },
      { header: "İlgili kayıt", key: "correlationId", width: 20 },
      { header: "Detay", key: "detail", width: 54 },
    ],
    model.events as unknown as readonly Row[],
  );
}

function buildAlerts(book: ExcelJS.Workbook, model: ReportModel): void {
  const sheet = book.addWorksheet("Alarmlar");
  addTable(
    sheet,
    [
      { header: "Dakika", key: "minute", width: 9, format: NUMBER },
      { header: "Kod", key: "code", width: 18 },
      { header: "Şiddet", key: "severity", width: 10 },
      { header: "İlgili", key: "entityId", width: 20 },
      { header: "Açık mı", key: "open", width: 9 },
      { header: "Görüldü", key: "acknowledged", width: 10 },
      { header: "Mesaj", key: "message", width: 90 },
    ],
    model.alerts as unknown as readonly Row[],
  );
}

function buildRisk(book: ExcelJS.Workbook, model: ReportModel): void {
  const sheet = book.addWorksheet("Bakım Riski");
  addTable(
    sheet,
    [
      { header: "İstasyon", key: "machineId", width: 14 },
      { header: "Ad", key: "station", width: 22 },
      { header: "Risk puanı", key: "score", width: 12, format: "0.000" },
      { header: "Arıza", key: "failures", width: 9, format: NUMBER },
      { header: "Duruş", key: "downtimeTicks", width: 11, format: MINUTES },
      { header: "Son arızadan beri", key: "minutesSinceLastFailure", width: 17, format: MINUTES },
      {
        header: "Arızalar arası (MTBF)",
        key: "meanTimeBetweenFailures",
        width: 20,
        format: MINUTES,
      },
      { header: "Gerekçe", key: "reason", width: 66 },
    ],
    model.risk as unknown as readonly Row[],
  );
  sheet.getCell(model.risk.length + 3, 1).value =
    "Not: Bu sıralama geçmiş gözlemlere dayanır. Tahmin modeli değildir; titreşim, sıcaklık ya da başka bir durum sinyali kullanmaz.";
  sheet.getCell(model.risk.length + 3, 1).font = {
    italic: true,
    size: 9,
    color: { argb: "FF64748B" },
  };
}

/** Build the workbook and return it as a buffer ready to write or serve. */
export async function buildWorkbook(model: ReportModel): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = BRAND.full;
  book.created = model.generatedAt;
  book.title = `${BRAND.NAME} — ${model.lineId} üretim analizi`;
  book.description = `${model.scenarioLabel} · ${clock(model.simulatedMinutes)} · tohum ${model.seed}`;

  buildSummary(book, model);
  buildStations(book, model);
  buildQuality(book, model);
  buildWorkOrders(book, model);
  buildShipments(book, model);
  buildInventory(book, model);
  buildProducts(book, model);
  buildAlerts(book, model);
  buildRisk(book, model);
  buildEvents(book, model);

  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
