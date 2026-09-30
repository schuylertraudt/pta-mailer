import { escapeHtml } from "@/lib/html";

/**
 * Minimal branded-neutral layout for one-off transactional mail (confirmation,
 * officer notifications). Table-based, inline styles, no images.
 */
export function simpleEmail(opts: {
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footer?: string;
}): { html: string; text: string } {
  const p = opts.paragraphs
    .map((t) => `<p style="margin:0 0 16px;font:16px/24px Arial,Helvetica,sans-serif;color:#222222;">${escapeHtml(t)}</p>`)
    .join("");
  const btn = opts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#1F4E79" style="border-radius:4px;"><a href="${escapeHtml(opts.button.url)}" style="display:inline-block;padding:12px 24px;font:bold 16px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;">${escapeHtml(opts.button.label)}</a></td></tr></table>`
    : "";
  const footer = opts.footer
    ? `<p style="margin:24px 0 0;font:12px/18px Arial,Helvetica,sans-serif;color:#666666;">${escapeHtml(opts.footer)}</p>`
    : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(opts.heading)}</title></head><body style="margin:0;padding:0;background:#f4f4f4;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;"><tr><td style="padding:24px;"><h1 style="margin:0 0 16px;font:bold 22px/28px Arial,Helvetica,sans-serif;color:#111111;">${escapeHtml(opts.heading)}</h1>${p}${btn}${footer}</td></tr></table></td></tr></table></body></html>`;
  const text = [
    opts.heading,
    "",
    ...opts.paragraphs.flatMap((t) => [t, ""]),
    ...(opts.button ? [`${opts.button.label}: ${opts.button.url}`, ""] : []),
    ...(opts.footer ? [opts.footer] : []),
  ]
    .join("\n")
    .trim();
  return { html, text };
}
