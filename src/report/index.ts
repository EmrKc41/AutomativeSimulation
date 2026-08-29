export { buildReportModel, clock, type ReportModel, type ReportOptions } from "./model.ts";
export { buildWorkbook } from "./workbook.ts";
export { buildPdf } from "./pdf.ts";

/** File names a plant would recognise on disk, dated by plant clock. */
export function reportFileName(
  kind: "xlsx" | "pdf",
  lineId: string,
  scenario: string,
  minute: number,
): string {
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  const stem = kind === "xlsx" ? "uretim-analizi" : "vardiya-raporu";
  return `${stem}_${lineId}_${scenario}_${hours}${minutes}.${kind}`;
}
