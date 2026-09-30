import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db";
import { assets, brandSettings } from "@/db/schema";
import type { BrandForRender } from "@/lib/render/email";

export const DEFAULT_BRAND_ROW = {
  primaryColor: "#1F4E79",
  accentColor: "#F2A900",
  footerText: "You're receiving this because you subscribed to PTA news.",
  ptaMailingAddress: "PTA mailing address not set. An admin must set it before sending.",
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #1F4E79");
export const brandInput = z.object({
  primaryColor: hex,
  accentColor: hex,
  footerText: z.string().trim().max(500),
  ptaMailingAddress: z.string().trim().min(5, "A physical mailing address is required by CAN-SPAM").max(300),
  logoAssetId: z.uuid().nullable(),
});

export async function getBrandRow(db: DbOrTx) {
  const [row] = await db.select().from(brandSettings).where(eq(brandSettings.id, true));
  return row ?? { id: true, logoAssetId: null, updatedBy: null, updatedAt: new Date(), ...DEFAULT_BRAND_ROW };
}

export async function loadBrand(db: DbOrTx): Promise<BrandForRender> {
  const row = await getBrandRow(db);
  const [logo] = row.logoAssetId ? await db.select().from(assets).where(eq(assets.id, row.logoAssetId)) : [];
  return {
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    footerText: row.footerText,
    ptaMailingAddress: row.ptaMailingAddress,
    logoUrl: logo?.publicUrl ?? null,
    logoAlt: logo?.altText || "PTA",
    // Stored at up to 2x; display at half the pixel width, capped for the header.
    logoWidth: logo ? Math.min(240, Math.round(logo.width / 2)) : null,
  };
}

export async function saveBrand(db: DbOrTx, input: z.input<typeof brandInput>, officerId: string) {
  const v = brandInput.parse(input);
  await db
    .insert(brandSettings)
    .values({ id: true, ...v, updatedBy: officerId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: brandSettings.id, set: { ...v, updatedBy: officerId, updatedAt: new Date() } });
}
