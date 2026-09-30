import { and, count, eq, exists, isNotNull, notExists, sql, type SQL } from "drizzle-orm";
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

async function segmentWhere(db: DbOrTx, segmentId: string | null): Promise<SQL | undefined> {
  if (!segmentId) return undefined;
  const [seg] = await db.select().from(segments).where(eq(segments.id, segmentId));
  if (!seg) throw new Error(`Segment ${segmentId} not found`);
  const rule = parseSegmentRule(seg.rule);
  switch (rule.kind) {
    case "all":
      return undefined;
    case "grade":
      return eq(subscribers.grade, rule.value);
    case "teacher":
      return eq(subscribers.teacher, rule.value);
    case "committee":
      return exists(
        db
          .select({ one: sql`1` })
          .from(subscriberSegments)
          .where(and(eq(subscriberSegments.segmentId, seg.id), eq(subscriberSegments.subscriberId, subscribers.id))),
      );
  }
}

export async function recipientFilter(db: DbOrTx, segmentId: string | null): Promise<SQL> {
  return and(eligibleRecipientWhere(), await segmentWhere(db, segmentId))!;
}

export async function countRecipients(db: DbOrTx, segmentId: string | null): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(subscribers).where(await recipientFilter(db, segmentId));
  return n;
}

export async function listRecipients(db: DbOrTx, segmentId: string | null) {
  return db
    .select({ id: subscribers.id, email: subscribers.email })
    .from(subscribers)
    .where(await recipientFilter(db, segmentId));
}
