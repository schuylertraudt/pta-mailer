import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { renderCampaign } from "@/lib/campaigns/render";
import { getCampaign } from "@/lib/campaigns/service";
import { countRecipients } from "@/lib/campaigns/recipients";
import { json, toResponse } from "@/lib/http";

/** Renders the saved campaign exactly as it would be sent (unsubscribe link is a non-working preview link). */
export const POST = withOfficer<{ id: string }>("compose", async (req, _o, { id }) => {
  try {
    const db = getDb();
    const body = (await req.json().catch(() => ({}))) as { dark?: boolean };
    const c = await getCampaign(db, id);
    const r = await renderCampaign(db, c, { forceDark: !!body.dark });
    const recipients = await countRecipients(db, c.segmentId);
    return json({ html: r.html.replaceAll("__UNSUBSCRIBE_TOKEN__", "preview"), text: r.text, checks: r.checks, bytes: r.bytes, recipients });
  } catch (e) {
    return toResponse(e);
  }
});
