import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { campaigns, sends, subscribers, suppressions } from "@/db/schema";
import type { EmailProvider } from "@/lib/mail/provider";
import { listUnsubscribeHeaders, UNSUBSCRIBE_TOKEN_PLACEHOLDER } from "@/lib/urls";

export const MAX_ATTEMPTS = 5;
/** A row stuck in "sending" this long means a worker died mid-send. */
export const STALE_SENDING_MS = 15 * 60_000;

export function backoffMs(attempt: number): number {
  return Math.min(3600_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

/** Provider errors that will never succeed on retry. */
function isPermanent(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? "";
  return ["MessageRejected", "InvalidParameterValue", "BadRequestException"].includes(name);
}

export type DispatchOptions = {
  ratePerSecond: number;
  batchSize?: number;
  /** Stop claiming new work after this many ms (serverless time limits). */
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

type Claimed = { id: string; campaign_id: string; subscriber_id: string; attempts: number };

async function claimBatch(db: Db, n: number): Promise<Claimed[]> {
  // SKIP LOCKED lets several workers run without ever claiming the same row.
  // next_attempt_at doubles as the lease start while a row is "sending".
  const { rows } = await db.execute<Claimed>(sql`
    update ${sends} set status = 'sending', attempts = attempts + 1, next_attempt_at = now()
    where id in (
      select id from ${sends}
      where status = 'queued' and next_attempt_at <= now()
      order by created_at, id
      limit ${n}
      for update skip locked
    )
    returning id, campaign_id, subscriber_id, attempts`);
  return rows;
}

/**
 * Never re-send a row whose outcome is unknown: the provider may have accepted
 * it. Mark it failed for a human to look at instead of risking a duplicate.
 */
async function failStaleLeases(db: Db) {
  await db.execute(sql`
    update ${sends} set status = 'failed', last_error = 'Interrupted while sending; not retried to avoid a duplicate'
    where status = 'sending' and next_attempt_at < now() - make_interval(secs => ${STALE_SENDING_MS / 1000})`);
}

async function finalizeCampaigns(db: Db) {
  await db.execute(sql`
    update ${campaigns} c set
      status = case when exists (select 1 from ${sends} s where s.campaign_id = c.id and s.status in ('sent','bounced','complained'))
                    then 'sent'::campaign_status else 'failed'::campaign_status end,
      sent_at = now(), updated_at = now()
    where c.status = 'sending'
      and not exists (select 1 from ${sends} s where s.campaign_id = c.id and s.status in ('queued','sending'))`);
}

/**
 * Sends queued mail at the provider's rate. Every row is re-checked against
 * suppressions and subscriber status at dispatch time, not just queue time.
 */
export async function processQueue(db: Db, provider: EmailProvider, opts: DispatchOptions) {
  const started = Date.now();
  const deadline = opts.deadlineMs ?? 50_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const interval = 1000 / opts.ratePerSecond;
  const campaignCache = new Map<string, typeof campaigns.$inferSelect>();
  const result = { sent: 0, failed: 0, skipped: 0, retried: 0 };
  let lastSend = 0;

  await failStaleLeases(db);

  while (Date.now() - started < deadline) {
    const batch = await claimBatch(db, opts.batchSize ?? 25);
    if (batch.length === 0) break;

    for (const row of batch) {
      let c = campaignCache.get(row.campaign_id);
      if (!c) {
        [c] = await db.select().from(campaigns).where(eq(campaigns.id, row.campaign_id));
        campaignCache.set(row.campaign_id, c);
      }
      const [sub] = await db
        .select({
          email: subscribers.email,
          status: subscribers.status,
          confirmedAt: subscribers.confirmedAt,
          token: subscribers.unsubscribeToken,
          // Fully qualified on purpose: drizzle leaves column refs unqualified in select lists.
          suppressed: sql<boolean>`exists (select 1 from ${suppressions} sp where sp.email = "subscribers"."email")`,
        })
        .from(subscribers)
        .where(eq(subscribers.id, row.subscriber_id));

      const skipReason = !sub
        ? "subscriber deleted"
        : sub.suppressed
          ? "suppressed"
          : sub.status !== "active" || !sub.confirmedAt
            ? `subscriber ${sub.status}`
            : !c?.renderedHtml || !c.plaintextBody
              ? "campaign not rendered"
              : null;
      if (skipReason) {
        await db.update(sends).set({ status: "skipped", lastError: skipReason }).where(eq(sends.id, row.id));
        result.skipped++;
        continue;
      }

      const wait = lastSend + interval - Date.now();
      if (wait > 0) await sleep(wait);
      lastSend = Date.now();

      try {
        const token = sub!.token;
        const { messageId } = await provider.send({
          to: sub!.email,
          subject: c!.subject,
          html: c!.renderedHtml!.replaceAll(UNSUBSCRIBE_TOKEN_PLACEHOLDER, token),
          text: c!.plaintextBody!.replaceAll(UNSUBSCRIBE_TOKEN_PLACEHOLDER, token),
          headers: { ...listUnsubscribeHeaders(token), "X-PTA-Campaign": c!.id },
        });
        await db
          .update(sends)
          .set({ status: "sent", providerMessageId: messageId, sentAt: new Date(), lastError: null })
          .where(and(eq(sends.id, row.id), eq(sends.status, "sending")));
        result.sent++;
      } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        if (isPermanent(e) || row.attempts >= MAX_ATTEMPTS) {
          await db.update(sends).set({ status: "failed", lastError: msg }).where(eq(sends.id, row.id));
          result.failed++;
        } else {
          await db
            .update(sends)
            .set({ status: "queued", lastError: msg, nextAttemptAt: new Date(Date.now() + backoffMs(row.attempts)) })
            .where(eq(sends.id, row.id));
          result.retried++;
        }
      }
    }
  }

  await finalizeCampaigns(db);
  return result;
}
