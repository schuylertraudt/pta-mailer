import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { countRecipients, sampleRecipients } from "@/lib/campaigns/recipients";
import { getCampaign } from "@/lib/campaigns/service";
import { json, toResponse } from "@/lib/http";

const LIMIT = 500;

/** "View selected recipients": who the saved audiences reach right now. */
export const GET = withOfficer<{ id: string }>("view_subscribers", async (_req, _o, { id }) => {
  try {
    const db = getDb();
    const c = await getCampaign(db, id);
    const [total, recipients] = await Promise.all([countRecipients(db, c.segmentIds), sampleRecipients(db, c.segmentIds, LIMIT)]);
    return json({ total, recipients, limit: LIMIT });
  } catch (e) {
    return toResponse(e);
  }
});
