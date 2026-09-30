import Link from "next/link";
import { getDb } from "@/db";
import { findPendingByConfirmToken } from "@/lib/subscribers/service";

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
      <main className="narrow">
        <h1>You&apos;re subscribed</h1>
        <p>Thanks! You&apos;ll get the next PTA newsletter. Every email has a one-click unsubscribe link.</p>
      </main>
    );
  }
  const pending = result === "invalid" ? undefined : await findPendingByConfirmToken(getDb(), token);
  if (!pending) {
    return (
      <main className="narrow">
        <h1>Link expired or already used</h1>
        <p>
          If you already confirmed, you&apos;re all set. Otherwise, <Link href="/">subscribe again</Link> to get a new
          link.
        </p>
      </main>
    );
  }
  return (
    <main className="narrow">
      <h1>Confirm your subscription</h1>
      <p>One more tap and you&apos;ll start receiving PTA news.</p>
      <form method="post" action={`/api/confirm/${encodeURIComponent(token)}`}>
        <button type="submit" className="full">
          Confirm subscription
        </button>
      </form>
    </main>
  );
}
