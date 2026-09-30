import { getDb } from "@/db";
import { env } from "@/lib/env";
import { confirmSubscription } from "@/lib/subscribers/service";

// Confirmation happens on POST (button on the confirm page) so link scanners
// that prefetch GET URLs cannot confirm on the subscriber's behalf.
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const result = await confirmSubscription(getDb(), token);
  const url = `${env().APP_URL}/confirm/${encodeURIComponent(token)}?result=${result}`;
  return Response.redirect(url, 303);
}
