import type { Db } from "@/db";
import { brandSettings, campaigns } from "@/db/schema";
import type { Doc } from "@/lib/editor/model";
import { BLOCKS, docOf } from "./docs";

export async function realBrand(db: Db) {
  await db
    .insert(brandSettings)
    .values({ primaryColor: "#1F4E79", accentColor: "#F2A900", footerText: "Thanks for reading.", ptaMailingAddress: "Example PTA, 1 Main St, Town, ST 00000" })
    .onConflictDoNothing();
}

export async function makeCampaign(db: Db, createdBy: string, over: Partial<typeof campaigns.$inferInsert> & { body?: Doc } = {}) {
  const { body, ...rest } = over;
  const [c] = await db
    .insert(campaigns)
    .values({ subject: "PTA News", preheader: "This month", bodyJson: body ?? docOf(BLOCKS.heading1, BLOCKS.paragraph, BLOCKS.button), createdBy, ...rest })
    .returning();
  return c;
}
