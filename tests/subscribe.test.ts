import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { subscribers, suppressions } from "@/db/schema";
import { issueFormToken, checkFormToken } from "@/lib/subscribers/form-token";
import {
  confirmSubscription,
  subscribe,
  unsubscribeByToken,
  CONFIRM_TOKEN_TTL_MS,
} from "@/lib/subscribers/service";
import { countRecipients, listRecipients } from "@/lib/campaigns/recipients";
import { listUnsubscribeHeaders } from "@/lib/urls";
import { POST as subscribeRoute } from "../app/api/subscribe/route";
import { POST as unsubscribeRoute } from "../app/api/unsubscribe/[token]/route";
import { POST as confirmRoute } from "../app/api/confirm/[token]/route";
import { resetDb, testDb } from "./helpers/db";
import { mailbox, makeSubscriber } from "./helpers/factories";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  mailbox().clear();
});

const ip = () => `10.0.0.${Math.floor(Math.random() * 250)}`;
const params = (token: string) => ({ params: Promise.resolve({ token }) });
const confirmTokenFromMail = () => {
  const m = mailbox().sent.at(-1)!;
  return /\/confirm\/([A-Za-z0-9_-]+)/.exec(m.text)![1];
};

describe("subscribe + double opt-in", () => {
  it("creates a pending subscriber and emails a confirmation link", async () => {
    expect(await subscribe(db, { email: " New@Example.com ", school: "Orenda" }, { ip: ip() })).toBe(
      "sent_confirmation",
    );
    const [row] = await db.select().from(subscribers);
    expect(row).toMatchObject({ email: "new@example.com", school: "Orenda", status: "pending", confirmedAt: null });
    expect(mailbox().sent).toHaveLength(1);
    expect(mailbox().sent[0].to).toBe("new@example.com");
    expect(confirmTokenFromMail()).toBe(row.confirmToken);
  });

  it("activates only when the confirmation link is used", async () => {
    await subscribe(db, { email: "p@example.com", school: "Karigon" }, { ip: ip() });
    expect(await countRecipients(db, null)).toBe(0);
    expect(await confirmSubscription(db, confirmTokenFromMail())).toBe("confirmed");
    const [row] = await db.select().from(subscribers);
    expect(row.status).toBe("active");
    expect(row.confirmToken).toBeNull();
    expect(await countRecipients(db, null)).toBe(1);
    // Token is single use.
    expect(await confirmSubscription(db, confirmTokenFromMail())).toBe("invalid");
  });

  it("rejects expired confirmation tokens", async () => {
    await subscribe(db, { email: "old@example.com", school: "Karigon" }, { ip: ip() });
    await db.update(subscribers).set({ consentAt: new Date(Date.now() - CONFIRM_TOKEN_TTL_MS - 1000) });
    expect(await confirmSubscription(db, confirmTokenFromMail())).toBe("invalid");
  });

  it("confirm route redirects and activates on POST", async () => {
    await subscribe(db, { email: "r@example.com", school: "Karigon" }, { ip: ip() });
    const token = confirmTokenFromMail();
    const res = await confirmRoute(new Request(`https://pta.example.org/api/confirm/${token}`, { method: "POST" }), params(token));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("result=confirmed");
  });

  it("does nothing for already-active subscribers (no enumeration, no spam)", async () => {
    await makeSubscriber(db, { email: "a@example.com" });
    expect(await subscribe(db, { email: "a@example.com", school: "Karigon" }, { ip: ip() })).toBe("noop");
    expect(mailbox().sent).toHaveLength(0);
  });

  it("sends nothing at all to bounced/complained/manual suppressions", async () => {
    await db.insert(suppressions).values({ email: "b@example.com", reason: "bounce", source: "test" });
    expect(await subscribe(db, { email: "b@example.com", school: "Karigon" }, { ip: ip() })).toBe("noop");
    expect(mailbox().sent).toHaveLength(0);
    expect(await db.select().from(subscribers)).toHaveLength(0);
  });

  it("rejects invalid input", async () => {
    await expect(subscribe(db, { email: "nope", school: "Karigon" }, { ip: ip() })).rejects.toThrow();
    await expect(subscribe(db, { email: "x@example.com", school: "Hogwarts" as never }, { ip: ip() })).rejects.toThrow();
  });

  it("rate-limits per IP and per email", async () => {
    const fixed = "192.0.2.1";
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await subscribe(db, { email: `x${i}@example.com`, school: "Karigon" }, { ip: fixed }));
    expect(results.slice(0, 10).every((r) => r === "sent_confirmation")).toBe(true);
    expect(results.slice(10)).toEqual(["rate_limited", "rate_limited"]);

    const per = [];
    for (let i = 0; i < 4; i++) per.push(await subscribe(db, { email: "same@example.com", school: "Karigon" }, { ip: ip() }));
    expect(per.at(-1)).toBe("rate_limited");
  });
});

