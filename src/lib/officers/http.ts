import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/auth/guard";
import { OfficerError } from "./manage";

export function officerErrorResponse(e: unknown): Response {
  if (e instanceof OfficerError) return NextResponse.json({ error: e.message }, { status: e.status });
  return errorResponse(e);
}
