import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { env } from "@/lib/env";
import { handleBrevoEvent, type BrevoEvent } from "@/lib/webhooks/brevo-events";

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Brevo sends no signature, so the webhook carries a shared secret: as a
 * Bearer token (Brevo's webhook "authentication" setting), as the password of
 * Basic auth, or as ?token= in the URL.
 */
function authorized(req: Request, secret: string) {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ") && same(auth.slice(7).trim(), secret)) return true;
  if (auth.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString();
    const password = decoded.slice(decoded.indexOf(":") + 1);
    if (same(password, secret)) return true;
  }
  const token = new URL(req.url).searchParams.get("token");
  return !!token && same(token, secret);
}

/** Brevo transactional events: bounces, spam reports, unsubscribes, opens, clicks. */
export async function POST(req: Request) {
  const secret = env().BREVO_WEBHOOK_SECRET;
  if (!secret) return new Response("Brevo webhook not configured", { status: 503 });
  if (!authorized(req, secret)) return new Response("Unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const events = (Array.isArray(body) ? body : [body]).slice(0, 1000) as BrevoEvent[];
  const db = getDb();
  const outcomes: string[] = [];
  for (const e of events) {
    if (e && typeof e === "object") outcomes.push(await handleBrevoEvent(db, e));
  }
  return new Response(outcomes.join("\n") || "ignored");
}
