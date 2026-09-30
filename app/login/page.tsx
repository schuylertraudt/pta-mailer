import { signIn } from "@/auth";

const MESSAGES: Record<string, string> = {
  not_allowed: "That Google account isn't on the team list. Ask a PTA admin to add your email.",
  unverified_email: "Google reports that email address as unverified.",
  account_mismatch:
    "Your email is linked to a different Google account. Ask an admin to re-add you if your account changed.",
  AccessDenied: "Access denied.",
};

export default async function LoginPage(props: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await props.searchParams;
  return (
    <main className="narrow">
      <h1>PTA team login</h1>
      <p className="muted">Committee members and coordinators log in with their Google account. Parents don&apos;t need to log in.</p>
      {error && (
        <p className="error" role="alert">
          {MESSAGES[error] ?? "Login failed."}
        </p>
      )}
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/admin" });
        }}
      >
        <button type="submit" className="full">
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
