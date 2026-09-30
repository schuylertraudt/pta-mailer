import { and, count, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db, DbOrTx } from "@/db";
import { officerAudit, officers, sessions } from "@/db/schema";
import { emailSchema } from "@/lib/email";
import type { Role } from "@/lib/auth/roles";
import { getEmailProvider } from "@/lib/mail/provider";
import { simpleEmail } from "@/lib/mail/transactional";
import { env } from "@/lib/env";
import { lockAdminSet } from "./locks";

export const MIN_ACTIVE_ADMINS = 2;

type Officer = typeof officers.$inferSelect;
type Actor = Pick<Officer, "id" | "email" | "name">;

export class OfficerError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

export const roleSchema = z.enum(["admin", "sender", "drafter"]);
export const addOfficerInput = z.object({
  email: emailSchema,
  role: roleSchema,
  name: z.string().trim().max(100).optional().transform((v) => v || null),
});

/** Test seam: lets tests force a failure mid-transaction to prove rollback. */
export type TxHooks = { beforeCommit?: (tx: DbOrTx) => Promise<void> };

async function activeAdminCount(tx: DbOrTx) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(officers)
    .where(and(eq(officers.role, "admin"), eq(officers.active, true)));
  return n;
}

async function getForUpdate(tx: DbOrTx, id: string) {
  const [o] = await tx.select().from(officers).where(eq(officers.id, id)).for("update");
  if (!o) throw new OfficerError(404, "Team member not found");
  return o;
}

/** Throws if the change would leave fewer than MIN_ACTIVE_ADMINS active admins. Call under lockAdminSet. */
async function assertAdminFloor(tx: DbOrTx, target: Officer, after: { role: Role; active: boolean }) {
  const losesAdmin = target.active && target.role === "admin" && !(after.active && after.role === "admin");
  if (!losesAdmin) return;
  if ((await activeAdminCount(tx)) - 1 < MIN_ACTIVE_ADMINS) {
    throw new OfficerError(
      422,
      `At least ${MIN_ACTIVE_ADMINS} active admins are required. Add or promote another admin first.`,
    );
  }
}

const RANK: Record<Role, number> = { drafter: 0, sender: 1, admin: 2 };

type Snapshot = { role: Role; active: boolean } | null;
type Change = { officer: Officer; before: Snapshot; after: { role: Role; active: boolean } };

export function notificationKind(before: Snapshot, after: { role: Role; active: boolean }) {
  const gained =
    after.active &&
    (after.role === "admin" || after.role === "sender") &&
    !(before?.active && RANK[before.role] >= RANK[after.role]);
  const adminRemoved = !!before?.active && before.role === "admin" && !(after.active && after.role === "admin");
  if (adminRemoved) return "admin_removed" as const;
  if (gained) return "granted" as const;
  return null;
}

/**
 * Emails all active admins and the affected officer. Runs after commit; a mail
 * failure is logged, never rolled back into the officer change.
 */
async function notify(db: Db, actor: Actor, change: Change) {
  const kind = notificationKind(change.before, change.after);
  if (!kind) return;
  try {
    const admins = await db
      .select({ email: officers.email })
      .from(officers)
      .where(and(eq(officers.role, "admin"), eq(officers.active, true)));
    const to = new Set([...admins.map((a) => a.email), change.officer.email]);
    const who = change.officer.name ? `${change.officer.name} (${change.officer.email})` : change.officer.email;
    const by = actor.name ? `${actor.name} (${actor.email})` : actor.email;
    const subject =
      kind === "granted"
        ? `PTA mailer: ${who} was granted ${change.after.role} access`
        : `PTA mailer: ${who} is no longer an admin`;
    const detail =
      kind === "granted"
        ? `${by} granted ${who} the ${change.after.role} role. ${change.after.role === "admin" ? "Admins can manage the team and send to all families." : "Senders can send newsletters to all families."}`
        : change.after.active
          ? `${by} changed ${who} from admin to ${change.after.role}.`
          : `${by} deactivated ${who}. Their sessions were ended immediately.`;
    const { html, text } = simpleEmail({
      heading: subject.replace("PTA mailer: ", ""),
      paragraphs: [detail, "If this wasn't expected, sign in and review the team list and audit log now."],
      button: { label: "Review team", url: `${env().APP_URL}/admin/team` },
    });
    const provider = getEmailProvider();
    await Promise.all([...to].map((addr) => provider.send({ to: addr, subject, html, text })));
  } catch (e) {
    console.error("officer notification failed", e);
  }
}

