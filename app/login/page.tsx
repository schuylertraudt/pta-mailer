import { cookies } from "next/headers";
import Link from "next/link";
import { signIn, signOut } from "@/auth";
import { getDb } from "@/db";
import { officerForSessionToken, SESSION_COOKIES } from "@/lib/auth/guard";
import PublicShell, { styles as s } from "@/components/public/PublicShell";

const MESSAGES: Record<string, string> = {
  not_allowed: "That Google account isn't on the team list. Ask a PTA admin to add your email.",
  unverified_email: "Google reports that email address as unverified.",
  account_mismatch:
    "Your email is linked to a different Google account. Ask an admin to re-add you if your account changed.",
  AccessDenied: "Access denied.",
  OAuthAccountNotLinked:
    "This browser was still logged in as a different team member. Click Sign in with Google again to switch accounts.",
  OAuthCallbackError:
    "Google didn't finish the login (it was cancelled, timed out, or the Google window was used twice). Click Sign in with Google again.",
  MissingCSRF: "The login form expired. Reload this page and try again.",
  Configuration:
    "Login isn't set up correctly on the server. A developer can find the reason with: sudo journalctl -u pta-web -n 50",
};

export const metadata = { title: "Team login" };

export default async function LoginPage(props: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await props.searchParams;
  const jar = await cookies();
  const current = await officerForSessionToken(getDb(), SESSION_COOKIES.map((n) => jar.get(n)?.value).find(Boolean));
  return (
    <PublicShell hideLogin>
      <div className={s.intro}>
        <h1 className={s.h1}>PTA team login</h1>
        <p className={s.lead}>
          Committee members and coordinators log in with their Google account. Parents don&apos;t need to log in.
        </p>
      </div>
      <form
        className={s.card}
        action={async () => {
          "use server";
          // A browser still logged in as one team member can't log in as another
          // (Auth.js refuses with OAuthAccountNotLinked), so end that session first.
          await signOut({ redirect: false });
          await signIn("google", { redirectTo: "/admin" });
        }}
      >
        {current && (
          <p className={s.lead} role="status">
            You&apos;re logged in as <strong>{current.email}</strong>. <Link href="/admin">Go to Messages</Link>, or sign in below to switch
            to a different Google account.
          </p>
        )}
        {error && (
          <p className={s.error} role="alert">
            {MESSAGES[error] ?? `Login failed (${error.slice(0, 40)}). Try again; if it keeps happening, an admin can check the server log.`}
          </p>
        )}
        <button type="submit" className={s.button}>
          Sign in with Google
        </button>
      </form>
    </PublicShell>
  );
}
