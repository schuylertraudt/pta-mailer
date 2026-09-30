import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { json } from "@/lib/http";
import { campaignStats } from "@/lib/queue/enqueue";

export const GET = withOfficer<{ id: string }>("compose", async (_req, _o, { id }) => json({ stats: await campaignStats(getDb(), id) }));
