import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db";
import { officers, sendingSettings } from "@/db/schema";
import { env } from "@/lib/env";
import { configuredProviders, overriddenProvider, providerByName, type EmailProvider, type ProviderName } from "./provider";

/** How long to wait before trying again after the provider says its quota is used up. */
export const QUOTA_RETRY_MS = 60 * 60_000;

export const PROVIDER_LABEL: Record<ProviderName, string> = { ses: "Amazon SES", brevo: "Brevo" };

export class SendingError extends Error {
  constructor(
    public status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

async function readRow(db: DbOrTx) {
  const [row] = await db.select().from(sendingSettings).where(eq(sendingSettings.id, true));
  return row;
}

/** The provider that sends right now: the admin's choice, else EMAIL_PROVIDER. */
export async function activeProviderName(db: DbOrTx): Promise<ProviderName | "console" | "memory"> {
  const row = await readRow(db);
  return (row?.provider as ProviderName | null) ?? env().EMAIL_PROVIDER;
}

export async function getActiveProvider(db: DbOrTx): Promise<EmailProvider> {
  return overriddenProvider() ?? providerByName(await activeProviderName(db));
}

/** A pause that is still in effect, or null. */
export async function currentPause(db: DbOrTx) {
  const row = await readRow(db);
  if (!row?.pausedUntil || row.pausedUntil <= new Date()) return null;
  return { until: row.pausedUntil, reason: row.pauseReason ?? "" };
}

export async function pauseSending(db: DbOrTx, reason: string, ms = QUOTA_RETRY_MS) {
  const until = new Date(Date.now() + ms);
  await db
    .insert(sendingSettings)
    .values({ id: true, pausedUntil: until, pauseReason: reason.slice(0, 500) })
    .onConflictDoUpdate({ target: sendingSettings.id, set: { pausedUntil: until, pauseReason: reason.slice(0, 500) } });
  return until;
}

export const switchInput = z.object({ provider: z.enum(["ses", "brevo"]) });

/** Switches the sending service. Clears any quota pause, since it belonged to the old provider. */
export async function switchProvider(db: DbOrTx, officerId: string, raw: z.input<typeof switchInput>) {
  const { provider } = switchInput.parse(raw);
  if (!configuredProviders()[provider]) {
    throw new SendingError(400, `${PROVIDER_LABEL[provider]} isn't set up on the server yet. Add its settings to /etc/pta-mailer.env and restart.`);
  }
  const values = { provider, pausedUntil: null, pauseReason: null, updatedBy: officerId, updatedAt: new Date() };
  await db.insert(sendingSettings).values({ id: true, ...values }).onConflictDoUpdate({ target: sendingSettings.id, set: values });
  return sendingStatus(db);
}

/** Everything the Sending page shows. */
export async function sendingStatus(db: DbOrTx) {
  const e = env();
  const [row] = await db
    .select({ provider: sendingSettings.provider, updatedAt: sendingSettings.updatedAt, updatedBy: officers.email })
    .from(sendingSettings)
    .leftJoin(officers, eq(officers.id, sendingSettings.updatedBy))
    .where(eq(sendingSettings.id, true));
  const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from sends where status in ('queued', 'sending')`);
  return {
    active: (row?.provider as ProviderName | null) ?? e.EMAIL_PROVIDER,
    chosenBy: row?.provider ? { email: row.updatedBy, at: row.updatedAt } : null,
    configured: configuredProviders(),
    missing: {
      ses: [
        !e.SES_REGION && "SES_REGION",
        !e.SES_ACCESS_KEY_ID && "SES_ACCESS_KEY_ID",
        !e.SES_SECRET_ACCESS_KEY && "SES_SECRET_ACCESS_KEY",
      ].filter(Boolean) as string[],
      brevo: [!e.BREVO_API_KEY && "BREVO_API_KEY"].filter(Boolean) as string[],
    },
    // Optional extras that enable bounce/complaint/open/click reporting.
    reporting: { ses: !!(e.SES_CONFIGURATION_SET && e.SNS_TOPIC_ARNS), brevo: !!e.BREVO_WEBHOOK_SECRET },
    pause: await currentPause(db),
    queued: rows[0]?.n ?? 0,
  };
}
