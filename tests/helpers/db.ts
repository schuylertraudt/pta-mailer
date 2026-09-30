import { sql } from "drizzle-orm";
import { createDb } from "@/db";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pta_mailer_test";

export function testDb() {
  return createDb(TEST_DATABASE_URL);
}

export async function resetDb(db: ReturnType<typeof testDb>["db"]) {
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate ${list} restart identity cascade`));
}
