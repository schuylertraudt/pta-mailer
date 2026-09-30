import MailComposer from "nodemailer/lib/mail-composer";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { env } from "@/lib/env";

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
    private opts: { region?: string; configurationSet?: string } = {},
    client?: SESv2Client,
  ) {
    this.client = client ?? new SESv2Client({ region: opts.region });
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

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (!provider) {
    const e = env();
    provider =
      e.EMAIL_PROVIDER === "ses"
        ? new SesProvider({ region: e.AWS_REGION, configurationSet: e.SES_CONFIGURATION_SET })
        : e.EMAIL_PROVIDER === "memory"
          ? new MemoryProvider()
          : new ConsoleProvider();
  }
  return provider;
}

export function setEmailProvider(p: EmailProvider | undefined) {
  provider = p;
}
