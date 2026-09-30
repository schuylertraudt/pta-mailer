import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { listAssets, uploadAsset } from "@/lib/assets/service";
import { MAX_UPLOAD_BYTES } from "@/lib/images/process";
import { json, toResponse } from "@/lib/http";

export const GET = withOfficer("compose", async () => json({ assets: await listAssets(getDb()) }));

export const POST = withOfficer("compose", async (req, officer) => {
  try {
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
