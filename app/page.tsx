import Link from "next/link";
import { issueFormToken } from "@/lib/subscribers/form-token";
import { SCHOOLS } from "@/lib/schools";
import { env } from "@/lib/env";
import SubscribeForm from "@/components/SubscribeForm";

export const dynamic = "force-dynamic";

export default function SubscribePage() {
  return (
    <main className="narrow">
      <h1>Get PTA News</h1>
      <p className="muted">
        School news, events, and volunteer requests from the PTA, by email. No account needed. Unsubscribe any time
        with one click.
      </p>
      <div className="card">
        <SubscribeForm
          formToken={issueFormToken()}
          schools={[...SCHOOLS]}
          turnstileSiteKey={env().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        />
      </div>
      <p className="muted" style={{ fontSize: 14 }}>
        We only store your email and your home school, so we can send news that applies to you. We never ask for
        children&apos;s names. <Link href="/archive">Past newsletters</Link>
      </p>
      <p className="muted" style={{ fontSize: 13, marginTop: 32, textAlign: "center" }}>
        <Link href="/login" style={{ color: "inherit" }}>
          Team sign-in
        </Link>
      </p>
    </main>
  );
}
