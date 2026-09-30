import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { finalizeUpload, listAssets, uploadAsset } from "@/lib/assets/service";
import { MAX_UPLOAD_BYTES } from "@/lib/images/process";
import { json, toResponse } from "@/lib/http";

export const GET = withOfficer("compose", async () => json({ assets: await listAssets(getDb()) }));

/**
 * Either JSON { key, alt } to finalize a direct-to-bucket upload (required on
 * Vercel, whose functions cap request bodies at 4.5 MB), or multipart
 * { file, alt } for small files / self-hosted deployments.
 */
export const POST = withOfficer("compose", async (req, officer) => {
  try {
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      const body = (await req.json()) as { key?: string; alt?: string };
      const asset = await finalizeUpload(getDb(), String(body.key ?? ""), { altText: String(body.alt ?? ""), uploadedBy: officer.id });
      return json({ asset }, 201);
    }
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES + 64 * 1024) return json({ error: "Image is larger than 10 MB." }, 413);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return json({ error: "No file uploaded" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return json({ error: "Image is larger than 10 MB." }, 413);
    const alt = String(form.get("alt") ?? "");
    const asset = await uploadAsset(getDb(), Buffer.from(await file.arrayBuffer()), { altText: alt, uploadedBy: officer.id });
    return json({ asset }, 201);
  } catch (e) {
    return toResponse(e);
  }
});
