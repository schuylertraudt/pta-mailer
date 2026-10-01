import { afterAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { ImageRejected, MAX_UPLOAD_BYTES, processImage, sniffImageType, TARGET_BYTES } from "@/lib/images/process";
import { uploadAsset } from "@/lib/assets/service";
import { MemoryStorage, getStorage } from "@/lib/storage";
import { POST as uploadRoute } from "../app/api/assets/route";
import { resetDb, testDb } from "./helpers/db";
import { makeOfficer, sessionFor } from "./helpers/factories";

const { db, pool } = testDb();
afterAll(() => pool.end());
beforeEach(() => resetDb(db));

/** A noisy photo-like JPEG with EXIF (camera + GPS) and a rotation flag. */
async function photoWithGps(width = 2400, height = 1600, orientation = 6, detail: "photo" | "noise" = "photo") {
  const px = Buffer.alloc(width * height * 3);
  for (let i = 0; i < px.length; i++) {
    const p = Math.floor(i / 3);
    const x = p % width;
    const y = Math.floor(p / width);
    const n = ((i * 2654435761) >>> 24) & 255;
    px[i] = detail === "noise" ? n : (((x >> 3) + (y >> 3) * (i % 3 + 1)) & 255) ^ (n & 15);
  }
  return sharp(px, { raw: { width, height, channels: 3 } })
    .withExif({
      IFD0: { Make: "TestCam", Model: "X1", Orientation: String(orientation) },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 46/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "122/1 25/1 0/1" },
    })
    .withMetadata({ orientation })
    .jpeg({ quality: 95 })
    .toBuffer();
}

describe("image pipeline", () => {
  it("fixture really carries EXIF + GPS", async () => {
    const meta = await sharp(await photoWithGps()).metadata();
    expect(meta.exif).toBeDefined();
    expect(meta.exif!.toString("latin1")).toContain("TestCam");
    expect(meta.orientation).toBe(6);
  });

  it("strips EXIF/GPS, applies orientation, resizes to 1200 wide, compresses under 200 KB", async () => {
    const out = await processImage(await photoWithGps(2400, 1600, 6));
    const meta = await sharp(out.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(out.buffer.toString("latin1")).not.toContain("TestCam");
    // Orientation 6 = rotate 90deg: 2400x1600 becomes 1600x2400, then width capped at 1200.
    expect(out.width).toBe(1200);
    expect(out.height).toBe(1800);
    expect(meta.orientation ?? 1).toBe(1);
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.buffer.length).toBeLessThanOrEqual(TARGET_BYTES);
  });

  it("downscales pathological detail toward the size target but never below 600px", async () => {
    const out = await processImage(await photoWithGps(2400, 1600, 6, "noise"));
    expect(out.width).toBeGreaterThanOrEqual(600);
    expect(out.width).toBeLessThan(1200);
  });

  it("resizes over-width landscape images to 1200px and leaves small ones alone", async () => {
    const big = await processImage(await photoWithGps(3000, 1000, 1));
    expect(big.width).toBe(1200);
    expect(big.height).toBe(400);
    const small = await processImage(await sharp({ create: { width: 300, height: 200, channels: 3, background: "#336699" } }).png().toBuffer());
    expect(small.width).toBe(300);
  });

  it("converts WebP to JPEG and keeps PNG transparency", async () => {
    const webp = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#aa3300" } }).webp().toBuffer();
    expect(sniffImageType(webp)).toBe("webp");
    expect((await processImage(webp)).mimeType).toBe("image/jpeg");

    const alpha = await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await processImage(alpha);
    expect(out.mimeType).toBe("image/png");
    expect((await sharp(out.buffer).metadata()).hasAlpha).toBe(true);
  });

  it("keeps animated GIFs animated, capped at 600px", async () => {
    const frames = 3;
    const w = 900;
    const h = 300;
    const raw = Buffer.alloc(w * h * frames * 4);
    for (let i = 0; i < w * h * frames; i++) {
      const f = Math.floor(i / (w * h));
      raw[i * 4] = f === 0 ? 255 : 0;
      raw[i * 4 + 1] = f === 1 ? 255 : 0;
      raw[i * 4 + 2] = f === 2 ? 255 : 0;
      raw[i * 4 + 3] = 255;
    }
    const gif = await sharp(raw, { raw: { width: w, height: h * frames, channels: 4, pageHeight: h } as never }).gif({ loop: 0 }).toBuffer();
    const out = await processImage(gif);
    expect(out.mimeType).toBe("image/gif");
    expect(out.width).toBe(600);
    const meta = await sharp(out.buffer, { animated: true }).metadata();
    expect(meta.pages).toBe(frames);
  });

  it("detects HEIC by content", () => {
    const heicHeader = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
    expect(sniffImageType(heicHeader)).toBe("heic");
  });

  it("rejects disallowed types regardless of claimed name/type", async () => {
    const cases = [
      Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from("GIF but not really, just text......"),
      await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).tiff().toBuffer(),
      await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).avif().toBuffer(),
    ];
    for (const buf of cases) await expect(processImage(buf)).rejects.toBeInstanceOf(ImageRejected);
  });

  it("rejects files over 10 MB", async () => {
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    await expect(processImage(huge)).rejects.toThrow("10 MB");
  });
});

