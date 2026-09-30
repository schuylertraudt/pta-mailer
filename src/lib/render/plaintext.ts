import type { Block, Doc, Inline, ListItem } from "@/lib/editor/model";
import type { BrandForRender, RenderMode } from "./email";

function inlineToText(content: Inline[] | undefined): string {
  return (content ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "\n";
      const link = n.marks?.find((m) => m.type === "link");
      if (link?.type === "link") {
        const href = link.attrs.href.replace(/^mailto:/, "");
        return n.text.trim() === href ? n.text : `${n.text} (${href})`;
      }
      return n.text;
    })
    .join("");
}

function listToText(items: ListItem[], ordered: boolean, start: number, indent: string): string[] {
  return items.flatMap((li, i) => {
    const bullet = ordered ? `${start + i}.` : "-";
    return li.content.flatMap((c, j) => {
      if (c.type === "paragraph") return [`${indent}${j === 0 ? bullet : " ".repeat(bullet.length)} ${inlineToText(c.content)}`];
      return listToText(c.content, c.type === "orderedList", c.type === "orderedList" ? c.attrs.start : 1, indent + "   ");
    });
  });
}

function blockToText(b: Block): string | null {
  switch (b.type) {
    case "paragraph":
      return inlineToText(b.content).trim() || null;
    case "heading": {
      const t = inlineToText(b.content).trim();
      if (!t) return null;
      return b.attrs.level === 1 ? `${t.toUpperCase()}\n${"=".repeat(Math.min(t.length, 60))}` : b.attrs.level === 2 ? `${t}\n${"-".repeat(Math.min(t.length, 60))}` : t;
    }
    case "bulletList":
      return listToText(b.content, false, 1, "").join("\n");
    case "orderedList":
      return listToText(b.content, true, b.attrs.start, "").join("\n");
    case "horizontalRule":
      return "----------------------------------------";
    case "spacer":
      return null;
    case "emailImage":
      return b.attrs.alt || b.attrs.href ? [b.attrs.alt && `[${b.attrs.alt}]`, b.attrs.href].filter(Boolean).join(" ") : null;
    case "emailButton":
      return `${b.attrs.label}: ${b.attrs.href}`;
    case "twoColumn":
      return [
        b.attrs.imageAlt || b.attrs.imageHref ? [b.attrs.imageAlt && `[${b.attrs.imageAlt}]`, b.attrs.imageHref].filter(Boolean).join(" ") : null,
        ...b.content.map(blockToText),
      ]
        .filter(Boolean)
        .join("\n\n");
  }
}

/** Plaintext alternative generated from the same document as the HTML part. */
export function renderPlaintext(doc: Doc, brand: Pick<BrandForRender, "footerText" | "ptaMailingAddress">, mode: RenderMode): string {
  const body = doc.content.map(blockToText).filter(Boolean).join("\n\n");
  const footer = [
    "--",
    brand.footerText,
    brand.ptaMailingAddress,
    mode.kind === "email" ? `Unsubscribe: ${mode.unsubscribeUrl}` : `Subscribe: ${mode.subscribeUrl}`,
    mode.kind === "email" && mode.viewOnlineUrl ? `View in browser: ${mode.viewOnlineUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${body}\n\n${footer}\n`;
}
