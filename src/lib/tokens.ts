import { randomBytes } from "node:crypto";

/** 256-bit random token, base64url (43 chars). Used for confirm/unsubscribe links. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
