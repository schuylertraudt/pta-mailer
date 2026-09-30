import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/auth/guard";
import { CampaignError } from "@/lib/campaigns/service";
import { ImageRejected } from "@/lib/images/process";
import { OfficerError } from "@/lib/officers/manage";

/** Maps domain errors to HTTP responses; anything unknown becomes a 500. */
export function toResponse(e: unknown): Response {
  if (e instanceof CampaignError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
  if (e instanceof OfficerError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ImageRejected) return NextResponse.json({ error: e.message }, { status: 415 });
  return errorResponse(e);
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
