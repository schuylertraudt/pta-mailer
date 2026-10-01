import Link from "next/link";
import { getDb } from "@/db";
import { listArchive } from "@/lib/archive";
import PublicShell, { styles as s } from "@/components/public/PublicShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Past newsletters" };

export default async function ArchivePage() {
  const items = await listArchive(getDb());
  return (
    <PublicShell>
      <div className={s.intro}>
        <h1 className={s.h1}>Past newsletters</h1>
        <p className={s.lead}>
          Not getting these by email? <Link href="/">Subscribe</Link>.
        </p>
      </div>
      {items.length === 0 ? (
        <p className={s.small}>Nothing here yet.</p>
      ) : (
        <ul className={s.list}>
          {items.map((i) => (
            <li key={i.id} className={`${s.card} ${s.listItem}`} style={{ gap: 0 }}>
              <a href={`/archive/${i.id}`}>{i.subject}</a>
              <div className={s.meta}>
                {i.sentAt?.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                {i.preheader ? ` · ${i.preheader}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PublicShell>
  );
}
