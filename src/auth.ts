import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getDb } from "@/db";
import { officerAdapter } from "@/lib/auth/adapter";
import { authorizeGoogleSignIn } from "@/lib/auth/sign-in";

// Behind a reverse proxy (nginx), Next.js sees requests as http://localhost:<port>.
// Auth.js would then give Google a localhost callback URL and redirect errors
// there. Pin it to the public address unless AUTH_URL is set explicitly.
process.env.AUTH_URL ??= process.env.APP_URL;

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: officerAdapter(getDb()),
  trustHost: true,
  session: { strategy: "database", maxAge: 7 * 24 * 3600, updateAge: 24 * 3600 },
  providers: [
    Google({
      // Identity only. No Gmail API scopes, ever.
      authorization: { params: { scope: "openid email profile", prompt: "select_account" } },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google" || !profile) return false;
      const decision = await authorizeGoogleSignIn(getDb(), {
        sub: account.providerAccountId,
        email: profile.email,
        emailVerified: (profile as { email_verified?: boolean }).email_verified,
      });
      return decision.ok ? true : `/login?error=${decision.reason}`;
    },
  },
}));
