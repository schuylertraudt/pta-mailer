import {
  ALIGNS,
  BUTTON_COLORS,
  COLOR_TOKENS,
  CONTENT_WIDTH,
  EMPTY_DOC,
  type Align,
  type Block,
  type BulletList,
  type Doc,
  type Inline,
  type ListItem,
  type Mark,
  type OrderedList,
  type Paragraph,
  type TextBlock,
} from "./model";
import { safeImageUrl, safeLinkUrl } from "./urls";

type AnyNode = { type?: unknown; attrs?: Record<string, unknown>; content?: unknown; marks?: unknown; text?: unknown };

const MAX_TEXT = 20_000;
const MAX_BLOCKS = 500;
const MAX_LIST_DEPTH = 3;

const isObj = (v: unknown): v is AnyNode => !!v && typeof v === "object" && !Array.isArray(v);
const kids = (n: AnyNode): AnyNode[] => (Array.isArray(n.content) ? n.content.filter(isObj) : []);
const align = (v: unknown): Align => (ALIGNS.includes(v as Align) ? (v as Align) : "left");
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};
// Strip control characters except tab/newline.
const cleanText = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, MAX_TEXT);
const cleanAttr = (v: unknown, max: number) => (typeof v === "string" ? cleanText(v).trim().slice(0, max) : "");

function marks(raw: unknown): Mark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Mark[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    if (!isObj(m) || typeof m.type !== "string" || seen.has(m.type)) continue;
    switch (m.type) {
      case "bold":
      case "italic":
      case "underline":
        out.push({ type: m.type });
        break;
      case "link": {
        const href = safeLinkUrl(m.attrs?.href);
        if (href) out.push({ type: "link", attrs: { href } });
        break;
      }
      case "brandColor": {
        const color = m.attrs?.color;
        if (COLOR_TOKENS.includes(color as never)) out.push({ type: "brandColor", attrs: { color: color as never } });
        break;
      }
      // Everything else (textStyle with arbitrary color/font, strike, code, highlight...) is dropped.
    }
    seen.add(m.type);
  }
  return out.length ? out : undefined;
}

function inline(nodes: AnyNode[]): Inline[] | undefined {
  const out: Inline[] = [];
  for (const n of nodes) {
    if (n.type === "text" && typeof n.text === "string") {
      const text = cleanText(n.text);
      if (!text) continue;
      const m = marks(n.marks);
      out.push(m ? { type: "text", text, marks: m } : { type: "text", text });
    } else if (n.type === "hardBreak") {
      out.push({ type: "hardBreak" });
    } else {
      // Unknown inline node (mention, emoji node, image inline...): keep its text only.
      const nested = inline(kids(n));
      if (nested) out.push(...nested);
    }
  }
  return out.length ? out : undefined;
}

function paragraph(n: AnyNode): Paragraph {
  const content = inline(kids(n));
  return { type: "paragraph", attrs: { textAlign: align(n.attrs?.textAlign) }, ...(content ? { content } : {}) };
}

function listItems(n: AnyNode, depth: number): ListItem[] {
  const items: ListItem[] = [];
  for (const li of kids(n)) {
    const content: ListItem["content"] = [];
    for (const c of li.type === "listItem" ? kids(li) : [li]) {
      if ((c.type === "bulletList" || c.type === "orderedList") && depth < MAX_LIST_DEPTH) {
        const nested = list(c, depth + 1);
        if (nested) content.push(nested);
      } else {
        content.push(paragraph(c));
      }
    }
    if (content.length === 0 || content[0].type !== "paragraph") content.unshift(paragraph({}));
    items.push({ type: "listItem", content });
  }
  return items;
}

function list(n: AnyNode, depth = 1): BulletList | OrderedList | undefined {
  const content = listItems(n, depth);
  if (!content.length) return undefined;
  if (n.type === "orderedList") {
    return { type: "orderedList", attrs: { start: clampInt(n.attrs?.start, 1, 1000, 1) }, content };
  }
  return { type: "bulletList", content };
}

