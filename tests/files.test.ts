import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { campaigns, files } from "@/db/schema";
import { renderCampaign } from "@/lib/campaigns/render";
import { cleanFileName, FileRejected, uploadFile } from "@/lib/files/service";
import { MemoryStorage, setStorage } from "@/lib/storage";
import { POST as uploadRoute } from "../app/api/files/route";
import { PATCH as patchRoute } from "../app/api/campaigns/[id]/route";
import { resetDb, testDb } from "./helpers/db";
import { makeOfficer, sessionFor } from "./helpers/factories";
import { makeCampaign, realBrand } from "./helpers/campaign";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(async () => {
  await resetDb(db);
  await realBrand(db);
  setStorage(new MemoryStorage());
});

const zip = (...names: string[]) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`....${names.join("....")}....`)]);
const DOCX = zip("[Content_Types].xml", "word/document.xml");
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");

describe("document attachments", () => {
  it("accepts PDF and Office documents, checking the content and not just the name", async () => {
    const o = await makeOfficer(db, "drafter");
    const doc = await uploadFile(db, DOCX, "C:\\Users\\me\\Fall Festival — Volunteer Form.docx", o.id);
    expect(doc).toMatchObject({ name: "Fall Festival  Volunteer Form.docx".replace("  ", " "), bytes: DOCX.length });
    expect(doc.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(doc.storageKey).toMatch(/^files\/[0-9a-f-]{36}\/Fall-Festival-Volunteer-Form\.docx$/);
    expect((await uploadFile(db, PDF, "flyer.PDF", o.id)).name).toBe("flyer.pdf");
    expect((await uploadFile(db, zip("[Content_Types].xml", "xl/workbook.xml"), "sheet.xlsx", o.id)).mimeType).toContain("spreadsheetml");
  });

  it("refuses macro-capable, disguised and unsupported files with a clear reason", async () => {
    const o = await makeOfficer(db, "drafter");
    await expect(uploadFile(db, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), "old.doc", o.id)).rejects.toThrow(/Save As → \.docx/);
    await expect(uploadFile(db, Buffer.from("<html><script>alert(1)</script>"), "evil.docx", o.id)).rejects.toThrow("isn't a valid .docx");
    await expect(uploadFile(db, zip("[Content_Types].xml", "word/document.xml", "word/vbaProject.bin"), "macro.docx", o.id)).rejects.toThrow(
      FileRejected,
    );
    await expect(uploadFile(db, Buffer.from("x"), "run.exe", o.id)).rejects.toThrow(/Attach PDF, Word/);
    await expect(uploadFile(db, DOCX, "pic.docx.html", o.id)).rejects.toThrow(FileRejected);
    expect(await db.select().from(files)).toHaveLength(0);
  });

  it("cleans file names", () => {
    expect(cleanFileName("../../etc/passwd")).toEqual({ base: "passwd", ext: "" });
    expect(cleanFileName("Report<script>.PDF")).toEqual({ base: "Reportscript", ext: "pdf" });
    expect(cleanFileName(".pdf").base).toBe(".pdf");
  });

  it("uploads through the API and lists attachments as download links in the email", async () => {
    const o = await makeOfficer(db, "drafter");
    const h = (await sessionFor(db, o.id)).headers;
    const form = new FormData();
    form.set("file", new File([new Uint8Array(DOCX)], "Permission Slip.docx"));
    const res = await uploadRoute(new Request("https://pta.example.org/api/files", { method: "POST", headers: h, body: form }), {
      params: Promise.resolve({}),
    } as never);
    expect(res.status).toBe(201);
    const { file } = await res.json();

    const bad = new FormData();
    bad.set("file", new File(["MZ"], "setup.exe"));
    const rejected = await uploadRoute(new Request("https://pta.example.org/api/files", { method: "POST", headers: h, body: bad }), {
      params: Promise.resolve({}),
    } as never);
    expect(rejected.status).toBe(415);

    const c = await makeCampaign(db, o.id);
    const patch = (body: object) =>
      patchRoute(
        new Request("https://pta.example.org/api/x", { method: "PATCH", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify(body) }),
        { params: Promise.resolve({ id: c.id }) } as never,
      );
    expect((await patch({ attachmentIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(400);
    expect((await patch({ attachmentIds: [file.id] })).status).toBe(200);

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, c.id));
    const r = await renderCampaign(db, row);
    expect(r.html).toContain("Attachments");
    expect(r.html).toContain(`href="${file.publicUrl}"`);
    expect(r.html).toContain("Permission Slip.docx");
    expect(r.text).toContain(`- Permission Slip.docx (1 KB): ${file.publicUrl}`);
  });
});
