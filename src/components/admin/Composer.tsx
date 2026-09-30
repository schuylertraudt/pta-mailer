"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { emailExtensions } from "@/lib/editor/extensions";
import { COLOR_TOKENS, CONTENT_WIDTH, type ColorToken } from "@/lib/editor/model";
import type { Check } from "@/lib/render/checks";
import { api } from "./api";
import MediaLibrary, { type Asset } from "./MediaLibrary";
import Modal from "./Modal";

type Status = "draft" | "pending_approval" | "approved" | "sending" | "sent" | "failed";
type Campaign = {
  id: string;
  subject: string;
  preheader: string;
  bodyJson: unknown;
  segmentId: string | null;
  showInArchive: boolean;
  status: Status;
};
type Segment = { id: string; name: string; recipients: number };
type Stats = { total: number; queued: number; sent: number; failed: number; skipped: number; bounced: number; complained: number };
type Preview = { html: string; checks: Check[]; bytes: number; recipients: number };

const EDITABLE: Status[] = ["draft", "pending_approval", "approved"];
const STATUS_LABEL: Record<Status, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
};

/** Inserts a block after a selected atom (image/button) instead of replacing it. */
function insertBlock(editor: Editor, content: object) {
  const sel = editor.state.selection;
  const chain = editor.chain().focus();
  return (sel instanceof NodeSelection ? chain.insertContentAt(sel.to, content) : chain.insertContent(content)).run();
}

