import { and, count, eq, exists, inArray, isNotNull, notExists, or, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { segments, subscriberSegments, subscribers, suppressions } from "@/db/schema";
import { parseSegmentRule } from "@/lib/segment-rule";

/**
 * The only definition of "may receive a campaign": confirmed, active, and not
 * on the suppression list (regardless of subscriber status).
 */
export function eligibleRecipientWhere(): SQL {
  return and(
    eq(subscribers.status, "active"),
    isNotNull(subscribers.confirmedAt),
    notExists(sql`(select 1 from ${suppressions} where ${suppressions.email} = ${subscribers.email})`),
  )!;
}

async function segmentWhere(db: DbOrTx, seg: typeof segments.$inferSelect): Promise<SQL | undefined> {
  const rule = parseSegmentRule(seg.rule);
  switch (rule.kind) {
    case "all":
      return undefined;
    case "school":
      return eq(subscribers.school, rule.value);
    case "committee":
      return exists(
        db
          .select({ one: sql`1` })
          .from(subscriberSegments)
          .where(and(eq(subscriberSegments.segmentId, seg.id), eq(subscriberSegments.subscriberId, subscribers.id))),
      );
  }
}

/**
 * Anyone in any of the audiences. `null` means no audience filter (every
 * eligible subscriber); an empty list means nobody.
 */
async function audienceWhere(db: DbOrTx, segmentIds: string[] | null): Promise<SQL | undefined> {
  if (segmentIds === null) return undefined;
  const ids = [...new Set(segmentIds)];
  if (!ids.length) return sql`false`;
  const rows = await db.select().from(segments).where(inArray(segments.id, ids));
  if (rows.length !== ids.length) throw new Error("Audience not found");
  const parts = await Promise.all(rows.map((seg) => segmentWhere(db, seg)));
  if (parts.some((p) => p === undefined)) return undefined;
  return or(...(parts as SQL[]));
}

export async function recipientFilter(db: DbOrTx, segmentIds: string[] | null): Promise<SQL> {
  return and(eligibleRecipientWhere(), await audienceWhere(db, segmentIds))!;
}

export async function countRecipients(db: DbOrTx, segmentIds: string[] | null): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(subscribers).where(await recipientFilter(db, segmentIds));
  return n;
}

export async function listRecipients(db: DbOrTx, segmentIds: string[] | null) {
  return db
    .select({ id: subscribers.id, email: subscribers.email })
    .from(subscribers)
    .where(await recipientFilter(db, segmentIds));
}

/** First `limit` recipients by email, for "View selected recipients". */
export async function sampleRecipients(db: DbOrTx, segmentIds: string[], limit: number) {
  return db
    .select({ email: subscribers.email, school: subscribers.school })
    .from(subscribers)
    .where(await recipientFilter(db, segmentIds))
    .orderBy(subscribers.email)
    .limit(limit);
}
