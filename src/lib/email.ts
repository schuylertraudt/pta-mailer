import { z } from "zod";

/** Canonical form for every stored email address: trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform(normalizeEmail);
