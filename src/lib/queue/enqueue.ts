import { count, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { campaigns, sends, subscribers } from "@/db/schema";
import { DEFAULT_BRAND_ROW, getBrandRow } from "@/lib/brand";
import { recipientFilter } from "@/lib/campaigns/recipients";
import { archiveMode, renderCampaign } from "@/lib/campaigns/render";
import { CampaignError, EDITABLE } from "@/lib/campaigns/service";
import { hasBlocker } from "@/lib/render/checks";

/**
 * Freezes the campaign (rendered HTML + plaintext with an unsubscribe-token
 * placeholder, plus the archive copy) and queues one sends row per eligible
 * recipient. The unique (campaign, subscriber) index makes this idempotent.
 */
export async function enqueueCampaign(db: Db, campaignId: string, officerId: string) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).for("update");
    if (!c) throw new CampaignError(404, "Newsletter not found");
    if (!EDITABLE.includes(c.status as never)) throw new CampaignError(409, `Newsletter is already ${c.status}.`);

    const brand = await getBrandRow(tx);
    if (brand.ptaMailingAddress === DEFAULT_BRAND_ROW.ptaMailingAddress) {
      throw new CampaignError(422, "Set the PTA mailing address in Brand settings before sending (required by CAN-SPAM).");
    }

    const email = await renderCampaign(tx, c);
    if (hasBlocker(email.checks)) {
      throw new CampaignError(422, email.checks.filter((x) => x.level === "block").map((x) => x.message).join(" "), email.checks);
    }
    const archive = await renderCampaign(tx, c, { mode: archiveMode() });

    const where = await recipientFilter(tx, c.segmentId);
    const [{ n }] = await tx.select({ n: count() }).from(subscribers).where(where);
    if (n === 0) throw new CampaignError(422, "No eligible recipients in this audience.");

    await tx
      .update(campaigns)
      .set({
        status: "sending",
        renderedHtml: email.html,
        plaintextBody: email.text,
        archiveHtml: archive.html,
        sentBy: officerId,
        approvedBy: c.approvedBy ?? officerId,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, c.id));

    const { rows: inserted } = await tx.execute<{ id: string }>(sql`
      insert into ${sends} (campaign_id, subscriber_id)
      select ${c.id}::uuid, ${subscribers.id} from ${subscribers} where ${where}
      on conflict (campaign_id, subscriber_id) do nothing
      returning id`);
    return { queued: inserted.length };
  });
}

export async function campaignStats(db: Db, campaignId: string) {
  const rows = await db
    .select({ status: sends.status, n: count() })
    .from(sends)
    .where(eq(sends.campaignId, campaignId))
    .groupBy(sends.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  const total = rows.reduce((a, r) => a + r.n, 0);
  return {
    total,
    queued: (by.queued ?? 0) + (by.sending ?? 0),
    sent: by.sent ?? 0,
    failed: by.failed ?? 0,
    skipped: by.skipped ?? 0,
    bounced: by.bounced ?? 0,
    complained: by.complained ?? 0,
  };
}

