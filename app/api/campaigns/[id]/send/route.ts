import { after } from "next/server";
import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { json, toResponse } from "@/lib/http";
import { enqueueCampaign } from "@/lib/queue/enqueue";
import { runQueueOnce } from "@/lib/queue/run";

export const maxDuration = 60;

/** Sender/admin only. Drafters get 403 from the guard before anything runs. */
export const POST = withOfficer<{ id: string }>("send", async (_req, officer, { id }) => {
  try {
    const result = await enqueueCampaign(getDb(), id, officer.id);
    // Start delivering now; the cron job picks up anything left over.
    after(() => runQueueOnce().catch((e) => console.error("queue run failed", e)));
    return json(result, 202);
  } catch (e) {
    return toResponse(e);
  }
});
