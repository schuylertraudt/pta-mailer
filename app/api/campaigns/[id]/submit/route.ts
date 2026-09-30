import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { submitForApproval } from "@/lib/campaigns/service";
import { json, toResponse } from "@/lib/http";

export const POST = withOfficer<{ id: string }>("compose", async (_req, _o, { id }) => {
  try {
    return json({ campaign: await submitForApproval(getDb(), id) });
  } catch (e) {
    return toResponse(e);
  }
});
