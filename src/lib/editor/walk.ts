import type { Block, Doc, Inline } from "./model";

export function inlineText(content: Inline[] | undefined): string {
  return (content ?? []).map((n) => (n.type === "text" ? n.text : "\n")).join("");
}

export function* walkBlocks(blocks: Block[]): Generator<Block> {
  for (const b of blocks) {
    yield b;
    if (b.type === "twoColumn") yield* walkBlocks(b.content);
    if (b.type === "bulletList" || b.type === "orderedList") {
      for (const li of b.content) yield* walkBlocks(li.content);
    }
  }
}

/** Visible text characters (excluding whitespace) and image count, for spam heuristics. */
export function contentStats(doc: Doc) {
  let textChars = 0;
  let images = 0;
  const missingAlt: string[] = [];
  for (const b of walkBlocks(doc.content)) {
    if (b.type === "paragraph" || b.type === "heading") textChars += inlineText(b.content).replace(/\s+/g, "").length;
    if (b.type === "emailButton") textChars += b.attrs.label.replace(/\s+/g, "").length;
    if (b.type === "emailImage") {
      images++;
      if (!b.attrs.alt) missingAlt.push(b.attrs.src);
    }
    if (b.type === "twoColumn") {
      images++;
      if (!b.attrs.imageAlt) missingAlt.push(b.attrs.imageSrc);
    }
  }
  return { textChars, images, missingAlt };
}
