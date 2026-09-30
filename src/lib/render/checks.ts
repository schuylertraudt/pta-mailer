import type { Doc } from "@/lib/editor/model";
import { contentStats } from "@/lib/editor/walk";

// Gmail clips messages over ~102KB, hiding the footer and unsubscribe link.
export const SIZE_WARN_BYTES = 90 * 1024;
export const SIZE_BLOCK_BYTES = 100 * 1024;

export type Check = { level: "warn" | "block"; code: string; message: string };

export function checkCampaign(input: { doc: Doc; html: string; subject: string }): Check[] {
  const out: Check[] = [];
  const bytes = Buffer.byteLength(input.html, "utf8");
  const kb = (bytes / 1024).toFixed(1);
  if (bytes >= SIZE_BLOCK_BYTES) {
    out.push({ level: "block", code: "size_block", message: `Email is ${kb} KB. Gmail clips messages over ~102 KB and hides the unsubscribe link. Shorten it below 100 KB to send.` });
  } else if (bytes >= SIZE_WARN_BYTES) {
    out.push({ level: "warn", code: "size_warn", message: `Email is ${kb} KB, close to Gmail's ~102 KB clipping limit.` });
  }
  if (!input.subject.trim()) out.push({ level: "block", code: "no_subject", message: "Add a subject line." });

  const s = contentStats(input.doc);
  if (s.images > 0 && s.textChars < 20) {
    out.push({ level: "warn", code: "image_only", message: "This email is image-only. Spam filters penalize that and screen readers can't read it. Add text." });
  } else if (s.images > 0 && s.textChars < 150 * s.images) {
    out.push({ level: "warn", code: "near_image_only", message: "This email is mostly images. Add more text to avoid spam filters." });
  }
  if (s.missingAlt.length) {
    out.push({ level: "warn", code: "missing_alt", message: `${s.missingAlt.length} image(s) have no alt text.` });
  }
  if (s.textChars === 0 && s.images === 0) out.push({ level: "block", code: "empty", message: "The email body is empty." });
  return out;
}

export const hasBlocker = (checks: Check[]) => checks.some((c) => c.level === "block");
