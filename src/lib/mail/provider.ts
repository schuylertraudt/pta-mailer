import MailComposer from "nodemailer/lib/mail-composer";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { env } from "@/lib/env";
import { parseFrom } from "@/lib/mail/sender";

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

export type SendResult = { messageId: string };

/** Delivery provider. SES is the default; Resend/Postmark can implement the same interface. */
export interface EmailProvider {
  readonly name: string;
  send(msg: OutboundEmail): Promise<SendResult>;
}

/** Builds a multipart/alternative (text + html) RFC 5322 message. No attachments, ever. */
export async function buildMime(msg: Required<Pick<OutboundEmail, "from">> & OutboundEmail): Promise<Buffer> {
  const composer = new MailComposer({
    from: msg.from,
    to: msg.to,
    replyTo: msg.replyTo,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    headers: msg.headers,
    textEncoding: "quoted-printable",
  });
  return composer.compile().build();
}

export class SesProvider implements EmailProvider {
  readonly name = "ses";
  private client: SESv2Client;
  constructor(
    private opts: { region?: string; configurationSet?: string; accessKeyId?: string; secretAccessKey?: string } = {},
    client?: SESv2Client,
  ) {
    this.client =
      client ??
      new SESv2Client({
        region: opts.region,
        credentials: opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
      });
  }
  async send(msg: OutboundEmail): Promise<SendResult> {
    const from = msg.from ?? env().EMAIL_FROM;
    const raw = await buildMime({ ...msg, from, replyTo: msg.replyTo ?? env().EMAIL_REPLY_TO });
    const out = await this.client.send(
      new SendEmailCommand({
        Content: { Raw: { Data: raw } },
        ConfigurationSetName: this.opts.configurationSet,
      }),
    );
    if (!out.MessageId) throw new Error("SES returned no MessageId");
    return { messageId: out.MessageId };
  }
}

/** Captures mail in memory. Used by tests and local development. */
export class MemoryProvider implements EmailProvider {
  readonly name: string = "memory";
  sent: (OutboundEmail & { messageId: string })[] = [];
  /** Optional hook to simulate provider failures. */
  failWith?: (msg: OutboundEmail) => Error | undefined;
  private n = 0;
  async send(msg: OutboundEmail): Promise<SendResult> {
    const err = this.failWith?.(msg);
    if (err) throw err;
    const messageId = `mem-${Date.now()}-${++this.n}`;
    this.sent.push({ ...msg, from: msg.from ?? env().EMAIL_FROM, messageId });
    return { messageId };
  }
  clear() {
    this.sent = [];
    this.failWith = undefined;
  }
}

export class ConsoleProvider extends MemoryProvider {
  override readonly name = "console";
  override async send(msg: OutboundEmail) {
    const res = await super.send(msg);
    console.info(`[mail] to=${msg.to} subject=${JSON.stringify(msg.subject)} id=${res.messageId}`);
    return res;
  }
}

/**
 * The provider's sending quota is used up (e.g. Brevo's free-plan daily cap).
 * Not a per-message failure: the queue pauses and resumes later.
 */
export class QuotaExceededError extends Error {
  override name = "QuotaExceeded";
}

/** Brevo transactional API (POST /v3/smtp/email). */
export class BrevoProvider implements EmailProvider {
  readonly name = "brevo";
  constructor(
    private opts: { apiKey: string; endpoint?: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async send(msg: OutboundEmail): Promise<SendResult> {
    const from = parseFrom(msg.from ?? env().EMAIL_FROM);
    const replyTo = msg.replyTo ?? env().EMAIL_REPLY_TO;
    const res = await this.fetchImpl(this.opts.endpoint ?? "https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": this.opts.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: from.name ? { name: from.name, email: from.address } : { email: from.address },
        to: [{ email: msg.to }],
        ...(replyTo && { replyTo: { email: parseFrom(replyTo).address } }),
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
        ...(msg.headers && { headers: msg.headers }),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { messageId?: string; code?: string; message?: string };
    if (res.ok && body.messageId) return { messageId: body.messageId };
    const detail = `Brevo ${res.status}${body.code ? ` ${body.code}` : ""}: ${body.message ?? res.statusText}`;
    // 402: out of credits / daily limit reached.
    if (res.status === 402) throw new QuotaExceededError(detail);
    const err = new Error(detail);
    // 400 means this message will never be accepted; 401/403/429/5xx may clear up.
    err.name = res.status === 400 ? "BadRequestException" : res.status === 429 ? "Throttled" : "BrevoError";
    throw err;
  }
}

export type ProviderName = "ses" | "brevo";

/** Which real providers have credentials in the environment. */
export function configuredProviders(): Record<ProviderName, boolean> {
  const e = env();
  return { ses: !!(e.SES_REGION && e.SES_ACCESS_KEY_ID && e.SES_SECRET_ACCESS_KEY), brevo: !!e.BREVO_API_KEY };
}

const instances = new Map<string, EmailProvider>();

/** A provider by name, built once. `console`/`memory` are for development and tests. */
export function providerByName(name: ProviderName | "console" | "memory"): EmailProvider {
  let p = instances.get(name);
  if (!p) {
    const e = env();
    p =
      name === "ses"
        ? new SesProvider({
            region: e.SES_REGION,
            configurationSet: e.SES_CONFIGURATION_SET,
            accessKeyId: e.SES_ACCESS_KEY_ID,
            secretAccessKey: e.SES_SECRET_ACCESS_KEY,
          })
        : name === "brevo"
          ? new BrevoProvider({ apiKey: e.BREVO_API_KEY ?? "" })
          : name === "memory"
            ? new MemoryProvider()
            : new ConsoleProvider();
    instances.set(name, p);
  }
  return p;
}

let provider: EmailProvider | undefined;

/** The provider named by EMAIL_PROVIDER (or a test override). Prefer getActiveProvider(db). */
export function getEmailProvider(): EmailProvider {
  return provider ?? providerByName(env().EMAIL_PROVIDER);
}

/** Test hook: route every send through `p` regardless of settings. */
export function overriddenProvider(): EmailProvider | undefined {
  return provider;
}

export function setEmailProvider(p: EmailProvider | undefined) {
  provider = p;
}