describe("asset upload", () => {
  it("stores processed bytes and records an https public URL", async () => {
    const o = await makeOfficer(db, "drafter");
    const asset = await uploadAsset(db, await photoWithGps(1600, 1200, 1), { altText: "Field day", uploadedBy: o.id });
    expect(asset.publicUrl).toMatch(/^https:\/\/images\.pta\.example\.org\/images\/\d{4}\/\d{2}\/[0-9a-f-]+\.jpg$/);
    expect(asset).toMatchObject({ width: 1200, height: 900, mimeType: "image/jpeg", altText: "Field day" });
    const stored = (getStorage() as MemoryStorage).objects.get(asset.storageKey)!;
    expect((await sharp(stored.body).metadata()).exif).toBeUndefined();
  });

  it("upload route requires a session and returns 415 for bad types", async () => {
    const o = await makeOfficer(db, "drafter");
    const { headers } = await sessionFor(db, o.id);
    const form = new FormData();
    form.set("file", new Blob([Buffer.from("%PDF-1.4 not an image at all")]), "doc.jpg");
    form.set("alt", "x");
    const res = await uploadRoute(new Request("https://pta.example.org/api/assets", { method: "POST", headers, body: form }), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(415);
    const anon = await uploadRoute(new Request("https://pta.example.org/api/assets", { method: "POST", headers: { origin: headers.origin }, body: form }), { params: Promise.resolve({}) } as never);
    expect(anon.status).toBe(401);
  });
});

describe("direct-to-bucket upload finalize", () => {
  it("processes an incoming original, stores the clean copy, deletes the original", async () => {
    const { finalizeUpload, createUploadUrl } = await import("@/lib/assets/service");
    const o = await makeOfficer(db, "drafter");
    const storage = getStorage() as MemoryStorage;
    expect(await createUploadUrl({ contentType: "image/jpeg", size: 1000 })).toEqual({ direct: false });
    await expect(createUploadUrl({ contentType: "image/jpeg", size: MAX_UPLOAD_BYTES + 1 })).rejects.toBeInstanceOf(ImageRejected);

    const key = "incoming/0b0e9b6e-3c1a-4a55-9d62-1b0b5b1c2d3e";
    storage.incoming.set(key, await photoWithGps(1600, 1200, 1));
    const asset = await finalizeUpload(db, key, { altText: "x", uploadedBy: o.id });
    expect(asset.width).toBe(1200);
    expect(storage.incoming.has(key)).toBe(false);
    expect((await sharp(storage.objects.get(asset.storageKey)!.body).metadata()).exif).toBeUndefined();
  });

  it("rejects bad keys, missing and oversized originals", async () => {
    const { finalizeUpload } = await import("@/lib/assets/service");
    const o = await makeOfficer(db, "drafter");
    const storage = getStorage() as MemoryStorage;
    await expect(finalizeUpload(db, "images/2026/09/someone-elses.jpg", { altText: "", uploadedBy: o.id })).rejects.toThrow("Invalid upload");
    await expect(finalizeUpload(db, "incoming/0b0e9b6e-3c1a-4a55-9d62-1b0b5b1c2d3f", { altText: "", uploadedBy: o.id })).rejects.toThrow("not found");
    const key = "incoming/0b0e9b6e-3c1a-4a55-9d62-1b0b5b1c2d40";
    storage.incoming.set(key, Buffer.alloc(MAX_UPLOAD_BYTES + 1));
    await expect(finalizeUpload(db, key, { altText: "", uploadedBy: o.id })).rejects.toThrow("10 MB");
    expect(storage.incoming.has(key)).toBe(false);
  });
});

describe("local disk storage", () => {
  it("writes under its directory with web-readable permissions and refuses path traversal", async () => {
    const { LocalStorage } = await import("@/lib/storage");
    const { mkdtemp, readFile, stat } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(os.tmpdir(), "pta-media-"));
    const s = new LocalStorage(dir);
    const { publicUrl } = await s.put("images/2026/10/a.jpg", Buffer.from("x"));
    expect(publicUrl).toBe("https://images.pta.example.org/images/2026/10/a.jpg");
    expect((await readFile(path.join(dir, "images/2026/10/a.jpg"))).toString()).toBe("x");
    expect((await stat(path.join(dir, "images/2026/10/a.jpg"))).mode & 0o777).toBe(0o644);
    await expect(s.put("../escape.jpg", Buffer.from("x"))).rejects.toThrow("Invalid storage key");
    expect(await s.presignIncoming()).toBeNull();
  });
});
