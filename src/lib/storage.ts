import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/** S3-compatible object storage (R2, S3, Supabase Storage S3 endpoint). */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<{ publicUrl: string }>;
  /**
   * Direct browser upload of an original into the incoming area, bypassing
   * serverless request-size limits. Returns null when unsupported.
   */
  presignIncoming(key: string, contentType: string): Promise<string | null>;
  getIncoming(key: string, maxBytes: number): Promise<Buffer | null>;
  deleteIncoming(key: string): Promise<void>;
}

export class TooLarge extends Error {}

export function publicUrlFor(key: string): string {
  return `${env().STORAGE_PUBLIC_BASE_URL}/${key}`;
}

export class S3Storage implements ObjectStorage {
  private client: S3Client;
  constructor(
    private bucket: string,
    /** Originals (with EXIF/GPS) land here; ideally a private bucket. */
    private incomingBucket: string = bucket,
  ) {
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
  async presignIncoming(key: string, contentType: string) {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.incomingBucket, Key: key, ContentType: contentType }), {
      expiresIn: 600,
    });
  }
  async getIncoming(key: string, maxBytes: number) {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.incomingBucket, Key: key }));
      if ((head.ContentLength ?? 0) > maxBytes) throw new TooLarge();
      const obj = await this.client.send(new GetObjectCommand({ Bucket: this.incomingBucket, Key: key }));
      return Buffer.from(await obj.Body!.transformToByteArray());
    } catch (e) {
      if (e instanceof TooLarge) throw e;
      return null;
    }
  }
  async deleteIncoming(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.incomingBucket, Key: key })).catch(() => {});
  }
}

export class MemoryStorage implements ObjectStorage {
  objects = new Map<string, { body: Buffer; contentType: string }>();
  incoming = new Map<string, Buffer>();
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
    return { publicUrl: publicUrlFor(key) };
  }
  async presignIncoming() {
    return null;
  }
  async getIncoming(key: string, maxBytes: number) {
    const b = this.incoming.get(key);
    if (b && b.length > maxBytes) throw new TooLarge();
    return b ?? null;
  }
  async deleteIncoming(key: string) {
    this.incoming.delete(key);
  }
}

/**
 * Files on this server's disk. The web server serves the directory read-only
 * at STORAGE_PUBLIC_BASE_URL; uploads go through the app (no request-size cap
 * on a self-hosted server), so there is no presigned "incoming" step.
 */
export class LocalStorage implements ObjectStorage {
  private root: string;
  constructor(dir: string) {
    this.root = path.resolve(dir);
  }
  async put(key: string, body: Buffer) {
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    await mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
    await writeFile(file, body, { mode: 0o644 });
    return { publicUrl: publicUrlFor(key) };
  }
  async presignIncoming() {
    return null;
  }
  async getIncoming() {
    return null;
  }
  async deleteIncoming() {}
}

let storage: ObjectStorage | undefined;
export function getStorage(): ObjectStorage {
  if (!storage) {
    const e = env();
    if (e.STORAGE_DRIVER === "memory") storage = new MemoryStorage();
    else if (e.STORAGE_DRIVER === "local") storage = new LocalStorage(e.STORAGE_LOCAL_DIR);
    else {
      if (!e.S3_BUCKET) throw new Error("S3_BUCKET is not set");
      storage = new S3Storage(e.S3_BUCKET, e.S3_INCOMING_BUCKET || e.S3_BUCKET);
    }
  }
  return storage;
}
export function setStorage(s: ObjectStorage | undefined) {
  storage = s;
}
