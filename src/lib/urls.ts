import { env } from "@/lib/env";

export const UNSUBSCRIBE_TOKEN_PLACEHOLDER = "__UNSUBSCRIBE_TOKEN__";

const base = () => env().APP_URL;

/** Footer link target: a page with a single Unsubscribe button. */
export const unsubscribePageUrl = (token: string) => `${base()}/u/${encodeURIComponent(token)}`;
/** RFC 8058 one-click endpoint (List-Unsubscribe https target). Accepts POST. */
export const unsubscribeApiUrl = (token: string) => `${base()}/api/unsubscribe/${encodeURIComponent(token)}`;
export const confirmPageUrl = (token: string) => `${base()}/confirm/${encodeURIComponent(token)}`;
export const subscribePageUrl = () => `${base()}/`;
export const archiveUrl = (id: string) => `${base()}/archive/${id}`;

/**
 * Headers required on every bulk (campaign) email: mailto + https unsubscribe
 * targets and the RFC 8058 one-click marker.
 */
export function listUnsubscribeHeaders(token: string): Record<string, string> {
  const targets = [`<${unsubscribeApiUrl(token)}>`];
  const mailto = env().UNSUBSCRIBE_MAILTO;
  if (mailto) targets.unshift(`<mailto:${mailto}?subject=unsubscribe%20${encodeURIComponent(token)}>`);
  return {
    "List-Unsubscribe": targets.join(", "),
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
