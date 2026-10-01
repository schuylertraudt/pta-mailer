"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Placeholder } from "@tiptap/extensions";
import { emailExtensions } from "@/lib/editor/extensions";
import { COLOR_TOKENS, CONTENT_WIDTH, type ColorToken } from "@/lib/editor/model";
import type { Check } from "@/lib/render/checks";
import { api } from "./api";
import MediaLibrary, { type Asset } from "./MediaLibrary";
import { Icon } from "./icons";
import Modal from "./Modal";
import RecipientPicker from "./RecipientPicker";

type Status = "draft" | "pending_approval" | "approved" | "sending" | "sent" | "failed";
type Campaign = {
  id: string;
  subject: string;
  preheader: string;
  bodyJson: unknown;
  segmentIds: string[];
  fromName: string;
  showInArchive: boolean;
  status: Status;
};
type Segment = { id: string; name: string; recipients: number };
type Stats = {
  total: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  bounced: number;
  complained: number;
  delivered: number;
  opened: number;
  clicked: number;
};
type LinkStat = { url: string; families: number; clicks: number };

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
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

function Tb(props: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={props.active ? "tb-btn on" : "tb-btn"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

function ColorPicker({ editor, palette, value }: { editor: Editor; palette: Record<ColorToken, string>; value: ColorToken | "" }) {
  const [open, setOpen] = useState(false);
  const c = () => editor.chain().focus();
  return (
    <span className="tb-pop">
      <Tb title="Text color" onClick={() => setOpen((o) => !o)} active={open}>
        <span className="swatch" style={{ background: value ? palette[value] : "var(--fg)" }} />
      </Tb>
      {open && (
        <span className="tb-menu" role="menu">
          <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => (c().unsetMark("brandColor").run(), setOpen(false))}>
            <span className="swatch" style={{ background: "var(--fg)" }} /> Default
          </button>
          {COLOR_TOKENS.map((t) => (
            <button key={t} type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => (c().setMark("brandColor", { color: t }).run(), setOpen(false))}>
              <span className="swatch" style={{ background: palette[t] }} /> {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </span>
      )}
    </span>
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
      color: ((e.getAttributes("brandColor").color as ColorToken | undefined) ?? "") as ColorToken | "",
      undo: e.can().undo(),
      redo: e.can().redo(),
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
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <span className="tb-group">
        <Tb title="Bold" active={s.bold} onClick={() => c().toggleBold().run()}>
          <b>B</b>
        </Tb>
        <Tb title="Italic" active={s.italic} onClick={() => c().toggleItalic().run()}>
          <i style={{ fontFamily: "Georgia, serif" }}>I</i>
        </Tb>
        <Tb title="Underline" active={s.underline} onClick={() => c().toggleUnderline().run()}>
          <u>U</u>
        </Tb>
        <Tb title="Clear formatting" onClick={() => c().unsetAllMarks().clearNodes().run()}>
          <span>
            T<sub style={{ fontSize: 9 }}>x</sub>
          </span>
        </Tb>
      </span>
      <span className="tb-group">
        {([1, 2, 3] as const).map((l) => (
          <Tb key={l} title={`Heading ${l}`} active={s[`h${l}`]} onClick={() => c().toggleHeading({ level: l }).run()}>
            <span>
              H<sub style={{ fontSize: 9 }}>{l}</sub>
            </span>
          </Tb>
        ))}
      </span>
      <span className="tb-group">
        <ColorPicker editor={editor} palette={palette} value={s.color} />
      </span>
      <span className="tb-group">
        <Tb title="Insert image" onClick={() => onInsert("image")}>
          <Icon name="image" />
        </Tb>
        <Tb title="Insert image with text beside it" onClick={() => onInsert("twoColumn")}>
          <Icon name="imageText" />
        </Tb>
        <Tb title="Insert button" onClick={() => onInsert("button")}>
          <Icon name="button" />
        </Tb>
        <Tb title="Insert divider line" onClick={() => c().setHorizontalRule().run()}>
          <Icon name="divider" />
        </Tb>
        <Tb title="Insert space" onClick={() => insertBlock(editor, { type: "spacer", attrs: { height: 24 } })}>
          <Icon name="spacer" />
        </Tb>
      </span>
      <span className="tb-group">
        <Tb title="Bulleted list" active={s.bullet} onClick={() => c().toggleBulletList().run()}>
          <Icon name="bullet" />
        </Tb>
        <Tb title="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()}>
          <Icon name="ordered" />
        </Tb>
      </span>
      <span className="tb-group">
        <Tb title="Add link" active={s.link} onClick={link}>
          <Icon name="link" />
        </Tb>
        <Tb title="Remove link" disabled={!s.link} onClick={() => c().extendMarkRange("link").unsetLink().run()}>
          <Icon name="unlink" />
        </Tb>
      </span>
      <span className="tb-group">
        <Tb title="Align left" active={s.left} onClick={() => c().setTextAlign("left").run()}>
          <Icon name="alignLeft" />
        </Tb>
        <Tb title="Align center" active={s.center} onClick={() => c().setTextAlign("center").run()}>
          <Icon name="alignCenter" />
        </Tb>
        <Tb title="Align right" active={s.right} onClick={() => c().setTextAlign("right").run()}>
          <Icon name="alignRight" />
        </Tb>
      </span>
      <span className="tb-group">
        <Tb title="Undo" disabled={!s.undo} onClick={() => c().undo().run()}>
          <Icon name="undo" />
        </Tb>
        <Tb title="Redo" disabled={!s.redo} onClick={() => c().redo().run()}>
          <Icon name="redo" />
        </Tb>
      </span>
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
    <div className="block-panel">
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

function Dropzone(props: { onFile: (f: File) => void; onBrowse: () => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      className={drag ? "dropzone over" : "dropzone"}
      role="button"
      tabIndex={0}
      onClick={props.onBrowse}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), props.onBrowse())}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) props.onFile(f);
      }}
    >
      <span className="dropzone-icon">
        <Icon name="upload" size={28} />
      </span>
      <span>Drag &amp; drop a photo to add it to the message, or select a file</span>
      <span className="muted" style={{ fontSize: 12 }}>
        JPG, PNG, GIF, WebP or HEIC up to 10 MB. Resized and stripped of location data automatically.
      </span>
    </div>
  );
}

