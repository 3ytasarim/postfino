import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/*/src/**/*.test.ts", "apps/api/src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    // Each test file boots its own PGlite (WASM Postgres); unbounded parallelism exhausts memory on dev machines.
    maxWorkers: 4,
  },
});
