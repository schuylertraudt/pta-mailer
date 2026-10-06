import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { json } from "@/lib/http";
import { currentPause } from "@/lib/mail/active";
import { campaignLinks, campaignStats } from "@/lib/queue/enqueue";

export const GET = withOfficer<{ id: string }>("compose", async (_req, _o, { id }) => {
  const db = getDb();
  const [stats, links, pause] = await Promise.all([campaignStats(db, id), campaignLinks(db, id), currentPause(db)]);
  return json({ stats, links, pause });
});
