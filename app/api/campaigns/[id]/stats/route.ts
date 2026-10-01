import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { json } from "@/lib/http";
import { campaignLinks, campaignStats } from "@/lib/queue/enqueue";

export const GET = withOfficer<{ id: string }>("compose", async (_req, _o, { id }) => {
  const db = getDb();
  const [stats, links] = await Promise.all([campaignStats(db, id), campaignLinks(db, id)]);
  return json({ stats, links });
});
