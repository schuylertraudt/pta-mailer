import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { sends } from "@/db/schema";
import { normalizeEmail } from "@/lib/email";
import { suppressEmail, unsubscribeByToken } from "@/lib/subscribers/service";

type Recipient = { emailAddress: string };
export type SesEvent = {
  notificationType?: string;
  eventType?: string;
  mail?: { messageId?: string; commonHeaders?: { subject?: string } };
  bounce?: { bounceType: string; bounceSubType?: string; bouncedRecipients: Recipient[] };
  complaint?: { complainedRecipients: Recipient[]; complaintFeedbackType?: string };
};

// "Name <addr>" or bare address
const addr = (s: string) => normalizeEmail(/<([^>]+)>/.exec(s)?.[1] ?? s);

/**
 * Applies an SES notification (either the SNS "notification" format or the
 * configuration-set "event publishing" format).
 *  - Permanent bounce / complaint: suppress + mark subscriber + mark the send row.
 *  - Transient bounce: ignored (SES already retried).
 *  - Received (inbound to the List-Unsubscribe mailto): unsubscribe by token in the subject.
 */
export async function handleSesEvent(db: Db, e: SesEvent): Promise<string> {
  const type = e.notificationType ?? e.eventType;
  const messageId = e.mail?.messageId;

  if (type === "Bounce" && e.bounce) {
    if (e.bounce.bounceType !== "Permanent") return "ignored transient bounce";
    await db.transaction(async (tx) => {
      for (const r of e.bounce!.bouncedRecipients) {
        await suppressEmail(tx, addr(r.emailAddress), "bounce", `ses:bounce:${e.bounce!.bounceSubType ?? "General"}`);
      }
      if (messageId) await tx.update(sends).set({ status: "bounced" }).where(eq(sends.providerMessageId, messageId));
    });
    return "bounce suppressed";
  }

  if (type === "Complaint" && e.complaint) {
    await db.transaction(async (tx) => {
      for (const r of e.complaint!.complainedRecipients) {
        await suppressEmail(tx, addr(r.emailAddress), "complaint", `ses:complaint:${e.complaint!.complaintFeedbackType ?? "abuse"}`);
      }
      if (messageId) await tx.update(sends).set({ status: "complained" }).where(eq(sends.providerMessageId, messageId));
    });
    return "complaint suppressed";
  }

  if (type === "Received") {
    const token = /unsubscribe\s+([A-Za-z0-9_-]{43,})/i.exec(e.mail?.commonHeaders?.subject ?? "")?.[1];
    if (token) return (await unsubscribeByToken(db, token, "mailto")) === "unsubscribed" ? "mailto unsubscribed" : "unknown token";
    return "ignored inbound";
  }
  return "ignored";
}
