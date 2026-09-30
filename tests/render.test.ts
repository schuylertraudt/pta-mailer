import { describe, expect, it } from "vitest";
import { renderEmailHtml, type RenderMode } from "@/lib/render/email";
import { renderPlaintext } from "@/lib/render/plaintext";
import { checkCampaign, SIZE_BLOCK_BYTES, SIZE_WARN_BYTES } from "@/lib/render/checks";
import { sanitizeDoc } from "@/lib/editor/sanitize";
import { STARTER_TEMPLATES } from "@/lib/templates/starters";
import { EMPTY_DOC } from "@/lib/editor/model";
import { BLOCKS, BRAND, IMG, docOf, longText } from "./helpers/docs";

const STORAGE = "https://images.pta.example.org";
const EMAIL: RenderMode = { kind: "email", unsubscribeUrl: "https://pta.example.org/u/__UNSUBSCRIBE_TOKEN__", viewOnlineUrl: "https://pta.example.org/archive/abc" };
const render = (doc = docOf(), mode: RenderMode = EMAIL) =>
  renderEmailHtml({ doc, subject: "Subject", preheader: "Preheader text", brand: BRAND, mode });

/** The body region only, so snapshots are about the block, not the shell. */
function bodyOf(html: string) {
  const start = html.indexOf('<td class="pad" style="padding:16px 24px 8px">');
  const end = html.indexOf('<td class="pad" style="padding:16px 24px 24px;');
  return html.slice(start, end);
}

describe("editor JSON -> HTML snapshots", () => {
  for (const [name, block] of Object.entries(BLOCKS)) {
    it(`renders ${name}`, async () => {
      expect(bodyOf(await render(docOf(block)))).toMatchSnapshot();
    });
  }
  it("renders the full shell (header, preheader, footer)", async () => {
    expect(await render(docOf(BLOCKS.paragraph))).toMatchSnapshot();
  });
});

