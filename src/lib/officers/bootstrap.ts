import { and, count, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { officerAudit, officers } from "@/db/schema";
import { emailSchema } from "@/lib/email";
import { lockAdminSet } from "./locks";

export type BootstrapResult =
  | { status: "unconfigured" }
  | { status: "disabled" }
  | { status: "created" | "promoted"; officerId: string };

/**
 * Creates the first admin from BOOTSTRAP_ADMIN_EMAIL. Permanently a no-op once
 * any active admin exists, so a leaked or stale env var cannot mint admins.
 *
 * If no active admin exists and the email already has an officers row
 * (e.g. every admin was deactivated), that same row is promoted and
 * reactivated rather than duplicated.
 */
export async function bootstrapAdmin(db: Db, rawEmail: string | undefined): Promise<BootstrapResult> {
  if (!rawEmail?.trim()) return { status: "unconfigured" };
  const email = emailSchema.parse(rawEmail);

  return db.transaction(async (tx) => {
    await lockAdminSet(tx);

    const [{ n }] = await tx
      .select({ n: count() })
      .from(officers)
      .where(and(eq(officers.role, "admin"), eq(officers.active, true)));
    if (n > 0) return { status: "disabled" } as const;

    const [existing] = await tx.select().from(officers).where(eq(officers.email, email));
    if (existing) {
      await tx
        .update(officers)
        .set({ role: "admin", active: true, deactivatedAt: null })
        .where(eq(officers.id, existing.id));
      await tx.insert(officerAudit).values({
        officerId: existing.id,
        action: "bootstrap",
        actorId: null,
        details: { previousRole: existing.role, previousActive: existing.active },
      });
      return { status: "promoted", officerId: existing.id } as const;
    }

    const [created] = await tx
      .insert(officers)
      .values({ email, role: "admin", name: null })
      .returning({ id: officers.id });
    await tx.insert(officerAudit).values({
      officerId: created.id,
      action: "bootstrap",
      actorId: null,
      details: { email },
    });
    return { status: "created", officerId: created.id } as const;
  });
}

export function bootstrapAdminFromEnv(db: Db): Promise<BootstrapResult> {
  return bootstrapAdmin(db, process.env.BOOTSTRAP_ADMIN_EMAIL);
}
