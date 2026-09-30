import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { json, toResponse } from "@/lib/http";
import { createSegment, listSegmentsWithCounts } from "@/lib/segments/service";

export const GET = withOfficer("compose", async () => json({ segments: await listSegmentsWithCounts(getDb()) }));

export const POST = withOfficer("send", async (req) => {
  try {
    return json({ segment: await createSegment(getDb(), await req.json()) }, 201);
  } catch (e) {
    return toResponse(e);
  }
});
