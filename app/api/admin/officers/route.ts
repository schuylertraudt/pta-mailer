import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { addOfficer, listAudit, listOfficers } from "@/lib/officers/manage";
import { officerErrorResponse } from "@/lib/officers/http";

export const GET = withOfficer("manage_officers", async () => {
  const db = getDb();
  return NextResponse.json({ officers: await listOfficers(db), audit: await listAudit(db) });
});

export const POST = withOfficer("manage_officers", async (req, actor) => {
  try {
    const officer = await addOfficer(getDb(), actor, await req.json());
    return NextResponse.json({ officer }, { status: 201 });
  } catch (e) {
    return officerErrorResponse(e);
  }
});
