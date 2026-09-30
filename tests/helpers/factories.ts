import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { officers, sessions, subscribers } from "@/db/schema";
import { generateToken } from "@/lib/tokens";
import { MemoryProvider, getEmailProvider } from "@/lib/mail/provider";

export function mailbox(): MemoryProvider {
  const p = getEmailProvider();
  if (!(p instanceof MemoryProvider)) throw new Error("tests expect the memory provider");
  return p;
}

let n = 0;
export async function makeSubscriber(
  db: Db,
  over: Partial<typeof subscribers.$inferInsert> = {},
) {
  n++;
  const [row] = await db
    .insert(subscribers)
    .values({
      email: `sub${n}.${Date.now()}@example.com`,
      grade: "K",
      status: "active",
      consentAt: new Date(),
      confirmedAt: new Date(),
      unsubscribeToken: generateToken(),
      ...over,
    })
    .returning();
  return row;
}

export async function makeOfficer(
  db: Db,
  role: "admin" | "sender" | "drafter",
  over: Partial<typeof officers.$inferInsert> = {},
) {
  n++;
  const [row] = await db
    .insert(officers)
    .values({ email: `${role}${n}.${Date.now()}@example.org`, name: `${role} ${n}`, role, ...over })
    .returning();
  return row;
}

/** Creates a DB session for the officer and returns request headers carrying its cookie. */
export async function sessionFor(db: Db, officerId: string) {
  const token = generateToken();
  await db.insert(sessions).values({ sessionToken: token, officerId, expires: new Date(Date.now() + 86_400_000) });
  return {
    token,
    headers: { cookie: `authjs.session-token=${token}`, origin: "https://pta.example.org" },
  };
}

export async function reload<T extends { id: string }>(db: Db, table: typeof subscribers, row: T) {
  const [r] = await db.select().from(table).where(eq(table.id, row.id));
  return r;
}