function Tb(props: { onClick: () => void; active?: boolean; label: string; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={props.active ? "small" : "secondary small"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
      title={props.title ?? props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
    >
      {props.label}
    </button>
  );
}

function Toolbar({ editor, palette, onInsert }: { editor: Editor; palette: Record<ColorToken, string>; onInsert: (k: "image" | "button" | "twoColumn") => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      link: e.isActive("link"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      left: e.isActive({ textAlign: "left" }),
      center: e.isActive({ textAlign: "center" }),
      right: e.isActive({ textAlign: "right" }),
      color: (e.getAttributes("brandColor").color as ColorToken | undefined) ?? "",
    }),
  });
  const c = () => editor.chain().focus();
  function link() {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL (https://, mailto: or tel:)", prev ?? "https://");
    if (url === null) return;
    if (!url.trim()) c().extendMarkRange("link").unsetLink().run();
    else c().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }
  return (
    <div className="row" style={{ gap: 4, padding: 8, borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--card)", zIndex: 2 }}>
      <Tb label="P" title="Paragraph" onClick={() => c().setParagraph().run()} />
      <Tb label="H1" active={s.h1} onClick={() => c().toggleHeading({ level: 1 }).run()} />
      <Tb label="H2" active={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()} />
      <Tb label="H3" active={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()} />
      <span style={{ width: 8 }} />
      <Tb label="B" title="Bold" active={s.bold} onClick={() => c().toggleBold().run()} />
      <Tb label="I" title="Italic" active={s.italic} onClick={() => c().toggleItalic().run()} />
      <Tb label="U" title="Underline" active={s.underline} onClick={() => c().toggleUnderline().run()} />
      <Tb label="Link" active={s.link} onClick={link} />
      <select
        aria-label="Text color"
        value={s.color}
        onChange={(e) => (e.target.value ? c().setMark("brandColor", { color: e.target.value }).run() : c().unsetMark("brandColor").run())}
        style={{ width: "auto", padding: "4px 8px" }}
      >
        <option value="">Default color</option>
        {COLOR_TOKENS.map((t) => (
          <option key={t} value={t} style={{ color: palette[t] }}>
            {t[0].toUpperCase() + t.slice(1)}
          </option>
        ))}
      </select>
      <span style={{ width: 8 }} />
      <Tb label="• List" active={s.bullet} onClick={() => c().toggleBulletList().run()} />
      <Tb label="1. List" active={s.ordered} onClick={() => c().toggleOrderedList().run()} />
      <Tb label="Left" active={s.left} onClick={() => c().setTextAlign("left").run()} />
      <Tb label="Center" active={s.center} onClick={() => c().setTextAlign("center").run()} />
      <Tb label="Right" active={s.right} onClick={() => c().setTextAlign("right").run()} />
      <span style={{ width: 8 }} />
      <Tb label="+ Image" onClick={() => onInsert("image")} />
      <Tb label="+ Button" onClick={() => onInsert("button")} />
      <Tb label="+ Image & text" onClick={() => onInsert("twoColumn")} />
      <Tb label="+ Divider" onClick={() => c().setHorizontalRule().run()} />
      <Tb label="+ Spacer" onClick={() => insertBlock(editor, { type: "spacer", attrs: { height: 24 } })} />
    </div>
  );
}

/** Attribute editor for the selected image/button/spacer or the enclosing image+text block. */
function BlockPanel({ editor, onReplaceImage }: { editor: Editor; onReplaceImage: (type: "emailImage" | "twoColumn") => void }) {
  const info = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const sel = e.state.selection;
      if (sel instanceof NodeSelection && ["emailImage", "emailButton", "spacer", "twoColumn"].includes(sel.node.type.name)) {
        return { type: sel.node.type.name, attrs: sel.node.attrs as Record<string, unknown> };
      }
      for (let d = sel.$from.depth; d > 0; d--) {
        const n = sel.$from.node(d);
        if (n.type.name === "twoColumn") return { type: "twoColumn", attrs: n.attrs as Record<string, unknown> };
      }
      return null;
    },
  });
  if (!info) return null;
  const set = (attrs: Record<string, unknown>) => editor.chain().updateAttributes(info.type, attrs).run();
  const a = info.attrs;
  const align = (
    <>
      <label>Alignment</label>
      <select value={String(a.align)} onChange={(e) => set({ align: e.target.value })}>
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </select>
    </>
  );
  return (
    <div className="card" style={{ marginTop: 12 }}>
      {info.type === "emailImage" && (
        <>
          <strong>Image</strong>
          <label>Alt text (required)</label>
          <input value={String(a.alt ?? "")} maxLength={300} onChange={(e) => set({ alt: e.target.value })} />
          {!String(a.alt ?? "").trim() && <p className="warn">Add alt text: it&apos;s read aloud by screen readers and shown when images are blocked.</p>}
          <label>Link (optional)</label>
          <input value={String(a.href ?? "")} placeholder="https://" onChange={(e) => set({ href: e.target.value || null })} />
          <label>Width: {String(a.width)}px</label>
          <input type="range" min={100} max={CONTENT_WIDTH} step={4} value={Number(a.width)} onChange={(e) => set({ width: Number(e.target.value) })} />
          {align}
          <button type="button" className="secondary small" style={{ marginTop: 8 }} onClick={() => onReplaceImage("emailImage")}>
            Replace image
          </button>
        </>
      )}
      {info.type === "emailButton" && (
        <>
          <strong>Button</strong>
          <label>Label</label>
          <input value={String(a.label)} maxLength={60} onChange={(e) => set({ label: e.target.value })} />
          <label>Link</label>
          <input value={String(a.href)} onChange={(e) => set({ href: e.target.value })} />
          <label>Color</label>
          <select value={String(a.color)} onChange={(e) => set({ color: e.target.value })}>
            <option value="primary">Primary</option>
            <option value="accent">Accent</option>
          </select>
          {align}
        </>
      )}
      {info.type === "spacer" && (
        <>
          <strong>Spacer</strong>
          <label>Height: {String(a.height)}px</label>
          <input type="range" min={8} max={64} step={4} value={Number(a.height)} onChange={(e) => set({ height: Number(e.target.value) })} />
        </>
      )}
      {info.type === "twoColumn" && (
        <>
          <strong>Image &amp; text</strong>
          <label>Image alt text (required)</label>
          <input value={String(a.imageAlt ?? "")} maxLength={300} onChange={(e) => set({ imageAlt: e.target.value })} />
          <label>Image link (optional)</label>
          <input value={String(a.imageHref ?? "")} placeholder="https://" onChange={(e) => set({ imageHref: e.target.value || null })} />
          <label>Image side</label>
          <select value={String(a.imagePosition)} onChange={(e) => set({ imagePosition: e.target.value })}>
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
          <p className="muted" style={{ fontSize: 13 }}>
            Stacks with the image on top on phones.
          </p>
          <button type="button" className="secondary small" onClick={() => onReplaceImage("twoColumn")}>
            Replace image
          </button>
        </>
      )}
    </div>
  );
}

