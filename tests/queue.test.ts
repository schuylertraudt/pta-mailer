import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { campaigns, sends, subscribers, suppressions } from "@/db/schema";
import { campaignStats, enqueueCampaign } from "@/lib/queue/enqueue";
import { processQueue, STALE_SENDING_MS } from "@/lib/queue/dispatch";
import { MemoryProvider } from "@/lib/mail/provider";
import { unsubscribeByToken } from "@/lib/subscribers/service";
import { handleSesEvent } from "@/lib/webhooks/ses-events";
import { resetDb, testDb } from "./helpers/db";
import { makeOfficer, makeSubscriber } from "./helpers/factories";
import { makeCampaign, realBrand } from "./helpers/campaign";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  await realBrand(db);
});

const run = (p: MemoryProvider) => processQueue(db, p, { ratePerSecond: 10_000, sleep: async () => {} });

async function sendCampaign(provider = new MemoryProvider()) {
  const o = await makeOfficer(db, "sender");
  const c = await makeCampaign(db, o.id);
  await enqueueCampaign(db, c.id, o.id);
  await run(provider);
  return { c, o, provider };
}

describe("queue + dispatch", () => {
  it("sends each eligible subscriber exactly once with their own unsubscribe token and headers", async () => {
    const subs = await Promise.all([makeSubscriber(db), makeSubscriber(db), makeSubscriber(db)]);
    await makeSubscriber(db, { status: "pending", confirmedAt: null });
    const { c, provider } = await sendCampaign();

    expect(provider.sent.map((m) => m.to).sort()).toEqual(subs.map((s) => s.email).sort());
    for (const m of provider.sent) {
      const sub = subs.find((s) => s.email === m.to)!;
      expect(m.html).toContain(`/u/${sub.unsubscribeToken}`);
      expect(m.text).toContain(`/u/${sub.unsubscribeToken}`);
      expect(m.html).not.toContain("__UNSUBSCRIBE_TOKEN__");
      for (const other of subs.filter((s) => s !== sub)) expect(m.html).not.toContain(other.unsubscribeToken);
      expect(m.headers!["List-Unsubscribe"]).toContain(`/api/unsubscribe/${sub.unsubscribeToken}`);
      expect(m.headers!["List-Unsubscribe"]).toContain("mailto:");
      expect(m.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    }
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(row.status).toBe("sent");
    expect(row.sentAt).not.toBeNull();
    expect(await campaignStats(db, c.id)).toMatchObject({ total: 3, sent: 3, queued: 0, failed: 0 });
  });

  it("checks suppression at dispatch time, not just queue time", async () => {
    const a = await makeSubscriber(db);
    const b = await makeSubscriber(db);
    const o = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, o.id);
    await enqueueCampaign(db, c.id, o.id);
    // Unsubscribes after queueing, before dispatch.
    await unsubscribeByToken(db, a.unsubscribeToken, "one-click");
    // And a suppression for b is added directly while b stays "active".
    await db.insert(suppressions).values({ email: b.email, reason: "manual", source: "test" });
    const p = new MemoryProvider();
    await run(p);
    expect(p.sent).toHaveLength(0);
    expect(await campaignStats(db, c.id)).toMatchObject({ skipped: 2, sent: 0 });
  });

  it("never sends to unconfirmed subscribers even if a row slips into the queue", async () => {
    const pending = await makeSubscriber(db, { status: "pending", confirmedAt: null });
    await makeSubscriber(db);
    const o = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, o.id);
    await enqueueCampaign(db, c.id, o.id);
    await db.insert(sends).values({ campaignId: c.id, subscriberId: pending.id });
    const p = new MemoryProvider();
    await run(p);
    expect(p.sent.map((m) => m.to)).not.toContain(pending.email);
  });

  it("retries with backoff and never double-sends", async () => {
    const flaky = await makeSubscriber(db);
    await makeSubscriber(db);
    const o = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, o.id);
    await enqueueCampaign(db, c.id, o.id);

    const p = new MemoryProvider();
    let failures = 0;
    p.failWith = (m) => (m.to === flaky.email && failures++ < 2 ? Object.assign(new Error("Throttling"), { name: "Throttling" }) : undefined);

    await run(p);
    let [row] = await db.select().from(sends).where(eq(sends.subscriberId, flaky.id));
    expect(row).toMatchObject({ status: "queued", attempts: 1 });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // Not due yet: another run does nothing for it.
    await run(p);
    expect(p.sent.filter((m) => m.to === flaky.email)).toHaveLength(0);

    for (let i = 0; i < 3; i++) {
      await db.update(sends).set({ nextAttemptAt: new Date(0) }).where(eq(sends.subscriberId, flaky.id));
      await run(p);
    }
    [row] = await db.select().from(sends).where(eq(sends.subscriberId, flaky.id));
    expect(row).toMatchObject({ status: "sent", attempts: 3 });
    expect(p.sent.filter((m) => m.to === flaky.email)).toHaveLength(1);
    expect(p.sent).toHaveLength(2);
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(camp.status).toBe("sent");
  });

  it("gives up after max attempts and on permanent errors", async () => {
    const s = await makeSubscriber(db);
    const o = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, o.id);
    await enqueueCampaign(db, c.id, o.id);
    const p = new MemoryProvider();
    p.failWith = () => Object.assign(new Error("Address blacklisted"), { name: "MessageRejected" });
    await run(p);
    const [row] = await db.select().from(sends).where(eq(sends.subscriberId, s.id));
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row.lastError).toContain("MessageRejected");
    const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(camp.status).toBe("failed");
  });

  it("concurrent workers and duplicate enqueues never double-send", async () => {
    await Promise.all(Array.from({ length: 30 }, () => makeSubscriber(db)));
    const o = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, o.id);
    await enqueueCampaign(db, c.id, o.id);
    await expect(enqueueCampaign(db, c.id, o.id)).rejects.toMatchObject({ status: 409 });

    const p = new MemoryProvider();
    await Promise.all([
      processQueue(db, p, { ratePerSecond: 10_000, batchSize: 5, sleep: async () => {} }),
      processQueue(db, p, { ratePerSecond: 10_000, batchSize: 5, sleep: async () => {} }),
      processQueue(db, p, { ratePerSecond: 10_000, batchSize: 5, sleep: async () => {} }),
    ]);
    expect(p.sent).toHaveLength(30);
    expect(new Set(p.sent.map((m) => m.to)).size).toBe(30);
  });

  it("a row interrupted mid-send is failed, not re-sent", async () => {
    const s = await makeSubscriber(db);
    const o = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, o.id);
    await enqueueCampaign(db, c.id, o.id);
    await db
      .update(sends)
      .set({ status: "sending", attempts: 1, nextAttemptAt: new Date(Date.now() - STALE_SENDING_MS - 1000) })
      .where(eq(sends.subscriberId, s.id));
    const p = new MemoryProvider();
    await run(p);
    expect(p.sent).toHaveLength(0);
    const [row] = await db.select().from(sends).where(eq(sends.subscriberId, s.id));
    expect(row.status).toBe("failed");
  });

  it("respects the provider rate limit", async () => {
    await Promise.all(Array.from({ length: 5 }, () => makeSubscriber(db)));
    const o = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, o.id);
    await enqueueCampaign(db, c.id, o.id);
    const waits: number[] = [];
    await processQueue(db, new MemoryProvider(), { ratePerSecond: 2, sleep: async (ms) => void waits.push(ms) });
    expect(waits.length).toBeGreaterThanOrEqual(4);
    for (const w of waits) expect(w).toBeLessThanOrEqual(500);
    expect(waits.reduce((a, b) => a + b, 0)).toBeGreaterThan(1500);
  });
});

