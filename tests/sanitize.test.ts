import { describe, expect, it } from "vitest";
import { sanitizeDoc } from "@/lib/editor/sanitize";
import { htmlToDoc } from "@/lib/editor/import-html";
import { renderEmailHtml } from "@/lib/render/email";
import { BRAND, IMG } from "./helpers/docs";

const STORAGE = "https://images.pta.example.org";

describe("sanitizeDoc", () => {
  it("drops disallowed marks, nodes and attributes", () => {
    const doc = sanitizeDoc(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "justify", style: "font-family: Comic Sans" },
            content: [
              { type: "text", text: "styled", marks: [{ type: "textStyle", attrs: { color: "#ff00ff", fontFamily: "Papyrus" } }, { type: "strike" }, { type: "bold" }] },
              { type: "text", text: "bad link", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
              { type: "text", text: "data link", marks: [{ type: "link", attrs: { href: "data:text/html,<script>" } }] },
              { type: "text", text: "color", marks: [{ type: "brandColor", attrs: { color: "#123456" } }] },
            ],
          },
          { type: "codeBlock", content: [{ type: "text", text: "code text" }] },
          { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "cell" }] }] }] }] },
          { type: "iframe", attrs: { src: "https://evil.example.com" } },
          { type: "emailImage", attrs: { src: "data:image/png;base64,AAAA", alt: "x" } },
          { type: "emailImage", attrs: { src: "https://evil.example.com/x.png", alt: "x" } },
          { type: "emailImage", attrs: { src: "https://images.pta.example.org.evil.com/x.png", alt: "x" } },
          { type: "emailButton", attrs: { label: "Go", href: "javascript:alert(1)" } },
          { type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "h" }] },
        ],
      },
      STORAGE,
    );
    expect(doc).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "left" },
          content: [
            { type: "text", text: "styled", marks: [{ type: "bold" }] },
            { type: "text", text: "bad link" },
            { type: "text", text: "data link" },
            { type: "text", text: "color" },
          ],
        },
        { type: "paragraph", attrs: { textAlign: "left" }, content: [{ type: "text", text: "code text" }] },
        { type: "paragraph", attrs: { textAlign: "left" }, content: [{ type: "text", text: "cell" }] },
        { type: "heading", attrs: { level: 3, textAlign: "left" }, content: [{ type: "text", text: "h" }] },
      ],
    });
  });

  it("keeps valid storage images and clamps attributes", () => {
    const doc = sanitizeDoc({ type: "doc", content: [{ type: "emailImage", attrs: { src: IMG, alt: "ok", width: 9999, align: "middle", href: "https://example.org" } }] }, STORAGE);
    expect(doc.content[0]).toEqual({ type: "emailImage", attrs: { src: IMG, alt: "ok", href: "https://example.org/", align: "left", width: 552, assetId: null } });
  });

  it("returns an empty doc for garbage", () => {
    for (const bad of [null, "x", 5, { type: "nope" }, { type: "doc", content: "x" }]) {
      expect(sanitizeDoc(bad, STORAGE).content).toHaveLength(1);
    }
  });
});

describe("pasted HTML from Word / Google Docs", () => {
  const WORD = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{font-family:Calibri}</style>
    <script>alert('x')</script></head><body>
    <p class=MsoNormal style='font-family:"Comic Sans MS";color:#FF0000;font-size:28pt'><b>Bake sale</b> this <i>Friday</i>!<o:p></o:p></p>
    <h2 style="color:purple">Details</h2>
    <ul><li style="mso-list:l0">Bring <span style="background:yellow">cookies</span></li><li>Tell friends</li></ul>
    <p><a href="https://school.example.org/bake">Sign up</a> or <a href="javascript:alert(1)">click me</a></p>
    <p><img src="data:image/png;base64,iVBORw0KGgo=" onerror="alert(1)"><img src="https://tracker.example.com/pixel.gif"></p>
    <iframe src="https://evil.example.com"></iframe>
    <table><tr><td>Cell text</td></tr></table>
    <p onclick="steal()">Plain <font face="Wingdings" color="red">font tag</font></p>
    </body></html>`;

  const DOCS = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr" style="line-height:1.38;margin-top:0pt"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:700;">Volunteers needed</span></p><ol><li dir="ltr"><p dir="ltr"><span style="font-family:Arial;">Setup crew</span></p></li></ol></b>`;

  it("strips Word markup to allowed marks and blocks", async () => {
    const doc = htmlToDoc(WORD, STORAGE);
    const json = JSON.stringify(doc);
    for (const bad of ["Comic", "FF0000", "font-size", "script", "alert", "javascript", "data:", "tracker", "iframe", "onclick", "Wingdings", "background"]) {
      expect(json).not.toContain(bad);
    }
    expect(json).toContain('"type":"bold"');
    expect(json).toContain('"type":"italic"');
    expect(json).toContain('"type":"heading"');
    expect(json).toContain('"type":"bulletList"');
    expect(json).toContain("https://school.example.org/bake");
    expect(json).toContain("Cell text");
    expect(json).toContain("font tag");

    const html = await renderEmailHtml({ doc, subject: "s", preheader: "", brand: BRAND, mode: { kind: "archive", subscribeUrl: "https://pta.example.org/" } });
    expect(html).not.toMatch(/<script|javascript:|onerror|onclick|data:|<iframe/i);
  });

  it("strips Google Docs wrapper spans", () => {
    const doc = htmlToDoc(DOCS, STORAGE);
    const json = JSON.stringify(doc);
    expect(json).not.toContain("font-family");
    expect(json).not.toContain("docs-internal");
    expect(json).toContain("Volunteers needed");
    expect(json).toContain('"type":"orderedList"');
  });
});
