import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { reactivateOfficer } from "@/lib/officers/manage";
import { officerErrorResponse } from "@/lib/officers/http";

export const POST = withOfficer<{ id: string }>("manage_officers", async (req, actor, { id }) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { role?: string };
    return NextResponse.json({ officer: await reactivateOfficer(getDb(), actor, id, body.role as never) });
  } catch (e) {
    return officerErrorResponse(e);
  }
});
