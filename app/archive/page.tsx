import Link from "next/link";
import { getDb } from "@/db";
import { listArchive } from "@/lib/archive";

export const dynamic = "force-dynamic";
export const metadata = { title: "PTA News Archive" };

export default async function ArchivePage() {
  const items = await listArchive(getDb());
  return (
    <main className="narrow">
      <h1>Past newsletters</h1>
      <p>
        <Link href="/">Subscribe to PTA News</Link>
      </p>
      {items.length === 0 ? (
        <p className="muted">Nothing here yet.</p>
      ) : (
        <ul style={{ paddingLeft: 0, listStyle: "none" }} className="stack">
          {items.map((i) => (
            <li key={i.id} className="card">
              <a href={`/archive/${i.id}`}>
                <strong>{i.subject}</strong>
              </a>
              <div className="muted" style={{ fontSize: 14 }}>
                {i.sentAt?.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                {i.preheader ? ` · ${i.preheader}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
