import sharp from "sharp";
import type { Metadata, OutputInfo, Sharp } from "sharp";
import convertHeic from "heic-convert";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Stored width; displayed at <= 600px so this covers 2x (retina). */
export const MAX_WIDTH = 1200;
export const TARGET_BYTES = 200 * 1024;
export const MAX_GIF_WIDTH = 600;
export const MAX_GIF_BYTES = 1024 * 1024;

export type SourceType = "jpeg" | "png" | "gif" | "webp" | "heic";
export type ProcessedImage = { buffer: Buffer; mimeType: "image/jpeg" | "image/png" | "image/gif"; ext: "jpg" | "png" | "gif"; width: number; height: number };

export class ImageRejected extends Error {}

/** Identifies the file by its bytes, never by the client's filename or declared type. */
export function sniffImageType(buf: Buffer): SourceType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a") return "gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) return "heic";
  }
  return null;
}

async function encodeStill(input: Sharp, hasAlpha: boolean): Promise<ProcessedImage> {
  if (hasAlpha) {
    // Keep transparency (logos). Palette PNG is usually far smaller.
    let buf = await input.clone().png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    if (buf.info.size > TARGET_BYTES) {
      buf = await input.clone().png({ palette: true, quality: 60, colours: 128, compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
    }
    return { buffer: buf.data, mimeType: "image/png", ext: "png", width: buf.info.width, height: buf.info.height };
  }
  const jpeg = (p: Sharp, quality: number) =>
    p.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true, progressive: true }).toBuffer({ resolveWithObject: true });
  let last!: { data: Buffer; info: OutputInfo };
  for (const quality of [82, 72, 62, 52]) {
    last = await jpeg(input.clone(), quality);
    if (last.info.size <= TARGET_BYTES) break;
  }
  // Very detailed images: trade resolution for size, but never below the 600px display width.
  for (const width of [1000, 800, 600]) {
    if (last.info.size <= TARGET_BYTES || last.info.width <= width) break;
    last = await jpeg(sharp(await input.clone().png().toBuffer()).resize({ width }), 62);
  }
  return { buffer: last.data, mimeType: "image/jpeg", ext: "jpg", width: last.info.width, height: last.info.height };
}

/**
 * Normalizes an upload for email: auto-rotate, strip all metadata (EXIF/GPS),
 * convert HEIC/WebP to JPEG/PNG, cap width at 1200px, compress toward <200 KB.
 * Animated GIFs stay GIF, capped at 600px wide and 1 MB.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageRejected("Image is larger than 10 MB.");
  const type = sniffImageType(input);
  if (!type) throw new ImageRejected("Unsupported file type. Use JPG, PNG, GIF, WebP or HEIC.");

  let buf = input;
  if (type === "heic") {
    try {
      buf = Buffer.from(await convertHeic({ buffer: input, format: "JPEG", quality: 0.92 }));
    } catch {
      throw new ImageRejected("Could not read that HEIC image.");
    }
  }

  if (type === "gif") {
    const meta = await sharp(buf, { animated: true }).metadata();
    if ((meta.pages ?? 1) > 1) {
      // sharp drops metadata by default; resizing an animation keeps every frame.
      let out = await sharp(buf, { animated: true })
        .resize({ width: MAX_GIF_WIDTH, withoutEnlargement: true })
        .gif({ effort: 7, colours: 128 })
        .toBuffer({ resolveWithObject: true });
      if (out.info.size > MAX_GIF_BYTES) {
        out = await sharp(buf, { animated: true })
          .resize({ width: 400, withoutEnlargement: true })
          .gif({ effort: 10, colours: 64 })
          .toBuffer({ resolveWithObject: true });
      }
      if (out.info.size > MAX_GIF_BYTES) throw new ImageRejected("Animated GIF is too large for email (over 1 MB after resizing).");
      const pageHeight = out.info.pageHeight ?? out.info.height;
      return { buffer: out.data, mimeType: "image/gif", ext: "gif", width: out.info.width, height: pageHeight };
    }
  }

  let meta: Metadata;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    throw new ImageRejected("That file isn't a readable image.");
  }
  // .rotate() with no args applies EXIF orientation, after which metadata is not re-emitted.
  const pipeline = sharp(buf, { failOn: "error" }).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true });
  return encodeStill(pipeline, !!meta.hasAlpha && type !== "jpeg");
}
