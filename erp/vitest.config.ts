import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  resolve: { alias: { "server-only": r("./tests/stubs/server-only.ts"), "@": r("./") } },
  test: {
    include: ["tests/**/*.test.ts"], globalSetup: ["tests/global-setup.ts"], testTimeout: 30000, hookTimeout: 60000,
    fileParallelism: false,
    env: { DATABASE_URL: "postgresql://erp_app:erp_app_pw@127.0.0.1:5432/erp_test", BILLING_PROVIDER: "test", TEST_WEBHOOK_SECRET: "test-secret", APP_URL: "http://localhost:3100" },
  },
});
