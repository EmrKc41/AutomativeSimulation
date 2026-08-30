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
const script = path.join(here, "build_assets.py");

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

const wanted = process.argv.slice(2);
console.log(`Blender : ${blender}`);
console.log(`Çıktı   : ${path.relative(root, outDir)}`);

const output = execFileSync(
  blender,
  ["--background", "--python", script, "--", outDir, ...wanted],
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
