import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  brandSettings,
  campaigns,
  officers,
  sends,
  subscribers,
  suppressions,
} from "@/db/schema";
import { generateToken } from "@/lib/tokens";
import { resetDb, testDb } from "./helpers/db";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

/** Drizzle wraps driver errors; the Postgres error sits on `cause`. */
async function pgError(p: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await p;
  } catch (e: any) {
    return e.cause ?? e;
  }
  throw new Error("expected query to fail");
}

const sub = (email: string) => ({
  email,
  consentAt: new Date(),
  unsubscribeToken: generateToken(),
});

describe("schema", () => {
  it("creates every table in the data model", async () => {
    const { rows } = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' order by 1`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(
      expect.arrayContaining([
        "assets",
        "brand_settings",
        "campaigns",
        "officer_audit",
        "officers",
        "segments",
        "sends",
        "sessions",
        "subscriber_segments",
        "subscribers",
        "suppressions",
        "templates",
      ]),
    );
  });

  it("has no columns that could hold child names", async () => {
    const { rows } = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'subscribers'`,
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols.filter((c) => /child|student|kid|first_name|last_name/.test(c))).toEqual([]);
  });

  it("rejects non-lowercased emails on subscribers, officers and suppressions", async () => {
    expect((await pgError(db.insert(subscribers).values(sub("Parent@Example.com")))).constraint).toBe(
      "subscribers_email_lower",
    );
    expect(
      (await pgError(db.insert(officers).values({ email: "Officer@Example.org", role: "sender" }))).constraint,
    ).toBe("officers_email_lower");
    expect(
      (await pgError(db.insert(suppressions).values({ email: "X@Example.com", reason: "manual" }))).constraint,
    ).toBe("suppressions_email_lower");
  });

  it("enforces unique subscriber email and unique tokens", async () => {
    await db.insert(subscribers).values(sub("a@example.com"));
    expect((await pgError(db.insert(subscribers).values(sub("a@example.com")))).code).toBe("23505");

    const token = generateToken();
    await db.insert(subscribers).values({ ...sub("b@example.com"), unsubscribeToken: token });
    expect(
      (await pgError(db.insert(subscribers).values({ ...sub("c@example.com"), unsubscribeToken: token }))).constraint,
    ).toBe("subscribers_unsubscribe_token_key");
  });

  it("rejects short (guessable) tokens", async () => {
    expect(
      (await pgError(db.insert(subscribers).values({ ...sub("d@example.com"), unsubscribeToken: "abc" }))).constraint,
    ).toBe("subscribers_unsubscribe_token_len");
    expect(
      (await pgError(db.insert(subscribers).values({ ...sub("e@example.com"), confirmToken: "abc" }))).constraint,
    ).toBe("subscribers_confirm_token_len");
  });

  it("defaults new subscribers to pending", async () => {
    const [row] = await db.insert(subscribers).values(sub("f@example.com")).returning();
    expect(row.status).toBe("pending");
    expect(row.confirmedAt).toBeNull();
  });

  it("allows only one brand_settings row and validates colors", async () => {
    const base = { primaryColor: "#112233", accentColor: "#445566", ptaMailingAddress: "1 Main St" };
    await db.insert(brandSettings).values(base);
    expect((await pgError(db.insert(brandSettings).values(base))).code).toBe("23505");
    expect((await pgError(db.insert(brandSettings).values({ ...base, id: false }))).constraint).toBe(
      "brand_settings_singleton",
    );
    expect(
      (await pgError(db.update(brandSettings).set({ primaryColor: "red" }))).constraint,
    ).toBe("brand_settings_primary_color_hex");
  });

  it("keeps officers.active and deactivated_at consistent", async () => {
    expect(
      (await pgError(db.insert(officers).values({ email: "g@example.org", role: "sender", active: false })))
        .constraint,
    ).toBe("officers_active_consistent");
    await db
      .insert(officers)
      .values({ email: "h@example.org", role: "sender", active: false, deactivatedAt: new Date() });
  });

  it("allows at most one send row per subscriber per campaign", async () => {
    const [o] = await db.insert(officers).values({ email: "i@example.org", role: "admin" }).returning();
    const [c] = await db.insert(campaigns).values({ bodyJson: {}, createdBy: o.id }).returning();
    const [s] = await db.insert(subscribers).values(sub("j@example.com")).returning();
    await db.insert(sends).values({ campaignId: c.id, subscriberId: s.id });
    expect(
      (await pgError(db.insert(sends).values({ campaignId: c.id, subscriberId: s.id }))).constraint,
    ).toBe("sends_campaign_subscriber_key");
  });
});
