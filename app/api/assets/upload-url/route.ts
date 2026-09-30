import { withOfficer } from "@/lib/auth/guard";
import { createUploadUrl } from "@/lib/assets/service";
import { json, toResponse } from "@/lib/http";

export const POST = withOfficer("compose", async (req) => {
  try {
    const body = (await req.json()) as { contentType?: string; size?: number };
    return json(await createUploadUrl({ contentType: String(body.contentType ?? ""), size: Number(body.size ?? 0) }));
  } catch (e) {
    return toResponse(e);
  }
});
