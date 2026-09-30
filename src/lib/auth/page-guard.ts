import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { officerForSessionToken, SESSION_COOKIES, type Officer } from "./guard";
import { can, type Permission } from "./roles";

/** For server components: the signed-in, active officer or a redirect to /login. */
export async function pageOfficer(): Promise<Officer> {
  const jar = await cookies();
  const token = SESSION_COOKIES.map((n) => jar.get(n)?.value).find(Boolean);
  const officer = await officerForSessionToken(getDb(), token);
  if (!officer) redirect("/login");
  return officer;
}

export async function pageOfficerWith(perm: Permission): Promise<{ officer: Officer; allowed: boolean }> {
  const officer = await pageOfficer();
  return { officer, allowed: can(officer.role, perm) };
}
