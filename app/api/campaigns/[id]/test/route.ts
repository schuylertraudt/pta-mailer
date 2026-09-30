import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { renderCampaign } from "@/lib/campaigns/render";
import { getCampaign } from "@/lib/campaigns/service";
import { json, toResponse } from "@/lib/http";
import { getEmailProvider } from "@/lib/mail/provider";
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
    await getEmailProvider().send({
      to: officer.email,
      subject: `[TEST] ${c.subject || "(no subject)"}`,
      html,
      text,
      headers: listUnsubscribeHeaders(token),
    });
    return json({ ok: true, to: officer.email, checks: r.checks });
  } catch (e) {
    return toResponse(e);
  }
});
