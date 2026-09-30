import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDb } from "@/db";
import { clientIp } from "@/lib/rate-limit";
import { checkFormToken, verifyTurnstile } from "@/lib/subscribers/form-token";
import { subscribe } from "@/lib/subscribers/service";

const GENERIC_OK = "If that address can receive PTA news, a confirmation link is on its way. Click it to finish subscribing.";

async function readBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await req.json().catch(() => ({}))) as Record<string, string>;
  const fd = await req.formData();
  return Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
}

export async function POST(req: Request) {
  const body = await readBody(req);
  const ip = clientIp(req);

  // Honeypot filled or form token missing/too fast/stale: pretend success, do nothing.
  if (body.website || !checkFormToken(body.formToken)) {
    return NextResponse.json({ ok: true, message: GENERIC_OK });
  }
  if (!(await verifyTurnstile(body["cf-turnstile-response"], ip))) {
    return NextResponse.json({ error: "Please complete the verification challenge." }, { status: 400 });
  }

  try {
    const outcome = await subscribe(getDb(), { email: body.email, school: body.school as never }, { ip });
    if (outcome === "rate_limited") {
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    }
    return NextResponse.json({ ok: true, message: GENERIC_OK });
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Please enter a valid email and choose your school." }, { status: 400 });
    }
    throw e;
  }
}
