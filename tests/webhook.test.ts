import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";
import { subscribers, suppressions } from "@/db/schema";
import { isValidSnsUrl, setCertFetcher, stringToSign, type SnsMessage } from "@/lib/webhooks/sns";
import { POST } from "../app/api/webhooks/ses/route";
import { resetDb, testDb } from "./helpers/db";
import { makeSubscriber } from "./helpers/factories";

const { db, pool } = testDb();
afterAll(() => pool.end());

const TOPIC = "arn:aws:sns:us-east-1:123456789012:pta-ses-events";
const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc123.pem";
const aws = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = (k: typeof aws) => k.publicKey.export({ type: "spki", format: "pem" }).toString();

beforeEach(async () => {
  await resetDb(db);
  setCertFetcher(async (url) => {
    if (url !== CERT_URL) throw new Error("unexpected cert url");
    return pem(aws);
  });
});
afterEach(() => setCertFetcher(undefined));

function signed(message: object, opts: { key?: typeof aws; version?: "1" | "2"; topic?: string; certUrl?: string } = {}): SnsMessage {
  const m: SnsMessage = {
    Type: "Notification",
    MessageId: "11111111-2222-3333-4444-555555555555",
    TopicArn: opts.topic ?? TOPIC,
    Message: JSON.stringify(message),
    Timestamp: new Date().toISOString(),
    SignatureVersion: opts.version ?? "1",
    Signature: "",
    SigningCertURL: opts.certUrl ?? CERT_URL,
  };
  const s = createSign(m.SignatureVersion === "1" ? "RSA-SHA1" : "RSA-SHA256");
  s.update(stringToSign(m));
  m.Signature = s.sign((opts.key ?? aws).privateKey, "base64");
  return m;
}

const post = (body: unknown) =>
  POST(new Request("https://pta.example.org/api/webhooks/ses", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

const bounceFor = (email: string) => ({
  notificationType: "Bounce",
  mail: { messageId: "ses-1" },
  bounce: { bounceType: "Permanent", bounceSubType: "General", bouncedRecipients: [{ emailAddress: email }] },
});

describe("SES/SNS webhook", () => {
  it("accepts a correctly signed bounce (v1 and v2) and suppresses", async () => {
    const a = await makeSubscriber(db);
    const b = await makeSubscriber(db);
    expect((await post(signed(bounceFor(a.email)))).status).toBe(200);
    expect((await post(signed(bounceFor(b.email), { version: "2" }))).status).toBe(200);
    expect((await db.select().from(suppressions)).map((s) => s.email).sort()).toEqual([a.email, b.email].sort());
    expect((await db.select().from(subscribers)).every((s) => s.status === "bounced")).toBe(true);
  });

  it("rejects unsigned, forged, tampered, wrong-topic and bad-cert-URL payloads", async () => {
    const s = await makeSubscriber(db);
    const good = signed(bounceFor(s.email));
    const cases: unknown[] = [
      "not json",
      { ...good, Signature: undefined },
      { ...good, Signature: "" },
      signed(bounceFor(s.email), { key: attacker }),
      { ...good, Message: JSON.stringify(bounceFor("victim@example.com")) },
      signed(bounceFor(s.email), { topic: "arn:aws:sns:us-east-1:999999999999:other" }),
      signed(bounceFor(s.email), { certUrl: "https://evil.example.com/cert.pem" }),
      signed(bounceFor(s.email), { certUrl: "http://sns.us-east-1.amazonaws.com/x.pem" }),
      signed(bounceFor(s.email), { certUrl: "https://sns.us-east-1.amazonaws.com.evil.com/x.pem" }),
      { ...good, SignatureVersion: "3" },
      { ...good, Type: "Surprise" },
    ];
    for (const body of cases) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(403);
    }
    expect(await db.select().from(suppressions)).toHaveLength(0);
  });

  it("validates SNS URLs strictly", () => {
    expect(isValidSnsUrl(CERT_URL, "cert")).toBe(true);
    expect(isValidSnsUrl("https://sns.cn-north-1.amazonaws.com.cn/x.pem", "cert")).toBe(true);
    expect(isValidSnsUrl("https://sns.us-east-1.amazonaws.com/x.txt", "cert")).toBe(false);
    expect(isValidSnsUrl("https://user@sns.us-east-1.amazonaws.com/x.pem", "cert")).toBe(false);
    expect(isValidSnsUrl("https://sns.us-east-1.amazonaws.com:8443/x.pem", "cert")).toBe(false);
  });
});
