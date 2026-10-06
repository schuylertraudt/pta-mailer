import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db";
import { subscribers, suppressions } from "@/db/schema";
import { emailSchema } from "@/lib/email";
import { SCHOOLS } from "@/lib/schools";
import { getActiveProvider } from "@/lib/mail/active";
import { simpleEmail } from "@/lib/mail/transactional";
import { DEFAULT_BRAND_ROW, getBrandRow } from "@/lib/brand";
import { SITE } from "@/lib/site";
import { hitRateLimit } from "@/lib/rate-limit";
import { generateToken } from "@/lib/tokens";
import { confirmPageUrl } from "@/lib/urls";

export const CONFIRM_TOKEN_TTL_MS = 7 * 24 * 3600_000;

export const subscribeInput = z.object({
  email: emailSchema,
  school: z.enum(SCHOOLS),
});
export type SubscribeInput = z.input<typeof subscribeInput>;

export type SubscribeOutcome = "sent_confirmation" | "noop" | "rate_limited";

export async function isSuppressed(db: DbOrTx, email: string) {
  const [row] = await db.select().from(suppressions).where(eq(suppressions.email, email));
  return row;
}

/**
 * Public subscribe. Always leaves the address pending until the confirmation
 * link is used. The caller shows the same message for every non-error outcome
 * so the form cannot be used to probe who is subscribed.
 */
export async function subscribe(db: Db, raw: SubscribeInput, meta: { ip: string }): Promise<SubscribeOutcome> {
  const input = subscribeInput.parse(raw);

  const ipOk = await hitRateLimit(db, `subscribe:ip:${meta.ip}`, 10, 3600);
  const emailOk = await hitRateLimit(db, `subscribe:email:${input.email}`, 3, 3600);
  if (!ipOk || !emailOk) return "rate_limited";

  const suppression = await isSuppressed(db, input.email);
  // Bounced, complained or manually blocked addresses get nothing, not even a confirmation.
  if (suppression && suppression.reason !== "unsubscribe") return "noop";

  const token = generateToken();
  const now = new Date();
  const [existing] = await db.select().from(subscribers).where(eq(subscribers.email, input.email));

  if (!existing) {
    await db.insert(subscribers).values({
      email: input.email,
      school: input.school,
      status: "pending",
      consentAt: now,
      confirmToken: token,
      unsubscribeToken: generateToken(),
    });
  } else if (existing.status === "pending" || existing.status === "unsubscribed") {
    // Re-subscribing after an unsubscribe requires a fresh double opt-in.
    await db
      .update(subscribers)
      .set({ status: "pending", school: input.school, consentAt: now, confirmToken: token, confirmedAt: null, confirmEmailDueAt: null })
      .where(eq(subscribers.id, existing.id));
  } else {
    // active, bounced, complained: nothing to do.
    return "noop";
  }

  try {
    await sendConfirmation(db, input.email, token);
  } catch (e) {
    // The family still sees "check your email"; the send worker retries.
    console.error("confirmation email failed; will retry", e);
    await db.update(subscribers).set({ confirmEmailDueAt: now }).where(eq(subscribers.email, input.email));
  }
  return "sent_confirmation";
}

/**
 * The double opt-in email. It names the organization and its postal address:
 * a recognizable sender and real-looking content help it stay out of spam,
 * which matters most while the sending domain is new.
 */
async function sendConfirmation(db: DbOrTx, email: string, token: string) {
  const brand = await getBrandRow(db);
  const address = brand.ptaMailingAddress === DEFAULT_BRAND_ROW.ptaMailingAddress ? "" : brand.ptaMailingAddress;
  const subject = `Confirm your ${SITE.shortName} email signup`;
  const { html, text } = simpleEmail({
    heading: subject,
    paragraphs: [
      `Thanks for signing up for email updates from the ${SITE.shortName} (${SITE.orgName.replace(/^the /, "")}).`,
      "Tap the button below to confirm your email address. If you didn't sign up, ignore this email and you won't hear from us.",
    ],
    button: { label: "Confirm my signup", url: confirmPageUrl(token) },
    footer: [`This link expires in 7 days.`, SITE.shortName, address].filter(Boolean).join(" · "),
  });
  await (await getActiveProvider(db)).send({ to: email, subject, html, text });
}

