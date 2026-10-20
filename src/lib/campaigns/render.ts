import type { DbOrTx } from "@/db";
import type { campaigns } from "@/db/schema";
import { loadBrand } from "@/lib/brand";
import { sanitizeDoc } from "@/lib/editor/sanitize";
import { env } from "@/lib/env";
import { filesByIds, formatBytes } from "@/lib/files/service";
import { renderEmailHtml, type RenderMode } from "@/lib/render/email";
import { renderPlaintext } from "@/lib/render/plaintext";
import { checkCampaign } from "@/lib/render/checks";
import { archiveUrl, subscribePageUrl, unsubscribePageUrl, UNSUBSCRIBE_TOKEN_PLACEHOLDER } from "@/lib/urls";

type Campaign = Pick<typeof campaigns.$inferSelect, "id" | "subject" | "preheader" | "bodyJson" | "showInArchive"> & {
  attachmentIds?: string[];
};

export function emailMode(c: Pick<Campaign, "id" | "showInArchive">, token = UNSUBSCRIBE_TOKEN_PLACEHOLDER): RenderMode {
  return { kind: "email", unsubscribeUrl: unsubscribePageUrl(token), viewOnlineUrl: c.showInArchive ? archiveUrl(c.id) : null };
}

export async function renderCampaign(
  db: DbOrTx,
  c: Campaign,
  opts: { mode?: RenderMode; forceDark?: boolean } = {},
) {
  const doc = sanitizeDoc(c.bodyJson, env().STORAGE_PUBLIC_BASE_URL);
  const brand = await loadBrand(db);
  const mode = opts.mode ?? emailMode(c);
  const attachments = (await filesByIds(db, c.attachmentIds ?? [])).map((f) => ({ name: f.name, url: f.publicUrl, size: formatBytes(f.bytes) }));
  const html = await renderEmailHtml({ doc, subject: c.subject, preheader: c.preheader, brand, mode, forceDark: opts.forceDark, attachments });
  const text = renderPlaintext(doc, brand, mode, attachments);
  return { html, text, doc, checks: checkCampaign({ doc, html, subject: c.subject }), bytes: Buffer.byteLength(html) };
}

export function archiveMode(): RenderMode {
  return { kind: "archive", subscribeUrl: subscribePageUrl() };
}
