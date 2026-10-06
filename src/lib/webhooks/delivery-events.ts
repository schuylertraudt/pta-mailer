import { inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { sendClicks, sends } from "@/db/schema";
import { env } from "@/lib/env";
import { suppressEmail } from "@/lib/subscribers/service";

/**
 * Provider-neutral handling of delivery events, shared by the SES and Brevo
 * webhooks. Every function is safe to call twice for the same event.
 */

const MAX_URL = 2000;

/** Message ids as stored and as reported can differ only by surrounding angle brackets. */
function idVariants(messageId: string) {
  const bare = messageId.trim().replace(/^<|>$/g, "");
  return [...new Set([messageId, bare, `<${bare}>`])];
}

export function eventTime(v: string | number | undefined) {
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : v ? new Date(v) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Permanent failure or spam report: suppress the address for good and mark the send. */
export async function recordSuppression(
  db: Db,
  kind: "bounce" | "complaint",
  emails: string[],
  source: string,
  messageId: string | undefined,
) {
  await db.transaction(async (tx) => {
    for (const email of emails) await suppressEmail(tx, email, kind, source);
    if (messageId) {
      await tx
        .update(sends)
        .set({ status: kind === "bounce" ? "bounced" : "complained" })
        .where(inArray(sends.providerMessageId, idVariants(messageId)));
    }
  });
}

/** `count: false` records the first open without adding to the count (a duplicate "unique open" event). */
export async function recordOpen(db: Db, messageId: string, at: Date, opts: { count?: boolean } = {}) {
  const rows = await db
    .update(sends)
    .set({
      ...(opts.count !== false && { openCount: sql`${sends.openCount} + 1` }),
      firstOpenedAt: sql`least(coalesce(${sends.firstOpenedAt}, ${at}), ${at})`,
    })
    .where(inArray(sends.providerMessageId, idVariants(messageId)))
    .returning({ id: sends.id });
  return rows.length > 0;
}

/** Links that are ours (unsubscribe, view online) aren't engagement and may carry tokens. */
function isOwnLink(url: string) {
  const base = env().APP_URL;
  return url.startsWith(`${base}/u/`) || url.startsWith(`${base}/archive/`) || url.startsWith(`${base}/api/unsubscribe/`);
}

export async function recordClick(db: Db, messageId: string, link: string | undefined, at: Date) {
  const url = (link ?? "").slice(0, MAX_URL);
  if (url && isOwnLink(url)) return "ignored own link";
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(sends)
      .set({ clickCount: sql`${sends.clickCount} + 1`, firstClickedAt: sql`least(coalesce(${sends.firstClickedAt}, ${at}), ${at})` })
      .where(inArray(sends.providerMessageId, idVariants(messageId)))
      .returning({ id: sends.id });
    if (!row) return "ignored click";
    if (url) {
      await tx
        .insert(sendClicks)
        .values({ sendId: row.id, url, firstAt: at })
        .onConflictDoUpdate({ target: [sendClicks.sendId, sendClicks.url], set: { clicks: sql`${sendClicks.clicks} + 1` } });
    }
    return "click recorded";
  });
}

/** The provider refused to deliver (e.g. its own blocklist): fail the send, keep the subscriber. */
export async function recordRefused(db: Db, messageId: string, reason: string) {
  const rows = await db
    .update(sends)
    .set({ status: "failed", lastError: reason.slice(0, 500) })
    .where(inArray(sends.providerMessageId, idVariants(messageId)))
    .returning({ id: sends.id });
  return rows.length > 0;
}
