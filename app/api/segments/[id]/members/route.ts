import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { json } from "@/lib/http";
import { addMembers, listMembers, removeMember } from "@/lib/segments/service";

type P = { id: string };

export const GET = withOfficer<P>("send", async (_req, _o, { id }) => json({ members: await listMembers(getDb(), id) }));

export const POST = withOfficer<P>("send", async (req, _o, { id }) => {
  const body = (await req.json()) as { emails?: string };
  const emails = String(body.emails ?? "").split(/[\s,;]+/);
  return json(await addMembers(getDb(), id, emails));
});

export const DELETE = withOfficer<P>("send", async (req, _o, { id }) => {
  const body = (await req.json()) as { email?: string };
  await removeMember(getDb(), id, String(body.email ?? ""));
  return json({ ok: true });
});
