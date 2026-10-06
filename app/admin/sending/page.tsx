import { getDb } from "@/db";
import { pageOfficerWith } from "@/lib/auth/page-guard";
import { sendingStatus } from "@/lib/mail/active";
import Forbidden from "@/components/admin/Forbidden";
import SendingSettings from "@/components/admin/SendingSettings";

export default async function SendingPage() {
  const { allowed } = await pageOfficerWith("manage_brand");
  if (!allowed) return <Forbidden />;
  const status = await sendingStatus(getDb());
  return <SendingSettings initial={JSON.parse(JSON.stringify(status))} />;
}
