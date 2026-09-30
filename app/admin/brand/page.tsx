import { getDb } from "@/db";
import { pageOfficerWith } from "@/lib/auth/page-guard";
import { getBrandRow, loadBrand } from "@/lib/brand";
import BrandForm from "@/components/admin/BrandForm";
import Forbidden from "@/components/admin/Forbidden";

export default async function BrandPage() {
  const { allowed } = await pageOfficerWith("manage_brand");
  if (!allowed) return <Forbidden />;
  const db = getDb();
  const [row, brand] = await Promise.all([getBrandRow(db), loadBrand(db)]);
  return (
    <div className="stack" style={{ maxWidth: 700 }}>
      <h1>Brand settings</h1>
      <BrandForm
        brand={{
          primaryColor: row.primaryColor,
          accentColor: row.accentColor,
          footerText: row.footerText,
          ptaMailingAddress: row.ptaMailingAddress,
          logoAssetId: row.logoAssetId,
        }}
        logoUrl={brand.logoUrl}
      />
    </div>
  );
}
