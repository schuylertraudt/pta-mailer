import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Route handlers schedule queue work with next/server's after(); outside a request we skip it.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
import { eq } from "drizzle-orm";
import { campaigns, segments, sends } from "@/db/schema";
import { POST as createRoute } from "../app/api/campaigns/route";
import { PATCH as patchRoute } from "../app/api/campaigns/[id]/route";
import { POST as previewRoute } from "../app/api/campaigns/[id]/preview/route";
import { POST as testRoute } from "../app/api/campaigns/[id]/test/route";
import { POST as submitRoute } from "../app/api/campaigns/[id]/submit/route";
import { POST as approveRoute } from "../app/api/campaigns/[id]/approve/route";
import { POST as sendRoute } from "../app/api/campaigns/[id]/send/route";
import { GET as recipientsRoute } from "../app/api/campaigns/[id]/recipients/route";
import { PUT as brandRoute } from "../app/api/brand/route";
import { POST as templateRoute } from "../app/api/templates/route";
import { enqueueCampaign } from "@/lib/queue/enqueue";
import { ensureStarterTemplates, listTemplates } from "@/lib/templates/service";
import { STARTER_TEMPLATES } from "@/lib/templates/starters";
import { resetDb, testDb } from "./helpers/db";
import { mailbox, makeOfficer, makeSubscriber, sessionFor } from "./helpers/factories";
import { allAudience, makeCampaign, realBrand } from "./helpers/campaign";
import { longText } from "./helpers/docs";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  mailbox().clear();
  await realBrand(db);
});

const call = async (
  route: (req: Request, ctx: never) => Promise<Response>,
  headers: Record<string, string>,
  id?: string,
  body?: unknown,
  method = "POST",
) =>
  route(
    new Request(`https://pta.example.org/api/x`, { method, headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve(id ? { id } : {}) } as never,
  );

describe("approval workflow and role enforcement", () => {
  it("drafter cannot send via a direct API call", async () => {
    const d = await makeOfficer(db, "drafter");
    await makeSubscriber(db);
    const { headers } = await sessionFor(db, d.id);
    const c = await makeCampaign(db, d.id);
    const res = await call(sendRoute, headers, c.id);
    expect(res.status).toBe(403);
    // Even after approval, a drafter still can't press send.
    await db.update(campaigns).set({ status: "approved" }).where(eq(campaigns.id, c.id));
    expect((await call(sendRoute, headers, c.id)).status).toBe(403);
    expect(await db.select().from(sends)).toHaveLength(0);
    expect((await call(approveRoute, headers, c.id)).status).toBe(403);
  });

  it("drafter submits, sender approves and sends", async () => {
    const d = await makeOfficer(db, "drafter");
    const s = await makeOfficer(db, "sender");
    await makeSubscriber(db);
    const dh = (await sessionFor(db, d.id)).headers;
    const sh = (await sessionFor(db, s.id)).headers;

    const created = await (await call(createRoute, dh, undefined, { templateId: null })).json();
    const id = created.campaign.id;
    expect((await call(patchRoute, dh, id, { subject: "Hello", bodyJson: longText(1000), segmentIds: [await allAudience(db)] }, "PATCH")).status).toBe(200);
    expect((await call(submitRoute, dh, id)).status).toBe(200);
    expect((await call(approveRoute, sh, id)).status).toBe(200);
    const [approved] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(approved).toMatchObject({ status: "approved", approvedBy: s.id });

    const res = await call(sendRoute, sh, id);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: 1 });
    const [sent] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    expect(sent).toMatchObject({ status: "sending", sentBy: s.id, approvedBy: s.id });
  });

  it("editing an approved campaign sends it back to draft", async () => {
    const d = await makeOfficer(db, "drafter");
    const s = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, d.id, { status: "approved", approvedBy: s.id });
    const dh = (await sessionFor(db, d.id)).headers;
    await call(patchRoute, dh, c.id, { subject: "sneaky change" }, "PATCH");
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(row).toMatchObject({ status: "draft", approvedBy: null });
  });

  it("sent campaigns can't be edited or re-sent", async () => {
    const s = await makeOfficer(db, "sender");
    await makeSubscriber(db);
    const c = await makeCampaign(db, s.id);
    await enqueueCampaign(db, c.id, s.id);
    const sh = (await sessionFor(db, s.id)).headers;
    expect((await call(patchRoute, sh, c.id, { subject: "x" }, "PATCH")).status).toBe(409);
    expect((await call(sendRoute, sh, c.id)).status).toBe(409);
    expect(await db.select().from(sends)).toHaveLength(1);
  });

  it("only admins edit brand settings", async () => {
    const s = await makeOfficer(db, "sender");
    const a = await makeOfficer(db, "admin");
    const body = { primaryColor: "#000000", accentColor: "#ffffff", footerText: "f", ptaMailingAddress: "1 Main St, Town", logoAssetId: null };
    expect((await call(brandRoute, (await sessionFor(db, s.id)).headers, undefined, body, "PUT")).status).toBe(403);
    expect((await call(brandRoute, (await sessionFor(db, a.id)).headers, undefined, body, "PUT")).status).toBe(200);
  });
});

