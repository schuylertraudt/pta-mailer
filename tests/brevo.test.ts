import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sendClicks, sends, sendingSettings, subscribers, suppressions } from "@/db/schema";
import { activeProviderName, currentPause, sendingStatus, switchProvider } from "@/lib/mail/active";
import { BrevoProvider, MemoryProvider, QuotaExceededError, setEmailProvider, type OutboundEmail } from "@/lib/mail/provider";
import { campaignStats, enqueueCampaign } from "@/lib/queue/enqueue";
import { processQueue } from "@/lib/queue/dispatch";
import { sendDueConfirmations, subscribe } from "@/lib/subscribers/service";
import { POST as brevoWebhook } from "../app/api/webhooks/brevo/route";
import { POST as testSend } from "../app/api/campaigns/[id]/test/route";
import { GET as sendingGet, PUT as sendingPut } from "../app/api/admin/sending/route";
import { resetDb, testDb } from "./helpers/db";
import { makeOfficer, makeSubscriber, sessionFor } from "./helpers/factories";
import { makeCampaign, realBrand } from "./helpers/campaign";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  await realBrand(db);
});
afterEach(() => setEmailProvider(undefined));

const run = (p: MemoryProvider) => processQueue(db, p, { ratePerSecond: 10_000, sleep: async () => {} });

/** Accepts `limit` messages, then reports the daily quota as used up. */
class CappedProvider extends MemoryProvider {
  constructor(public limit: number) {
    super();
  }
  override async send(msg: OutboundEmail) {
    if (this.sent.length >= this.limit) throw new QuotaExceededError("Brevo 402 not_enough_credits: daily limit");
    return super.send(msg);
  }
}

describe("Brevo provider", () => {
  it("posts the message to Brevo's API and returns its message id", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messageId: "<abc@smtp-relay.mailin.fr>" }), { status: 201 });
    }) as unknown as typeof fetch;
    const p = new BrevoProvider({ apiKey: "k-123" }, fake);
    const out = await p.send({
      to: "parent@example.com",
      from: '"Karigon PTA" <news@pta.example.org>',
      subject: "Hi",
      html: "<p>h</p>",
      text: "t",
      headers: { "List-Unsubscribe": "<https://x>" },
    });
    expect(out.messageId).toBe("<abc@smtp-relay.mailin.fr>");
    expect(calls[0].url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((calls[0].init.headers as Record<string, string>)["api-key"]).toBe("k-123");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      sender: { name: "Karigon PTA", email: "news@pta.example.org" },
      to: [{ email: "parent@example.com" }],
      subject: "Hi",
      htmlContent: "<p>h</p>",
      textContent: "t",
      headers: { "List-Unsubscribe": "<https://x>" },
    });
  });

  it("turns 402 into a quota error and 400 into a permanent error", async () => {
    const reply = (status: number, body: object) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const msg = { to: "a@b.c", subject: "s", html: "h", text: "t" };
    await expect(new BrevoProvider({ apiKey: "k" }, reply(402, { code: "not_enough_credits", message: "limit" })).send(msg)).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
    await expect(new BrevoProvider({ apiKey: "k" }, reply(400, { code: "invalid_parameter", message: "bad" })).send(msg)).rejects.toMatchObject({
      name: "BadRequestException",
    });
    await expect(new BrevoProvider({ apiKey: "k" }, reply(429, {})).send(msg)).rejects.toMatchObject({ name: "Throttled" });
  });
});

