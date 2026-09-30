import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { officers, sessions } from "@/db/schema";
import { authorizeGoogleSignIn } from "@/lib/auth/sign-in";
import { officerAdapter } from "@/lib/auth/adapter";
import { requireOfficer, sessionTokenFromCookieHeader } from "@/lib/auth/guard";
import { can } from "@/lib/auth/roles";
import { GET as listOfficersRoute } from "../app/api/admin/officers/route";
import { resetDb, testDb } from "./helpers/db";
import { makeOfficer, sessionFor } from "./helpers/factories";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));
afterEach(() => {
  process.env.BOOTSTRAP_ADMIN_EMAIL = "";
});

const google = (over: Partial<{ sub: string; email: string; emailVerified: boolean }> = {}) => ({
  sub: "google-sub-1",
  email: "officer@example.org",
  emailVerified: true,
  ...over,
});
const get = (headers: Record<string, string>) => new Request("https://pta.example.org/api/admin/officers", { headers });
const noParams = { params: Promise.resolve({}) } as never;

describe("Google sign-in gate", () => {
  it("rejects a Google account that is not on the officer list", async () => {
    await makeOfficer(db, "admin", { email: "someone-else@example.org" });
    expect(await authorizeGoogleSignIn(db, google())).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("rejects unverified or missing email", async () => {
    await makeOfficer(db, "sender", { email: "officer@example.org" });
    expect(await authorizeGoogleSignIn(db, google({ emailVerified: false }))).toEqual({ ok: false, reason: "unverified_email" });
    expect(await authorizeGoogleSignIn(db, { sub: "x", email: "officer@example.org" })).toEqual({
      ok: false,
      reason: "unverified_email",
    });
    const [o] = await db.select().from(officers);
    expect(o.googleSub).toBeNull();
  });

  it("binds google_sub on first login, matches on it thereafter, and updates last_login_at", async () => {
    const o = await makeOfficer(db, "sender", { email: "officer@example.org" });
    const first = await authorizeGoogleSignIn(db, google({ email: "Officer@Example.org" }));
    expect(first).toEqual({ ok: true, officerId: o.id });
    const [bound] = await db.select().from(officers).where(eq(officers.id, o.id));
    expect(bound.googleSub).toBe("google-sub-1");
    expect(bound.lastLoginAt).not.toBeNull();

    // Same Google account, even if its email later changes: still matched by sub.
    expect(await authorizeGoogleSignIn(db, google({ email: "renamed@example.org" }))).toEqual({ ok: true, officerId: o.id });
    // A different Google account claiming the same email is rejected.
    expect(await authorizeGoogleSignIn(db, google({ sub: "google-sub-2" }))).toEqual({ ok: false, reason: "account_mismatch" });
  });

  it("rejects deactivated officers, by sub or by email", async () => {
    const o = await makeOfficer(db, "admin", { email: "officer@example.org" });
    await authorizeGoogleSignIn(db, google());
    await db.update(officers).set({ active: false, deactivatedAt: new Date() }).where(eq(officers.id, o.id));
    expect(await authorizeGoogleSignIn(db, google())).toEqual({ ok: false, reason: "not_allowed" });
    await makeOfficer(db, "admin", { email: "off2@example.org", active: false, deactivatedAt: new Date() });
    expect(await authorizeGoogleSignIn(db, google({ sub: "s3", email: "off2@example.org" }))).toEqual({
      ok: false,
      reason: "not_allowed",
    });
  });

  it("admits the bootstrap admin on first sign-in when no admin exists", async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = "Boot@Example.org";
    const res = await authorizeGoogleSignIn(db, google({ email: "boot@example.org" }));
    expect(res.ok).toBe(true);
    const [o] = await db.select().from(officers);
    expect(o).toMatchObject({ email: "boot@example.org", role: "admin", googleSub: "google-sub-1" });
  });

  it("adapter never creates users and hides inactive officers", async () => {
    const adapter = officerAdapter(db);
    await expect(adapter.createUser!({ id: "x", email: "x@example.org", emailVerified: null })).rejects.toThrow();
    const o = await makeOfficer(db, "sender", { googleSub: "sub-9" });
    expect(await adapter.getUserByAccount!({ provider: "google", providerAccountId: "sub-9" })).toMatchObject({ id: o.id });
    await db.update(officers).set({ active: false, deactivatedAt: new Date() }).where(eq(officers.id, o.id));
    expect(await adapter.getUserByAccount!({ provider: "google", providerAccountId: "sub-9" })).toBeNull();
  });
});

describe("request guard", () => {
  it("rejects requests without a session (401) and non-admins on admin routes (403)", async () => {
    expect((await listOfficersRoute(get({}), noParams)).status).toBe(401);
    const s = await makeOfficer(db, "sender");
    const { headers } = await sessionFor(db, s.id);
    expect((await listOfficersRoute(get(headers), noParams)).status).toBe(403);
  });

  it("deactivated officer loses access on the next request even with an open session", async () => {
    const a = await makeOfficer(db, "admin");
    const { headers, token } = await sessionFor(db, a.id);
    expect((await listOfficersRoute(get(headers), noParams)).status).toBe(200);
    // Flip the flag without touching sessions: the guard must still refuse.
    await db.update(officers).set({ active: false, deactivatedAt: new Date() }).where(eq(officers.id, a.id));
    expect(await db.select().from(sessions).where(eq(sessions.sessionToken, token))).toHaveLength(1);
    expect((await listOfficersRoute(get(headers), noParams)).status).toBe(401);
  });

  it("role downgrade takes effect immediately", async () => {
    const a = await makeOfficer(db, "admin");
    const { headers } = await sessionFor(db, a.id);
    expect((await listOfficersRoute(get(headers), noParams)).status).toBe(200);
    await db.update(officers).set({ role: "drafter" }).where(eq(officers.id, a.id));
    expect((await listOfficersRoute(get(headers), noParams)).status).toBe(403);
  });

  it("expired sessions are rejected", async () => {
    const a = await makeOfficer(db, "admin");
    const { headers, token } = await sessionFor(db, a.id);
    await db.update(sessions).set({ expires: new Date(Date.now() - 1000) }).where(eq(sessions.sessionToken, token));
    expect((await listOfficersRoute(get(headers), noParams)).status).toBe(401);
  });

  it("rejects cross-origin mutations", async () => {
    const a = await makeOfficer(db, "admin");
    const { headers } = await sessionFor(db, a.id);
    const req = new Request("https://pta.example.org/api/x", {
      method: "POST",
      headers: { ...headers, origin: "https://evil.example.com" },
    });
    await expect(requireOfficer(req, undefined, db)).rejects.toMatchObject({ status: 403 });
  });

  it("parses either Auth.js cookie name", () => {
    expect(sessionTokenFromCookieHeader("a=1; __Secure-authjs.session-token=abc")).toBe("abc");
    expect(sessionTokenFromCookieHeader("authjs.session-token=def")).toBe("def");
    expect(sessionTokenFromCookieHeader(null)).toBeUndefined();
  });

  it("role permissions match the spec", () => {
    expect(can("admin", "manage_officers")).toBe(true);
    expect(can("sender", "send")).toBe(true);
    expect(can("sender", "manage_officers")).toBe(false);
    expect(can("drafter", "compose")).toBe(true);
    expect(can("drafter", "send")).toBe(false);
    expect(can("drafter", "approve")).toBe(false);
  });
});
