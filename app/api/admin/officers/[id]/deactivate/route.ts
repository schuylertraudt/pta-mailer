import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { deactivateOfficer } from "@/lib/officers/manage";
import { officerErrorResponse } from "@/lib/officers/http";

export const POST = withOfficer<{ id: string }>("manage_officers", async (_req, actor, { id }) => {
  try {
    return NextResponse.json({ officer: await deactivateOfficer(getDb(), actor, id) });
  } catch (e) {
    return officerErrorResponse(e);
  }
});
