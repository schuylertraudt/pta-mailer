import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { returnToDraft } from "@/lib/campaigns/service";
import { json, toResponse } from "@/lib/http";

export const POST = withOfficer<{ id: string }>("compose", async (_req, _o, { id }) => {
  try {
    return json({ campaign: await returnToDraft(getDb(), id) });
  } catch (e) {
    return toResponse(e);
  }
});