export async function addOfficer(db: Db, actor: Actor, raw: z.input<typeof addOfficerInput>) {
  const input = addOfficerInput.parse(raw);
  const officer = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(officers).where(eq(officers.email, input.email));
    if (existing) {
      throw new OfficerError(
        409,
        existing.active ? "That email is already on the team." : "That team member is deactivated. Reactivate them instead.",
      );
    }
    const [o] = await tx
      .insert(officers)
      .values({ email: input.email, role: input.role, name: input.name, addedBy: actor.id })
      .returning();
    await tx.insert(officerAudit).values({
      officerId: o.id,
      action: "add",
      actorId: actor.id,
      details: { email: o.email, role: o.role },
    });
    return o;
  });
  await notify(db, actor, { officer, before: null, after: { role: officer.role, active: true } });
  return officer;
}

export async function changeRole(db: Db, actor: Actor, officerId: string, rawRole: Role, hooks: TxHooks = {}) {
  const role = roleSchema.parse(rawRole);
  const { before, officer } = await db.transaction(async (tx) => {
    await lockAdminSet(tx);
    const target = await getForUpdate(tx, officerId);
    if (!target.active) throw new OfficerError(409, "Reactivate this team member before changing their role.");
    if (target.role === role) return { before: target, officer: target };
    await assertAdminFloor(tx, target, { role, active: true });
    const [o] = await tx.update(officers).set({ role }).where(eq(officers.id, target.id)).returning();
    await tx.insert(officerAudit).values({
      officerId: target.id,
      action: "role_change",
      actorId: actor.id,
      details: { from: target.role, to: role },
    });
    await hooks.beforeCommit?.(tx);
    return { before: target, officer: o };
  });
  if (before.role !== officer.role) {
    await notify(db, actor, { officer, before: { role: before.role, active: true }, after: { role: officer.role, active: true } });
  }
  return officer;
}

/** One transaction: mark inactive, delete every session, write audit. */
export async function deactivateOfficer(db: Db, actor: Actor, officerId: string, hooks: TxHooks = {}) {
  const { before, officer } = await db.transaction(async (tx) => {
    await lockAdminSet(tx);
    const target = await getForUpdate(tx, officerId);
    if (!target.active) throw new OfficerError(409, "Already deactivated.");
    await assertAdminFloor(tx, target, { role: target.role, active: false });
    const [o] = await tx
      .update(officers)
      .set({ active: false, deactivatedAt: new Date() })
      .where(eq(officers.id, target.id))
      .returning();
    const killed = await tx.delete(sessions).where(eq(sessions.officerId, target.id)).returning({ t: sessions.sessionToken });
    await tx.insert(officerAudit).values({
      officerId: target.id,
      action: "deactivate",
      actorId: actor.id,
      details: { role: target.role, sessionsRevoked: killed.length, self: target.id === actor.id },
    });
    await hooks.beforeCommit?.(tx);
    return { before: target, officer: o };
  });
  await notify(db, actor, { officer, before: { role: before.role, active: true }, after: { role: officer.role, active: false } });
  return officer;
}

/** Same row, no duplicates. Optionally sets a new role at the same time. */
export async function reactivateOfficer(db: Db, actor: Actor, officerId: string, rawRole?: Role) {
  const role = rawRole ? roleSchema.parse(rawRole) : undefined;
  const { before, officer } = await db.transaction(async (tx) => {
    await lockAdminSet(tx);
    const target = await getForUpdate(tx, officerId);
    if (target.active) throw new OfficerError(409, "Already active.");
    const [o] = await tx
      .update(officers)
      .set({ active: true, deactivatedAt: null, role: role ?? target.role })
      .where(eq(officers.id, target.id))
      .returning();
    await tx.insert(officerAudit).values({
      officerId: target.id,
      action: "reactivate",
      actorId: actor.id,
      details: { role: o.role, previousRole: target.role },
    });
    return { before: target, officer: o };
  });
  await notify(db, actor, { officer, before: { role: before.role, active: false }, after: { role: officer.role, active: true } });
  return officer;
}

export async function listOfficers(db: DbOrTx) {
  const adder = alias(officers, "adder");
  return db
    .select({
      id: officers.id,
      email: officers.email,
      name: officers.name,
      role: officers.role,
      active: officers.active,
      lastLoginAt: officers.lastLoginAt,
      addedAt: officers.addedAt,
      deactivatedAt: officers.deactivatedAt,
      addedBy: adder.email,
    })
    .from(officers)
    .leftJoin(adder, eq(adder.id, officers.addedBy))
    .orderBy(desc(officers.active), officers.email);
}

export async function listAudit(db: DbOrTx, limit = 200) {
  const target = alias(officers, "target");
  const actor = alias(officers, "actor");
  return db
    .select({
      id: officerAudit.id,
      action: officerAudit.action,
      details: officerAudit.details,
      timestamp: officerAudit.timestamp,
      officerEmail: target.email,
      actorEmail: actor.email,
    })
    .from(officerAudit)
    .innerJoin(target, eq(target.id, officerAudit.officerId))
    .leftJoin(actor, eq(actor.id, officerAudit.actorId))
    .orderBy(desc(officerAudit.timestamp), desc(officerAudit.id))
    .limit(limit);
}
