import Link from "next/link";
import { getDb } from "@/db";
import { segments as segmentsTable } from "@/db/schema";
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
  const [campaigns, templates, segments] = await Promise.all([listCampaigns(db), listTemplates(db), db.select({ id: segmentsTable.id, name: segmentsTable.name }).from(segmentsTable)]);
  const names = new Map(segments.map((s) => [s.id, s.name]));
  return (
    <div className="composer">
      <div className="page-head">
        <h1>Messages</h1>
        <NewCampaign templates={templates} />
      </div>
      <section className="panel" style={{ paddingTop: 12, overflowX: "auto" }}>
        <table className="list">
          <thead>
            <tr>
              <th>Subject</th>
              <th>To</th>
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
                <td className="muted">{c.segmentIds.map((id) => names.get(id) ?? "(deleted audience)").join(", ") || "Nobody yet"}</td>
                <td>
                  <span className="badge">{LABEL[c.status]}</span>
                </td>
                <td className="muted">{c.createdBy}</td>
                <td className="muted">{(c.sentAt ?? c.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No messages yet. Start one with New Message.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
