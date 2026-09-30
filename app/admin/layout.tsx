import Link from "next/link";
import { signOut } from "@/auth";
import { pageOfficer } from "@/lib/auth/page-guard";
import { can } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "PTA Mailer", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const officer = await pageOfficer();
  return (
    <>
      <nav className="admin">
        <strong>PTA Mailer</strong>
        <Link href="/admin">Campaigns</Link>
        <Link href="/admin/templates">Templates</Link>
        <Link href="/admin/media">Media</Link>
        {can(officer.role, "view_subscribers") && <Link href="/admin/subscribers">Subscribers</Link>}
        {can(officer.role, "send") && <Link href="/admin/segments">Audiences</Link>}
        {can(officer.role, "manage_brand") && <Link href="/admin/brand">Brand</Link>}
        {can(officer.role, "manage_officers") && <Link href="/admin/officers">Officers</Link>}
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 14 }}>
          {officer.email} · {officer.role}
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="secondary small" type="submit">
            Sign out
          </button>
        </form>
      </nav>
      <main className="wide">{children}</main>
    </>
  );
}
