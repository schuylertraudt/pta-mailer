import { createDb } from "@/db";
import { seed } from "@/db/seed";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "1") {
  throw new Error("Refusing to seed a production database (set ALLOW_PRODUCTION_SEED=1 to override).");
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, pool } = createDb(url);
await seed(db);
await pool.end();
console.log("Seed complete.");
