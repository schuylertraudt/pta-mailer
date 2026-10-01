import Link from "next/link";
import { getDb } from "@/db";
import { findByUnsubscribeToken } from "@/lib/subscribers/service";
import PublicShell, { CheckIcon, styles as s } from "@/components/public/PublicShell";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default async function UnsubscribePage(props: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { token } = await props.params;
  const { result } = await props.searchParams;

  if (result === "unsubscribed") {
    return (
      <PublicShell>
        <div className={s.status}>
          <CheckIcon />
          <h1 className={s.h1}>You&apos;re unsubscribed</h1>
          <p className={s.lead}>You won&apos;t receive any more PTA newsletters at this address.</p>
          <p className={s.small}>
            Changed your mind? <Link href="/">Subscribe again</Link>.
          </p>
        </div>
      </PublicShell>
    );
  }
  const sub = token === "preview" ? undefined : await findByUnsubscribeToken(getDb(), token);
  if (!sub) {
    return (
      <PublicShell>
        <div className={s.status}>
          <h1 className={s.h1}>Unsubscribe</h1>
          <p className={s.lead}>
            This unsubscribe link isn&apos;t valid. If you keep getting emails, reply to one and we&apos;ll remove you.
          </p>
        </div>
      </PublicShell>
    );
  }
  // One button, no login, no questions. A POST (not the GET that loaded this page)
  // does the unsubscribe, so corporate link scanners can't unsubscribe people.
  return (
    <PublicShell>
      <div className={s.status}>
        <h1 className={s.h1}>Unsubscribe from PTA news?</h1>
        <p className={s.lead}>You&apos;ll stop receiving PTA newsletters at this address.</p>
        <form method="post" action={`/api/unsubscribe/${encodeURIComponent(token)}`} style={{ width: "100%" }}>
          <button type="submit" className={s.button}>
            Unsubscribe
          </button>
        </form>
      </div>
    </PublicShell>
  );
}
