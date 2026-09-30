import { createDb } from "@/db";
import { bootstrapAdminFromEnv } from "@/lib/officers/bootstrap";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, pool } = createDb(url);
const result = await bootstrapAdminFromEnv(db);
await pool.end();
console.log(
  {
    unconfigured: "BOOTSTRAP_ADMIN_EMAIL is not set; nothing to do.",
    disabled: "An active admin already exists; bootstrap is disabled.",
    created: "Bootstrap admin created. Sign in with Google using that address.",
    promoted: "Existing officer promoted to admin and reactivated.",
  }[result.status],
);
