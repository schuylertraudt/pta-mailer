import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";

// Arbitrary constant; serializes every change to the set of active admins
// (bootstrap, deactivation, demotion) so the two-admin floor cannot race.
const ADMIN_SET_LOCK_KEY = 0x70_74_61_01;

/** Must be called inside a transaction; released at commit/rollback. */
export async function lockAdminSet(tx: DbOrTx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_SET_LOCK_KEY})`);
}