describe("send guards", () => {
  it("blocks send above the 100 KB size limit", async () => {
    const s = await makeOfficer(db, "sender");
    await makeSubscriber(db);
    const c = await makeCampaign(db, s.id, { body: longText(120_000) });
    const res = await call(sendRoute, (await sessionFor(db, s.id)).headers, c.id);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Gmail clips/);
    expect(await db.select().from(sends)).toHaveLength(0);
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(row.status).toBe("draft");
  });

  it("blocks send with no subject, no recipients, no mailing address, or no audience", async () => {
    const s = await makeOfficer(db, "sender");
    const noSubject = await makeCampaign(db, s.id, { subject: "" });
    await makeSubscriber(db);
    await expect(enqueueCampaign(db, noSubject.id, s.id)).rejects.toMatchObject({ status: 422 });

    await resetDb(db);
    const s2 = await makeOfficer(db, "sender");
    await realBrand(db);
    const c = await makeCampaign(db, s2.id);
    await expect(enqueueCampaign(db, c.id, s2.id)).rejects.toThrow("No eligible recipients");

    await resetDb(db);
    const s3 = await makeOfficer(db, "sender");
    await makeSubscriber(db);
    const c3 = await makeCampaign(db, s3.id);
    await expect(enqueueCampaign(db, c3.id, s3.id)).rejects.toThrow("mailing address");

    await realBrand(db);
    const nobody = await makeCampaign(db, s3.id, { segmentIds: [] });
    await expect(enqueueCampaign(db, nobody.id, s3.id)).rejects.toThrow("Choose who this message goes to");
  });
});

describe("recipients and sender name", () => {
  it("saves several audiences and a cleaned sender name; rejects unknown audiences", async () => {
    const d = await makeOfficer(db, "drafter");
    const h = (await sessionFor(db, d.id)).headers;
    const [k, o] = await db
      .insert(segments)
      .values([
        { name: "Karigon", rule: "school=Karigon" },
        { name: "Orenda", rule: "school=Orenda" },
      ])
      .returning();
    const c = await makeCampaign(db, d.id, { segmentIds: [] });
    const res = await call(patchRoute, h, c.id, { segmentIds: [k.id, o.id, k.id], fromName: '  Karigon "PTA" <x@evil.example>\r\nBcc: a@b.c ' }, "PATCH");
    expect(res.status).toBe(200);
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(row.segmentIds).toEqual([k.id, o.id]);
    expect(row.fromName).toBe("Karigon PTA x@evil.example Bcc: a@b.c");
    const bad = await call(patchRoute, h, c.id, { segmentIds: ["00000000-0000-4000-8000-000000000000"] }, "PATCH");
    expect(bad.status).toBe(400);
  });

  it("lists the selected recipients for team members who may view subscribers", async () => {
    const d = await makeOfficer(db, "drafter");
    const s = await makeOfficer(db, "sender");
    const k = await makeSubscriber(db, { school: "Karigon" });
    await makeSubscriber(db, { school: "Orenda" });
    const [seg] = await db.insert(segments).values({ name: "Karigon", rule: "school=Karigon" }).returning();
    const c = await makeCampaign(db, d.id, { segmentIds: [seg.id] });
    const get = (h: Record<string, string>) => call(recipientsRoute, h, c.id, undefined, "GET");
    expect((await get((await sessionFor(db, d.id)).headers)).status).toBe(403);
    const body = await (await get((await sessionFor(db, s.id)).headers)).json();
    expect(body.total).toBe(1);
    expect(body.recipients).toEqual([{ email: k.email, school: "Karigon" }]);
  });
});

describe("preview, test send and templates", () => {
  it("preview returns HTML, plaintext, checks and recipient count", async () => {
    const d = await makeOfficer(db, "drafter");
    await makeSubscriber(db);
    await makeSubscriber(db, { status: "pending", confirmedAt: null });
    const c = await makeCampaign(db, d.id);
    const res = await call(previewRoute, (await sessionFor(db, d.id)).headers, c.id, { dark: true });
    const body = await res.json();
    expect(body.recipients).toBe(1);
    expect(body.html).toContain("/u/preview");
    expect(body.html).not.toContain("__UNSUBSCRIBE_TOKEN__");
    expect(body.text).toContain("Unsubscribe:");
    expect(Array.isArray(body.checks)).toBe(true);
  });

  it("send test to me goes only to the signed-in officer, through the provider, multipart", async () => {
    const d = await makeOfficer(db, "drafter");
    await makeSubscriber(db);
    const c = await makeCampaign(db, d.id);
    const res = await call(testRoute, (await sessionFor(db, d.id)).headers, c.id);
    expect(res.status).toBe(200);
    expect(mailbox().sent).toHaveLength(1);
    const m = mailbox().sent[0];
    expect(m.to).toBe(d.email);
    expect(m.subject).toBe("[TEST] PTA News");
    expect(m.html).toContain("<html");
    expect(m.text.length).toBeGreaterThan(10);
    expect(m.from).toBe("Example PTA <news@pta.example.org>");

    await db.update(campaigns).set({ fromName: "Karigon PTA" }).where(eq(campaigns.id, c.id));
    await call(testRoute, (await sessionFor(db, d.id)).headers, c.id);
    expect(mailbox().sent[1].from).toBe('"Karigon PTA" <news@pta.example.org>');
  });

  it("ships 3 starter templates and can save a campaign as a template", async () => {
    await ensureStarterTemplates(db);
    await ensureStarterTemplates(db);
    const names = (await listTemplates(db)).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Monthly Newsletter", "Event Announcement", "Volunteer Ask"]));
    expect(names).toHaveLength(3);

    const d = await makeOfficer(db, "drafter");
    const c = await makeCampaign(db, d.id);
    const res = await call(templateRoute, (await sessionFor(db, d.id)).headers, undefined, { name: "My template", campaignId: c.id });
    expect(res.status).toBe(201);
    const created = await (await call(createRoute, (await sessionFor(db, d.id)).headers, undefined, { templateId: STARTER_TEMPLATES[1].id })).json();
    expect(JSON.stringify(created.campaign.bodyJson)).toContain("RSVP now");
  });
});