export default function Composer(props: {
  campaign: Campaign;
  segments: Segment[];
  role: "admin" | "sender" | "drafter";
  palette: Record<ColorToken, string>;
}) {
  const router = useRouter();
  const [c, setC] = useState(props.campaign);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [width, setWidth] = useState<600 | 375>(600);
  const [dark, setDark] = useState(false);
  const [modal, setModal] = useState<null | { kind: "image" | "twoColumn" | "button" | "send" | "template"; replace?: "emailImage" | "twoColumn" }>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const canSend = props.role !== "drafter";
  const editable = EDITABLE.includes(c.status);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef(c.status);
  statusRef.current = c.status;
  const fields = useRef({ subject: c.subject, preheader: c.preheader, segmentId: c.segmentId, showInArchive: c.showInArchive });

  const editor = useEditor({
    extensions: emailExtensions(),
    content: props.campaign.bodyJson as object,
    editable,
    immediatelyRender: false,
    onUpdate: () => schedule(),
  });

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (!editor || !EDITABLE.includes(statusRef.current)) return;
    setSaveState("saving");
    try {
      const { campaign } = await api<{ campaign: Campaign }>(`/api/campaigns/${c.id}`, {
        method: "PATCH",
        body: { ...fields.current, bodyJson: editor.getJSON() },
      });
      if (c.status !== "draft" && campaign.status === "draft") setNotice("Edited after submission, so this campaign is back to draft and needs approval again.");
      setC((prev) => ({ ...prev, status: campaign.status }));
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setError((e as Error).message);
    }
  }, [editor, c.id, c.status]);

  function schedule() {
    if (!EDITABLE.includes(statusRef.current)) return;
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1200);
  }
  const saveRef = useRef(save);
  saveRef.current = save;

  function setField<K extends keyof typeof fields.current>(k: K, v: (typeof fields.current)[K]) {
    fields.current = { ...fields.current, [k]: v };
    setC((prev) => ({ ...prev, [k]: v }));
    schedule();
  }

  const refreshPreview = useCallback(async () => {
    if (saveState !== "saved") await saveRef.current();
    try {
      setPreview(await api<Preview>(`/api/campaigns/${c.id}/preview`, { body: { dark } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [c.id, dark, saveState]);

  useEffect(() => {
    void refreshPreview();
    // Re-render when dark mode toggles or after the first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    if (c.status !== "sending" && c.status !== "sent" && c.status !== "failed") return;
    let stop = false;
    const tick = async () => {
      const { stats } = await api<{ stats: Stats }>(`/api/campaigns/${c.id}/stats`);
      if (stop) return;
      setStats(stats);
      if (c.status === "sending" && stats.queued === 0) router.refresh();
    };
    void tick();
    const iv = c.status === "sending" ? setInterval(tick, 5000) : undefined;
    return () => {
      stop = true;
      if (iv) clearInterval(iv);
    };
  }, [c.id, c.status, router]);

  async function action(path: string, okMsg: string) {
    setBusy(true);
    setError("");
    try {
      await saveRef.current();
      const res = await api<{ campaign?: Campaign; queued?: number; to?: string }>(`/api/campaigns/${c.id}/${path}`, { body: {} });
      if (res.campaign) setC((prev) => ({ ...prev, status: res.campaign!.status }));
      if (path === "send") {
        statusRef.current = "sending";
        setC((prev) => ({ ...prev, status: "sending" }));
      }
      setNotice(okMsg.replace("{to}", res.to ?? "").replace("{n}", String(res.queued ?? "")));
      if (path === "send") editor?.setEditable(false, false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setModal(null);
    }
  }

  function insertAsset(a: Asset & { altText: string }) {
    if (!editor || !modal) return;
    const width = Math.min(CONTENT_WIDTH, a.width);
    const chain = editor.chain().focus();
    if (modal.replace === "emailImage") chain.updateAttributes("emailImage", { src: a.publicUrl, alt: a.altText, assetId: a.id, width }).run();
    else if (modal.replace === "twoColumn") chain.updateAttributes("twoColumn", { imageSrc: a.publicUrl, imageAlt: a.altText, assetId: a.id }).run();
    else if (modal.kind === "twoColumn")
      insertBlock(editor, {
        type: "twoColumn",
        attrs: { imageSrc: a.publicUrl, imageAlt: a.altText, assetId: a.id, imagePosition: "left" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Write something about this photo." }] }],
      });
    else insertBlock(editor, { type: "emailImage", attrs: { src: a.publicUrl, alt: a.altText, assetId: a.id, width, align: "center" } });
    setModal(null);
  }

  const segment = props.segments.find((s) => s.id === c.segmentId);
  const blockers = preview?.checks.filter((x) => x.level === "block") ?? [];

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <a href="/admin">← Campaigns</a>
          <span className="badge">{STATUS_LABEL[c.status]}</span>
          <span className="muted" style={{ fontSize: 13 }}>
            {editable ? { saved: "All changes saved", dirty: "Unsaved changes", saving: "Saving…", error: "Save failed" }[saveState] : "Read-only"}
          </span>
        </div>
        <div className="row">
          <button type="button" className="secondary" disabled={busy} onClick={() => action("test", "Test sent to {to}.")}>
            Send test to me
          </button>
          <button type="button" className="secondary" onClick={() => setModal({ kind: "template" })}>
            Save as template
          </button>
          {editable && props.role === "drafter" && c.status === "draft" && (
            <button type="button" disabled={busy} onClick={() => action("submit", "Submitted for approval. A sender or admin will review it.")}>
              Submit for approval
            </button>
          )}
          {editable && c.status !== "draft" && props.role === "drafter" && (
            <button type="button" className="secondary" disabled={busy} onClick={() => action("unsubmit", "Returned to draft.")}>
              Withdraw
            </button>
          )}
          {canSend && c.status === "pending_approval" && (
            <button type="button" className="secondary" disabled={busy} onClick={() => action("approve", "Approved.")}>
              Approve
            </button>
          )}
          {canSend && editable && (
            <button type="button" disabled={busy} onClick={async () => {
              await refreshPreview();
              setModal({ kind: "send" });
            }}>
              Send…
            </button>
          )}
        </div>
      </div>

      {notice && <p className="ok" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {stats && (
        <div className="card row" style={{ gap: 24 }}>
          <strong>Delivery</strong>
          <span>Queued {stats.queued}</span>
          <span>Sent {stats.sent}</span>
          <span>Failed {stats.failed}</span>
          <span>Skipped {stats.skipped}</span>
          <span>Bounced {stats.bounced}</span>
          <span>Complaints {stats.complained}</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 640px)", gap: 16 }} className="composer-grid">
        <div className="stack">
          <div className="card">
            <label htmlFor="subject">Subject</label>
            <input id="subject" value={c.subject} maxLength={200} disabled={!editable} onChange={(e) => setField("subject", e.target.value)} />
            <label htmlFor="preheader">Preheader (inbox preview text)</label>
            <input id="preheader" value={c.preheader} maxLength={200} disabled={!editable} onChange={(e) => setField("preheader", e.target.value)} />
            <label htmlFor="segment">Audience</label>
            <select id="segment" value={c.segmentId ?? ""} disabled={!editable} onChange={(e) => setField("segmentId", e.target.value || null)}>
              <option value="">All confirmed subscribers</option>
              {props.segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.recipients})
                </option>
              ))}
            </select>
            <label className="row" style={{ fontWeight: 400 }}>
              <input type="checkbox" checked={c.showInArchive} disabled={!editable} onChange={(e) => setField("showInArchive", e.target.checked)} />
              Show in the public newsletter archive
            </label>
          </div>
          <div className="card editor" style={{ padding: 0, ...Object.fromEntries(COLOR_TOKENS.map((t) => [`--pal-${t}`, props.palette[t]])) }}>
            {editor && editable && <Toolbar editor={editor} palette={props.palette} onInsert={(k) => setModal({ kind: k })} />}
            <p className="muted" style={{ fontSize: 13, margin: "8px 16px 0" }}>
              The logo header and the footer (address + unsubscribe link) are added automatically.
            </p>
            <EditorContent editor={editor} />
          </div>
          {editor && editable && <BlockPanel editor={editor} onReplaceImage={(t) => setModal({ kind: "image", replace: t })} />}
        </div>

        <div className="stack">
          <div className="row">
            <button type="button" className={width === 600 ? "small" : "secondary small"} onClick={() => setWidth(600)}>
              Desktop
            </button>
            <button type="button" className={width === 375 ? "small" : "secondary small"} onClick={() => setWidth(375)}>
              Mobile
            </button>
            <button type="button" className={!dark ? "small" : "secondary small"} onClick={() => setDark(false)}>
              Light
            </button>
            <button type="button" className={dark ? "small" : "secondary small"} onClick={() => setDark(true)}>
              Dark
            </button>
            <button type="button" className="secondary small" onClick={() => void refreshPreview()}>
              Refresh preview
            </button>
          </div>
          {preview && (
            <>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                {(preview.bytes / 1024).toFixed(1)} KB · {preview.recipients} recipient{preview.recipients === 1 ? "" : "s"}
              </p>
              {preview.checks.map((x) => (
                <p key={x.code} className={x.level === "block" ? "error" : "warn"} style={{ margin: 0 }}>
                  {x.message}
                </p>
              ))}
              <div style={{ overflowX: "auto" }}>
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={preview.html}
                  style={{ width, maxWidth: "none", height: 900, border: "1px solid var(--border)", borderRadius: 8, background: dark ? "#111418" : "#fff", display: "block", margin: "0 auto" }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {modal?.kind === "image" || modal?.kind === "twoColumn" ? (
        <Modal title="Choose an image" wide onClose={() => setModal(null)}>
          <MediaLibrary onPick={insertAsset} />
        </Modal>
      ) : null}
      {modal?.kind === "button" && editor && (
        <ButtonModal
          onClose={() => setModal(null)}
          onInsert={(attrs) => {
            insertBlock(editor, { type: "emailButton", attrs });
            setModal(null);
          }}
        />
      )}
      {modal?.kind === "template" && editor && (
        <TemplateModal campaignId={c.id} beforeSave={() => saveRef.current()} onClose={() => setModal(null)} onSaved={(n) => setNotice(`Saved template "${n}".`)} />
      )}
      {modal?.kind === "send" && (
        <Modal title="Send campaign" onClose={() => setModal(null)}>
          <p>
            <strong>{c.subject || "(no subject)"}</strong>
          </p>
          <p>
            To: {segment?.name ?? "All confirmed subscribers"} · <strong>{preview?.recipients ?? "?"}</strong> recipients
          </p>
          {preview?.checks.map((x) => (
            <p key={x.code} className={x.level === "block" ? "error" : "warn"}>
              {x.message}
            </p>
          ))}
          <p className="muted">Sending can&apos;t be undone. Tip: send a test to yourself first.</p>
          <div className="row">
            <button type="button" disabled={busy || blockers.length > 0 || !preview?.recipients} onClick={() => action("send", "Sending to {n} recipients.")}>
              Send to {preview?.recipients ?? 0} recipients
            </button>
            <button type="button" className="secondary" onClick={() => setModal(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ButtonModal(props: { onClose: () => void; onInsert: (a: { label: string; href: string; color: string; align: string }) => void }) {
  const [label, setLabel] = useState("Learn more");
  const [href, setHref] = useState("https://");
  const [color, setColor] = useState("primary");
  const valid = label.trim() && /^(https?:\/\/[^/\s]+|mailto:\S+@\S+|tel:\S+)/.test(href.trim());
  return (
    <Modal title="Add a button" onClose={props.onClose}>
      <label>Label</label>
      <input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
      <label>Link</label>
      <input value={href} onChange={(e) => setHref(e.target.value)} />
      <label>Color</label>
      <select value={color} onChange={(e) => setColor(e.target.value)}>
        <option value="primary">Primary</option>
        <option value="accent">Accent</option>
      </select>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" disabled={!valid} onClick={() => props.onInsert({ label: label.trim(), href: href.trim(), color, align: "center" })}>
          Insert button
        </button>
      </div>
    </Modal>
  );
}

function TemplateModal(props: { campaignId: string; beforeSave: () => Promise<void>; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal title="Save as template" onClose={props.onClose}>
      <label>Template name</label>
      <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <button
          type="button"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              await props.beforeSave();
              await api("/api/templates", { body: { name: name.trim(), campaignId: props.campaignId } });
              props.onSaved(name.trim());
              props.onClose();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Save template
        </button>
      </div>
    </Modal>
  );
}
