import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db";
import { subscribers, suppressions } from "@/db/schema";
import { emailSchema } from "@/lib/email";
import { GRADES } from "@/lib/grades";
import { getEmailProvider } from "@/lib/mail/provider";
import { simpleEmail } from "@/lib/mail/transactional";
import { hitRateLimit } from "@/lib/rate-limit";
import { generateToken } from "@/lib/tokens";
import { confirmPageUrl } from "@/lib/urls";

export const CONFIRM_TOKEN_TTL_MS = 7 * 24 * 3600_000;

export const subscribeInput = z.object({
  email: emailSchema,
  grade: z.enum(GRADES),
  teacher: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
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
      grade: input.grade,
      teacher: input.teacher,
      status: "pending",
      consentAt: now,
      confirmToken: token,
      unsubscribeToken: generateToken(),
    });
  } else if (existing.status === "pending" || existing.status === "unsubscribed") {
    // Re-subscribing after an unsubscribe requires a fresh double opt-in.
    await db
      .update(subscribers)
      .set({ status: "pending", grade: input.grade, teacher: input.teacher, consentAt: now, confirmToken: token, confirmedAt: null })
      .where(eq(subscribers.id, existing.id));
  } else {
    // active, bounced, complained: nothing to do.
    return "noop";
  }

  const { html, text } = simpleEmail({
    heading: "Confirm your PTA newsletter subscription",
    paragraphs: [
      "Someone (hopefully you) asked to receive PTA news at this address.",
      "Tap the button below to confirm. If this wasn't you, ignore this email and you won't hear from us.",
    ],
    button: { label: "Confirm subscription", url: confirmPageUrl(token) },
    footer: "This link expires in 7 days.",
  });
  await getEmailProvider().send({ to: input.email, subject: "Confirm your PTA newsletter subscription", html, text });
  return "sent_confirmation";
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