describe("daily limit", () => {
  it("pauses the queue without using up retries, then finishes after the limit resets", async () => {
    for (let i = 0; i < 5; i++) await makeSubscriber(db);
    const o = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, o.id);
    await enqueueCampaign(db, c.id, o.id);

    const p = new CappedProvider(3);
    const first = await run(p);
    expect(first).toMatchObject({ sent: 3, paused: true, failed: 0 });
    expect(await currentPause(db)).not.toBeNull();
    const waiting = await db.select().from(sends).where(eq(sends.status, "queued"));
    expect(waiting).toHaveLength(2);
    expect(waiting.every((r) => r.attempts === 0)).toBe(true);

    // Still paused: nothing is attempted.
    expect(await run(p)).toMatchObject({ sent: 0, paused: true });

    // The limit resets (simulated by ending the pause).
    p.limit = 100;
    await db.update(sendingSettings).set({ pausedUntil: new Date(Date.now() - 1000) });
    await db.update(sends).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(sends.status, "queued"));
    expect(await run(p)).toMatchObject({ sent: 2, paused: false });
    expect(await campaignStats(db, c.id)).toMatchObject({ sent: 5, queued: 0, failed: 0 });
    expect(new Set(p.sent.map((m) => m.to)).size).toBe(5);
  });

  it("retries a confirmation email that couldn't be sent at signup", async () => {
    const p = new CappedProvider(0);
    setEmailProvider(p);
    expect(await subscribe(db, { email: "new@example.com", school: "Okte" }, { ip: "1.2.3.4" })).toBe("sent_confirmation");
    const [row] = await db.select().from(subscribers).where(eq(subscribers.email, "new@example.com"));
    expect(row.confirmEmailDueAt).not.toBeNull();

    p.limit = 10;
    expect(await sendDueConfirmations(db)).toBe(1);
    expect(p.sent.map((m) => m.to)).toEqual(["new@example.com"]);
    const [after] = await db.select().from(subscribers).where(eq(subscribers.email, "new@example.com"));
    expect(after.confirmEmailDueAt).toBeNull();
    expect(await sendDueConfirmations(db)).toBe(0);
  });
});

describe("Send Preview errors", () => {
  it("shows the service's reason instead of a generic error", async () => {
    const o = await makeOfficer(db, "drafter");
    const c = await makeCampaign(db, o.id);
    const failing = new MemoryProvider();
    failing.failWith = () => Object.assign(new Error("Brevo 401 unauthorized: unrecognised IP address"), { name: "BrevoError" });
    setEmailProvider(failing);
    const call = async () =>
      testSend(new Request("https://pta.example.org/api/x", { method: "POST", headers: (await sessionFor(db, o.id)).headers }), {
        params: Promise.resolve({ id: c.id }),
      } as never);
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("The email service refused the email: Brevo 401 unauthorized: unrecognised IP address");

    failing.failWith = () => new QuotaExceededError("Brevo 402 not_enough_credits: limit");
    const quota = await call();
    expect(quota.status).toBe(429);
    expect((await quota.json()).error).toMatch(/sending limit is used up/);
  });
});

