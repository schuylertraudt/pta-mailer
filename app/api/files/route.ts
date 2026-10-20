import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { listFiles, MAX_FILE_BYTES, uploadFile } from "@/lib/files/service";
import { json, toResponse } from "@/lib/http";

export const GET = withOfficer("compose", async () => json({ files: await listFiles(getDb()) }));

/** Multipart { file }: a PDF, .docx, .xlsx or .pptx to attach to messages. */
export const POST = withOfficer("compose", async (req, officer) => {
  try {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_FILE_BYTES + 64 * 1024) return json({ error: "File is larger than 10 MB." }, 413);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "No file uploaded" }, 400);
    if (file.size > MAX_FILE_BYTES) return json({ error: "File is larger than 10 MB." }, 413);
    const row = await uploadFile(getDb(), Buffer.from(await file.arrayBuffer()), file.name, officer.id);
    return json({ file: row }, 201);
  } catch (e) {
    return toResponse(e);
  }
});
