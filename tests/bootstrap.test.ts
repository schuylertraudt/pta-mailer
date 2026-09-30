import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { officerAudit, officers } from "@/db/schema";
import { bootstrapAdmin } from "@/lib/officers/bootstrap";
import { resetDb, testDb } from "./helpers/db";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

describe("bootstrapAdmin", () => {
  it("does nothing when the env var is unset or blank", async () => {
    expect(await bootstrapAdmin(db, undefined)).toEqual({ status: "unconfigured" });
    expect(await bootstrapAdmin(db, "  ")).toEqual({ status: "unconfigured" });
    expect(await db.select().from(officers)).toHaveLength(0);
  });

  it("creates the first admin with a normalized email and a system audit row", async () => {
    const res = await bootstrapAdmin(db, "  First.Admin@Example.org ");
    expect(res.status).toBe("created");
    const rows = await db.select().from(officers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "first.admin@example.org", role: "admin", active: true, googleSub: null });

    const audit = await db.select().from(officerAudit);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ officerId: rows[0].id, action: "bootstrap", actorId: null });
  });

  it("disables itself once any active admin exists", async () => {
    await bootstrapAdmin(db, "first@example.org");
    expect(await bootstrapAdmin(db, "first@example.org")).toEqual({ status: "disabled" });
    expect(await bootstrapAdmin(db, "attacker@example.org")).toEqual({ status: "disabled" });
    expect(await db.select().from(officers)).toHaveLength(1);
    expect(await db.select().from(officerAudit)).toHaveLength(1);
  });

  it("is disabled by an admin created any other way", async () => {
    await db.insert(officers).values({ email: "real@example.org", role: "admin" });
    expect(await bootstrapAdmin(db, "boot@example.org")).toEqual({ status: "disabled" });
  });

  it("is not disabled by active non-admins or inactive admins", async () => {
    await db.insert(officers).values([
      { email: "sender@example.org", role: "sender" },
      { email: "old@example.org", role: "admin", active: false, deactivatedAt: new Date() },
    ]);
    expect((await bootstrapAdmin(db, "boot@example.org")).status).toBe("created");
  });

  it("promotes and reactivates an existing row instead of duplicating it", async () => {
    const [old] = await db
      .insert(officers)
      .values({ email: "back@example.org", role: "drafter", active: false, deactivatedAt: new Date() })
      .returning();
    const res = await bootstrapAdmin(db, "Back@Example.org");
    expect(res).toEqual({ status: "promoted", officerId: old.id });
    const rows = await db.select().from(officers).where(eq(officers.email, "back@example.org"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "admin", active: true, deactivatedAt: null });
    const [audit] = await db.select().from(officerAudit);
    expect(audit.details).toEqual({ previousRole: "drafter", previousActive: false });
  });

  it("creates exactly one admin under concurrent calls", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => bootstrapAdmin(db, `racer${i}@example.org`)),
    );
    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(results.filter((r) => r.status === "disabled")).toHaveLength(7);
    expect(await db.select().from(officers)).toHaveLength(1);
  });

  it("rejects an invalid email", async () => {
    await expect(bootstrapAdmin(db, "nope")).rejects.toThrow();
  });
});