describe("bounces and complaints", () => {
  it("hard bounce and complaint are suppressed, update status, and are skipped in the next campaign", async () => {
    const bouncer = await makeSubscriber(db);
    const complainer = await makeSubscriber(db);
    const fine = await makeSubscriber(db);
    const { provider } = await sendCampaign();
    const idOf = (email: string) => provider.sent.find((m) => m.to === email)!.messageId;

    await handleSesEvent(db, {
      notificationType: "Bounce",
      mail: { messageId: idOf(bouncer.email) },
      bounce: { bounceType: "Permanent", bounceSubType: "General", bouncedRecipients: [{ emailAddress: `Parent <${bouncer.email.toUpperCase()}>` }] },
    });
    await handleSesEvent(db, {
      eventType: "Complaint",
      mail: { messageId: idOf(complainer.email) },
      complaint: { complainedRecipients: [{ emailAddress: complainer.email }], complaintFeedbackType: "abuse" },
    });
    // Transient bounces don't suppress.
    await handleSesEvent(db, {
      notificationType: "Bounce",
      mail: { messageId: idOf(fine.email) },
      bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: fine.email }] },
    });

    const supp = await db.select().from(suppressions);
    expect(supp.map((s) => [s.email, s.reason]).sort()).toEqual(
      [
        [bouncer.email, "bounce"],
        [complainer.email, "complaint"],
      ].sort(),
    );
    const statuses = Object.fromEntries((await db.select().from(subscribers)).map((s) => [s.email, s.status]));
    expect(statuses[bouncer.email]).toBe("bounced");
    expect(statuses[complainer.email]).toBe("complained");
    expect(statuses[fine.email]).toBe("active");

    const sendStatuses = await db.select({ s: sends.status, n: sql<number>`count(*)::int` }).from(sends).groupBy(sends.status);
    expect(Object.fromEntries(sendStatuses.map((r) => [r.s, r.n]))).toEqual({ sent: 1, bounced: 1, complained: 1 });

    const next = await sendCampaign();
    expect(next.provider.sent.map((m) => m.to)).toEqual([fine.email]);
  });

  it("inbound mailto unsubscribe uses the token in the subject", async () => {
    const s = await makeSubscriber(db);
    const out = await handleSesEvent(db, { notificationType: "Received", mail: { commonHeaders: { subject: `unsubscribe ${s.unsubscribeToken}` } } });
    expect(out).toBe("mailto unsubscribed");
    const [row] = await db.select().from(suppressions);
    expect(row).toMatchObject({ email: s.email, source: "unsubscribe:mailto" });
  });
});
