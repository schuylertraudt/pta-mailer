import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db";
import { segments, subscriberSegments, subscribers } from "@/db/schema";
import { countRecipients } from "@/lib/campaigns/recipients";
import { normalizeEmail } from "@/lib/email";
import { formatSegmentRule, parseSegmentRule } from "@/lib/segment-rule";
import { SCHOOLS } from "@/lib/schools";

export const segmentInput = z.object({
  name: z.string().trim().min(1).max(100),
  rule: z.string().trim().transform((r, ctx) => {
    try {
      return formatSegmentRule(parseSegmentRule(r));
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  }),
});

export async function listSegmentsWithCounts(db: DbOrTx) {
  const rows = await db.select().from(segments).orderBy(segments.name);
  return Promise.all(rows.map(async (s) => ({ ...s, recipients: await countRecipients(db, [s.id]) })));
}

export const ALL_SUBSCRIBERS = "All subscribers";

/**
 * "All subscribers" plus one audience per school, so they can be picked in the
 * composer from day one. Idempotent; skips one if any audience already has its
 * rule or its name.
 */
export async function ensureDefaultSegments(db: DbOrTx) {
  for (const [name, rule] of [[ALL_SUBSCRIBERS, "all"], ...SCHOOLS.map((s) => [s, `school=${s}`])]) {
    await db.execute(sql`
      insert into ${segments} (name, rule)
      select ${name}, ${rule}
      where not exists (select 1 from ${segments} where rule = ${rule} or name = ${name})`);
  }
}

export async function createSegment(db: DbOrTx, raw: z.input<typeof segmentInput>) {
  const v = segmentInput.parse(raw);
  const [row] = await db.insert(segments).values(v).returning();
  return row;
}

/** Committee segments: add existing subscribers by email. Unknown emails are reported, not created. */
export async function addMembers(db: DbOrTx, segmentId: string, emails: string[]) {
  const list = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (!list.length) return { added: 0, unknown: [] as string[] };
  const found = await db.select({ id: subscribers.id, email: subscribers.email }).from(subscribers).where(inArray(subscribers.email, list));
  if (found.length) {
    await db
      .insert(subscriberSegments)
      .values(found.map((f) => ({ subscriberId: f.id, segmentId })))
      .onConflictDoNothing();
  }
  const known = new Set(found.map((f) => f.email));
  return { added: found.length, unknown: list.filter((e) => !known.has(e)) };
}

export async function removeMember(db: DbOrTx, segmentId: string, email: string) {
  const [s] = await db.select({ id: subscribers.id }).from(subscribers).where(eq(subscribers.email, normalizeEmail(email)));
  if (s) {
    await db
      .delete(subscriberSegments)
      .where(and(eq(subscriberSegments.segmentId, segmentId), eq(subscriberSegments.subscriberId, s.id)));
  }
}

export async function listMembers(db: DbOrTx, segmentId: string) {
  return db
    .select({ email: subscribers.email, status: subscribers.status })
    .from(subscriberSegments)
    .innerJoin(subscribers, eq(subscribers.id, subscriberSegments.subscriberId))
    .where(eq(subscriberSegments.segmentId, segmentId))
    .orderBy(subscribers.email);
}
