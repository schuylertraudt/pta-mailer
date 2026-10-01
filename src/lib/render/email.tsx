import * as React from "react";
import { Body, Container, Head, Hr, Html, Preview } from "@react-email/components";
import { render } from "@react-email/render";
import { escapeHtml } from "@/lib/html";
import {
  COLUMN_WIDTH,
  CONTENT_WIDTH,
  FONT_STACK,
  palette,
  type Block,
  type Doc,
  type EmailButton,
  type Inline,
  type ListItem,
  type Palette,
  type TextBlock,
} from "@/lib/editor/model";
import { readableOn } from "./color";
import { RawHtml } from "./raw";

export type BrandForRender = {
  primaryColor: string;
  accentColor: string;
  footerText: string;
  ptaMailingAddress: string;
  logoUrl: string | null;
  logoAlt: string;
  logoWidth: number | null;
};

/**
 * Tells SES click tracking to leave a link alone: unsubscribing and viewing
 * online aren't engagement, and the unsubscribe token shouldn't pass through a
 * redirect.
 */
const NO_TRACK = { "ses:no-track": "" } as Record<string, string>;

export type RenderMode =
  /** Outgoing campaign: footer carries the unsubscribe link (placeholder token until send time). */
  | { kind: "email"; unsubscribeUrl: string; viewOnlineUrl: string | null }
  /** Public archive: no unsubscribe tokens, links to the subscribe page instead. */
  | { kind: "archive"; subscribeUrl: string };

export type RenderInput = {
  doc: Doc;
  subject: string;
  preheader: string;
  brand: BrandForRender;
  mode: RenderMode;
  /** Preview only: apply the dark-mode overrides unconditionally. */
  forceDark?: boolean;
};

const TEXT = "#222222";
const MUTED = "#666666";

type Ctx = { pal: Palette; raw: RawHtml };

const base: React.CSSProperties = { fontFamily: FONT_STACK, fontSize: 16, lineHeight: "24px", color: TEXT, margin: "0 0 16px" };
const HEADING_SIZE = { 1: [28, 34], 2: [22, 28], 3: [18, 24] } as const;

function PTable(props: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={props.style} className={props.className}>
      <tbody>{props.children}</tbody>
    </table>
  );
}

function renderInline(content: Inline[] | undefined, ctx: Ctx): React.ReactNode {
  if (!content?.length) return <>&nbsp;</>;
  return content.map((n, i) => {
    if (n.type === "hardBreak") return <br key={i} />;
    let el: React.ReactNode = n.text;
    const color = n.marks?.find((m) => m.type === "brandColor");
    for (const m of n.marks ?? []) {
      if (m.type === "bold") el = <strong>{el}</strong>;
      else if (m.type === "italic") el = <em>{el}</em>;
      else if (m.type === "underline") el = <u>{el}</u>;
      else if (m.type === "brandColor") el = <span style={{ color: ctx.pal[m.attrs.color] }}>{el}</span>;
    }
    const link = n.marks?.find((m) => m.type === "link");
    if (link && link.type === "link") {
      el = (
        <a
          href={link.attrs.href}
          target="_blank"
          style={{ color: color?.type === "brandColor" ? ctx.pal[color.attrs.color] : ctx.pal.primary, textDecoration: "underline" }}
        >
          {el}
        </a>
      );
    }
    return <React.Fragment key={i}>{el}</React.Fragment>;
  });
}

function ListEl({ node, ctx }: { node: Extract<Block, { type: "bulletList" | "orderedList" }>; ctx: Ctx }) {
  const style: React.CSSProperties = { ...base, paddingLeft: 24, margin: "0 0 16px" };
  const items = node.content.map((li: ListItem, i) => (
    <li key={i} className="fg" style={{ ...base, margin: "0 0 6px" }}>
      {li.content.map((c, j) =>
        c.type === "paragraph" ? (
          <React.Fragment key={j}>
            {j > 0 && <br />}
            {renderInline(c.content, ctx)}
          </React.Fragment>
        ) : (
          <ListEl key={j} node={c} ctx={ctx} />
        ),
      )}
    </li>
  ));
  return node.type === "orderedList" ? (
    <ol start={node.attrs.start} style={style}>
      {items}
    </ol>
  ) : (
    <ul style={style}>{items}</ul>
  );
}

function TextBlockEl({ b, ctx }: { b: TextBlock; ctx: Ctx }) {
  switch (b.type) {
    case "paragraph":
      return (
        <p className="fg" style={{ ...base, textAlign: b.attrs.textAlign }}>
          {renderInline(b.content, ctx)}
        </p>
      );
    case "heading": {
      const [size, lh] = HEADING_SIZE[b.attrs.level];
      const Tag = `h${b.attrs.level}` as "h1";
      return (
        <Tag className="fg" style={{ ...base, fontSize: size, lineHeight: `${lh}px`, fontWeight: "bold", color: "#111111", textAlign: b.attrs.textAlign, margin: "0 0 12px" }}>
          {renderInline(b.content, ctx)}
        </Tag>
      );
    }
    case "bulletList":
    case "orderedList":
      return <ListEl node={b} ctx={ctx} />;
  }
}

