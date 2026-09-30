import { generateJSON } from "@tiptap/html/server";
import { emailExtensions } from "./extensions";
import type { Doc } from "./model";
import { sanitizeDoc } from "./sanitize";

/**
 * Converts pasted/imported HTML (Word, Google Docs, web pages) to an
 * email-safe document: ProseMirror's schema drops unknown structure, then
 * sanitizeDoc enforces the allowlist on what's left.
 */
export function htmlToDoc(html: string, storageBase: string): Doc {
  return sanitizeDoc(generateJSON(html, emailExtensions()), storageBase);
}
