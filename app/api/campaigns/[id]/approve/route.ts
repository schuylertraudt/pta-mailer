import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { approveCampaign } from "@/lib/campaigns/service";
import { json, toResponse } from "@/lib/http";

export const POST = withOfficer<{ id: string }>("approve", async (_req, officer, { id }) => {
  try {
    return json({ campaign: await approveCampaign(getDb(), id, officer.id) });
  } catch (e) {
    return toResponse(e);
  }
});
