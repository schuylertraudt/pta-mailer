import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { json, toResponse } from "@/lib/http";
import { deleteTemplate, getTemplate, isStarter } from "@/lib/templates/service";

export const GET = withOfficer<{ id: string }>("compose", async (_req, _o, { id }) => {
  const t = await getTemplate(getDb(), id);
  return t ? json({ template: t }) : json({ error: "Not found" }, 404);
});

export const DELETE = withOfficer<{ id: string }>("compose", async (_req, _o, { id }) => {
  if (isStarter(id)) return json({ error: "Starter templates can't be deleted." }, 409);
  try {
    await deleteTemplate(getDb(), id);
    return json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
});
