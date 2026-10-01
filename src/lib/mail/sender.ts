import { env } from "@/lib/env";

/** Splits EMAIL_FROM ("PTA News <news@x.org>" or a bare address) into name and address. */
export function parseFrom(from: string): { name: string; address: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].trim(), address: m[2].trim() } : { name: "", address: from.trim() };
}

/**
 * A From display name safe to put in a header: no quotes, angle brackets,
 * backslashes or control characters (which could forge an address or a header),
 * whitespace collapsed, at most 64 characters.
 */
export function cleanSenderName(v: string): string {
  return v
    .replace(/[\p{Cc}\p{Cf}"<>\\]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
    .trim();
}

export function defaultSenderName(): string {
  return parseFrom(env().EMAIL_FROM).name;
}

/** The From header for a message: its own display name on the EMAIL_FROM address. */
export function fromHeader(name: string): string {
  const clean = cleanSenderName(name);
  if (!clean) return env().EMAIL_FROM;
  return `"${clean}" <${parseFrom(env().EMAIL_FROM).address}>`;
}
