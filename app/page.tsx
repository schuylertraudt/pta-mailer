import { issueFormToken } from "@/lib/subscribers/form-token";
import { SCHOOLS } from "@/lib/schools";
import { SITE } from "@/lib/site";
import { env } from "@/lib/env";
import SubscribeForm from "@/components/SubscribeForm";
import PublicShell from "@/components/public/PublicShell";

export const dynamic = "force-dynamic";

export default function SubscribePage() {
  return (
    <PublicShell>
      <SubscribeForm
        formToken={issueFormToken()}
        schools={[...SCHOOLS]}
        turnstileSiteKey={env().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        title={SITE.title}
        intro={SITE.intro}
      />
    </PublicShell>
  );
}
