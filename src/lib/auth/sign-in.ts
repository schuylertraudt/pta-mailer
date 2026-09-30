import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { officers } from "@/db/schema";
import { normalizeEmail } from "@/lib/email";
import { bootstrapAdminFromEnv } from "@/lib/officers/bootstrap";

export type GoogleIdentity = { sub: string; email?: string | null; emailVerified?: boolean | null };
export type SignInDecision =
  | { ok: true; officerId: string }
  | { ok: false; reason: "unverified_email" | "not_allowed" | "account_mismatch" };

/**
 * The officer allowlist gate for Google sign-in.
 *  - email_verified must be true.
 *  - A bound google_sub is authoritative: match on it, never on email.
 *  - Otherwise the verified email must match an active officer with no bound sub; bind it now.
 */
export async function authorizeGoogleSignIn(db: Db, id: GoogleIdentity): Promise<SignInDecision> {
  if (id.emailVerified !== true || !id.email || !id.sub) return { ok: false, reason: "unverified_email" };
  const email = normalizeEmail(id.email);

  // Creates the first admin if configured and no active admin exists; no-op otherwise.
  await bootstrapAdminFromEnv(db);

  return db.transaction(async (tx) => {
    const [bySub] = await tx.select().from(officers).where(eq(officers.googleSub, id.sub)).for("update");
    if (bySub) {
      if (!bySub.active) return { ok: false, reason: "not_allowed" } as const;
      await tx.update(officers).set({ lastLoginAt: new Date() }).where(eq(officers.id, bySub.id));
      return { ok: true, officerId: bySub.id } as const;
    }

    const [byEmail] = await tx
      .select()
      .from(officers)
      .where(and(eq(officers.email, email), eq(officers.active, true)))
      .for("update");
    if (!byEmail) return { ok: false, reason: "not_allowed" } as const;
    // Email matches but a different Google account is already bound (e.g. recreated account).
    if (byEmail.googleSub) return { ok: false, reason: "account_mismatch" } as const;

    await tx
      .update(officers)
      .set({ googleSub: id.sub, lastLoginAt: new Date() })
      .where(eq(officers.id, byEmail.id));
    return { ok: true, officerId: byEmail.id } as const;
  });
}
