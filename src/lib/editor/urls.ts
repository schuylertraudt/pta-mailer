const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/** Returns a normalized link URL or null if it is not an allowed absolute link. */
export function safeLinkUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 2000) return null;
  try {
    const u = new URL(v);
    if (!LINK_PROTOCOLS.has(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Image sources must be https URLs under the configured storage base. */
export function safeImageUrl(raw: unknown, storageBase: string): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw.trim());
    const base = new URL(storageBase.replace(/\/+$/, "") + "/");
    if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) return null;
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}
