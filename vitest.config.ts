import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname), "server-only": path.resolve(__dirname, "tests/stubs/empty.ts") } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 60000, hookTimeout: 60000, fileParallelism: false, globalSetup: ["tests/global-setup.ts"],
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://mfg_app:app@localhost/mfg_test" } },
});
