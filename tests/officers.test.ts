import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { officerAudit, officers, sessions } from "@/db/schema";
import {
  addOfficer,
  changeRole,
  deactivateOfficer,
  notificationKind,
  reactivateOfficer,
} from "@/lib/officers/manage";
import { GET, POST } from "../app/api/admin/officers/route";
import { PATCH } from "../app/api/admin/officers/[id]/route";
import { POST as DEACTIVATE } from "../app/api/admin/officers/[id]/deactivate/route";
import { POST as REACTIVATE } from "../app/api/admin/officers/[id]/reactivate/route";
import { resetDb, testDb } from "./helpers/db";
import { mailbox, makeOfficer, sessionFor } from "./helpers/factories";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  mailbox().clear();
});

const req = (method: string, headers: Record<string, string>, body?: unknown) =>
  new Request("https://pta.example.org/api/admin/officers", {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const p = (id?: string) => ({ params: Promise.resolve(id ? { id } : {}) }) as never;

async function twoAdmins() {
  const a1 = await makeOfficer(db, "admin");
  const a2 = await makeOfficer(db, "admin");
  return { a1, a2 };
}

describe("officer endpoints reject non-admins", () => {
  it.each(["sender", "drafter"] as const)("%s gets 403 on every endpoint", async (role) => {
    const { a1 } = await twoAdmins();
    const me = await makeOfficer(db, role);
    const { headers } = await sessionFor(db, me.id);
    expect((await GET(req("GET", headers), p())).status).toBe(403);
    expect((await POST(req("POST", headers, { email: "n@example.org", role: "admin" }), p())).status).toBe(403);
    expect((await PATCH(req("PATCH", headers, { role: "drafter" }), p(a1.id))).status).toBe(403);
    expect((await DEACTIVATE(req("POST", headers), p(a1.id))).status).toBe(403);
    expect((await REACTIVATE(req("POST", headers), p(a1.id))).status).toBe(403);
    // Nothing changed.
    expect(await db.select().from(officerAudit)).toHaveLength(0);
    const [still] = await db.select().from(officers).where(eq(officers.id, a1.id));
    expect(still).toMatchObject({ role: "admin", active: true });
  });

  it("admins can use them", async () => {
    const { a1 } = await twoAdmins();
    const { headers } = await sessionFor(db, a1.id);
    const res = await POST(req("POST", headers, { email: "New@Example.org", role: "drafter" }), p());
    expect(res.status).toBe(201);
    const list = await (await GET(req("GET", headers), p())).json();
    expect(list.officers.map((o: { email: string }) => o.email)).toContain("new@example.org");
    expect(list.audit[0]).toMatchObject({ action: "add", actorEmail: a1.email, officerEmail: "new@example.org" });
  });
});

describe("two-admin floor", () => {
  it("blocks deactivating an admin when only two remain, including self", async () => {
    const { a1, a2 } = await twoAdmins();
    await expect(deactivateOfficer(db, a1, a2.id)).rejects.toMatchObject({ status: 422 });
    await expect(deactivateOfficer(db, a1, a1.id)).rejects.toMatchObject({ status: 422 });
  });

  it("blocks demoting an admin when only two remain, including self", async () => {
    const { a1, a2 } = await twoAdmins();
    await expect(changeRole(db, a1, a2.id, "sender")).rejects.toMatchObject({ status: 422 });
    await expect(changeRole(db, a1, a1.id, "drafter")).rejects.toMatchObject({ status: 422 });
  });

  it("allows it with three admins, then blocks the next one", async () => {
    const { a1, a2 } = await twoAdmins();
    const a3 = await makeOfficer(db, "admin");
    await deactivateOfficer(db, a1, a3.id);
    await expect(changeRole(db, a1, a2.id, "sender")).rejects.toMatchObject({ status: 422 });
  });

  it("returns 422 over HTTP", async () => {
    const { a1, a2 } = await twoAdmins();
    const { headers } = await sessionFor(db, a1.id);
    const res = await DEACTIVATE(req("POST", headers), p(a2.id));
    expect(res.status).toBe(422);
  });

  it("holds under concurrent demotions", async () => {
    const { a1, a2 } = await twoAdmins();
    const a3 = await makeOfficer(db, "admin");
    const results = await Promise.allSettled([
      deactivateOfficer(db, a1, a2.id),
      deactivateOfficer(db, a1, a3.id),
      changeRole(db, a2, a1.id, "sender"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const admins = await db.select().from(officers).where(eq(officers.active, true));
    expect(admins.filter((o) => o.role === "admin")).toHaveLength(2);
  });

  it("does not block changes to non-admins", async () => {
    const { a1 } = await twoAdmins();
    const s = await makeOfficer(db, "sender");
    await deactivateOfficer(db, a1, s.id);
  });
});

describe("audit trail", () => {
  it("writes a correct row for every change", async () => {
    const { a1 } = await twoAdmins();
    const o = await addOfficer(db, a1, { email: "x@example.org", role: "drafter", name: "X" });
    await changeRole(db, a1, o.id, "sender");
    await deactivateOfficer(db, a1, o.id);
    await reactivateOfficer(db, a1, o.id, "drafter");

    const rows = await db.select().from(officerAudit).where(eq(officerAudit.officerId, o.id)).orderBy(officerAudit.id);
    expect(rows.map((r) => [r.action, r.actorId])).toEqual([
      ["add", a1.id],
      ["role_change", a1.id],
      ["deactivate", a1.id],
      ["reactivate", a1.id],
    ]);
    expect(rows[0].details).toEqual({ email: "x@example.org", role: "drafter" });
    expect(rows[1].details).toEqual({ from: "drafter", to: "sender" });
    expect(rows[2].details).toMatchObject({ role: "sender", self: false });
    expect(rows[3].details).toEqual({ role: "drafter", previousRole: "sender" });
  });

  it("reactivation reuses the same row; re-adding an existing email is refused", async () => {
    const { a1 } = await twoAdmins();
    const o = await addOfficer(db, a1, { email: "y@example.org", role: "sender" });
    await deactivateOfficer(db, a1, o.id);
    await expect(addOfficer(db, a1, { email: "Y@example.org", role: "sender" })).rejects.toMatchObject({ status: 409 });
    const back = await reactivateOfficer(db, a1, o.id);
    expect(back.id).toBe(o.id);
    expect(await db.select().from(officers).where(eq(officers.email, "y@example.org"))).toHaveLength(1);
  });
});

describe("deactivation transaction", () => {
  it("sets inactive, deletes all sessions and writes audit together", async () => {
    const { a1 } = await twoAdmins();
    const s = await makeOfficer(db, "sender");
    await sessionFor(db, s.id);
    await sessionFor(db, s.id);
    await deactivateOfficer(db, a1, s.id);
    const [row] = await db.select().from(officers).where(eq(officers.id, s.id));
    expect(row.active).toBe(false);
    expect(row.deactivatedAt).not.toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.officerId, s.id))).toHaveLength(0);
    const [audit] = await db.select().from(officerAudit).where(eq(officerAudit.officerId, s.id));
    expect(audit.details).toMatchObject({ sessionsRevoked: 2 });
  });

  it("rolls back fully on partial failure", async () => {
    const { a1 } = await twoAdmins();
    const s = await makeOfficer(db, "sender");
    await sessionFor(db, s.id);
    await expect(
      deactivateOfficer(db, a1, s.id, {
        beforeCommit: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    const [row] = await db.select().from(officers).where(eq(officers.id, s.id));
    expect(row).toMatchObject({ active: true, deactivatedAt: null });
    expect(await db.select().from(sessions).where(eq(sessions.officerId, s.id))).toHaveLength(1);
    expect(await db.select().from(officerAudit)).toHaveLength(0);
    expect(mailbox().sent).toHaveLength(0);
  });

  it("role change rolls back on partial failure", async () => {
    const { a1 } = await twoAdmins();
    const s = await makeOfficer(db, "sender");
    await expect(
      changeRole(db, a1, s.id, "admin", { beforeCommit: async () => Promise.reject(new Error("boom")) }),
    ).rejects.toThrow();
    const [row] = await db.select().from(officers).where(eq(officers.id, s.id));
    expect(row.role).toBe("sender");
    expect(await db.select().from(officerAudit)).toHaveLength(0);
  });
});

describe("notifications", () => {
  it("emails all admins and the officer when admin or sender is granted", async () => {
    const { a1, a2 } = await twoAdmins();
    await addOfficer(db, a1, { email: "new@example.org", role: "sender" });
    expect(mailbox().sent.map((m) => m.to).sort()).toEqual([a1.email, a2.email, "new@example.org"].sort());
    expect(mailbox().sent[0].subject).toContain("granted sender");
  });

  it("emails when an admin is removed", async () => {
    const { a1, a2 } = await twoAdmins();
    const a3 = await makeOfficer(db, "admin");
    await deactivateOfficer(db, a1, a3.id);
    expect(mailbox().sent.map((m) => m.to).sort()).toEqual([a1.email, a2.email, a3.email].sort());
    expect(mailbox().sent[0].subject).toContain("no longer an admin");
  });

  it("does not email for drafter-level changes", async () => {
    const { a1 } = await twoAdmins();
    const d = await addOfficer(db, a1, { email: "d@example.org", role: "drafter" });
    await deactivateOfficer(db, a1, d.id);
    expect(mailbox().sent).toHaveLength(0);
  });

  it("classifies changes", () => {
    expect(notificationKind(null, { role: "admin", active: true })).toBe("granted");
    expect(notificationKind({ role: "drafter", active: true }, { role: "sender", active: true })).toBe("granted");
    expect(notificationKind({ role: "admin", active: true }, { role: "sender", active: true })).toBe("admin_removed");
    expect(notificationKind({ role: "sender", active: true }, { role: "drafter", active: true })).toBeNull();
    expect(notificationKind({ role: "sender", active: false }, { role: "sender", active: true })).toBe("granted");
  });

  it("a mail failure does not undo the committed change", async () => {
    const { a1 } = await twoAdmins();
    mailbox().failWith = () => new Error("smtp down");
    const o = await addOfficer(db, a1, { email: "z@example.org", role: "admin" });
    const [row] = await db.select().from(officers).where(eq(officers.id, o.id));
    expect(row.role).toBe("admin");
  });
});
