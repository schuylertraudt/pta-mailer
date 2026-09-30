import type { Block, Doc } from "@/lib/editor/model";
import type { BrandForRender } from "@/lib/render/email";

export const IMG = "https://images.pta.example.org/images/2026/09/photo.jpg";

export const BRAND: BrandForRender = {
  primaryColor: "#1F4E79",
  accentColor: "#F2A900",
  footerText: "You subscribed to PTA news.",
  ptaMailingAddress: "Example PTA, 1 Main St, Town, ST 00000",
  logoUrl: "https://images.pta.example.org/images/logo.png",
  logoAlt: "Example PTA",
  logoWidth: 200,
};

const text = (t: string) => ({ type: "text" as const, text: t });

export const BLOCKS: Record<string, Block> = {
  paragraph: {
    type: "paragraph",
    attrs: { textAlign: "left" },
    content: [
      text("Plain, "),
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      text(", "),
      { type: "text", text: "italic", marks: [{ type: "italic" }] },
      text(", "),
      { type: "text", text: "underline", marks: [{ type: "underline" }] },
      text(", "),
      { type: "text", text: "accent", marks: [{ type: "brandColor", attrs: { color: "accent" } }] },
      text(", "),
      { type: "text", text: "a link", marks: [{ type: "link", attrs: { href: "https://example.org/x" } }] },
      { type: "hardBreak" },
      text("second line"),
    ],
  },
  heading1: { type: "heading", attrs: { level: 1, textAlign: "center" }, content: [text("Heading One")] },
  heading2: { type: "heading", attrs: { level: 2, textAlign: "left" }, content: [text("Heading Two")] },
  heading3: { type: "heading", attrs: { level: 3, textAlign: "right" }, content: [text("Heading Three")] },
  bulletList: {
    type: "bulletList",
    content: [
      { type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: "left" }, content: [text("One")] }] },
      {
        type: "listItem",
        content: [
          { type: "paragraph", attrs: { textAlign: "left" }, content: [text("Two")] },
          { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: "left" }, content: [text("Nested")] }] }] },
        ],
      },
    ],
  },
  orderedList: {
    type: "orderedList",
    attrs: { start: 3 },
    content: [{ type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: "left" }, content: [text("Third")] }] }],
  },
  divider: { type: "horizontalRule" },
  spacer: { type: "spacer", attrs: { height: 32 } },
  image: { type: "emailImage", attrs: { src: IMG, alt: "Kids at the fair", href: "https://example.org/fair", align: "center", width: 400, assetId: null } },
  button: { type: "emailButton", attrs: { label: "RSVP now", href: "https://example.org/rsvp?a=1&b=2", color: "primary", align: "center" } },
  twoColumn: {
    type: "twoColumn",
    attrs: { imageSrc: IMG, imageAlt: "Garden", imageHref: null, imagePosition: "right", assetId: null },
    content: [{ type: "paragraph", attrs: { textAlign: "left" }, content: [text("Column text")] }],
  },
};

export const docOf = (...content: Block[]): Doc => ({ type: "doc", content });

export const longText = (chars: number): Doc =>
  docOf(
    ...Array.from({ length: Math.ceil(chars / 500) }, () => ({
      type: "paragraph" as const,
      attrs: { textAlign: "left" as const },
      content: [text("Lorem ipsum dolor sit amet. ".repeat(18))],
    })),
  );
