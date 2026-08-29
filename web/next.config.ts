import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
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
