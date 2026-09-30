import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { assets } from "@/db/schema";
import { ImageRejected, MAX_UPLOAD_BYTES, processImage } from "@/lib/images/process";
import { getStorage, TooLarge } from "@/lib/storage";

export async function uploadAsset(db: DbOrTx, file: Buffer, opts: { altText: string | null; uploadedBy: string }) {
  const img = await processImage(file);
  const now = new Date();
  const key = `images/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${img.ext}`;
  const { publicUrl } = await getStorage().put(key, img.buffer, img.mimeType);
  const [row] = await db
    .insert(assets)
    .values({
      storageKey: key,
      publicUrl,
      width: img.width,
      height: img.height,
      bytes: img.buffer.length,
      mimeType: img.mimeType,
      altText: opts.altText?.trim() || null,
      uploadedBy: opts.uploadedBy,
    })
    .returning();
  return row;
}

export async function listAssets(db: DbOrTx, limit = 200) {
  return db.select().from(assets).orderBy(desc(assets.createdAt)).limit(limit);
}

export async function setAltText(db: DbOrTx, id: string, altText: string) {
  const [row] = await db
    .update(assets)
    .set({ altText: altText.trim().slice(0, 300) || null })
    .where(eq(assets.id, id))
    .returning();
  return row;
}

const INCOMING_KEY = /^incoming\/[0-9a-f-]{36}$/;

/** Step 1 of a direct upload: a short-lived URL the browser PUTs the original to. */
export async function createUploadUrl(opts: { contentType: string; size: number }) {
  if (opts.size > MAX_UPLOAD_BYTES) throw new ImageRejected("Image is larger than 10 MB.");
  const key = `incoming/${randomUUID()}`;
  const url = await getStorage().presignIncoming(key, opts.contentType || "application/octet-stream");
  return url ? { direct: true as const, key, url } : { direct: false as const };
}

/** Step 2: process the uploaded original like any other upload, then delete it. */
export async function finalizeUpload(db: DbOrTx, key: string, opts: { altText: string | null; uploadedBy: string }) {
  if (!INCOMING_KEY.test(key)) throw new ImageRejected("Invalid upload.");
  const storage = getStorage();
  try {
    const original = await storage.getIncoming(key, MAX_UPLOAD_BYTES);
    if (!original) throw new ImageRejected("Upload not found. Please try again.");
    return await uploadAsset(db, original, opts);
  } catch (e) {
    if (e instanceof TooLarge) throw new ImageRejected("Image is larger than 10 MB.");
    throw e;
  } finally {
    await storage.deleteIncoming(key);
  }
}
