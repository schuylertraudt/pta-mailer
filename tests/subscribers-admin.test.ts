import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dataAudit, sends, subscribers, suppressions } from "@/db/schema";
import { csvCell, PAGE_SIZE } from "@/lib/subscribers/admin";
import { subscribe } from "@/lib/subscribers/service";
import { enqueueCampaign, campaignStats } from "@/lib/queue/enqueue";
import { processQueue } from "@/lib/queue/dispatch";
import { MemoryProvider } from "@/lib/mail/provider";
import { GET as listRoute } from "../app/api/subscribers/route";
import { DELETE as deleteRoute } from "../app/api/subscribers/[id]/route";
import { GET as exportRoute } from "../app/api/subscribers/export/route";
import { resetDb, testDb } from "./helpers/db";
import { mailbox, makeOfficer, makeSubscriber, sessionFor } from "./helpers/factories";
import { makeCampaign, realBrand } from "./helpers/campaign";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  mailbox().clear();
});

const noParams = { params: Promise.resolve({}) } as never;
const idParams = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const get = (path: string, headers: Record<string, string>) => new Request(`https://pta.example.org${path}`, { headers });
const del = (id: string, headers: Record<string, string>, body: unknown = {}) =>
  deleteRoute(
    new Request(`https://pta.example.org/api/subscribers/${id}`, { method: "DELETE", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }),
    idParams(id),
  );

async function as(role: "admin" | "sender" | "drafter") {
  const o = await makeOfficer(db, role);
  return { officer: o, headers: (await sessionFor(db, o.id)).headers };
}

describe("permissions", () => {
  it("drafters can't browse; senders can browse but not delete or export; admins can do all", async () => {
    const s = await makeSubscriber(db);
    const drafter = await as("drafter");
    const sender = await as("sender");
    const admin = await as("admin");

    expect((await listRoute(get("/api/subscribers", drafter.headers), noParams)).status).toBe(403);
    expect((await listRoute(get("/api/subscribers", sender.headers), noParams)).status).toBe(200);
    expect((await exportRoute(get("/api/subscribers/export", sender.headers), noParams)).status).toBe(403);
    expect((await del(s.id, sender.headers)).status).toBe(403);
    expect((await exportRoute(get("/api/subscribers/export", drafter.headers), noParams)).status).toBe(403);
    expect((await del(s.id, drafter.headers)).status).toBe(403);
    expect(await db.select().from(subscribers)).toHaveLength(1);
    expect(await db.select().from(dataAudit)).toHaveLength(0);

    expect((await exportRoute(get("/api/subscribers/export", admin.headers), noParams)).status).toBe(200);
    expect((await del(s.id, admin.headers)).status).toBe(200);
    expect((await listRoute(get("/api/subscribers", {}), noParams)).status).toBe(401);
  });
});

describe("search", () => {
  it("filters by email substring, status and school, and treats % and _ literally", async () => {
    await makeSubscriber(db, { email: "rivera.family@example.com", school: "Karigon" });
    await makeSubscriber(db, { email: "chen@example.com", school: "Orenda" });
    await makeSubscriber(db, { email: "pending@example.com", school: "Karigon", status: "pending", confirmedAt: null });
    await makeSubscriber(db, { email: "under_score@example.com", school: "Skano" });
    const { headers } = await as("sender");
    const emails = async (q: string) =>
      ((await (await listRoute(get(`/api/subscribers?${q}`, headers), noParams)).json()).rows as { email: string }[]).map((r) => r.email).sort();

    expect(await emails("q=RIVERA")).toEqual(["rivera.family@example.com"]);
    expect(await emails("school=Karigon")).toEqual(["pending@example.com", "rivera.family@example.com"]);
    expect(await emails("school=Karigon&status=active")).toEqual(["rivera.family@example.com"]);
    expect(await emails("school=Orenda")).toEqual(["chen@example.com"]);
    expect(await emails("q=_")).toEqual(["under_score@example.com"]);
    expect(await emails("q=%25")).toEqual([]);
  });

  it("paginates and flags do-not-mail addresses; never returns tokens", async () => {
    for (let i = 0; i < PAGE_SIZE + 5; i++) await makeSubscriber(db);
    const [first] = await db.select().from(subscribers).limit(1);
    await db.insert(suppressions).values({ email: first.email, reason: "manual" });
    const { headers } = await as("sender");
    const p1 = await (await listRoute(get("/api/subscribers", headers), noParams)).json();
    const p2 = await (await listRoute(get("/api/subscribers?page=2", headers), noParams)).json();
    expect(p1).toMatchObject({ total: PAGE_SIZE + 5, pages: 2, page: 1 });
    expect(p1.rows).toHaveLength(PAGE_SIZE);
    expect(p2.rows).toHaveLength(5);
    const all = [...p1.rows, ...p2.rows];
    expect(all.find((r: { email: string }) => r.email === first.email).suppression).toBe("manual");
    expect(JSON.stringify(all)).not.toContain(first.unsubscribeToken);
    expect(JSON.stringify(all)).not.toMatch(/unsubscribeToken|confirmToken/);
  });
});

