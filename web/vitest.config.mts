import { defineConfig } from "vitest/config";

/**
 * The command centre's testable surface is its pure logic: how a published
 * frame becomes floor positions, and how factory state becomes colour and
 * words. Those are the parts that can be silently wrong, so those are the parts
 * under test. Rendering is verified by looking at it.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
