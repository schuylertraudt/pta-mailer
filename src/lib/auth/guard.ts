import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Db } from "@/db";
import { getDb } from "@/db";
import { officers, sessions } from "@/db/schema";
import { env } from "@/lib/env";
import { can, type Permission } from "./roles";

export type Officer = typeof officers.$inferSelect;

export const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"] as const;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sessionTokenFromCookieHeader(header: string | null): string | undefined {
  if (!header) return undefined;
  const cookies = new Map(
    header.split(";").map((c) => {
      const i = c.indexOf("=");
      return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())] as const;
    }),
  );
  for (const name of SESSION_COOKIES) {
    const v = cookies.get(name);
    if (v) return v;
  }
  return undefined;
}

/**
 * Loads the officer for a session token straight from the database on every
 * call, so deactivation and role changes take effect on the very next request.
 */
export async function officerForSessionToken(db: Db, token: string | undefined): Promise<Officer | undefined> {
  if (!token) return undefined;
  const [row] = await db
    .select({ o: officers })
    .from(sessions)
    .innerJoin(officers, eq(officers.id, sessions.officerId))
    .where(and(eq(sessions.sessionToken, token), gt(sessions.expires, new Date()), eq(officers.active, true)));
  return row?.o;
}

function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const expected = new URL(env().APP_URL).origin;
  if (origin !== expected) throw new HttpError(403, "Cross-origin request rejected");
}

/** Server-side access control for API routes. Hidden UI is not access control. */
export async function requireOfficer(req: Request, perm?: Permission, db: Db = getDb()): Promise<Officer> {
  assertSameOrigin(req);
  const officer = await officerForSessionToken(db, sessionTokenFromCookieHeader(req.headers.get("cookie")));
  if (!officer) throw new HttpError(401, "Login required");
  if (perm && !can(officer.role, perm)) throw new HttpError(403, "Forbidden");
  return officer;
}

type RouteCtx<P> = { params: Promise<P> };

/** Wraps a route handler with requireOfficer and uniform error responses. */
export function withOfficer<P = Record<string, never>>(
  perm: Permission | undefined,
  handler: (req: Request, officer: Officer, params: P) => Promise<Response>,
) {
  return async (req: Request, ctx: RouteCtx<P>): Promise<Response> => {
    try {
      const officer = await requireOfficer(req, perm);
      return await handler(req, officer, (await ctx?.params) ?? ({} as P));
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e && typeof e === "object" && "issues" in e) {
    return NextResponse.json({ error: "Invalid input", issues: (e as { issues: unknown }).issues }, { status: 400 });
  }
  console.error(e);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
