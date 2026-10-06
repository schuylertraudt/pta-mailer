import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { renderCampaign } from "@/lib/campaigns/render";
import { getCampaign } from "@/lib/campaigns/service";
import { json, toResponse } from "@/lib/http";
import { activeProviderName, getActiveProvider, PROVIDER_LABEL } from "@/lib/mail/active";
import { QuotaExceededError } from "@/lib/mail/provider";
import { fromHeader } from "@/lib/mail/sender";
import { hitRateLimit } from "@/lib/rate-limit";
import { listUnsubscribeHeaders } from "@/lib/urls";

/** "Send test to me": the real rendered email through the real provider, to the signed-in officer only. */
export const POST = withOfficer<{ id: string }>("compose", async (_req, officer, { id }) => {
  try {
    const db = getDb();
    if (!(await hitRateLimit(db, `test-send:${officer.id}`, 20, 3600))) return json({ error: "Too many test sends; try again later." }, 429);
    const c = await getCampaign(db, id);
    const r = await renderCampaign(db, c);
    const token = "preview";
    const html = r.html.replaceAll("__UNSUBSCRIBE_TOKEN__", token);
    const text = r.text.replaceAll("__UNSUBSCRIBE_TOKEN__", token);
    const name = await activeProviderName(db);
    const label = name === "ses" || name === "brevo" ? PROVIDER_LABEL[name] : "The email service";
    try {
      await (await getActiveProvider(db)).send({
        to: officer.email,
        from: fromHeader(c.fromName),
        subject: `[TEST] ${c.subject || "(no subject)"}`,
        html,
        text,
        headers: listUnsubscribeHeaders(token),
      });
    } catch (e) {
      // Team members only: the provider's own reason is the useful part.
      console.error("test send failed", e);
      const reason = e instanceof Error ? e.message : String(e);
      if (e instanceof QuotaExceededError) {
        return json({ error: `${label}'s sending limit is used up for now (${reason}). Try again later, or switch services on the Sending page.` }, 429);
      }
      return json({ error: `${label} refused the email: ${reason}` }, 502);
    }
    return json({ ok: true, to: officer.email, checks: r.checks });
  } catch (e) {
    return toResponse(e);
  }
});
