import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";
import { env } from "@/lib/env";
import { getActiveProvider, pauseSending } from "@/lib/mail/active";
import { QuotaExceededError } from "@/lib/mail/provider";
import { sendDueConfirmations } from "@/lib/subscribers/service";
import { processQueue } from "./dispatch";

export async function runQueueOnce() {
  const db = getDb();
  // Housekeeping: expired rate-limit windows (all windows are <= 1 hour).
  await db.delete(rateLimits).where(sql`${rateLimits.windowStart} < now() - interval '1 day'`);
  const provider = await getActiveProvider(db);
  const result = await processQueue(db, provider, { ratePerSecond: env().SEND_RATE_PER_SECOND, deadlineMs: 50_000 });
  // Confirmation emails that failed at signup go out once sending works again.
  let confirmations = 0;
  if (!result.paused) {
    try {
      confirmations = await sendDueConfirmations(db);
    } catch (e) {
      if (e instanceof QuotaExceededError) await pauseSending(db, `${e.name}: ${e.message}`);
      else console.error("confirmation retry failed", e);
    }
  }
  return { ...result, confirmations };
}
