import { randomUUID } from "node:crypto";
import { desc, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { files } from "@/db/schema";
import { getStorage } from "@/lib/storage";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const OOXML_HEAD = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // ZIP
const PDF_HEAD = Buffer.from("%PDF-");
const OLE_HEAD = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // legacy .doc/.xls/.ppt

type Kind = { mime: string; check: (b: Buffer) => boolean };

const isOoxml = (folder: string) => (b: Buffer) =>
  b.subarray(0, 4).equals(OOXML_HEAD) &&
  b.includes("[Content_Types].xml") &&
  b.includes(folder) &&
  // Macros can't live in .docx/.xlsx/.pptx; a vbaProject means it's a renamed .docm/.xlsm.
  !b.includes("vbaProject.bin");

/**
 * Documents families can be sent. Content is checked, not just the extension.
 * Legacy .doc/.xls/.ppt are refused because they can carry macros; Word and
 * Excel save the modern formats by default.
 */
export const ALLOWED: Record<string, Kind> = {
  pdf: { mime: "application/pdf", check: (b) => b.subarray(0, 5).equals(PDF_HEAD) },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", check: isOoxml("word/") },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", check: isOoxml("xl/") },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", check: isOoxml("ppt/") },
};

const LEGACY = new Set(["doc", "xls", "ppt", "docm", "xlsm", "pptm"]);

export class FileRejected extends Error {}

/** A safe, readable filename: no path, no odd characters, lowercase extension. */
export function cleanFileName(raw: string): { base: string; ext: string } {
  const name = raw.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const base =
    (dot > 0 ? name.slice(0, dot) : name)
      .normalize("NFKD")
      .replace(/[^\w\s.-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "document";
  return { base, ext };
}

export async function uploadFile(db: DbOrTx, body: Buffer, originalName: string, uploadedBy: string) {
  if (body.length > MAX_FILE_BYTES) throw new FileRejected("File is larger than 10 MB.");
  if (body.length === 0) throw new FileRejected("The file is empty.");
  const { base, ext } = cleanFileName(originalName);
  if (LEGACY.has(ext)) {
    throw new FileRejected(`.${ext} files can contain macros. In Word, Excel or PowerPoint use File → Save As → .${ext.slice(0, 3)}x or PDF, then attach that.`);
  }
  const kind = ALLOWED[ext];
  if (!kind) throw new FileRejected("Attach PDF, Word (.docx), Excel (.xlsx) or PowerPoint (.pptx) files. For photos, use the image upload.");
  if (!kind.check(body)) throw new FileRejected(`That file isn't a valid .${ext} document.`);

  const name = `${base}.${ext}`;
  // URL-safe path segment; the readable name is kept in the database.
  const slug = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
  const key = `files/${randomUUID()}/${slug}.${ext}`;
  const { publicUrl } = await getStorage().put(key, body, kind.mime);
  const [row] = await db
    .insert(files)
    .values({ storageKey: key, publicUrl, name, mimeType: kind.mime, bytes: body.length, uploadedBy })
    .returning();
  return row;
}

export async function filesByIds(db: DbOrTx, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.select().from(files).where(inArray(files.id, ids));
  // Keep the order the message lists them in.
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r);
}

export async function listFiles(db: DbOrTx, limit = 100) {
  return db.select().from(files).orderBy(desc(files.createdAt)).limit(limit);
}

export function formatBytes(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
