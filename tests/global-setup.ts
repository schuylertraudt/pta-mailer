import { sql } from "drizzle-orm";
import { runMigrations } from "@/db/migrate";
import { testDb } from "./helpers/db";

// Rebuilds the test database from migrations once per run, so tests exercise
// the same SQL that production runs.
export default async function setup() {
  const { db, pool } = testDb();
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  await pool.end();
}
