import { getDb } from "@/db";
import { pageOfficerWith } from "@/lib/auth/page-guard";
import { SCHOOLS } from "@/lib/schools";
import { listSegmentsWithCounts } from "@/lib/segments/service";
import Forbidden from "@/components/admin/Forbidden";
import Segments from "@/components/admin/Segments";

export default async function SegmentsPage() {
  const { allowed } = await pageOfficerWith("send");
  if (!allowed) return <Forbidden />;
  const segments = await listSegmentsWithCounts(getDb());
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <h1>Audiences</h1>
      <p className="muted">Counts include only confirmed, active subscribers who aren&apos;t on the suppression list.</p>
      <Segments segments={segments.map((s) => ({ id: s.id, name: s.name, rule: s.rule, recipients: s.recipients }))} schools={[...SCHOOLS]} />
    </div>
  );
}
