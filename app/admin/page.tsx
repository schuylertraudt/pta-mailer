import Link from "next/link";
import { getDb } from "@/db";
import { listCampaigns } from "@/lib/campaigns/service";
import { listTemplates } from "@/lib/templates/service";
import NewCampaign from "@/components/admin/NewCampaign";

const LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
};

export default async function CampaignsPage() {
  const db = getDb();
  const [campaigns, templates] = await Promise.all([listCampaigns(db), listTemplates(db)]);
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Newsletters</h1>
        <NewCampaign templates={templates} />
      </div>
      <table className="list">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Status</th>
            <th>Created by</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/admin/campaigns/${c.id}`}>{c.subject || "(no subject)"}</Link>
              </td>
              <td>
                <span className="badge">{LABEL[c.status]}</span>
              </td>
              <td className="muted">{c.createdBy}</td>
              <td className="muted">{(c.sentAt ?? c.updatedAt).toLocaleString()}</td>
            </tr>
          ))}
          {campaigns.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No newsletters yet. Start one from a template above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
