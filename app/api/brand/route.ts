import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { getBrandRow, saveBrand } from "@/lib/brand";
import { json, toResponse } from "@/lib/http";

export const GET = withOfficer("compose", async () => json({ brand: await getBrandRow(getDb()) }));

export const PUT = withOfficer("manage_brand", async (req, officer) => {
  try {
    await saveBrand(getDb(), await req.json(), officer.id);
    return json({ brand: await getBrandRow(getDb()) });
  } catch (e) {
    return toResponse(e);
  }
});
