/**
 * Long-running send worker for hosts without Vercel Cron (e.g. a VPS).
 * Run under systemd or a process manager: `npm run worker`.
 */
import { runQueueOnce } from "@/lib/queue/run";

let stopping = false;
let wake: () => void = () => {};
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    wake();
  });
}

while (!stopping) {
  try {
    const r = await runQueueOnce();
    if (r.sent || r.failed || r.retried || r.skipped || r.confirmations) console.log(new Date().toISOString(), r);
  } catch (e) {
    console.error("queue run failed", e);
  }
  // Pause between sweeps; a stop signal ends the pause early.
  await new Promise<void>((r) => {
    const t = setTimeout(r, 15_000);
    wake = () => {
      clearTimeout(t);
      r();
    };
  });
}
process.exit(0);
