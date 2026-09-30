import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { changeRole } from "@/lib/officers/manage";
import { officerErrorResponse } from "@/lib/officers/http";

export const PATCH = withOfficer<{ id: string }>("manage_officers", async (req, actor, { id }) => {
  try {
    const body = (await req.json()) as { role?: string };
    const officer = await changeRole(getDb(), actor, id, body.role as never);
    return NextResponse.json({ officer });
  } catch (e) {
    return officerErrorResponse(e);
  }
});
