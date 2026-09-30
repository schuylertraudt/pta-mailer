import { describe, expect, it } from "vitest";
import { generateToken } from "@/lib/tokens";
import { normalizeEmail, emailSchema } from "@/lib/email";
import { formatSegmentRule, parseSegmentRule } from "@/lib/segment-rule";

describe("generateToken", () => {
  it("is 256-bit base64url and does not repeat", () => {
    const tokens = new Set(Array.from({ length: 10_000 }, generateToken));
    expect(tokens.size).toBe(10_000);
    for (const t of Array.from(tokens).slice(0, 100)) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("email normalization", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Parent@Example.COM ")).toBe("parent@example.com");
    expect(emailSchema.parse(" Parent@Example.COM")).toBe("parent@example.com");
  });
  it("rejects invalid addresses", () => {
    expect(() => emailSchema.parse("not-an-email")).toThrow();
  });
});

describe("segment rules", () => {
  it.each([
    ["all", { kind: "all" }],
    ["school=Karigon", { kind: "school", value: "Karigon" }],
    ["committee=Garden Committee", { kind: "committee", value: "Garden Committee" }],
  ] as const)("parses %s", (rule, parsed) => {
    expect(parseSegmentRule(rule)).toEqual(parsed);
    expect(formatSegmentRule(parseSegmentRule(rule))).toBe(rule);
  });
  it.each(["", "school", "school=", "=K", "grade=K", "teacher=X"])("rejects %j", (rule) => {
    expect(() => parseSegmentRule(rule)).toThrow();
  });
});
