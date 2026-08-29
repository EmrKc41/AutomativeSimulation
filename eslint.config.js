import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // The web app carries its own flat config (eslint-config-next); linting it
  // from here would also sweep in Turbopack build output.
  {
    ignores: [
      "node_modules/",
      "coverage/",
      "web/",
      "design-system/",
      ".next/",
      ".github/",
      // Third-party clone that lives inside the project directory.
      "kit-app-template/",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node build scripts and CLIs legitimately use the Node globals.
    files: ["scripts/**/*.mjs", "src/**/*-cli.ts", "src/cli.ts", "src/server.ts"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
