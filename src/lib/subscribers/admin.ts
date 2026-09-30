import { and, count, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db";
import { dataAudit, officers, subscribers, suppressions } from "@/db/schema";

export const PAGE_SIZE = 50;

export const subscriberFilter = z.object({
  q: z.string().trim().max(200).optional().default(""),
  status: z.enum(["pending", "active", "unsubscribed", "bounced", "complained"]).or(z.literal("")).optional().default(""),
  grade: z.string().trim().max(10).optional().default(""),
  teacher: z.string().trim().max(80).optional().default(""),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});
export type SubscriberFilter = z.infer<typeof subscriberFilter>;

export function filterFromSearchParams(sp: URLSearchParams | Record<string, string | undefined>): SubscriberFilter {
  const get = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) : sp[k]) ?? undefined;
  return subscriberFilter.parse({ q: get("q"), status: get("status"), grade: get("grade"), teacher: get("teacher"), page: get("page") });
}

// LIKE wildcards in user input are literal characters, not patterns.
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function where(f: SubscriberFilter): SQL | undefined {
  return and(
    f.q ? ilike(subscribers.email, `%${likeEscape(f.q.toLowerCase())}%`) : undefined,
    f.status ? eq(subscribers.status, f.status) : undefined,
    f.grade ? eq(subscribers.grade, f.grade) : undefined,
    f.teacher ? ilike(subscribers.teacher, `%${likeEscape(f.teacher)}%`) : undefined,
  );
}

// Fully qualified: drizzle leaves column refs unqualified inside select lists.
const suppressionReason = sql<string | null>`(select sp.reason from ${suppressions} sp where sp.email = "subscribers"."email")`;

const columns = {
  id: subscribers.id,
  email: subscribers.email,
  grade: subscribers.grade,
  teacher: subscribers.teacher,
  status: subscribers.status,
  consentAt: subscribers.consentAt,
  confirmedAt: subscribers.confirmedAt,
  createdAt: subscribers.createdAt,
  suppression: suppressionReason,
};

export async function searchSubscribers(db: DbOrTx, f: SubscriberFilter) {
  const w = where(f);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select(columns)
      .from(subscribers)
      .where(w)
      .orderBy(desc(subscribers.createdAt), subscribers.id)
      .limit(PAGE_SIZE)
      .offset((f.page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(subscribers).where(w),
  ]);
  return { rows, total, page: f.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function statusCounts(db: DbOrTx) {
  const rows = await db.select({ status: subscribers.status, n: count() }).from(subscribers).groupBy(subscribers.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<(typeof rows)[number]["status"], number>>;
}

export class SubscriberNotFound extends Error {}

/**
 * Permanently deletes a subscriber (e.g. a family's data-deletion request).
 * Past send rows keep their stats with the subscriber link removed.
 * With `suppress`, the address also goes on the do-not-mail list so it can't
 * be mailed again even if re-added; without it, the family may re-subscribe.
 */
export async function deleteSubscriber(db: Db, actorId: string, id: string, opts: { suppress: boolean }) {
  return db.transaction(async (tx) => {
    const [row] = await tx.delete(subscribers).where(eq(subscribers.id, id)).returning();
    if (!row) throw new SubscriberNotFound("Subscriber not found");
    if (opts.suppress) {
      await tx.insert(suppressions).values({ email: row.email, reason: "manual", source: "officer-delete" }).onConflictDoNothing();
    }
    await tx.insert(dataAudit).values({
      action: "subscriber_delete",
      actorId,
      details: { subscriberId: row.id, status: row.status, suppressed: opts.suppress },
    });
    return row;
  });
}

const CSV_COLUMNS = ["email", "grade", "teacher", "status", "on_do_not_mail_list", "consent_at", "confirmed_at", "created_at"] as const;

/** Quotes a CSV cell and defuses spreadsheet formula injection (=, +, -, @, tab, CR). */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of every subscriber matching the filter (all pages). Tokens are never exported. */
export async function exportSubscribersCsv(db: Db, actorId: string, f: SubscriberFilter): Promise<{ csv: string; count: number }> {
  const rows = await db.select(columns).from(subscribers).where(where(f)).orderBy(subscribers.email);
  const lines = [
    CSV_COLUMNS.join(","),
    ...rows.map((r) =>
      [r.email, r.grade, r.teacher, r.status, r.suppression ? "yes" : "no", r.consentAt, r.confirmedAt, r.createdAt].map(csvCell).join(","),
    ),
  ];
  const { page: _page, ...filter } = f;
  await db.insert(dataAudit).values({ action: "subscriber_export", actorId, details: { count: rows.length, filter } });
  return { csv: lines.join("\r\n") + "\r\n", count: rows.length };
}

export async function listDataAudit(db: DbOrTx, limit = 50) {
  return db
    .select({ id: dataAudit.id, action: dataAudit.action, details: dataAudit.details, timestamp: dataAudit.timestamp, actorEmail: officers.email })
    .from(dataAudit)
    .innerJoin(officers, eq(officers.id, dataAudit.actorId))
    .orderBy(desc(dataAudit.timestamp), desc(dataAudit.id))
    .limit(limit);
}
