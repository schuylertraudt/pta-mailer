import { defineConfig } from "vitest/config";
import path from "node:path";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pta_mailer_test";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    // Tests share one Postgres database; run files serially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      TEST_DATABASE_URL,
      APP_URL: "https://pta.example.org",
      AUTH_SECRET: "test-secret-test-secret-test-secret",
      EMAIL_PROVIDER: "memory",
      EMAIL_FROM: "Example PTA <news@pta.example.org>",
      UNSUBSCRIBE_MAILTO: "unsubscribe@pta.example.org",
      STORAGE_DRIVER: "memory",
      STORAGE_PUBLIC_BASE_URL: "https://images.pta.example.org",
      SNS_TOPIC_ARNS: "arn:aws:sns:us-east-1:123456789012:pta-ses-events",
      CRON_SECRET: "cron-secret",
      SEND_RATE_PER_SECOND: "1000",
      BOOTSTRAP_ADMIN_EMAIL: "",
    },
  },
});
