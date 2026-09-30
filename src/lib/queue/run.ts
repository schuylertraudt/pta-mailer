import { getDb } from "@/db";
import { env } from "@/lib/env";
import { getEmailProvider } from "@/lib/mail/provider";
import { processQueue } from "./dispatch";

export function runQueueOnce() {
  return processQueue(getDb(), getEmailProvider(), { ratePerSecond: env().SEND_RATE_PER_SECOND, deadlineMs: 50_000 });
}
