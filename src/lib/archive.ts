import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { campaigns } from "@/db/schema";

const PUBLIC = and(eq(campaigns.status, "sent"), eq(campaigns.showInArchive, true), isNotNull(campaigns.archiveHtml));

/** Only public fields; never subscriber data. */
export async function listArchive(db: DbOrTx) {
  return db
    .select({ id: campaigns.id, subject: campaigns.subject, preheader: campaigns.preheader, sentAt: campaigns.sentAt })
    .from(campaigns)
    .where(PUBLIC)
    .orderBy(desc(campaigns.sentAt));
}

export async function getArchivedHtml(db: DbOrTx, id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select({ html: campaigns.archiveHtml }).from(campaigns).where(and(PUBLIC, eq(campaigns.id, id)));
  return row?.html ?? null;
}

/**
 * Archive pages are rendered email HTML. The CSP forbids all script and
 * limits images to https, so even a rendering bug can't become XSS.
 */
export const ARCHIVE_CSP =
  "default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
