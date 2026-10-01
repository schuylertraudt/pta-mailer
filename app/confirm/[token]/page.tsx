import Link from "next/link";
import { getDb } from "@/db";
import { findPendingByConfirmToken } from "@/lib/subscribers/service";
import PublicShell, { CheckIcon, MailIcon, styles as s } from "@/components/public/PublicShell";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default async function ConfirmPage(props: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { token } = await props.params;
  const { result } = await props.searchParams;

  if (result === "confirmed") {
    return (
      <PublicShell>
        <div className={s.status}>
          <CheckIcon />
          <h1 className={s.h1}>You&apos;re subscribed</h1>
          <p className={s.lead}>Thanks! You&apos;ll get the next PTA message. Every email has a one-click unsubscribe link.</p>
        </div>
      </PublicShell>
    );
  }
  const pending = result === "invalid" ? undefined : await findPendingByConfirmToken(getDb(), token);
  if (!pending) {
    return (
      <PublicShell>
        <div className={s.status}>
          <h1 className={s.h1}>Link expired or already used</h1>
          <p className={s.lead}>
            If you already confirmed, you&apos;re all set. Otherwise, <Link href="/">subscribe again</Link> to get a new link.
          </p>
        </div>
      </PublicShell>
    );
  }
  // POST (not the GET that loaded this page) confirms, so mail scanners that open links can't.
  return (
    <PublicShell>
      <div className={s.status}>
        <MailIcon />
        <h1 className={s.h1}>Confirm your subscription</h1>
        <p className={s.lead}>One more tap and you&apos;ll start receiving PTA news.</p>
        <form method="post" action={`/api/confirm/${encodeURIComponent(token)}`} style={{ width: "100%" }}>
          <button type="submit" className={s.button}>
            Confirm subscription
          </button>
        </form>
      </div>
    </PublicShell>
  );
}
