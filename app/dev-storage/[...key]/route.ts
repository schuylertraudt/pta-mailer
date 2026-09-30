import { env } from "@/lib/env";
import { getStorage, MemoryStorage } from "@/lib/storage";

/** Serves in-memory uploads for local development only (STORAGE_DRIVER=memory). */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  if (env().STORAGE_DRIVER !== "memory") return new Response("Not found", { status: 404 });
  const storage = getStorage();
  const obj = storage instanceof MemoryStorage ? storage.objects.get((await ctx.params).key.join("/")) : undefined;
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(obj.body), { headers: { "content-type": obj.contentType } });
}