describe("subscribe route bot protection", () => {
  const post = (body: Record<string, string | undefined>) =>
    subscribeRoute(
      new Request("https://pta.example.org/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip() },
        body: JSON.stringify(body),
      }),
    );

  it("accepts a real submission", async () => {
    const res = await post({ email: "ok@example.com", school: "Karigon", formToken: issueFormToken(Date.now() - 5000) });
    expect(res.status).toBe(200);
    expect(mailbox().sent).toHaveLength(1);
  });

  it("silently drops honeypot, instant, forged and missing form tokens", async () => {
    for (const body of [
      { email: "bot1@example.com", school: "Karigon", formToken: issueFormToken(Date.now() - 5000), website: "spam" },
      { email: "bot2@example.com", school: "Karigon", formToken: issueFormToken() },
      { email: "bot3@example.com", school: "Karigon", formToken: `${Date.now() - 5000}.forged` },
      { email: "bot4@example.com", school: "Karigon" },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(200);
    }
    expect(mailbox().sent).toHaveLength(0);
    expect(await db.select().from(subscribers)).toHaveLength(0);
  });

  it("form tokens expire", () => {
    expect(checkFormToken(issueFormToken(Date.now() - 25 * 3600_000))).toBe(false);
  });

  it("returns 400 for bad input", async () => {
    const res = await post({ email: "nope", school: "Karigon", formToken: issueFormToken(Date.now() - 5000) });
    expect(res.status).toBe(400);
  });
});

describe("unsubscribe", () => {
  it("via the page button (link) suppresses immediately", async () => {
    const s = await makeSubscriber(db);
    const res = await unsubscribeRoute(
      new Request(`https://pta.example.org/api/unsubscribe/${s.unsubscribeToken}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
      }),
      params(s.unsubscribeToken),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("result=unsubscribed");
    const [sup] = await db.select().from(suppressions).where(eq(suppressions.email, s.email));
    expect(sup).toMatchObject({ reason: "unsubscribe", source: "unsubscribe:link" });
    const [row] = await db.select().from(subscribers).where(eq(subscribers.id, s.id));
    expect(row.status).toBe("unsubscribed");
  });

  it("via RFC 8058 one-click POST suppresses immediately", async () => {
    const s = await makeSubscriber(db);
    const res = await unsubscribeRoute(
      new Request(`https://pta.example.org/api/unsubscribe/${s.unsubscribeToken}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
      params(s.unsubscribeToken),
    );
    expect(res.status).toBe(200);
    const [sup] = await db.select().from(suppressions).where(eq(suppressions.email, s.email));
    expect(sup).toMatchObject({ reason: "unsubscribe", source: "unsubscribe:one-click" });
  });

  it("is idempotent", async () => {
    const s = await makeSubscriber(db);
    expect(await unsubscribeByToken(db, s.unsubscribeToken, "link")).toBe("unsubscribed");
    expect(await unsubscribeByToken(db, s.unsubscribeToken, "one-click")).toBe("unsubscribed");
    expect(await db.select().from(suppressions)).toHaveLength(1);
  });

  it("a token affects exactly one subscriber", async () => {
    const a = await makeSubscriber(db);
    const b = await makeSubscriber(db);
    await unsubscribeByToken(db, a.unsubscribeToken, "link");
    const [rb] = await db.select().from(subscribers).where(eq(subscribers.id, b.id));
    expect(rb.status).toBe("active");
    expect((await db.select().from(suppressions)).map((s) => s.email)).toEqual([a.email]);
  });

  it("rejects unknown, short and near-miss tokens", async () => {
    const a = await makeSubscriber(db);
    const flipped = a.unsubscribeToken.slice(0, -1) + (a.unsubscribeToken.endsWith("A") ? "B" : "A");
    for (const t of ["", "abc", flipped, "x".repeat(43)]) {
      expect(await unsubscribeByToken(db, t, "link")).toBe("invalid");
    }
    expect(await db.select().from(suppressions)).toHaveLength(0);
  });

  it("tokens are unique per subscriber and high-entropy", async () => {
    const subs = await Promise.all(Array.from({ length: 50 }, () => makeSubscriber(db)));
    const tokens = subs.map((s) => s.unsubscribeToken);
    expect(new Set(tokens).size).toBe(50);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });
});

describe("recipient eligibility", () => {
  it("excludes pending (unconfirmed) subscribers", async () => {
    await makeSubscriber(db, { status: "pending", confirmedAt: null });
    const active = await makeSubscriber(db);
    expect((await listRecipients(db, null)).map((r) => r.id)).toEqual([active.id]);
  });

  it("excludes suppressed addresses even when re-added as an active subscriber", async () => {
    const s = await makeSubscriber(db);
    await unsubscribeByToken(db, s.unsubscribeToken, "link");
    // Someone (or a bad import) flips the row back to active: suppression still wins.
    await db.update(subscribers).set({ status: "active" }).where(eq(subscribers.id, s.id));
    expect(await listRecipients(db, null)).toEqual([]);

    // Delete and re-insert the subscriber entirely: still suppressed.
    await db.delete(subscribers).where(eq(subscribers.id, s.id));
    await makeSubscriber(db, { email: s.email });
    expect(await listRecipients(db, null)).toEqual([]);
  });

  it("re-subscribing after unsubscribe requires a new confirmation, which lifts only the unsubscribe suppression", async () => {
    const s = await makeSubscriber(db, { email: "back@example.com" });
    await unsubscribeByToken(db, s.unsubscribeToken, "link");
    expect(await subscribe(db, { email: "back@example.com", school: "Karigon" }, { ip: ip() })).toBe("sent_confirmation");
    expect(await listRecipients(db, null)).toEqual([]);
    await confirmSubscription(db, confirmTokenFromMail());
    expect((await listRecipients(db, null)).map((r) => r.email)).toEqual(["back@example.com"]);
  });
});

describe("List-Unsubscribe headers", () => {
  it("includes mailto + https targets and the one-click marker", () => {
    const h = listUnsubscribeHeaders("TOKEN123");
    expect(h["List-Unsubscribe"]).toBe(
      "<mailto:unsubscribe@pta.example.org?subject=unsubscribe%20TOKEN123>, <https://pta.example.org/api/unsubscribe/TOKEN123>",
    );
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});
