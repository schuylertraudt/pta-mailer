import { createVerify } from "node:crypto";

export type SnsMessage = {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
};

/** Only certificates served by SNS itself may sign messages. */
export function isValidSnsUrl(raw: string | undefined, kind: "cert" | "subscribe"): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.port || u.username) return false;
    if (!/^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(u.hostname)) return false;
    return kind === "cert" ? u.pathname.endsWith(".pem") : true;
  } catch {
    return false;
  }
}

/** The exact string SNS signs, per AWS's documented field order. */
export function stringToSign(m: SnsMessage): string {
  const keys =
    m.Type === "Notification"
      ? ["Message", "MessageId", ...(m.Subject !== undefined ? ["Subject"] : []), "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return keys.map((k) => `${k}\n${(m as Record<string, string | undefined>)[k] ?? ""}\n`).join("");
}

export type CertFetcher = (url: string) => Promise<string>;

const certCache = new Map<string, string>();
let certOverride: CertFetcher | undefined;
/** Test seam: supply signing certificates without network access. */
export function setCertFetcher(f: CertFetcher | undefined) {
  certOverride = f;
}
export const fetchCert: CertFetcher = async (url) => {
  if (certOverride) return certOverride(url);
  const hit = certCache.get(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cert fetch failed: ${res.status}`);
  const pem = await res.text();
  if (!pem.includes("BEGIN CERTIFICATE")) throw new Error("not a certificate");
  certCache.set(url, pem);
  return pem;
};

export type VerifyResult = { ok: true; message: SnsMessage } | { ok: false; reason: string };

/**
 * Verifies an SNS envelope: shape, allowed topic, cert URL on an SNS host,
 * and the RSA signature (SHA1 for v1, SHA256 for v2).
 */
export async function verifySnsMessage(
  body: string,
  opts: { allowedTopics: string[]; getCert?: CertFetcher },
): Promise<VerifyResult> {
  let m: SnsMessage;
  try {
    m = JSON.parse(body);
  } catch {
    return { ok: false, reason: "invalid json" };
  }
  if (!m || typeof m !== "object" || typeof m.Signature !== "string" || typeof m.Message !== "string") {
    return { ok: false, reason: "missing fields" };
  }
  if (!["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"].includes(m.Type)) {
    return { ok: false, reason: "unknown type" };
  }
  if (!opts.allowedTopics.includes(m.TopicArn)) return { ok: false, reason: "topic not allowed" };
  if (!isValidSnsUrl(m.SigningCertURL, "cert")) return { ok: false, reason: "bad cert url" };
  const algo = m.SignatureVersion === "1" ? "RSA-SHA1" : m.SignatureVersion === "2" ? "RSA-SHA256" : null;
  if (!algo) return { ok: false, reason: "bad signature version" };

  let cert: string;
  try {
    cert = await (opts.getCert ?? fetchCert)(m.SigningCertURL);
  } catch {
    return { ok: false, reason: "cert unavailable" };
  }
  const v = createVerify(algo);
  v.update(stringToSign(m), "utf8");
  let valid = false;
  try {
    valid = v.verify(cert, m.Signature, "base64");
  } catch {
    valid = false;
  }
  return valid ? { ok: true, message: m } : { ok: false, reason: "bad signature" };
}
