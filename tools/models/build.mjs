import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Varlıkları Blender ile üret.
 *
 * Blender'ın yolu makineden makineye değişiyor ve bir kurulum yolunu betiğe
 * gömmek, projeyi klonlayan herkesin ilk işini "neden bulamıyor" diye aramak
 * yapar. Burada sırayla: `BLENDER` ortam değişkeni, `PATH`, sonra Windows'un
 * bilinen kurulum klasörleri denenir; hiçbiri yoksa ne yapılacağı yazılır.
 *
 *   npm run models              → hepsini üret
 *   npm run models -- tir       → yalnızca tırı üret
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const outDir = path.join(root, "web", "public", "models");
const buildScript = path.join(here, "build_assets.py");
const previewScript = path.join(here, "preview.py");
const previewOut = path.join(root, "docs", "onizleme.png");
/** Satir ayirici: Blender ciktisinda hem LF hem CRLF gorulebiliyor. */
const NEWLINES = new RegExp(String.fromCharCode(13) + "?" + String.fromCharCode(10));

function findBlender() {
  if (process.env["BLENDER"]) return process.env["BLENDER"];

  // On PATH?
  try {
    execFileSync("blender", ["--version"], { stdio: "ignore" });
    return "blender";
  } catch {
    // Not on PATH; keep looking.
  }

  // Windows keeps versioned folders, so the newest one wins rather than a
  // pinned version that goes stale on the next upgrade.
  for (const base of [
    "C:/Program Files/Blender Foundation",
    "C:/Program Files (x86)/Blender Foundation",
  ]) {
    if (!existsSync(base)) continue;
    const versions = readdirSync(base)
      .filter((name) => statSync(path.join(base, name)).isDirectory())
      .sort()
      .reverse();
    for (const version of versions) {
      const candidate = path.join(base, version, "blender.exe");
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const blender = findBlender();
if (blender === null) {
  console.error(
    [
      "Blender bulunamadı.",
      "",
      "  winget install BlenderFoundation.Blender",
      "",
      "Kurulu ama başka bir yerdeyse yolu verin:",
      '  BLENDER="C:/.../blender.exe" npm run models',
      "",
      "Not: `.glb` dosyaları depoda mevcut, yani Blender yalnızca modelleri",
      "değiştirecekseniz gerekli. Projeyi çalıştırmak için gerekmiyor.",
    ].join("\n"),
  );
  process.exit(1);
}

const argv = process.argv.slice(2);

/**
 * Önizleme modu.
 *
 * Varlıkları üretmek başka, **neye benzediklerini görmek** başka. Geliştirme
 * ortamındaki tarayıcı paneli kare üretmediği için sahne render edilmiyordu ve
 * modeller görülmeden gönderiliyordu — bir tur bu yüzden ölçeği tamamen yanlış
 * çıktı. Bu mod aynı `.glb` dosyalarını fabrika yerleşimine dizip tek bir PNG
 * yazıyor, yani iş kontrol edilebiliyor.
 */
if (argv[0] === "--onizleme") {
  console.log(`Blender : ${blender}`);
  const out = execFileSync(
    blender,
    ["--background", "--python", previewScript, "--", outDir, previewOut],
    { encoding: "utf8" },
  );
  const line = out.split(NEWLINES).find((row) => row.startsWith("ONIZLEME "));
  if (!line) {
    console.error("Önizleme üretilemedi. Blender çıktısı:" + out);
    process.exit(1);
  }
  console.log(`Önizleme: ${path.relative(root, previewOut)}`);
  process.exit(0);
}

const wanted = argv;
console.log(`Blender : ${blender}`);
console.log(`Çıktı   : ${path.relative(root, outDir)}`);

const output = execFileSync(
  blender,
  ["--background", "--python", buildScript, "--", outDir, ...wanted],
  { encoding: "utf8" },
);

const built = output
  .split(/\r?\n/)
  .filter((line) => line.startsWith("VARLIK "))
  .map((line) => line.split(" "));

if (built.length === 0) {
  console.error("Hiçbir varlık üretilmedi. Blender çıktısı:\n" + output);
  process.exit(1);
}

console.log("");
for (const [, name, bytes, polygons] of built) {
  console.log(
    `  ${String(name).padEnd(10)} ${(Number(bytes) / 1024).toFixed(1).padStart(7)} KB  ${String(polygons).padStart(5)} poligon`,
  );
}
console.log(`\n${built.length} varlık üretildi.`);
