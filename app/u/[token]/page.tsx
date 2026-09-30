import Link from "next/link";
import { getDb } from "@/db";
import { findByUnsubscribeToken } from "@/lib/subscribers/service";

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
      <main className="narrow">
        <h1>You&apos;re unsubscribed</h1>
        <p>You won&apos;t receive any more PTA newsletters at this address.</p>
        <p className="muted">
          Changed your mind? <Link href="/">Subscribe again</Link>.
        </p>
      </main>
    );
  }
  const sub = token === "preview" ? undefined : await findByUnsubscribeToken(getDb(), token);
  if (!sub) {
    return (
      <main className="narrow">
        <h1>Unsubscribe</h1>
        <p>This unsubscribe link isn&apos;t valid. If you keep getting emails, reply to one and we&apos;ll remove you.</p>
      </main>
    );
  }
  // One button, no login, no questions. A POST (not the GET that loaded this page)
  // does the unsubscribe, so corporate link scanners can't unsubscribe people.
  return (
    <main className="narrow">
      <h1>Unsubscribe from PTA News?</h1>
      <form method="post" action={`/api/unsubscribe/${encodeURIComponent(token)}`}>
        <button type="submit" className="full">
          Unsubscribe
        </button>
      </form>
    </main>
  );
}
