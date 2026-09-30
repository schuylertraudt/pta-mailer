import { createDb } from "@/db";
import { runMigrations } from "@/db/migrate";
import { ensureStarterTemplates } from "@/lib/templates/service";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, pool } = createDb(url);
await runMigrations(db);
await ensureStarterTemplates(db);
await pool.end();
console.log("Migrations applied; starter templates present.");