describe("rendered HTML invariants", () => {
  const everything = docOf(...Object.values(BLOCKS));

  it("has no data: URIs, no <script>, no external CSS; all images are https on the storage domain", async () => {
    const htmls = [await render(everything), await render(everything, { kind: "archive", subscribeUrl: "https://pta.example.org/" })];
    for (const html of htmls) {
      expect(html).not.toMatch(/data:/i);
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<link[^>]+stylesheet/i);
      expect(html).not.toMatch(/@import/i);
      expect(html).not.toMatch(/javascript:/i);
      const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
      expect(srcs.length).toBeGreaterThan(0);
      for (const s of srcs) expect(s.startsWith(`${STORAGE}/`)).toBe(true);
    }
  });

  it("uses 600px max width, color-scheme meta and MSO fallbacks", async () => {
    const html = await render(everything);
    expect(html).toContain("max-width:600px");
    expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("v:roundrect");
    expect(html).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
    expect(html).toContain("prefers-color-scheme:dark");
  });

  it("keeps the logo on a light tile for dark mode", async () => {
    const html = await render(docOf(BLOCKS.paragraph));
    expect(html).toMatch(/<td style="background-color:#ffffff;padding:12px;border-radius:8px"><img src="https:\/\/images\.pta\.example\.org\/images\/logo\.png"/);
  });

  it("escapes text content", async () => {
    const html = await render(docOf({ type: "paragraph", attrs: { textAlign: "left" }, content: [{ type: "text", text: "<script>alert(1)</script> & <img src=x onerror=alert(1)>" }] }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("button label and href are escaped inside the raw MSO markup", async () => {
    const html = await render(docOf({ type: "emailButton", attrs: { label: '"><script>x</script>', href: 'https://e.org/?q="><b>', color: "accent", align: "left" } }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('"><b>');
  });
});

describe("footer and unsubscribe are always present", () => {
  const docs = [
    ["empty", EMPTY_DOC],
    ...STARTER_TEMPLATES.map((t) => [t.name, t.body] as const),
    // A document that tries to smuggle its own footer/unsubscribe can't remove ours.
    ["hostile", sanitizeDoc({ type: "doc", content: [{ type: "footer" }, { type: "unsubscribe" }] }, STORAGE)],
  ] as const;

  for (const [name, doc] of docs) {
    it(`in ${name}`, async () => {
      const html = await render(doc as never);
      expect(html).toContain('href="https://pta.example.org/u/__UNSUBSCRIBE_TOKEN__"');
      expect(html).toContain('data-role="unsubscribe"');
      expect(html).toContain(BRAND.ptaMailingAddress);
      expect(html).toContain(BRAND.footerText);
      const text = renderPlaintext(doc as never, BRAND, EMAIL);
      expect(text).toContain("Unsubscribe: https://pta.example.org/u/__UNSUBSCRIBE_TOKEN__");
      expect(text).toContain(BRAND.ptaMailingAddress);
    });
  }

  it("archive mode has no unsubscribe link or token", async () => {
    const html = await render(docOf(BLOCKS.paragraph), { kind: "archive", subscribeUrl: "https://pta.example.org/" });
    expect(html).not.toContain("/u/");
    expect(html).not.toContain("__UNSUBSCRIBE_TOKEN__");
    expect(html).toContain("Subscribe to PTA News");
  });
});

describe("plaintext alternative", () => {
  it("covers every block type", () => {
    const text = renderPlaintext(docOf(...Object.values(BLOCKS)), BRAND, EMAIL);
    expect(text).toMatchSnapshot();
    expect(text).toContain("a link (https://example.org/x)");
    expect(text).toContain("RSVP now: https://example.org/rsvp?a=1&b=2");
    expect(text).toContain("[Kids at the fair] https://example.org/fair");
    expect(text).toContain("3. Third");
    expect(text).toContain("HEADING ONE");
  });
});

describe("content checks", () => {
  it("warns at 90 KB and blocks at 100 KB", () => {
    const doc = docOf(BLOCKS.paragraph);
    expect(checkCampaign({ doc, html: "x".repeat(SIZE_WARN_BYTES - 1), subject: "s" }).map((c) => c.code)).toEqual([]);
    expect(checkCampaign({ doc, html: "x".repeat(SIZE_WARN_BYTES), subject: "s" })).toEqual([expect.objectContaining({ level: "warn", code: "size_warn" })]);
    expect(checkCampaign({ doc, html: "x".repeat(SIZE_BLOCK_BYTES), subject: "s" })).toEqual([expect.objectContaining({ level: "block", code: "size_block" })]);
  });

  it("a real oversized campaign is blocked", async () => {
    const doc = longText(110_000);
    const html = await render(doc);
    expect(Buffer.byteLength(html)).toBeGreaterThan(SIZE_BLOCK_BYTES);
    expect(checkCampaign({ doc, html, subject: "s" }).some((c) => c.code === "size_block")).toBe(true);
  });

  it("warns on image-only, near image-only, and missing alt text", () => {
    const img = (alt: string) => ({ type: "emailImage" as const, attrs: { src: IMG, alt, href: null, align: "center" as const, width: 552, assetId: null } });
    const codes = (doc: ReturnType<typeof docOf>) => checkCampaign({ doc, html: "", subject: "s" }).map((c) => c.code);
    expect(codes(docOf(img("a"), img("b")))).toContain("image_only");
    expect(codes(docOf(img("a"), img("b"), { type: "paragraph", attrs: { textAlign: "left" }, content: [{ type: "text", text: "Short caption for two big images here." }] }))).toContain("near_image_only");
    expect(codes(docOf(img(""), BLOCKS.paragraph))).toContain("missing_alt");
    expect(codes(longText(2000))).toEqual([]);
  });

  it("blocks an empty subject or body", () => {
    expect(checkCampaign({ doc: EMPTY_DOC, html: "", subject: "" }).filter((c) => c.level === "block").map((c) => c.code).sort()).toEqual(["empty", "no_subject"]);
  });
});
