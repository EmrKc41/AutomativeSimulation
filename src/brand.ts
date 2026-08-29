/**
 * The brand, in one place.
 *
 * The name appears on the header, the browser tab, the PDF shift report and the
 * Excel workbook. Keeping it here means renaming the company is one edit rather
 * than a search across four surfaces that would inevitably miss one.
 *
 * `NAME` is already uppercase and contains `İ`. That is deliberate — it is the
 * company's own spelling, and the UI renders under `lang="tr"` so nothing
 * re-cases it into `KOC OTOMOTIV`.
 */
export const BRAND = {
  /** The company. */
  NAME: "KOÇ OTOMOTİV",
  /** What this piece of software is. */
  PRODUCT: "Fabrika Komuta Merkezi",
  /** Used where only one line fits. */
  full: "KOÇ OTOMOTİV — Fabrika Komuta Merkezi",
} as const;
