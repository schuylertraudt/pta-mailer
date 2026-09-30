import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

/** S3-compatible object storage (R2, S3, Supabase Storage S3 endpoint). */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<{ publicUrl: string }>;
}

export function publicUrlFor(key: string): string {
  return `${env().STORAGE_PUBLIC_BASE_URL}/${key}`;
}

export class S3Storage implements ObjectStorage {
  private client: S3Client;
  constructor(private bucket: string) {
    const e = env();
    this.client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT || undefined,
      forcePathStyle: !!e.S3_ENDPOINT,
      credentials:
        e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Keys are unique per upload, so objects never change.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return { publicUrl: publicUrlFor(key) };
  }
}

export class MemoryStorage implements ObjectStorage {
  objects = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
    return { publicUrl: publicUrlFor(key) };
  }
}

let storage: ObjectStorage | undefined;
export function getStorage(): ObjectStorage {
  if (!storage) {
    const e = env();
    if (e.STORAGE_DRIVER === "memory") storage = new MemoryStorage();
    else {
      if (!e.S3_BUCKET) throw new Error("S3_BUCKET is not set");
      storage = new S3Storage(e.S3_BUCKET);
    }
  }
  return storage;
}
export function setStorage(s: ObjectStorage | undefined) {
  storage = s;
}
