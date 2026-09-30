import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db";
import { templates } from "@/db/schema";
import { sanitizeDoc } from "@/lib/editor/sanitize";
import { env } from "@/lib/env";
import { STARTER_TEMPLATES } from "./starters";

export const templateInput = z.object({ name: z.string().trim().min(1).max(100), bodyJson: z.unknown() });

export async function ensureStarterTemplates(db: DbOrTx) {
  for (const s of STARTER_TEMPLATES) {
    await db.insert(templates).values({ id: s.id, name: s.name, bodyJson: s.body, createdBy: null }).onConflictDoNothing();
  }
}

export const isStarter = (id: string) => STARTER_TEMPLATES.some((s) => s.id === id);

export async function listTemplates(db: DbOrTx) {
  return db
    .select({ id: templates.id, name: templates.name, createdBy: templates.createdBy, updatedAt: templates.updatedAt })
    .from(templates)
    .orderBy(isNull(templates.createdBy), desc(templates.updatedAt));
}

export async function getTemplate(db: DbOrTx, id: string) {
  const [row] = await db.select().from(templates).where(eq(templates.id, id));
  return row;
}

export async function createTemplate(db: DbOrTx, raw: z.input<typeof templateInput>, officerId: string) {
  const v = templateInput.parse(raw);
  const [row] = await db
    .insert(templates)
    .values({ name: v.name, bodyJson: sanitizeDoc(v.bodyJson, env().STORAGE_PUBLIC_BASE_URL), createdBy: officerId })
    .returning();
  return row;
}

export async function deleteTemplate(db: DbOrTx, id: string) {
  if (isStarter(id)) throw new Error("Starter templates can't be deleted");
  await db.delete(templates).where(eq(templates.id, id));
}
