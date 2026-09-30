/**
 * The campaign body is a TipTap/ProseMirror JSON document restricted to the
 * email-safe node and mark set below. The server re-validates every document
 * with sanitizeDoc before storing or rendering it.
 */

export type Align = "left" | "center" | "right";
export const ALIGNS: readonly Align[] = ["left", "center", "right"];

/** Content column width inside the 600px container (24px side padding). */
export const CONTENT_WIDTH = 552;
export const COLUMN_WIDTH = CONTENT_WIDTH / 2;

/** Text colors are palette tokens, resolved against brand settings at render time. */
export const COLOR_TOKENS = ["primary", "accent", "dark", "gray", "muted"] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];
export const NEUTRALS: Record<Exclude<ColorToken, "primary" | "accent">, string> = {
  dark: "#222222",
  gray: "#555555",
  muted: "#888888",
};
export type Palette = Record<ColorToken, string>;
export function palette(brand: { primaryColor: string; accentColor: string }): Palette {
  return { primary: brand.primaryColor, accent: brand.accentColor, ...NEUTRALS };
}

export const BUTTON_COLORS = ["primary", "accent"] as const;
export type ButtonColor = (typeof BUTTON_COLORS)[number];

/** Web-safe stack only; custom web fonts are unreliable in email clients. */
export const FONT_STACK = "Arial, Helvetica, sans-serif";

export type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "link"; attrs: { href: string } }
  | { type: "brandColor"; attrs: { color: ColorToken } };

export type TextNode = { type: "text"; text: string; marks?: Mark[] };
export type HardBreak = { type: "hardBreak" };
export type Inline = TextNode | HardBreak;

export type Paragraph = { type: "paragraph"; attrs: { textAlign: Align }; content?: Inline[] };
export type HeadingNode = { type: "heading"; attrs: { level: 1 | 2 | 3; textAlign: Align }; content?: Inline[] };
export type ListItem = { type: "listItem"; content: (Paragraph | BulletList | OrderedList)[] };
export type BulletList = { type: "bulletList"; content: ListItem[] };
export type OrderedList = { type: "orderedList"; attrs: { start: number }; content: ListItem[] };
export type Divider = { type: "horizontalRule" };
export type Spacer = { type: "spacer"; attrs: { height: number } };
export type EmailImage = {
  type: "emailImage";
  attrs: { src: string; alt: string; href: string | null; align: Align; width: number; assetId: string | null };
};
export type EmailButton = {
  type: "emailButton";
  attrs: { label: string; href: string; color: ButtonColor; align: Align };
};
export type TextBlock = Paragraph | HeadingNode | BulletList | OrderedList;
export type TwoColumn = {
  type: "twoColumn";
  attrs: {
    imageSrc: string;
    imageAlt: string;
    imageHref: string | null;
    imagePosition: "left" | "right";
    assetId: string | null;
  };
  content: TextBlock[];
};

export type Block = TextBlock | Divider | Spacer | EmailImage | EmailButton | TwoColumn;
export type Doc = { type: "doc"; content: Block[] };

export const EMPTY_DOC: Doc = { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "left" } }] };
