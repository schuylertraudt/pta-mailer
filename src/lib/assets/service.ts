import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { assets } from "@/db/schema";
import { processImage } from "@/lib/images/process";
import { getStorage } from "@/lib/storage";

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
