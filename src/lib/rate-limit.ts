import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";

/**
 * Fixed-window counter stored in Postgres, so it holds across serverless
 * instances. Returns true when the call is within the limit.
 */
export async function hitRateLimit(db: DbOrTx, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { rows } = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count)
    values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then now() else rate_limits.window_start end
    returning count
  `);
  return Number(rows[0].count) <= limit;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
