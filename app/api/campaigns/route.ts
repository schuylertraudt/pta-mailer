import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { createCampaign, listCampaigns } from "@/lib/campaigns/service";
import { json, toResponse } from "@/lib/http";

export const GET = withOfficer("compose", async () => json({ campaigns: await listCampaigns(getDb()) }));

export const POST = withOfficer("compose", async (req, officer) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { templateId?: string | null };
    return json({ campaign: await createCampaign(getDb(), officer.id, { templateId: body.templateId }) }, 201);
  } catch (e) {
    return toResponse(e);
  }
});