function textBlocks(nodes: AnyNode[]): TextBlock[] {
  return blocks(nodes, "text") as TextBlock[];
}

function blocks(nodes: AnyNode[], mode: "all" | "text", storageBase = ""): Block[] {
  const out: Block[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "paragraph":
        out.push(paragraph(n));
        break;
      case "heading": {
        const content = inline(kids(n));
        out.push({
          type: "heading",
          attrs: { level: clampInt(n.attrs?.level, 1, 3, 2) as 1 | 2 | 3, textAlign: align(n.attrs?.textAlign) },
          ...(content ? { content } : {}),
        });
        break;
      }
      case "bulletList":
      case "orderedList": {
        const l = list(n);
        if (l) out.push(l);
        break;
      }
      case "horizontalRule":
        if (mode === "all") out.push({ type: "horizontalRule" });
        break;
      case "spacer":
        if (mode === "all") out.push({ type: "spacer", attrs: { height: clampInt(n.attrs?.height, 8, 64, 24) } });
        break;
      case "emailImage": {
        if (mode !== "all") break;
        const src = safeImageUrl(n.attrs?.src, storageBase);
        if (!src) break;
        out.push({
          type: "emailImage",
          attrs: {
            src,
            alt: cleanAttr(n.attrs?.alt, 300),
            href: safeLinkUrl(n.attrs?.href),
            align: align(n.attrs?.align ?? "center"),
            width: clampInt(n.attrs?.width, 50, CONTENT_WIDTH, CONTENT_WIDTH),
            assetId: typeof n.attrs?.assetId === "string" ? n.attrs.assetId : null,
          },
        });
        break;
      }
      case "emailButton": {
        if (mode !== "all") break;
        const label = cleanAttr(n.attrs?.label, 60);
        const href = safeLinkUrl(n.attrs?.href);
        if (!label || !href) break;
        const color = BUTTON_COLORS.includes(n.attrs?.color as never) ? (n.attrs!.color as "primary") : "primary";
        out.push({ type: "emailButton", attrs: { label, href, color, align: align(n.attrs?.align ?? "center") } });
        break;
      }
      case "twoColumn": {
        if (mode !== "all") break;
        const text = textBlocks(kids(n));
        const src = safeImageUrl(n.attrs?.imageSrc, storageBase);
        const content = text.length ? text : [paragraph({})];
        if (!src) {
          out.push(...content);
          break;
        }
        out.push({
          type: "twoColumn",
          attrs: {
            imageSrc: src,
            imageAlt: cleanAttr(n.attrs?.imageAlt, 300),
            imageHref: safeLinkUrl(n.attrs?.imageHref),
            imagePosition: n.attrs?.imagePosition === "right" ? "right" : "left",
            assetId: typeof n.attrs?.assetId === "string" ? n.attrs.assetId : null,
          },
          content,
        });
        break;
      }
      case "text":
      case "hardBreak":
        out.push(paragraph({ content: [n] }));
        break;
      default:
        // Blockquote, table, code block, div soup from Word/Docs: keep the text, drop the structure.
        if (kids(n).length) {
          const inner = kids(n);
          const looksInline = inner.every((c) => c.type === "text" || c.type === "hardBreak");
          out.push(...(looksInline ? [paragraph(n)] : blocks(inner, mode, storageBase)));
        }
    }
    if (out.length >= MAX_BLOCKS) break;
  }
  return out;
}

/**
 * Rebuilds a document from an allowlist of nodes, marks and attributes.
 * Anything not recognized is dropped or flattened to text; URLs are
 * protocol-checked; images must live on the storage domain.
 */
export function sanitizeDoc(raw: unknown, storageBase: string): Doc {
  if (!isObj(raw) || raw.type !== "doc") return structuredClone(EMPTY_DOC);
  const content = blocks(kids(raw), "all", storageBase);
  return { type: "doc", content: content.length ? content : structuredClone(EMPTY_DOC).content };
}
