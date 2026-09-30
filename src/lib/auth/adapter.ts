import type { Adapter, AdapterUser } from "next-auth/adapters";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db";
import { officers, sessions } from "@/db/schema";
import { normalizeEmail } from "@/lib/email";

type OfficerRow = typeof officers.$inferSelect;

const toUser = (o: OfficerRow): AdapterUser => ({
  id: o.id,
  email: o.email,
  name: o.name,
  emailVerified: null,
});

/**
 * Auth.js adapter where the officers table is the user table and google_sub is
 * the account link. It never creates users: the signIn callback admits only
 * pre-authorized officers and binds google_sub before Auth.js looks the account up.
 */
export function officerAdapter(db: Db): Adapter {
  return {
    async createUser() {
      throw new Error("Officers are added by an admin, never created at sign-in");
    },
    async getUser(id) {
      const [o] = await db.select().from(officers).where(and(eq(officers.id, id), eq(officers.active, true)));
      return o ? toUser(o) : null;
    },
    async getUserByEmail(email) {
      const [o] = await db
        .select()
        .from(officers)
        .where(and(eq(officers.email, normalizeEmail(email)), eq(officers.active, true)));
      return o ? toUser(o) : null;
    },
    async getUserByAccount({ provider, providerAccountId }) {
      if (provider !== "google") return null;
      const [o] = await db
        .select()
        .from(officers)
        .where(and(eq(officers.googleSub, providerAccountId), eq(officers.active, true)));
      return o ? toUser(o) : null;
    },
    async updateUser(user) {
      const [o] = await db.select().from(officers).where(eq(officers.id, user.id));
      return toUser(o);
    },
    async linkAccount() {
      // Binding happens in authorizeGoogleSignIn.
    },
    async createSession(s) {
      await db.insert(sessions).values({ sessionToken: s.sessionToken, officerId: s.userId, expires: s.expires });
      return s;
    },
    async getSessionAndUser(sessionToken) {
      const [row] = await db
        .select({ s: sessions, o: officers })
        .from(sessions)
        .innerJoin(officers, eq(officers.id, sessions.officerId))
        .where(and(eq(sessions.sessionToken, sessionToken), gt(sessions.expires, new Date()), eq(officers.active, true)));
      if (!row) return null;
      return {
        session: { sessionToken: row.s.sessionToken, userId: row.s.officerId, expires: row.s.expires },
        user: toUser(row.o),
      };
    },
    async updateSession(s) {
      if (!s.expires) return null;
      const [row] = await db
        .update(sessions)
        .set({ expires: s.expires })
        .where(eq(sessions.sessionToken, s.sessionToken))
        .returning();
      return row ? { sessionToken: row.sessionToken, userId: row.officerId, expires: row.expires } : null;
    },
    async deleteSession(sessionToken) {
      await db.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
    },
  };
}
