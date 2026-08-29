import { mkdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

/**
 * Prepare the brand assets, once.
 *
 * The source files are large full-bleed renders. Every surface needs a
 * different crop and size — a 28px header plaque, a square app icon, a print
 * mark in the PDF — and shipping the 800 KB original to all three would be
 * lazy. Run this again only when the source artwork changes:
 *
 *   node scripts/prepare-brand.mjs
 *
 * `sharp` is a devDependency for exactly this reason: it runs here, never at
 * request time, so the app has no native dependency to install.
 */

const SOURCE = "assets/brand";
const WEB = "web/public/brand";
const APP = "web/src/app";
const PRINT = "assets/brand";

async function main() {
  await mkdir(WEB, { recursive: true });

  const wide = sharp(path.join(SOURCE, "logo.jpg"));
  const { width = 0, height = 0 } = await wide.metadata();

  // The wide render has a wide dark margin around the plaque; trim it so the
  // header shows the mark rather than the mark plus its backdrop.
  const plaque = sharp(path.join(SOURCE, "logo.jpg")).extract({
    left: Math.round(width * 0.045),
    top: Math.round(height * 0.09),
    width: Math.round(width * 0.91),
    height: Math.round(height * 0.82),
  });

  // WebP, not PNG: the mark is a photographic gradient, and PNG stores that
  // badly — the same image is roughly fifteen times smaller this way, on a file
  // the header loads on every visit.
  await plaque
    .clone()
    .resize({ width: 640 })
    .webp({ quality: 86 })
    .toFile(path.join(WEB, "logo.webp"));

  await plaque
    .clone()
    .resize({ width: 320 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(path.join(PRINT, "logo-print.jpg"));

  // The icon source centres a square mark on a light field; take the middle
  // square so the glyph fills the tab, not the background.
  const iconSide = Math.min(width, height);
  const icon = sharp(path.join(SOURCE, "favicon.jpg")).extract({
    left: Math.round((width - iconSide) / 2),
    top: Math.round((height - iconSide) / 2),
    width: iconSide,
    height: iconSide,
  });

  // Next.js App Router picks these up by file name, no <link> needed.
  // 192px is the largest size a browser actually asks for; 512 was 400 KB of
  // detail nobody renders.
  await icon
    .clone()
    .resize(192, 192)
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(path.join(APP, "icon.png"));
  await icon
    .clone()
    .resize(180, 180)
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(path.join(APP, "apple-icon.png"));
  await icon.clone().resize(256, 256).webp({ quality: 88 }).toFile(path.join(WEB, "mark.webp"));

  const report = [
    [path.join(WEB, "logo.webp"), "üst bar"],
    [path.join(WEB, "mark.webp"), "kare marka"],
    [path.join(APP, "icon.png"), "favicon"],
    [path.join(APP, "apple-icon.png"), "iOS ikonu"],
    [path.join(PRINT, "logo-print.jpg"), "PDF ve Excel"],
  ];
  const { statSync } = await import("node:fs");
  for (const [file, use] of report) {
    console.log(
      `${file.padEnd(34)} ${(statSync(file).size / 1024).toFixed(0).padStart(5)} KB  ${use}`,
    );
  }
}

await main();
