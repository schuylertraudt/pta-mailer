import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import {
  brandSettings,
  officers,
  segments,
  subscriberSegments,
  subscribers,
  suppressions,
} from "@/db/schema";
import { DEFAULT_BRAND, SEED_OFFICERS, seed } from "@/db/seed";
import { SCHOOLS } from "@/lib/schools";
import { bootstrapAdmin } from "@/lib/officers/bootstrap";
import { resetDb, testDb } from "./helpers/db";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

describe("seed", () => {
  it("creates brand settings, officers, segments and subscribers across every school", async () => {
    await seed(db);

    const [brand] = await db.select().from(brandSettings);
    expect(brand).toMatchObject(DEFAULT_BRAND);

    const offs = await db.select().from(officers);
    expect(offs.map((o) => o.email).sort()).toEqual(SEED_OFFICERS.map((o) => o.email).sort());
    expect(offs.filter((o) => o.role === "admin" && o.active)).toHaveLength(2);

    const subs = await db.select().from(subscribers);
    expect(subs).toHaveLength(120);
    expect(new Set(subs.map((s) => s.school))).toEqual(new Set(SCHOOLS));
    expect(new Set(subs.map((s) => s.status))).toEqual(new Set(["active", "pending", "unsubscribed", "bounced"]));
    for (const s of subs) {
      expect(s.email).toMatch(/@example\.com$/);
      expect(s.status === "pending").toBe(s.confirmedAt === null);
    }

    const segs = await db.select().from(segments);
    expect(segs.map((s) => s.rule)).toContain("all");
    expect(segs.filter((s) => s.rule.startsWith("school="))).toHaveLength(SCHOOLS.length);
    const [{ n }] = await db.select({ n: count() }).from(subscriberSegments);
    expect(n).toBeGreaterThan(0);
  });

  it("suppresses every seeded unsubscribed/bounced subscriber", async () => {
    await seed(db);
    const bad = await db.select().from(subscribers).where(eq(subscribers.status, "bounced"));
    const unsub = await db.select().from(subscribers).where(eq(subscribers.status, "unsubscribed"));
    const supp = new Set((await db.select().from(suppressions)).map((s) => s.email));
    for (const s of [...bad, ...unsub]) expect(supp.has(s.email)).toBe(true);
  });

  it("is idempotent", async () => {
    await seed(db);
    await seed(db);
    expect(await db.select().from(officers)).toHaveLength(SEED_OFFICERS.length);
    expect(await db.select().from(brandSettings)).toHaveLength(1);
    expect(await db.select().from(subscribers)).toHaveLength(120);
  });

  it("leaves bootstrap disabled because seeded admins are active", async () => {
    await seed(db);
    expect(await bootstrapAdmin(db, "boot@example.org")).toEqual({ status: "disabled" });
  });
});
