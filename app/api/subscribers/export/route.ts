import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { exportSubscribersCsv, filterFromSearchParams } from "@/lib/subscribers/admin";

/** Admin only. Same filters as the list; exports all matching rows. */
export const GET = withOfficer("manage_subscribers", async (req, officer) => {
  const { csv } = await exportSubscribersCsv(getDb(), officer.id, filterFromSearchParams(new URL(req.url).searchParams));
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="pta-subscribers-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
});
