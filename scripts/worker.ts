/**
 * Long-running send worker for hosts without Vercel Cron (e.g. Hetzner).
 * Run under systemd or a process manager: `npm run worker`.
 */
import { createDb } from "@/db";
import { env } from "@/lib/env";
import { getEmailProvider } from "@/lib/mail/provider";
import { processQueue } from "@/lib/queue/dispatch";

const { db } = createDb(env().DATABASE_URL);
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));

while (!stopping) {
  try {
    const r = await processQueue(db, getEmailProvider(), { ratePerSecond: env().SEND_RATE_PER_SECOND, deadlineMs: 50_000 });
    if (r.sent || r.failed || r.retried || r.skipped) console.log(new Date().toISOString(), r);
  } catch (e) {
    console.error("queue run failed", e);
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
process.exit(0);
