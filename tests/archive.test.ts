import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { campaigns } from "@/db/schema";
import { enqueueCampaign } from "@/lib/queue/enqueue";
import { processQueue } from "@/lib/queue/dispatch";
import { MemoryProvider } from "@/lib/mail/provider";
import { listArchive } from "@/lib/archive";
import { GET as archiveRoute } from "../app/archive/[id]/route";
import { resetDb, testDb } from "./helpers/db";
import { makeOfficer, makeSubscriber } from "./helpers/factories";
import { makeCampaign, realBrand } from "./helpers/campaign";
import { BLOCKS, docOf } from "./helpers/docs";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  await realBrand(db);
});

const get = (id: string) => archiveRoute(new Request(`https://pta.example.org/archive/${id}`), { params: Promise.resolve({ id }) });

async function sent(over: Parameters<typeof makeCampaign>[2] = {}) {
  const o = await makeOfficer(db, "sender");
  const c = await makeCampaign(db, o.id, over);
  await enqueueCampaign(db, c.id, o.id);
  await processQueue(db, new MemoryProvider(), { ratePerSecond: 10_000, sleep: async () => {} });
  return c;
}

describe("public archive", () => {
  it("serves sent newsletters without tokens or subscriber data, with images and a no-script CSP", async () => {
    const subs = await Promise.all([makeSubscriber(db), makeSubscriber(db)]);
    const c = await sent({ body: docOf(BLOCKS.heading1, BLOCKS.image, BLOCKS.paragraph) });
    const res = await get(c.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("content-security-policy")).not.toContain("script");
    const html = await res.text();
    expect(html).toContain("Heading One");
    expect(html).toContain('src="https://images.pta.example.org/images/2026/09/photo.jpg"');
    expect(html).not.toContain("__UNSUBSCRIBE_TOKEN__");
    expect(html).not.toMatch(/\/u\/|\/api\/unsubscribe/);
    for (const s of subs) {
      expect(html).not.toContain(s.email);
      expect(html).not.toContain(s.unsubscribeToken);
    }
    expect(html).toContain("Subscribe to PTA News");
  });

  it("lists only sent campaigns marked for the archive", async () => {
    await makeSubscriber(db);
    const shown = await sent({ subject: "Shown" });
    const hidden = await sent({ subject: "Committee only", showInArchive: false });
    const o = await makeOfficer(db, "drafter");
    const draft = await makeCampaign(db, o.id, { subject: "Draft" });
    expect((await listArchive(db)).map((a) => a.subject)).toEqual(["Shown"]);
    expect((await get(shown.id)).status).toBe(200);
    expect((await get(hidden.id)).status).toBe(404);
    expect((await get(draft.id)).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
  });

  it("archived content stays script-free even with hostile input", async () => {
    await makeSubscriber(db);
    const c = await sent({
      subject: "<script>alert(1)</script>",
      body: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { textAlign: "left" }, content: [{ type: "text", text: "<img src=x onerror=alert(1)>", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
          { type: "emailButton", attrs: { label: "</a><script>x</script>", href: "https://example.org/\"><script>", color: "primary", align: "center" } },
        ],
      } as never,
    });
    const html = await (await get(c.id)).text();
    expect(html).not.toMatch(/<script|javascript:|<img src=x|<[^>]*\sonerror=/i);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(row.archiveHtml).toBe(html);
  });

  it("\"View in browser\" link points at the archive only when archived", async () => {
    const s = await makeSubscriber(db);
    const p = new MemoryProvider();
    const o = await makeOfficer(db, "sender");
    const c = await makeCampaign(db, o.id);
    await enqueueCampaign(db, c.id, o.id);
    await processQueue(db, p, { ratePerSecond: 10_000, sleep: async () => {} });
    expect(p.sent.find((m) => m.to === s.email)!.html).toContain(`https://pta.example.org/archive/${c.id}`);
  });
});