function imageEl(src: string, alt: string, width: number, align: "left" | "center" | "right", href: string | null) {
  const margin = align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : "0";
  const img = (
    <img
      src={src}
      alt={alt}
      width={width}
      style={{ display: "block", width: "100%", maxWidth: width, height: "auto", border: 0, outline: "none", textDecoration: "none", margin }}
    />
  );
  return href ? (
    <a href={href} target="_blank" style={{ display: "block" }}>
      {img}
    </a>
  ) : (
    img
  );
}

function buttonHtml(b: EmailButton, pal: Palette): string {
  const bg = pal[b.attrs.color];
  const fg = readableOn(bg);
  const label = escapeHtml(b.attrs.label);
  const href = escapeHtml(b.attrs.href);
  const width = Math.min(CONTENT_WIDTH, Math.max(160, b.attrs.label.length * 10 + 56));
  return [
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="9%" stroke="f" fillcolor="${bg}"><w:anchorlock/><center style="color:${fg};font-family:${FONT_STACK};font-size:16px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->`,
    `<!--[if !mso]><!-- --><a href="${href}" target="_blank" style="background-color:${bg};border-radius:4px;color:${fg};display:inline-block;font-family:${FONT_STACK};font-size:16px;font-weight:bold;line-height:48px;text-align:center;text-decoration:none;padding:0 28px;-webkit-text-size-adjust:none;mso-hide:all;">${label}</a><!--<![endif]-->`,
  ].join("");
}

function BlockEl({ b, ctx }: { b: Block; ctx: Ctx }): React.ReactNode {
  switch (b.type) {
    case "paragraph":
    case "heading":
    case "bulletList":
    case "orderedList":
      return <TextBlockEl b={b} ctx={ctx} />;
    case "horizontalRule":
      return <Hr style={{ border: "none", borderTop: "1px solid #dddddd", margin: "8px 0 24px", width: "100%" }} />;
    case "spacer":
      return (
        <PTable>
          <tr>
            <td height={b.attrs.height} style={{ height: b.attrs.height, fontSize: 0, lineHeight: 0 }}>
              &nbsp;
            </td>
          </tr>
        </PTable>
      );
    case "emailImage":
      return (
        <PTable>
          <tr>
            <td align={b.attrs.align} style={{ padding: "0 0 16px" }}>
              {imageEl(b.attrs.src, b.attrs.alt, b.attrs.width, b.attrs.align, b.attrs.href)}
            </td>
          </tr>
        </PTable>
      );
    case "emailButton":
      return (
        <PTable>
          <tr>
            <td align={b.attrs.align} style={{ padding: "8px 0 24px" }}>
              {ctx.raw.add(buttonHtml(b, ctx.pal))}
            </td>
          </tr>
        </PTable>
      );
    case "twoColumn": {
      const rtl = b.attrs.imagePosition === "right";
      const col: React.CSSProperties = { display: "inline-block", width: "100%", maxWidth: COLUMN_WIDTH, verticalAlign: "top", direction: "ltr" };
      return (
        <PTable>
          <tr>
            <td dir={rtl ? "rtl" : "ltr"} style={{ fontSize: 0, padding: "0 0 8px", textAlign: "left" }}>
              {ctx.raw.add(`<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${rtl ? "rtl" : "ltr"}"><tr><td width="${COLUMN_WIDTH}" valign="top" dir="ltr"><![endif]-->`)}
              <div style={col}>
                <div style={{ padding: rtl ? "0 0 16px 12px" : "0 12px 16px 0" }}>
                  {imageEl(b.attrs.imageSrc, b.attrs.imageAlt, COLUMN_WIDTH - 12, "left", b.attrs.imageHref)}
                </div>
              </div>
              {ctx.raw.add(`<!--[if mso]></td><td width="${COLUMN_WIDTH}" valign="top" dir="ltr"><![endif]-->`)}
              <div style={col}>
                <div style={{ padding: rtl ? "0 12px 0 0" : "0 0 0 12px", fontSize: 16 }}>
                  {b.content.map((c, i) => (
                    <TextBlockEl key={i} b={c} ctx={ctx} />
                  ))}
                </div>
              </div>
              {ctx.raw.add(`<!--[if mso]></td></tr></table><![endif]-->`)}
            </td>
          </tr>
        </PTable>
      );
    }
  }
}

const DARK_RULES = `
.bg-body{background-color:#111418 !important;}
.bg-card{background-color:#1a1e24 !important;}
.fg{color:#e8eaed !important;}
.fg-muted{color:#a8b0ba !important;}
.fg-link{color:#9cc3ff !important;}`;

