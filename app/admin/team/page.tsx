import { getDb } from "@/db";
import { pageOfficerWith } from "@/lib/auth/page-guard";
import { listAudit, listOfficers } from "@/lib/officers/manage";
import Forbidden from "@/components/admin/Forbidden";
import Officers from "@/components/admin/Officers";

export default async function OfficersPage() {
  const { officer, allowed } = await pageOfficerWith("manage_officers");
  if (!allowed) return <Forbidden />;
  const db = getDb();
  const [officers, audit] = await Promise.all([listOfficers(db), listAudit(db)]);
  return (
    <div className="stack">
      <h1>Team</h1>
      <p className="muted">At least two active admins are always required. Team members are never deleted, only deactivated.</p>
      <Officers
        meId={officer.id}
        officers={officers.map((o) => ({ ...o, lastLoginAt: o.lastLoginAt?.toISOString() ?? null }))}
        audit={audit.map((a) => ({ ...a, timestamp: a.timestamp.toISOString() }))}
      />
    </div>
  );
}
