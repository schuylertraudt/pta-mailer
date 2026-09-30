import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { deleteDraft, getCampaign, updateCampaign } from "@/lib/campaigns/service";
import { json, toResponse } from "@/lib/http";

type P = { id: string };

export const GET = withOfficer<P>("compose", async (_req, _o, { id }) => {
  try {
    return json({ campaign: await getCampaign(getDb(), id) });
  } catch (e) {
    return toResponse(e);
  }
});

export const PATCH = withOfficer<P>("compose", async (req, _o, { id }) => {
  try {
    return json({ campaign: await updateCampaign(getDb(), id, await req.json()) });
  } catch (e) {
    return toResponse(e);
  }
});

export const DELETE = withOfficer<P>("compose", async (_req, _o, { id }) => {
  try {
    await deleteDraft(getDb(), id);
    return json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
});
