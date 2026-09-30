import { getDb } from "@/db";
import { ARCHIVE_CSP, getArchivedHtml } from "@/lib/archive";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const html = await getArchivedHtml(getDb(), id);
  if (!html) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": ARCHIVE_CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "public, max-age=300",
    },
  });
}
