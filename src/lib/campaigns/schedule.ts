import { and, eq, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { campaigns, officers } from "@/db/schema";
import { can } from "@/lib/auth/roles";
import { env } from "@/lib/env";
import { getActiveProvider } from "@/lib/mail/active";
import { simpleEmail } from "@/lib/mail/transactional";
import { checkSendable, enqueueCampaign } from "@/lib/queue/enqueue";
import { CampaignError, EDITABLE } from "./service";

const MIN_LEAD_MS = 60_000;
const MAX_LEAD_MS = 366 * 24 * 3600_000;

/**
 * Schedules an unsent message. All send checks run now, so problems show up
 * while someone is looking. Scheduling counts as approval, like sending does.
 */
export async function scheduleCampaign(db: Db, id: string, officerId: string, at: Date) {
  if (Number.isNaN(at.getTime())) throw new CampaignError(400, "Pick a date and time.");
  const lead = at.getTime() - Date.now();
  if (lead < MIN_LEAD_MS) throw new CampaignError(400, "Pick a time at least a minute from now. To send right away, use Send now.");
  if (lead > MAX_LEAD_MS) throw new CampaignError(400, "Pick a time within the next year.");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, id)).for("update");
    if (!c) throw new CampaignError(404, "Message not found");
    if (!EDITABLE.includes(c.status as never)) throw new CampaignError(409, `Message is ${c.status.replace("_", " ")}; it can't be scheduled.`);
    const { recipients } = await checkSendable(tx, c);
    const [row] = await tx
      .update(campaigns)
      .set({
        status: "scheduled",
        scheduledAt: at,
        scheduledBy: officerId,
        approvedBy: c.approvedBy ?? officerId,
        scheduleError: null,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, id))
      .returning();
    return { campaign: row, recipients };
  });
}

/** Back to approved and editable. */
export async function cancelSchedule(db: Db, id: string) {
  const [row] = await db
    .update(campaigns)
    .set({ status: "approved", scheduledAt: null, scheduledBy: null, updatedAt: new Date() })
    .where(and(eq(campaigns.id, id), eq(campaigns.status, "scheduled")))
    .returning();
  if (!row) throw new CampaignError(409, "This message isn't scheduled (it may have started sending).");
  return row;
}

/**
 * Queues every scheduled message whose time has come. A message that can no
 * longer be sent (audience emptied, scheduler lost send rights, ...) goes back
 * to draft with the reason saved, and the scheduler is emailed.
 */
export async function runDueSchedules(db: Db) {
  const due = await db
    .select({ id: campaigns.id, subject: campaigns.subject, scheduledBy: campaigns.scheduledBy, scheduledAt: campaigns.scheduledAt })
    .from(campaigns)
    .where(and(eq(campaigns.status, "scheduled"), lte(campaigns.scheduledAt, new Date())));
  let started = 0;
  for (const c of due) {
    const [o] = c.scheduledBy ? await db.select().from(officers).where(eq(officers.id, c.scheduledBy)) : [];
    try {
      if (!o || !o.active || !can(o.role, "send")) {
        throw new CampaignError(409, "The team member who scheduled it can no longer send messages. A sender or admin needs to schedule or send it.");
      }
      await enqueueCampaign(db, c.id, o.id);
      started++;
    } catch (e) {
      if (!(e instanceof CampaignError)) throw e;
      if (e.status === 409 && e.message.startsWith("Message is already")) continue; // someone else got to it
      const reason = `Scheduled send on ${c.scheduledAt?.toUTCString()} didn't go out: ${e.message}`;
      const [failed] = await db
        .update(campaigns)
        .set({ status: "draft", scheduledAt: null, approvedBy: null, scheduleError: reason, updatedAt: new Date() })
        .where(and(eq(campaigns.id, c.id), eq(campaigns.status, "scheduled")))
        .returning({ id: campaigns.id });
      if (failed && o) await notifyScheduler(db, o.email, c.id, c.subject, e.message);
    }
  }
  return started;
}

async function notifyScheduler(db: Db, to: string, id: string, subject: string, reason: string) {
  try {
    const { html, text } = simpleEmail({
      heading: "A scheduled message didn't send",
      paragraphs: [`"${subject || "(no subject)"}" was scheduled but couldn't be sent: ${reason}`, "It's back in draft. Fix the problem, then send or schedule it again."],
      button: { label: "Open the message", url: `${env().APP_URL}/admin/campaigns/${id}` },
    });
    await (await getActiveProvider(db)).send({ to, subject: "PTA mailer: a scheduled message didn't send", html, text });
  } catch (e) {
    console.error("schedule failure notice failed", e);
  }
}
