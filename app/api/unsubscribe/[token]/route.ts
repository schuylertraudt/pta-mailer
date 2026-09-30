import { getDb } from "@/db";
import { env } from "@/lib/env";
import { unsubscribeByToken } from "@/lib/subscribers/service";

/**
 * Handles both:
 *  - RFC 8058 one-click (mail client POSTs "List-Unsubscribe=One-Click"), answered with 200.
 *  - The Unsubscribe button on /u/[token], answered with a redirect back to the page.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const body = await req.text().catch(() => "");
  const params = new URLSearchParams(body);
  const oneClick = params.get("List-Unsubscribe") === "One-Click";

  const result = await unsubscribeByToken(getDb(), token, oneClick ? "one-click" : "link");

  if (oneClick) {
    return new Response(result === "unsubscribed" ? "Unsubscribed" : "Unknown token", {
      status: result === "unsubscribed" ? 200 : 404,
      headers: { "content-type": "text/plain" },
    });
  }
  return Response.redirect(`${env().APP_URL}/u/${encodeURIComponent(token)}?result=${result}`, 303);
}