/**
 * Retries confirmation emails that couldn't be sent at signup (e.g. the
 * provider's daily limit). Stops at the first failure; the next run tries again.
 */
export async function sendDueConfirmations(db: Db, limit = 50) {
  const due = await db
    .select({ id: subscribers.id, email: subscribers.email, token: subscribers.confirmToken })
    .from(subscribers)
    .where(and(eq(subscribers.status, "pending"), isNotNull(subscribers.confirmEmailDueAt), isNotNull(subscribers.confirmToken)))
    .orderBy(subscribers.confirmEmailDueAt)
    .limit(limit);
  let sent = 0;
  for (const s of due) {
    await sendConfirmation(db, s.email, s.token!);
    await db.update(subscribers).set({ confirmEmailDueAt: null }).where(eq(subscribers.id, s.id));
    sent++;
  }
  return sent;
}

export async function findPendingByConfirmToken(db: DbOrTx, token: string) {
  const [row] = await db
    .select()
    .from(subscribers)
    .where(and(eq(subscribers.confirmToken, token), eq(subscribers.status, "pending")));
  if (!row || Date.now() - row.consentAt.getTime() > CONFIRM_TOKEN_TTL_MS) return undefined;
  return row;
}

export async function confirmSubscription(db: Db, token: string): Promise<"confirmed" | "invalid"> {
  return db.transaction(async (tx) => {
    const row = await findPendingByConfirmToken(tx, token);
    if (!row) return "invalid";
    const suppression = await isSuppressed(tx, row.email);
    if (suppression && suppression.reason !== "unsubscribe") return "invalid";
    await tx
      .update(subscribers)
      .set({ status: "active", confirmedAt: new Date(), confirmToken: null })
      .where(eq(subscribers.id, row.id));
    // A confirmed re-opt-in is an explicit request to receive mail again.
    if (suppression) {
      await tx
        .delete(suppressions)
        .where(and(eq(suppressions.email, row.email), eq(suppressions.reason, "unsubscribe")));
    }
    return "confirmed";
  });
}

export type UnsubscribeSource = "link" | "one-click" | "mailto";

/** Idempotent. Suppresses immediately; the token identifies exactly one subscriber. */
export async function unsubscribeByToken(
  db: Db,
  token: string,
  source: UnsubscribeSource,
): Promise<"unsubscribed" | "invalid"> {
  if (!token || token.length < 43) return "invalid";
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(subscribers).where(eq(subscribers.unsubscribeToken, token));
    if (!row) return "invalid";
    if (row.status === "active" || row.status === "pending") {
      await tx
        .update(subscribers)
        .set({ status: "unsubscribed", confirmToken: null })
        .where(eq(subscribers.id, row.id));
    }
    await tx
      .insert(suppressions)
      .values({ email: row.email, reason: "unsubscribe", source: `unsubscribe:${source}` })
      .onConflictDoNothing();
    return "unsubscribed";
  });
}

export async function findByUnsubscribeToken(db: DbOrTx, token: string) {
  const [row] = await db.select({ id: subscribers.id, status: subscribers.status }).from(subscribers).where(eq(subscribers.unsubscribeToken, token));
  return row;
}

/** Adds an address to suppressions (bounce/complaint/manual) and updates the subscriber if any. */
export async function suppressEmail(
  db: DbOrTx,
  email: string,
  reason: "bounce" | "complaint" | "manual" | "unsubscribe",
  source: string,
) {
  await db.insert(suppressions).values({ email, reason, source }).onConflictDoNothing();
  const status = reason === "bounce" ? "bounced" : reason === "complaint" ? "complained" : "unsubscribed";
  await db
    .update(subscribers)
    .set({ status, confirmToken: null })
    .where(eq(subscribers.email, email));
}

