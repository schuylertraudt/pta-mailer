import { z } from "zod";

const FREEMAIL = /@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|aol|proton|protonmail)\./i;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url().transform((u) => u.replace(/\/+$/, "")),
  AUTH_SECRET: z.string().min(16),

  EMAIL_PROVIDER: z.enum(["ses", "memory", "console"]).default("console"),
  // Role address on the PTA domain, e.g. "Example PTA <news@pta.example.org>". Never personal.
  EMAIL_FROM: z
    .string()
    .min(3)
    .refine((v) => !FREEMAIL.test(v), "EMAIL_FROM must be a role address on the PTA domain, not a personal mailbox"),
  EMAIL_REPLY_TO: z.string().optional(),
  UNSUBSCRIBE_MAILTO: z.email().optional(),
  // Not AWS_*: Vercel reserves those names.
  SES_REGION: z.string().optional(),
  SES_ACCESS_KEY_ID: z.string().optional(),
  SES_SECRET_ACCESS_KEY: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().optional(),
  // Messages per second allowed by the provider account (SES default production quota is 14).
  SEND_RATE_PER_SECOND: z.coerce.number().positive().default(10),

  // Comma-separated SNS topic ARNs whose notifications the webhook accepts.
  SNS_TOPIC_ARNS: z.string().default(""),
  CRON_SECRET: z.string().optional(),

  STORAGE_DRIVER: z.enum(["s3", "memory"]).default("s3"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  // Private bucket for unprocessed originals (defaults to S3_BUCKET under incoming/).
  S3_INCOMING_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Public HTTPS base for stored images, e.g. https://images.pta.example.org
  STORAGE_PUBLIC_BASE_URL: z.url().transform((u) => u.replace(/\/+$/, "")),

  TURNSTILE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

/** https, or plain http only for a local production build (next start on localhost). */
export function isHttpsOrLocal(url: string): boolean {
  const u = new URL(url);
  return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname));
}

let cached: Env | undefined;

/** Validated environment. Throws a readable error listing every bad variable. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && !isHttpsOrLocal(parsed.data.STORAGE_PUBLIC_BASE_URL)) {
    throw new Error("STORAGE_PUBLIC_BASE_URL must be https in production");
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached env after mutating process.env. */
export function resetEnvCache() {
  cached = undefined;
}
