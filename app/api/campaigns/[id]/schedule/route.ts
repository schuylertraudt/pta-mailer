import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { cancelSchedule, scheduleCampaign } from "@/lib/campaigns/schedule";
import { json, toResponse } from "@/lib/http";

/** { at: ISO timestamp }. Senders and admins only, like Send now. */
export const POST = withOfficer<{ id: string }>("send", async (req, officer, { id }) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { at?: string };
    return json(await scheduleCampaign(getDb(), id, officer.id, new Date(String(body.at ?? ""))));
  } catch (e) {
    return toResponse(e);
  }
});

export const DELETE = withOfficer<{ id: string }>("send", async (_req, _o, { id }) => {
  try {
    return json({ campaign: await cancelSchedule(getDb(), id) });
  } catch (e) {
    return toResponse(e);
  }
});