function headCss(forceDark: boolean) {
  const scoped = (prefix: string) =>
    DARK_RULES.trim()
      .split("\n")
      .map((r) => `${prefix}${r}`)
      .join("\n");
  return [
    ":root{color-scheme:light dark;supported-color-schemes:light dark;}",
    "body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}",
    "img{-ms-interpolation-mode:bicubic;}",
    "a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;}",
    "@media only screen and (max-width:620px){.container{width:100% !important;}.pad{padding-left:16px !important;padding-right:16px !important;}}",
    `@media (prefers-color-scheme:dark){${DARK_RULES}}`,
    // Outlook.com dark mode
    scoped("[data-ogsc] "),
    forceDark ? DARK_RULES : "",
  ].join("\n");
}

const MSO_HEAD = `<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>table,td,div,h1,h2,h3,p,a,li{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->`;

function Email({ input, ctx }: { input: RenderInput; ctx: Ctx }) {
  const { brand, mode, doc } = input;
  const small: React.CSSProperties = { ...base, fontSize: 13, lineHeight: "20px", color: MUTED, margin: "0 0 8px" };
  const linkStyle: React.CSSProperties = { color: ctx.pal.primary, textDecoration: "underline" };
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />
        <title>{input.subject}</title>
        <style>{headCss(!!input.forceDark)}</style>
      </Head>
      {input.preheader ? <Preview>{input.preheader}</Preview> : null}
      <Body className="bg-body" style={{ backgroundColor: "#f4f5f7", margin: 0, padding: 0 }}>
        <PTable className="bg-body" style={{ backgroundColor: "#f4f5f7" }}>
          <tr>
            <td align="center" style={{ padding: "24px 8px" }}>
              <Container className="container bg-card" style={{ width: "100%", maxWidth: 600, backgroundColor: "#ffffff", borderRadius: 8 }}>
                {/* Header: injected, not editable. Logo sits on a light tile so it stays legible in dark mode. */}
                <PTable>
                  <tr>
                    <td align="center" className="pad" style={{ padding: "24px 24px 8px", borderTop: `6px solid ${ctx.pal.primary}`, borderRadius: "8px 8px 0 0" }}>
                      {brand.logoUrl ? (
                        <table role="presentation" cellPadding={0} cellSpacing={0} border={0}>
                          <tbody>
                            <tr>
                              <td style={{ backgroundColor: "#ffffff", padding: 12, borderRadius: 8 }}>
                                <img
                                  src={brand.logoUrl}
                                  alt={brand.logoAlt}
                                  width={brand.logoWidth ?? 200}
                                  style={{ display: "block", width: brand.logoWidth ?? 200, maxWidth: "100%", height: "auto", border: 0 }}
                                />
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      ) : null}
                    </td>
                  </tr>
                </PTable>
                <PTable>
                  <tr>
                    <td className="pad" style={{ padding: "16px 24px 8px" }}>
                      {doc.content.map((b, i) => (
                        <BlockEl key={i} b={b} ctx={ctx} />
                      ))}
                    </td>
                  </tr>
                </PTable>
                {/* Footer: injected, not editable. Always carries the unsubscribe link in email mode. */}
                <PTable>
                  <tr>
                    <td className="pad" style={{ padding: "16px 24px 24px", borderTop: "1px solid #e5e7eb" }}>
                      {brand.footerText ? (
                        <p className="fg-muted" style={small}>
                          {brand.footerText}
                        </p>
                      ) : null}
                      <p className="fg-muted" style={small}>
                        {brand.ptaMailingAddress}
                      </p>
                      <p className="fg-muted" style={small}>
                        {mode.kind === "email" ? (
                          <>
                            <a href={mode.unsubscribeUrl} className="fg-link" style={linkStyle} data-role="unsubscribe" {...NO_TRACK}>
                              Unsubscribe
                            </a>
                            {mode.viewOnlineUrl ? (
                              <>
                                {" · "}
                                <a href={mode.viewOnlineUrl} className="fg-link" style={linkStyle} {...NO_TRACK}>
                                  View in browser
                                </a>
                              </>
                            ) : null}
                          </>
                        ) : (
                          <a href={mode.subscribeUrl} className="fg-link" style={linkStyle}>
                            Subscribe to PTA News
                          </a>
                        )}
                      </p>
                    </td>
                  </tr>
                </PTable>
              </Container>
            </td>
          </tr>
        </PTable>
      </Body>
    </Html>
  );
}

/** Editor JSON (already sanitized) -> table-based HTML with inline styles and MSO fallbacks. */
export async function renderEmailHtml(input: RenderInput): Promise<string> {
  const ctx: Ctx = { pal: palette(input.brand), raw: new RawHtml() };
  let html = await render(<Email input={input} ctx={ctx} />, { pretty: false });
  html = ctx.raw.apply(html).replace(/<!--(\$|\/\$|html|head|body)-->/g, "");
  html = html.replace(
    /<html([^>]*)>/,
    `<html$1 xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">`,
  );
  html = html.replace("</head>", `${MSO_HEAD}</head>`);
  return html;
}