describe("switching services", () => {
  it("only admins switch, only to a configured service, and switching clears a pause", async () => {
    const admin = await makeOfficer(db, "admin");
    const sender = await makeOfficer(db, "sender");
    const call = async (route: typeof sendingPut, officerId: string, body?: object, method = "PUT") =>
      route(
        new Request("https://pta.example.org/api/admin/sending", {
          method,
          headers: { ...(await sessionFor(db, officerId)).headers, "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        }),
        { params: Promise.resolve({}) } as never,
      );

    expect((await call(sendingPut, sender.id, { provider: "brevo" })).status).toBe(403);
    expect(await activeProviderName(db)).toBe("memory");

    // SES has no credentials in the test environment.
    const ses = await call(sendingPut, admin.id, { provider: "ses" });
    expect(ses.status).toBe(400);
    expect((await ses.json()).error).toMatch(/isn't set up/);

    await db.insert(sendingSettings).values({ id: true, pausedUntil: new Date(Date.now() + 3600_000), pauseReason: "limit" });
    const res = await call(sendingPut, admin.id, { provider: "brevo" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ active: "brevo", pause: null, configured: { ses: false, brevo: true }, chosenBy: { email: admin.email } });
    expect(await activeProviderName(db)).toBe("brevo");

    const got = await (await call(sendingGet as never, admin.id, undefined, "GET")).json();
    expect(got.active).toBe("brevo");
    expect((await call(sendingGet as never, sender.id, undefined, "GET")).status).toBe(403);
  });

  it("reports which settings are missing", async () => {
    const s = await sendingStatus(db);
    expect(s.missing.ses).toEqual(["SES_REGION", "SES_ACCESS_KEY_ID", "SES_SECRET_ACCESS_KEY"]);
    expect(s.missing.brevo).toEqual([]);
    expect(s.reporting.brevo).toBe(true);
    await expect(switchProvider(db, (await makeOfficer(db, "admin")).id, { provider: "nope" as never })).rejects.toThrow();
  });
});

describe("Brevo webhook", () => {
  const post = (body: unknown, auth: Record<string, string> = { authorization: "Bearer brevo-webhook-secret-123" }, query = "") =>
    brevoWebhook(
      new Request(`https://pta.example.org/api/webhooks/brevo${query}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify(body),
      }),
    );

  async function sentMessage() {
    const subs = [await makeSubscriber(db), await makeSubscriber(db), await makeSubscriber(db)];
    const o = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, o.id);
    await enqueueCampaign(db, c.id, o.id);
    const p = new MemoryProvider();
    await run(p);
    const idOf = (email: string) => p.sent.find((m) => m.to === email)!.messageId;
    return { c, subs, idOf };
  }

  it("rejects calls without the shared secret", async () => {
    expect((await post({ event: "spam", email: "x@y.z" }, {})).status).toBe(401);
    expect((await post({ event: "spam", email: "x@y.z" }, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post({ event: "request" }, {}, "?token=brevo-webhook-secret-123")).status).toBe(200);
    const basic = `Basic ${Buffer.from("brevo:brevo-webhook-secret-123").toString("base64")}`;
    expect((await post({ event: "request" }, { authorization: basic })).status).toBe(200);
    expect(await db.select().from(suppressions)).toHaveLength(0);
  });

  it("suppresses bounces and spam reports and records opens, clicks and refusals", async () => {
    const { c, subs, idOf } = await sentMessage();
    const [a, b, d] = subs;
    const res = await post([
      { event: "hard_bounce", email: a.email.toUpperCase(), "message-id": idOf(a.email), reason: "mailbox does not exist" },
      { event: "spam", email: b.email, "message-id": `<${idOf(b.email)}>` },
      { event: "opened", email: d.email, "message-id": idOf(d.email), ts_event: 1_790_000_000 },
      { event: "unique_opened", email: d.email, "message-id": idOf(d.email), ts_event: 1_790_000_000 },
      { event: "proxy_open", email: d.email, "message-id": idOf(d.email) },
      { event: "click", email: d.email, "message-id": idOf(d.email), link: "https://forms.example.org/volunteer" },
      { event: "click", email: d.email, "message-id": idOf(d.email), link: `https://pta.example.org/u/${d.unsubscribeToken}` },
      { event: "delivered", email: d.email, "message-id": idOf(d.email) },
    ]);
    expect(res.status).toBe(200);

    const supp = await db.select().from(suppressions);
    expect(supp.map((s) => [s.email, s.reason, s.source]).sort()).toEqual(
      [
        [a.email, "bounce", "brevo:hard_bounce"],
        [b.email, "complaint", "brevo:spam"],
      ].sort(),
    );
    expect(await campaignStats(db, c.id)).toMatchObject({ bounced: 1, complained: 1, opened: 1, clicked: 1 });
    const [dRow] = await db.select().from(sends).where(eq(sends.providerMessageId, idOf(d.email)));
    expect(dRow).toMatchObject({ openCount: 1, clickCount: 1 });
    // The unsubscribe link (with its token) isn't stored as a click.
    expect((await db.select().from(sendClicks)).map((r) => r.url)).toEqual(["https://forms.example.org/volunteer"]);

    await post({ event: "blocked", email: d.email, "message-id": idOf(d.email), reason: "blocklisted" });
    const [blocked] = await db.select().from(sends).where(eq(sends.providerMessageId, idOf(d.email)));
    expect(blocked).toMatchObject({ status: "failed", lastError: "Brevo blocked: blocklisted" });
  });

  it("treats a Brevo-side unsubscribe as an unsubscribe", async () => {
    const s = await makeSubscriber(db);
    await post({ event: "unsubscribed", email: s.email });
    const [row] = await db.select().from(subscribers).where(eq(subscribers.id, s.id));
    expect(row.status).toBe("unsubscribed");
    const [supp] = await db.select().from(suppressions);
    expect(supp).toMatchObject({ email: s.email, reason: "unsubscribe" });
  });
});
