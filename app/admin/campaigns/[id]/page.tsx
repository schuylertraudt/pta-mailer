import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { pageOfficer } from "@/lib/auth/page-guard";
import { loadBrand } from "@/lib/brand";
import { CampaignError, getCampaign } from "@/lib/campaigns/service";
import { palette } from "@/lib/editor/model";
import { listSegmentsWithCounts } from "@/lib/segments/service";
import Composer from "@/components/admin/Composer";

export default async function CampaignPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const officer = await pageOfficer();
  const db = getDb();
  let campaign;
  try {
    campaign = await getCampaign(db, id);
  } catch (e) {
    if (e instanceof CampaignError) notFound();
    throw e;
  }
  const [segments, brand] = await Promise.all([listSegmentsWithCounts(db), loadBrand(db)]);
  return (
    <Composer
      key={`${campaign.id}:${campaign.status}`}
      campaign={{
        id: campaign.id,
        subject: campaign.subject,
        preheader: campaign.preheader,
        bodyJson: campaign.bodyJson,
        segmentId: campaign.segmentId,
        showInArchive: campaign.showInArchive,
        status: campaign.status,
      }}
      segments={segments.map((s) => ({ id: s.id, name: s.name, recipients: s.recipients }))}
      role={officer.role}
      palette={palette(brand)}
    />
  );
}
