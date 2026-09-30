import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";
import { env } from "@/lib/env";
import { getEmailProvider } from "@/lib/mail/provider";
import { processQueue } from "./dispatch";

export async function runQueueOnce() {
  const db = getDb();
  // Housekeeping: expired rate-limit windows (all windows are <= 1 hour).
  await db.delete(rateLimits).where(sql`${rateLimits.windowStart} < now() - interval '1 day'`);
  return processQueue(db, getEmailProvider(), { ratePerSecond: env().SEND_RATE_PER_SECOND, deadlineMs: 50_000 });
}
