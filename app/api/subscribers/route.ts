import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { json } from "@/lib/http";
import { filterFromSearchParams, searchSubscribers } from "@/lib/subscribers/admin";

export const GET = withOfficer("view_subscribers", async (req) =>
  json(await searchSubscribers(getDb(), filterFromSearchParams(new URL(req.url).searchParams))),
);
