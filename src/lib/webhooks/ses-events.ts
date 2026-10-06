import type { Db } from "@/db";
import { normalizeEmail } from "@/lib/email";
import { unsubscribeByToken } from "@/lib/subscribers/service";
import { eventTime, recordClick, recordOpen, recordSuppression } from "./delivery-events";

type Recipient = { emailAddress: string };
export type SesEvent = {
  notificationType?: string;
  eventType?: string;
  mail?: { messageId?: string; commonHeaders?: { subject?: string } };
  bounce?: { bounceType: string; bounceSubType?: string; bouncedRecipients: Recipient[] };
  complaint?: { complainedRecipients: Recipient[]; complaintFeedbackType?: string };
  open?: { timestamp?: string };
  click?: { timestamp?: string; link?: string };
};

// "Name <addr>" or bare address
const addr = (s: string) => normalizeEmail(/<([^>]+)>/.exec(s)?.[1] ?? s);

/**
 * Applies an SES notification (either the SNS "notification" format or the
 * configuration-set "event publishing" format).
 *  - Permanent bounce / complaint: suppress + mark subscriber + mark the send row.
 *  - Transient bounce: ignored (SES already retried).
 *  - Received (inbound to the List-Unsubscribe mailto): unsubscribe by token in the subject.
 *  - Open / Click (configuration-set tracking): counted on the send row; clicks
 *    also per link. No IP address or device is stored.
 */
export async function handleSesEvent(db: Db, e: SesEvent): Promise<string> {
  const type = e.notificationType ?? e.eventType;
  const messageId = e.mail?.messageId;

  if (type === "Bounce" && e.bounce) {
    if (e.bounce.bounceType !== "Permanent") return "ignored transient bounce";
    const emails = e.bounce.bouncedRecipients.map((r) => addr(r.emailAddress));
    await recordSuppression(db, "bounce", emails, `ses:bounce:${e.bounce.bounceSubType ?? "General"}`, messageId);
    return "bounce suppressed";
  }

  if (type === "Complaint" && e.complaint) {
    const emails = e.complaint.complainedRecipients.map((r) => addr(r.emailAddress));
    await recordSuppression(db, "complaint", emails, `ses:complaint:${e.complaint.complaintFeedbackType ?? "abuse"}`, messageId);
    return "complaint suppressed";
  }

  if (type === "Open" && messageId) {
    return (await recordOpen(db, messageId, eventTime(e.open?.timestamp))) ? "open recorded" : "ignored open";
  }

  if (type === "Click" && messageId) {
    return recordClick(db, messageId, e.click?.link, eventTime(e.click?.timestamp));
  }

  if (type === "Received") {
    const token = /unsubscribe\s+([A-Za-z0-9_-]{43,})/i.exec(e.mail?.commonHeaders?.subject ?? "")?.[1];
    if (token) return (await unsubscribeByToken(db, token, "mailto")) === "unsubscribed" ? "mailto unsubscribed" : "unknown token";
    return "ignored inbound";
  }
  return "ignored";
}
