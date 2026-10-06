import { getDb } from "@/db";
import { withOfficer } from "@/lib/auth/guard";
import { json, toResponse } from "@/lib/http";
import { SendingError, sendingStatus, switchProvider } from "@/lib/mail/active";

export const GET = withOfficer("manage_brand", async () => json(await sendingStatus(getDb())));

/** Switches the email service: { provider: "ses" | "brevo" }. */
export const PUT = withOfficer("manage_brand", async (req, officer) => {
  try {
    return json(await switchProvider(getDb(), officer.id, await req.json()));
  } catch (e) {
    if (e instanceof SendingError) return json({ error: e.message }, e.status);
    return toResponse(e);
  }
});
