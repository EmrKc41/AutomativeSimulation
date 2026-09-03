import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Yayın sürümü tamamen statik.
 *
 * Motor tarayıcıda koştuğu için sunucu tarafında çalışacak bir şey yok:
 * `output: "export"` ile site düz HTML/JS/CSS'e dönüşüyor ve GitHub Pages gibi
 * bir yerde **süresiz** durabiliyor — uyuyan süreç, soğuk başlangıç, aylık
 * ücret yok.
 *
 * `basePath` deponun adı, çünkü Pages siteyi `/<depo>/` altında sunuyor. Yerel
 * geliştirmede boş kalıyor; aksi hâlde `npm run dev` kök yolda hiçbir şey
 * bulamazdı.
 */
const yayin = process.env.NEXT_PUBLIC_ENGINE_MODE === "local";
const altYol = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  ...(yayin
    ? {
        output: "export" as const,
        basePath: altYol,
        // Statik sunucularda `/yol` yerine `/yol/index.html` beklenir.
        trailingSlash: true,
        // Görsel eniyileme sunucu ister; statik dışa aktarımda kapalı.
        images: { unoptimized: true },
      }
    : {}),
  /**
   * The repository root, not the app directory.
   *
   * The command centre imports the engine's Turkish glossary (`src/labels.ts`)
   * so a status is never called one thing on a screen and another in a report.
   * That file lives one level up, so Turbopack has to be told the workspace
   * really does extend past `web/` — otherwise it refuses to resolve it.
   */
  turbopack: { root: path.join(here, "..") },
};

export default nextConfig;
