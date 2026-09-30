import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { setAltText } from "@/lib/assets/service";
import { json } from "@/lib/http";

export const PATCH = withOfficer<{ id: string }>("compose", async (req, _o, { id }) => {
  const body = (await req.json()) as { altText?: string };
  const asset = await setAltText(getDb(), id, String(body.altText ?? ""));
  return asset ? json({ asset }) : json({ error: "Not found" }, 404);
});
