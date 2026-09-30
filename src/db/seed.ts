import { faker } from "@faker-js/faker";
import { eq } from "drizzle-orm";
import type { Db } from "./index";
import {
  brandSettings,
  officers,
  segments,
  subscriberSegments,
  subscribers,
  suppressions,
} from "./schema";
import { SCHOOLS } from "@/lib/schools";
import { generateToken } from "@/lib/tokens";

export const DEFAULT_BRAND = {
  primaryColor: "#1F4E79",
  accentColor: "#F2A900",
  footerText: "You are receiving this because you subscribed to PTA news.",
  ptaMailingAddress: "Example Elementary PTA, 123 Main St, Anytown, ST 00000",
} as const;

// Reserved example domains only; seed data must never reach a real inbox.
export const SEED_OFFICERS = [
  { email: "admin1@example.org", name: "Alex Admin", role: "admin" },
  { email: "admin2@example.org", name: "Blair Admin", role: "admin" },
  { email: "sender@example.org", name: "Casey Sender", role: "sender" },
  { email: "drafter@example.org", name: "Drew Drafter", role: "drafter" },
] as const;

export const SEED_COMMITTEES = ["Garden Committee", "Fundraising Committee"] as const;

export async function seed(db: Db, opts: { subscribers?: number } = {}) {
  const subscriberCount = opts.subscribers ?? 120;
  faker.seed(42);

  await db.transaction(async (tx) => {
    await tx
      .insert(brandSettings)
      .values({ id: true, ...DEFAULT_BRAND })
      .onConflictDoNothing();

    const insertedOfficers = await tx
      .insert(officers)
      .values(SEED_OFFICERS.map((o) => ({ ...o })))
      .onConflictDoNothing({ target: officers.email })
      .returning({ id: officers.id, email: officers.email });
    const [firstAdmin] = await tx.select().from(officers).where(eq(officers.email, SEED_OFFICERS[0].email));
    if (insertedOfficers.length > 0 && firstAdmin) {
      await tx
        .update(officers)
        .set({ addedBy: firstAdmin.id })
        .where(eq(officers.role, "drafter"));
    }

    await tx
      .insert(segments)
      .values([
        { name: "All families", rule: "all" },
        ...SCHOOLS.map((s) => ({ name: s, rule: `school=${s}` })),
        ...SEED_COMMITTEES.map((c) => ({ name: c, rule: `committee=${c}` })),
      ])
      .onConflictDoNothing({ target: segments.name });

    const now = Date.now();
    const rows = Array.from({ length: subscriberCount }, (_, i) => {
      const school = SCHOOLS[i % SCHOOLS.length];
      // ~80% active, 10% pending, 5% unsubscribed, 5% bounced.
      const roll = i % 20;
      const status =
        roll < 16 ? "active" : roll < 18 ? "pending" : roll === 18 ? "unsubscribed" : "bounced";
      const consentAt = new Date(now - faker.number.int({ min: 1, max: 365 }) * 86_400_000);
      return {
        email: `family${i + 1}.${faker.string.alphanumeric(6).toLowerCase()}@example.com`,
        school,
        status,
        consentAt,
        confirmedAt: status === "pending" ? null : new Date(consentAt.getTime() + 3_600_000),
        confirmToken: status === "pending" ? generateToken() : null,
        unsubscribeToken: generateToken(),
      } as const;
    });
    const inserted = await tx
      .insert(subscribers)
      .values(rows)
      .onConflictDoNothing({ target: subscribers.email })
      .returning({ id: subscribers.id, email: subscribers.email, status: subscribers.status });

    const suppressed = inserted.filter((s) => s.status === "unsubscribed" || s.status === "bounced");
    if (suppressed.length) {
      await tx
        .insert(suppressions)
        .values(
          suppressed.map((s) => ({
            email: s.email,
            reason: s.status === "bounced" ? ("bounce" as const) : ("unsubscribe" as const),
            source: "seed",
          })),
        )
        .onConflictDoNothing();
    }

    const committeeSegments = await tx.select().from(segments).where(eq(segments.rule, `committee=${SEED_COMMITTEES[0]}`));
    const fundraising = await tx.select().from(segments).where(eq(segments.rule, `committee=${SEED_COMMITTEES[1]}`));
    const active = inserted.filter((s) => s.status === "active");
    const memberships = [
      ...active.slice(0, 8).map((s) => ({ subscriberId: s.id, segmentId: committeeSegments[0].id })),
      ...active.slice(5, 15).map((s) => ({ subscriberId: s.id, segmentId: fundraising[0].id })),
    ];
    if (memberships.length) await tx.insert(subscriberSegments).values(memberships).onConflictDoNothing();
  });
}
