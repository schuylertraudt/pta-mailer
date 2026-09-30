import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { getCampaign } from "@/lib/campaigns/service";
import { json, toResponse } from "@/lib/http";
import { createTemplate, listTemplates } from "@/lib/templates/service";

export const GET = withOfficer("compose", async () => json({ templates: await listTemplates(getDb()) }));

/** Body: { name, campaignId } to save a campaign as a template, or { name, bodyJson }. */
export const POST = withOfficer("compose", async (req, officer) => {
  try {
    const body = (await req.json()) as { name?: string; campaignId?: string; bodyJson?: unknown };
    const db = getDb();
    const bodyJson = body.campaignId ? (await getCampaign(db, body.campaignId)).bodyJson : body.bodyJson;
    const template = await createTemplate(db, { name: body.name ?? "", bodyJson }, officer.id);
    return json({ template }, 201);
  } catch (e) {
    return toResponse(e);
  }
});
