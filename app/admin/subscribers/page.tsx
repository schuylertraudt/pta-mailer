import Link from "next/link";
import { getDb } from "@/db";
import { pageOfficerWith } from "@/lib/auth/page-guard";
import { can } from "@/lib/auth/roles";
import { GRADES } from "@/lib/grades";
import { filterFromSearchParams, listDataAudit, searchSubscribers, statusCounts, type SubscriberFilter } from "@/lib/subscribers/admin";
import DeleteSubscriber from "@/components/admin/DeleteSubscriber";
import Forbidden from "@/components/admin/Forbidden";

const STATUS: Record<string, string> = {
  active: "Active",
  pending: "Awaiting confirmation",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  complained: "Marked as spam",
};

function qs(f: SubscriberFilter, over: Partial<SubscriberFilter> = {}) {
  const m = { ...f, ...over };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(m)) if (v && !(k === "page" && v === 1)) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function SubscribersPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { officer, allowed } = await pageOfficerWith("view_subscribers");
  if (!allowed) return <Forbidden />;
  const manage = can(officer.role, "manage_subscribers");
  const db = getDb();
  const sp = await props.searchParams;
  let filter: SubscriberFilter;
  try {
    filter = filterFromSearchParams(sp);
  } catch {
    filter = filterFromSearchParams({});
  }
  const [result, counts, audit] = await Promise.all([
    searchSubscribers(db, filter),
    statusCounts(db),
    manage ? listDataAudit(db, 20) : Promise.resolve([]),
  ]);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Subscribers</h1>
        {manage && (
          <a className="btn secondary" href={`/api/subscribers/export${qs(filter, { page: 1 })}`}>
            Export {result.total} to CSV
          </a>
        )}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {Object.entries(STATUS)
          .map(([k, label]) => `${label}: ${counts[k as keyof typeof counts] ?? 0}`)
          .join(" · ")}
      </p>

      <form method="get" className="card row" style={{ alignItems: "flex-end" }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label htmlFor="q">Email contains</label>
          <input id="q" name="q" defaultValue={filter.q} type="search" />
        </div>
        <div>
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={filter.status}>
            <option value="">Any</option>
            {Object.entries(STATUS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="grade">Grade</label>
          <select id="grade" name="grade" defaultValue={filter.grade}>
            <option value="">Any</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor="teacher">Teacher contains</label>
          <input id="teacher" name="teacher" defaultValue={filter.teacher} />
        </div>
        <button type="submit">Search</button>
        <Link href="/admin/subscribers" className="btn secondary">
          Clear
        </Link>
      </form>

      <p className="muted" style={{ margin: 0 }}>
        {result.total} match{result.total === 1 ? "" : "es"}
        {result.pages > 1 && ` · page ${result.page} of ${result.pages}`}
      </p>
      <table className="list">
        <thead>
          <tr>
            <th>Email</th>
            <th>Grade</th>
            <th>Teacher</th>
            <th>Status</th>
            <th>Signed up</th>
            {manage && <th />}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((s) => (
            <tr key={s.id}>
              <td>{s.email}</td>
              <td>{s.grade ?? "—"}</td>
              <td>{s.teacher ?? "—"}</td>
              <td>
                {STATUS[s.status]}
                {s.suppression && s.status === "active" && (
                  <span className="badge warn" style={{ marginLeft: 6 }} title="On the do-not-mail list: won't receive campaigns">
                    do not mail
                  </span>
                )}
              </td>
              <td className="muted">{s.createdAt.toLocaleDateString()}</td>
              {manage && (
                <td>
                  <DeleteSubscriber id={s.id} email={s.email} />
                </td>
              )}
            </tr>
          ))}
          {result.rows.length === 0 && (
            <tr>
              <td colSpan={manage ? 6 : 5} className="muted">
                No subscribers match.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {result.pages > 1 && (
        <div className="row">
          {result.page > 1 && <Link href={`/admin/subscribers${qs(filter, { page: result.page - 1 })}`}>← Previous</Link>}
          {result.page < result.pages && <Link href={`/admin/subscribers${qs(filter, { page: result.page + 1 })}`}>Next →</Link>}
        </div>
      )}

      {manage && (
        <>
          <h2>Deletions and exports</h2>
          <table className="list">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>By</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="muted">{a.timestamp.toLocaleString()}</td>
                  <td>{a.action === "subscriber_delete" ? "Deleted a subscriber" : "Exported subscribers"}</td>
                  <td>{a.actorEmail}</td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {a.action === "subscriber_export"
                      ? `${String(a.details.count)} rows`
                      : a.details.suppressed
                        ? "added to do-not-mail list"
                        : "may re-subscribe"}
                  </td>
                </tr>
              ))}
              {audit.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    None yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
