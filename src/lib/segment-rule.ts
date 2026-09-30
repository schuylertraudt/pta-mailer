export type SegmentRule =
  | { kind: "all" }
  | { kind: "grade"; value: string }
  | { kind: "teacher"; value: string }
  | { kind: "committee"; value: string };

/** Parses a segments.rule string: "all" | "grade=K" | "teacher=Smith" | "committee=Garden". */
export function parseSegmentRule(rule: string): SegmentRule {
  const trimmed = rule.trim();
  if (trimmed === "all") return { kind: "all" };
  const eq = trimmed.indexOf("=");
  if (eq <= 0) throw new Error(`Invalid segment rule: ${JSON.stringify(rule)}`);
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  if (!value) throw new Error(`Invalid segment rule: ${JSON.stringify(rule)}`);
  if (key === "grade" || key === "teacher" || key === "committee") return { kind: key, value };
  throw new Error(`Unknown segment rule key: ${JSON.stringify(key)}`);
}

export function formatSegmentRule(rule: SegmentRule): string {
  return rule.kind === "all" ? "all" : `${rule.kind}=${rule.value}`;
}
