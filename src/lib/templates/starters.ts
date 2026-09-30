import type { Block, Doc, Inline } from "@/lib/editor/model";

const t = (text: string, ...marks: ("bold" | "italic")[]): Inline =>
  marks.length ? { type: "text", text, marks: marks.map((m) => ({ type: m })) } : { type: "text", text };
const p = (...content: Inline[]): Block => ({ type: "paragraph", attrs: { textAlign: "left" }, content });
const h = (level: 1 | 2 | 3, text: string, align: "left" | "center" = "left"): Block => ({
  type: "heading",
  attrs: { level, textAlign: align },
  content: [t(text)],
});
const bullets = (...items: string[]): Block => ({
  type: "bulletList",
  content: items.map((i) => ({ type: "listItem", content: [{ type: "paragraph", attrs: { textAlign: "left" }, content: [t(i)] }] })),
});
const button = (label: string, color: "primary" | "accent" = "primary"): Block => ({
  type: "emailButton",
  attrs: { label, href: "https://example.org/replace-this-link", color, align: "center" },
});
const divider: Block = { type: "horizontalRule" };
const spacer = (height = 16): Block => ({ type: "spacer", attrs: { height } });

// Fixed ids so ensureStarterTemplates is idempotent.
export const STARTER_TEMPLATES: { id: string; name: string; body: Doc }[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Monthly Newsletter",
    body: {
      type: "doc",
      content: [
        h(1, "PTA News: [Month]", "center"),
        p(t("Hi families! Here's what's happening at school this month.")),
        divider,
        h(2, "From the President"),
        p(t("A short welcome note. Two or three sentences work best in email.")),
        h(2, "Upcoming Dates"),
        bullets("[Date]: [Event]", "[Date]: [Event]", "[Date]: [Event]"),
        h(2, "Spotlight"),
        p(t("Share a classroom highlight, a thank-you to volunteers, or a program update.")),
        button("See the full calendar"),
        divider,
        h(3, "Get Involved"),
        p(t("Questions or ideas? Reply to this email and someone from the PTA will get back to you.")),
      ],
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Event Announcement",
    body: {
      type: "doc",
      content: [
        h(1, "[Event Name]", "center"),
        { type: "paragraph", attrs: { textAlign: "center" }, content: [t("[Day, Date] · [Time] · [Location]", "bold")] },
        spacer(),
        p(t("One or two sentences on what the event is and why families will love it.")),
        h(3, "What to know"),
        bullets("Who: [Which schools / all families welcome]", "Cost: [Free / $X]", "Bring: [Anything families need]"),
        button("RSVP now", "accent"),
        p(t("Can't make it? We'd still love your help. Reply to this email to volunteer.", "italic")),
      ],
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Volunteer Ask",
    body: {
      type: "doc",
      content: [
        h(1, "We need your help!", "center"),
        p(t("The PTA is looking for volunteers for "), t("[event or program]", "bold"), t(".")),
        h(3, "Open roles"),
        bullets("[Role]: [time commitment]", "[Role]: [time commitment]", "[Role]: [time commitment]"),
        p(t("No experience needed, and every shift makes a difference for our students.")),
        button("Sign up to volunteer"),
        divider,
        p(t("Thank you for supporting our school community!")),
      ],
    },
  },
];
