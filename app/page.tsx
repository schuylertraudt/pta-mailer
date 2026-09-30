import Link from "next/link";
import { issueFormToken } from "@/lib/subscribers/form-token";
import { GRADES } from "@/lib/grades";
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
          grades={[...GRADES]}
          turnstileSiteKey={env().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        />
      </div>
      <p className="muted" style={{ fontSize: 14 }}>
        We only store your email, and your child&apos;s grade and teacher so we can send relevant news. We never ask
        for children&apos;s names. <Link href="/archive">Past newsletters</Link>
      </p>
    </main>
  );
}
