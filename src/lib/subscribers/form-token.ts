import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

// Bots that post instantly or replay stale forms are rejected.
export const MIN_FORM_AGE_MS = 2_000;
export const MAX_FORM_AGE_MS = 24 * 3600_000;

const sign = (ts: string) => createHmac("sha256", env().AUTH_SECRET).update(`subscribe-form:${ts}`).digest("base64url");

/** Signed timestamp embedded in the subscribe form when it is rendered. */
export function issueFormToken(now = Date.now()): string {
  const ts = String(now);
  return `${ts}.${sign(ts)}`;
}

export function checkFormToken(token: string | undefined | null, now = Date.now()): boolean {
  if (!token) return false;
  const [ts, sig] = token.split(".");
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  const expected = Buffer.from(sign(ts));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return false;
  const age = now - Number(ts);
  return age >= MIN_FORM_AGE_MS && age <= MAX_FORM_AGE_MS;
}

/** Cloudflare Turnstile check; skipped when TURNSTILE_SECRET_KEY is not configured. */
export async function verifyTurnstile(token: string | undefined | null, ip: string): Promise<boolean> {
  const secret = env().TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
  });
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}
