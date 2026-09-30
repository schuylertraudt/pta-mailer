import { getDb } from "@/db";
import { env } from "@/lib/env";
import { handleSesEvent } from "@/lib/webhooks/ses-events";
import { isValidSnsUrl, verifySnsMessage } from "@/lib/webhooks/sns";

/** SES bounce/complaint/inbound notifications delivered by SNS. Unsigned or forged payloads get 403. */
export async function POST(req: Request) {
  const body = await req.text();
  const allowedTopics = env().SNS_TOPIC_ARNS.split(",").map((s) => s.trim()).filter(Boolean);
  const v = await verifySnsMessage(body, { allowedTopics });
  if (!v.ok) return new Response(`Rejected: ${v.reason}`, { status: 403 });
  const m = v.message;

  if (m.Type === "SubscriptionConfirmation") {
    if (!isValidSnsUrl(m.SubscribeURL, "subscribe")) return new Response("Bad SubscribeURL", { status: 400 });
    const res = await fetch(m.SubscribeURL!);
    return new Response(res.ok ? "Subscribed" : "Confirm failed", { status: res.ok ? 200 : 502 });
  }
  if (m.Type === "UnsubscribeConfirmation") return new Response("OK");

  let event: unknown;
  try {
    event = JSON.parse(m.Message);
  } catch {
    return new Response("Ignored non-JSON message");
  }
  const outcome = await handleSesEvent(getDb(), event as never);
  return new Response(outcome);
}
