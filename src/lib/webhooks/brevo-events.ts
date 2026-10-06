import type { Db } from "@/db";
import { normalizeEmail } from "@/lib/email";
import { suppressEmail } from "@/lib/subscribers/service";
import { eventTime, recordClick, recordOpen, recordRefused, recordSuppression } from "./delivery-events";

/** One Brevo transactional webhook event (fields we use; Brevo sends more). */
export type BrevoEvent = {
  event?: string;
  email?: string;
  "message-id"?: string;
  link?: string;
  reason?: string;
  date?: string;
  ts_event?: number;
  ts_epoch?: number;
};

/** Brevo has used both snake_case and camelCase event names. */
const norm = (e: string) => e.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();

/**
 * Applies a Brevo transactional event.
 *  - hard_bounce / invalid_email: suppress (bounce). spam: suppress (complaint).
 *  - unsubscribed: suppress (unsubscribe), e.g. from Brevo's own unsubscribe handling.
 *  - blocked: Brevo refused to deliver; the send is marked failed.
 *  - opened / unique_opened: open. Apple Mail "proxy" opens are ignored, which
 *    makes Brevo's open rate closer to real reads than SES's.
 *  - click: click, per link. Our own unsubscribe/view links are not counted.
 *  - soft_bounce, deferred, delivered, request, error: ignored.
 */
export async function handleBrevoEvent(db: Db, e: BrevoEvent): Promise<string> {
  const type = norm(e.event ?? "");
  const messageId = e["message-id"];
  const at = eventTime(e.ts_epoch ?? e.ts_event ?? e.date);
  const email = e.email ? normalizeEmail(e.email) : undefined;

  switch (type) {
    case "hard_bounce":
    case "invalid_email":
    case "invalid":
      if (!email) return "ignored bounce without email";
      await recordSuppression(db, "bounce", [email], `brevo:${type}`, messageId);
      return "bounce suppressed";
    case "spam":
    case "complaint":
      if (!email) return "ignored complaint without email";
      await recordSuppression(db, "complaint", [email], "brevo:spam", messageId);
      return "complaint suppressed";
    case "unsubscribed":
    case "unsubscribe": {
      if (!email) return "ignored unsubscribe without email";
      await suppressEmail(db, email, "unsubscribe", "unsubscribe:brevo");
      return "unsubscribed";
    }
    case "blocked":
      if (!messageId) return "ignored blocked";
      return (await recordRefused(db, messageId, `Brevo blocked: ${e.reason ?? "address on Brevo's blocklist"}`)) ? "blocked recorded" : "ignored blocked";
    case "opened":
    case "unique_opened":
      if (!messageId) return "ignored open";
      return (await recordOpen(db, messageId, at, { count: type === "opened" })) ? "open recorded" : "ignored open";
    case "click":
    case "clicked":
      if (!messageId) return "ignored click";
      return recordClick(db, messageId, e.link, at);
    default:
      return `ignored ${type || "event"}`;
  }
}
