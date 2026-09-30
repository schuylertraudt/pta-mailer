import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runQueueOnce } from "@/lib/queue/run";

export const maxDuration = 60;

function authorized(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Vercel Cron (every minute) or any scheduler with the bearer secret. */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const result = await runQueueOnce();
  return Response.json(result);
}