describe("delete", () => {
  it("removes the row, keeps campaign stats, suppresses by default, and audits without the email", async () => {
    await realBrand(db);
    const s = await makeSubscriber(db, { email: "leaving@example.com" });
    await makeSubscriber(db);
    const admin = await as("admin");
    const c = await makeCampaign(db, admin.officer.id);
    await enqueueCampaign(db, c.id, admin.officer.id);
    await processQueue(db, new MemoryProvider(), { ratePerSecond: 10_000, sleep: async () => {} });

    expect((await del(s.id, admin.headers)).status).toBe(200);
    expect(await db.select().from(subscribers).where(eq(subscribers.id, s.id))).toHaveLength(0);
    expect(await campaignStats(db, c.id)).toMatchObject({ total: 2, sent: 2 });
    expect((await db.select().from(sends)).filter((r) => r.subscriberId === null)).toHaveLength(1);
    expect(await db.select().from(suppressions)).toEqual([expect.objectContaining({ email: "leaving@example.com", reason: "manual" })]);

    const [audit] = await db.select().from(dataAudit);
    expect(audit).toMatchObject({ action: "subscriber_delete", actorId: admin.officer.id });
    expect(JSON.stringify(audit.details)).not.toContain("leaving@example.com");

    // Suppressed: re-subscribing sends nothing.
    expect(await subscribe(db, { email: "leaving@example.com", school: "Karigon" }, { ip: "10.1.1.1" })).toBe("noop");
    expect(mailbox().sent).toHaveLength(0);
    expect((await del(s.id, admin.headers)).status).toBe(404);
  });

  it("without suppression the family can sign up again", async () => {
    const s = await makeSubscriber(db, { email: "later@example.com" });
    const admin = await as("admin");
    await del(s.id, admin.headers, { suppress: false });
    expect(await db.select().from(suppressions)).toHaveLength(0);
    expect(await subscribe(db, { email: "later@example.com", school: "Karigon" }, { ip: "10.1.1.2" })).toBe("sent_confirmation");
  });
});

describe("export", () => {
  it("returns filtered CSV without tokens, defuses formulas, and audits", async () => {
    // School is validated on the public form; the export still defends against odd values written any other way.
    await makeSubscriber(db, { email: "a@example.com", school: "=HYPERLINK(\"http://evil\")" });
    const b = await makeSubscriber(db, { email: "b@example.com", school: "Chango, East" });
    await db.insert(suppressions).values({ email: b.email, reason: "bounce" });
    const admin = await as("admin");

    const res = await exportRoute(get("/api/subscribers/export", admin.headers), noParams);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="pta-subscribers-\d{4}-\d{2}-\d{2}\.csv"/);
    const csv = await res.text();
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("email,school,status,on_do_not_mail_list,consent_at,confirmed_at,created_at");
    expect(lines[1]).toMatch(/^a@example\.com,"'=HYPERLINK\(""http:\/\/evil""\)",active,no,/);
    expect(lines[2]).toMatch(/^b@example\.com,"Chango, East",active,yes,/);
    expect(csv).not.toContain(b.unsubscribeToken);

    const filtered = await (await exportRoute(get("/api/subscribers/export?school=Chango%2C%20East", admin.headers), noParams)).text();
    expect(filtered.trim().split("\r\n")).toHaveLength(2);

    const audits = await db.select().from(dataAudit);
    expect(audits.map((a) => a.details)).toEqual([
      { count: 2, filter: { q: "", status: "", school: "" } },
      { count: 1, filter: { q: "", status: "", school: "Chango, East" } },
    ]);
  });

  it("csvCell escapes quotes, commas, newlines and formula prefixes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)"]) expect(csvCell(bad)).toBe(`"'${bad}"`);
    expect(csvCell(null)).toBe("");
  });
});
