import { signIn } from "@/auth";
import PublicShell, { styles as s } from "@/components/public/PublicShell";

const MESSAGES: Record<string, string> = {
  not_allowed: "That Google account isn't on the team list. Ask a PTA admin to add your email.",
  unverified_email: "Google reports that email address as unverified.",
  account_mismatch:
    "Your email is linked to a different Google account. Ask an admin to re-add you if your account changed.",
  AccessDenied: "Access denied.",
  Configuration:
    "Login isn't set up correctly on the server. A developer can find the reason with: sudo journalctl -u pta-web -n 50",
};

export const metadata = { title: "Team login" };

export default async function LoginPage(props: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await props.searchParams;
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
          await signIn("google", { redirectTo: "/admin" });
        }}
      >
        {error && (
          <p className={s.error} role="alert">
            {MESSAGES[error] ?? "Login failed."}
          </p>
        )}
        <button type="submit" className={s.button}>
          Sign in with Google
        </button>
      </form>
    </PublicShell>
  );
}