type ModalState =
  | null
  | { kind: "image" | "twoColumn"; replace?: "emailImage" | "twoColumn"; file?: File }
  | { kind: "button" | "send" | "template" | "recipients" | "preview" };

export default function Composer(props: {
  campaign: Campaign;
  segments: Segment[];
  role: "admin" | "sender" | "drafter";
  palette: Record<ColorToken, string>;
  senderDefault: string;
  senderSuggestions: string[];
}) {
  const router = useRouter();
  const [c, setC] = useState(props.campaign);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [width, setWidth] = useState<600 | 375>(600);
  const [dark, setDark] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [menu, setMenu] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [links, setLinks] = useState<LinkStat[]>([]);
  const [busy, setBusy] = useState(false);
  const canSend = props.role !== "drafter";
  const canViewRecipients = props.role !== "drafter";
  const editable = EDITABLE.includes(c.status);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef(c.status);
  statusRef.current = c.status;
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  const menuRef = useRef<HTMLDivElement>(null);
  const fields = useRef({ subject: c.subject, preheader: c.preheader, segmentIds: c.segmentIds, fromName: c.fromName, showInArchive: c.showInArchive });

  const editor = useEditor({
    extensions: [...emailExtensions(), Placeholder.configure({ placeholder: "Enter email message" })],
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
      if (statusRef.current !== "draft" && campaign.status === "draft") setNotice("Edited after submission, so this message is back to draft and needs approval again.");
      setC((prev) => ({ ...prev, status: campaign.status }));
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setError((e as Error).message);
    }
  }, [editor, c.id]);

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

  const refreshPreview = useCallback(
    async (opts: { dark?: boolean } = {}) => {
      if (saveStateRef.current !== "saved") await saveRef.current();
      try {
        const p = await api<Preview>(`/api/campaigns/${c.id}/preview`, { body: { dark: !!opts.dark } });
        setPreview(p);
        return p;
      } catch (e) {
        setError((e as Error).message);
        return null;
      }
    },
    [c.id],
  );

  // Recipient count (and content checks): on load, and shortly after the audiences change.
  const audienceKey = c.segmentIds.join(",");
  useEffect(() => {
    const t = setTimeout(() => void refreshPreview(), 600);
    return () => clearTimeout(t);
  }, [audienceKey, refreshPreview]);

  useEffect(() => {
    if (modal?.kind === "preview") void refreshPreview({ dark });
  }, [dark, modal?.kind, refreshPreview]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  useEffect(() => {
    if (c.status !== "sending" && c.status !== "sent" && c.status !== "failed") return;
    let stop = false;
    const tick = async () => {
      const { stats, links } = await api<{ stats: Stats; links: LinkStat[] }>(`/api/campaigns/${c.id}/stats`);
      if (stop) return;
      setStats(stats);
      setLinks(links);
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
    setMenu(false);
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

  async function saveNow() {
    setError("");
    await saveRef.current();
    if (saveStateRef.current !== "error") setNotice("Draft saved.");
  }

  async function remove() {
    setMenu(false);
    if (!window.confirm("Delete this message? This can't be undone.")) return;
    try {
      if (timer.current) clearTimeout(timer.current);
      await api(`/api/campaigns/${c.id}`, { method: "DELETE" });
      router.push("/admin");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function insertAsset(a: Asset & { altText: string }) {
    if (!editor || !modal || (modal.kind !== "image" && modal.kind !== "twoColumn")) return;
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

  const title = c.subject.trim() || (editable ? "New Message" : "(no subject)");
  const chosen = props.segments.filter((s) => c.segmentIds.includes(s.id));
  const blockers = preview?.checks.filter((x) => x.level === "block") ?? [];
  const menuItems: { label: string; onClick: () => void; danger?: boolean }[] = [];
  if (canSend && editable)
    menuItems.push({
      label: "Send now…",
      onClick: async () => {
        setMenu(false);
        await refreshPreview();
        setModal({ kind: "send" });
      },
    });
  if (editable && props.role === "drafter" && c.status === "draft")
    menuItems.push({ label: "Submit for approval", onClick: () => action("submit", "Submitted for approval. A sender or admin will review it.") });
  if (editable && props.role === "drafter" && c.status !== "draft") menuItems.push({ label: "Withdraw submission", onClick: () => action("unsubmit", "Returned to draft.") });
  if (canSend && c.status === "pending_approval") menuItems.push({ label: "Approve", onClick: () => action("approve", "Approved.") });
  menuItems.push({ label: "Save as template", onClick: () => (setMenu(false), setModal({ kind: "template" })) });
  if (editable) menuItems.push({ label: "Delete message", onClick: remove, danger: true });

  return (
    <div className="composer">
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="/admin">Messages</a>
        <span aria-hidden="true">›</span>
        <span>{title}</span>
      </nav>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <div className="row" style={{ marginTop: 4 }}>
            <span className="badge">{STATUS_LABEL[c.status]}</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {editable ? { saved: "All changes saved", dirty: "Unsaved changes", saving: "Saving…", error: "Save failed" }[saveState] : "Sent messages can't be edited"}
            </span>
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="link-btn" onClick={() => setModal({ kind: "preview" })}>
            Preview
          </button>
          <button type="button" className="link-btn" disabled={busy} title="Email a test copy to yourself" onClick={() => action("test", "Preview sent to {to}.")}>
            Send Preview
          </button>
          <div className="split" ref={menuRef}>
            {editable ? (
              <button type="button" disabled={busy || saveState === "saving"} onClick={saveNow}>
                Save Draft
              </button>
            ) : (
              <button type="button" onClick={() => setModal({ kind: "template" })}>
                Save as Template
              </button>
            )}
            <button type="button" className="split-toggle" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Icon name="chevronDown" />
            </button>
            {menu && (
              <div className="menu" role="menu">
                {menuItems.map((m) => (
                  <button key={m.label} type="button" role="menuitem" className={m.danger ? "danger-text" : undefined} disabled={busy} onClick={m.onClick}>
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {notice && (
        <p className="ok" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {stats && (
        <section className="panel">
          <div className="panel-head">
            <h2>Delivery</h2>
          </div>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-n">{stats.delivered}</span>
              <span className="muted">Delivered</span>
            </div>
            <div className="stat">
              <span className="stat-n">
                {pct(stats.opened, stats.delivered)}
                <sup>*</sup>
              </span>
              <span className="muted">Opened ({stats.opened})</span>
            </div>
            <div className="stat">
              <span className="stat-n">{pct(stats.clicked, stats.delivered)}</span>
              <span className="muted">Clicked a link ({stats.clicked})</span>
            </div>
          </div>
          <p className="muted hint">
            Queued {stats.queued} · Failed {stats.failed} · Skipped {stats.skipped} · Bounced {stats.bounced} · Spam complaints {stats.complained}
          </p>
          <p className="muted hint">
            * An estimate. Apple Mail opens every message automatically (counts as opened even if unread), and readers who block images
            aren&apos;t counted. Clicks are exact.
          </p>
          {links.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table className="list">
                <thead>
                  <tr>
                    <th>Link</th>
                    <th>Families</th>
                    <th>Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => (
                    <tr key={l.url}>
                      <td style={{ overflowWrap: "anywhere" }}>
                        {/^https?:\/\//i.test(l.url) ? (
                          <a href={l.url} target="_blank" rel="noopener noreferrer">
                            {l.url}
                          </a>
                        ) : (
                          l.url
                        )}
                      </td>
                      <td>{l.families}</td>
                      <td>{l.clicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Recipients</h2>
          {canViewRecipients && editable && (
            <button type="button" className="link-btn" disabled={!c.segmentIds.length} onClick={() => setModal({ kind: "recipients" })}>
              View Selected Recipients
            </button>
          )}
        </div>
        <span className="field-label" id="recipients-label">
          Recipients
        </span>
        <RecipientPicker audiences={props.segments} value={c.segmentIds} disabled={!editable} onChange={(ids) => setField("segmentIds", ids)} />
        <p className="muted hint">
          {!editable
            ? stats
              ? `Sent to ${stats.total} ${stats.total === 1 ? "family" : "families"}.`
              : ""
            : !c.segmentIds.length
            ? "Choose one or more audiences. Nobody is selected yet."
            : preview
              ? `${preview.recipients} ${preview.recipients === 1 ? "family" : "families"} will receive this. A family in more than one selected audience gets one copy.`
              : "Counting…"}
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Message Details</h2>
        </div>
        <div className="field-grid">
          <div>
            <label htmlFor="subject">Subject</label>
            <input id="subject" placeholder="Enter subject" value={c.subject} maxLength={200} disabled={!editable} onChange={(e) => setField("subject", e.target.value)} />
          </div>
          <div>
            <label htmlFor="fromName" className="label-row">
              Sender Display Name
              <span className="muted" title="The name families see in their inbox. The sending address stays the same.">
                <Icon name="info" />
              </span>
            </label>
            <input
              id="fromName"
              list="sender-names"
              placeholder={props.senderDefault || "PTA"}
              value={c.fromName}
              maxLength={64}
              disabled={!editable}
              onChange={(e) => setField("fromName", e.target.value)}
            />
            <datalist id="sender-names">
              {[props.senderDefault, ...props.senderSuggestions].filter(Boolean).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
        </div>
        <label htmlFor="preheader">
          Inbox Preview Text <span className="muted" style={{ fontWeight: 400 }}>(optional, shown after the subject in most inboxes)</span>
        </label>
        <input id="preheader" placeholder="One line that sums up the message" value={c.preheader} maxLength={200} disabled={!editable} onChange={(e) => setField("preheader", e.target.value)} />

        <span className="field-label">Email Message</span>
        <div className="editor-box editor" style={Object.fromEntries(COLOR_TOKENS.map((t) => [`--pal-${t}`, props.palette[t]]))}>
          {editor && editable && <Toolbar editor={editor} palette={props.palette} onInsert={(k) => setModal({ kind: k })} />}
          <EditorContent editor={editor} />
        </div>
        <p className="muted hint">The logo header and the footer (mailing address and unsubscribe link) are added automatically.</p>
        {editor && editable && <BlockPanel editor={editor} onReplaceImage={(t) => setModal({ kind: "image", replace: t })} />}

        {editable && (
          <>
            <span className="field-label">Images</span>
            <Dropzone onBrowse={() => setModal({ kind: "image" })} onFile={(file) => setModal({ kind: "image", file })} />
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={c.showInArchive} disabled={!editable} onChange={(e) => setField("showInArchive", e.target.checked)} />
          Show in the public message archive after sending
        </label>
      </section>

      {modal?.kind === "image" || modal?.kind === "twoColumn" ? (
        <Modal title="Choose an image" wide onClose={() => setModal(null)}>
          <MediaLibrary onPick={insertAsset} initialFile={modal.file} />
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
      {modal?.kind === "recipients" && <RecipientsModal campaignId={c.id} beforeLoad={() => saveRef.current()} onClose={() => setModal(null)} />}
      {modal?.kind === "preview" && (
        <Modal title="Preview" wide onClose={() => setModal(null)}>
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
          </div>
          {preview ? (
            <>
              <p className="muted" style={{ fontSize: 13 }}>
                {(preview.bytes / 1024).toFixed(1)} KB · {preview.recipients} recipient{preview.recipients === 1 ? "" : "s"}
              </p>
              {preview.checks.map((x) => (
                <p key={x.code} className={x.level === "block" ? "error" : "warn"} style={{ margin: "4px 0" }}>
                  {x.message}
                </p>
              ))}
              <div style={{ overflowX: "auto" }}>
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={preview.html}
                  style={{ width, maxWidth: "none", height: 800, border: "1px solid var(--border)", borderRadius: 8, background: dark ? "#111418" : "#fff", display: "block", margin: "0 auto" }}
                />
              </div>
            </>
          ) : (
            <p className="muted">Rendering…</p>
          )}
        </Modal>
      )}
      {modal?.kind === "send" && (
        <Modal title="Send message" onClose={() => setModal(null)}>
          <p>
            <strong>{c.subject || "(no subject)"}</strong>
          </p>
          <p>
            From: {c.fromName.trim() || props.senderDefault}
            <br />
            To: {chosen.length ? chosen.map((s) => s.name).join(", ") : "nobody selected"} · <strong>{preview?.recipients ?? "?"}</strong> recipients
          </p>
          {preview?.checks.map((x) => (
            <p key={x.code} className={x.level === "block" ? "error" : "warn"}>
              {x.message}
            </p>
          ))}
          <p className="muted">Sending can&apos;t be undone. Tip: use Send Preview to email yourself a copy first.</p>
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

function RecipientsModal(props: { campaignId: string; beforeLoad: () => Promise<void>; onClose: () => void }) {
  const [data, setData] = useState<{ total: number; limit: number; recipients: { email: string; school: string | null }[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    (async () => {
      await props.beforeLoad();
      setData(await api(`/api/campaigns/${props.campaignId}/recipients`));
    })().catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.campaignId]);
  return (
    <Modal title="Selected recipients" onClose={props.onClose}>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          <p className="muted">
            {data.total} {data.total === 1 ? "family" : "families"}
            {data.total > data.limit ? `; showing the first ${data.limit}` : ""}. Unconfirmed, unsubscribed and do-not-mail addresses are left out.
          </p>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <table className="list">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>School</th>
                </tr>
              </thead>
              <tbody>
                {data.recipients.map((r) => (
                  <tr key={r.email}>
                    <td>{r.email}</td>
                    <td className="muted">{r.school ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
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
