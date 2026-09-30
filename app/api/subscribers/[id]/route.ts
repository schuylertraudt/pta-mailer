import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { json } from "@/lib/http";
import { deleteSubscriber, SubscriberNotFound } from "@/lib/subscribers/admin";

/** Admin only. Body: { suppress: boolean } (default true). */
export const DELETE = withOfficer<{ id: string }>("manage_subscribers", async (req, officer, { id }) => {
  const body = (await req.json().catch(() => ({}))) as { suppress?: boolean };
  try {
    await deleteSubscriber(getDb(), officer.id, id, { suppress: body.suppress !== false });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof SubscriberNotFound) return json({ error: e.message }, 404);
    throw e;
  }
});
