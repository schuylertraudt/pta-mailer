import { describe, expect, it } from "vitest";
import { cleanSenderName, defaultSenderName, fromHeader, parseFrom } from "@/lib/mail/sender";
import { buildMime } from "@/lib/mail/provider";

describe("sender display name", () => {
  it("parses EMAIL_FROM with and without a name", () => {
    expect(parseFrom("PTA News <news@x.org>")).toEqual({ name: "PTA News", address: "news@x.org" });
    expect(parseFrom('"PTA News" <news@x.org>')).toEqual({ name: "PTA News", address: "news@x.org" });
    expect(parseFrom("news@x.org")).toEqual({ name: "", address: "news@x.org" });
    expect(defaultSenderName()).toBe("Example PTA");
  });

  it("strips characters that could forge an address or a header", () => {
    expect(cleanSenderName('a"b<c>d\\e\r\nBcc: x@y.z\u0000')).toBe("a b c d e Bcc: x@y.z");
    expect(cleanSenderName("x".repeat(100))).toHaveLength(64);
    expect(cleanSenderName("   ")).toBe("");
  });

  it("keeps the EMAIL_FROM address whatever the name", () => {
    expect(fromHeader("")).toBe("Example PTA <news@pta.example.org>");
    expect(fromHeader("Okte PTA")).toBe('"Okte PTA" <news@pta.example.org>');
    expect(fromHeader('x" <evil@example.com>')).toBe('"x evil@example.com" <news@pta.example.org>');
  });

  it("encodes non-ASCII names in the MIME header", async () => {
    const raw = (await buildMime({ from: fromHeader("Comité École"), to: "a@b.c", subject: "s", html: "<p>h</p>", text: "t" })).toString();
    const line = raw.split("\r\n").find((l) => l.startsWith("From:"))!;
    expect(line).toMatch(/=\?UTF-8\?/);
    expect(line).toContain("<news@pta.example.org>");
  });
});
