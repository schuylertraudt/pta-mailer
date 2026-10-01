"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export type Asset = { id: string; publicUrl: string; width: number; height: number; bytes: number; altText: string | null; mimeType: string };

const ACCEPT = "image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif";

/**
 * Upload (drag-drop or picker) and browse previously uploaded images.
 * In picker mode, "Insert" stays disabled until alt text is filled in.
 */
export default function MediaLibrary(props: { onPick?: (a: Asset & { altText: string }) => void; pickLabel?: string; initialFile?: File }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { assets } = await api<{ assets: Asset[] }>("/api/assets");
    setAssets(assets);
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Image is larger than 10 MB.");
      const target = await api<{ direct: boolean; key?: string; url?: string }>("/api/assets/upload-url", {
        body: { contentType: file.type, size: file.size },
      });
      let asset: Asset;
      if (target.direct) {
        const put = await fetch(target.url!, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream" } });
        if (!put.ok) throw new Error("Upload to storage failed. Check the bucket CORS settings.");
        ({ asset } = await api<{ asset: Asset }>("/api/assets", { body: { key: target.key, alt } }));
      } else {
        const form = new FormData();
        form.set("file", file);
        form.set("alt", alt);
        ({ asset } = await api<{ asset: Asset }>("/api/assets", { form }));
      }
      await load();
      choose(asset);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A photo dropped on the composer starts uploading as soon as the library opens.
  const started = useRef(false);
  useEffect(() => {
    if (props.initialFile && !started.current) {
      started.current = true;
      void upload(props.initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(a: Asset) {
    setSelected(a);
    setAlt(a.altText ?? "");
  }

  async function saveAlt() {
    if (!selected) return;
    const { asset } = await api<{ asset: Asset }>(`/api/assets/${selected.id}`, { method: "PATCH", body: { altText: alt } });
    setSelected(asset);
    await load();
  }

  async function pick() {
    if (!selected || !alt.trim() || !props.onPick) return;
    if ((selected.altText ?? "") !== alt.trim()) await saveAlt();
    props.onPick({ ...selected, altText: alt.trim() });
  }

  return (
    <div className="stack">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) upload(f);
        }}
        className="card"
        style={{ borderStyle: "dashed", textAlign: "center", background: drag ? "var(--bg)" : undefined }}
      >
        <p style={{ margin: "0 0 8px" }}>Drag a photo here, or</p>
        <button type="button" className="secondary" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : "Choose a file"}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
          JPG, PNG, GIF, WebP or HEIC up to 10 MB. Photos are resized, compressed and stripped of location data.
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {selected && (
        <div className="card row" style={{ alignItems: "flex-start" }}>
          <img src={selected.publicUrl} alt="" style={{ width: 160, height: "auto", borderRadius: 4 }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="alt">Alt text (required)</label>
            <input id="alt" value={alt} maxLength={300} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the image for screen readers and blocked images" />
            <p className="muted" style={{ fontSize: 13 }}>
              {selected.width}×{selected.height}px · {(selected.bytes / 1024).toFixed(0)} KB
            </p>
            <div className="row">
              {props.onPick ? (
                <button type="button" onClick={pick} disabled={!alt.trim()}>
                  {props.pickLabel ?? "Insert image"}
                </button>
              ) : (
                <button type="button" onClick={saveAlt}>
                  Save alt text
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
        {assets.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => choose(a)}
            className="secondary"
            style={{ padding: 4, border: selected?.id === a.id ? "2px solid var(--primary)" : "1px solid var(--border)" }}
            title={a.altText ?? "No alt text"}
          >
            <img src={a.publicUrl} alt={a.altText ?? ""} style={{ width: "100%", height: 90, objectFit: "cover", display: "block" }} />
            {!a.altText && <span className="warn" style={{ fontSize: 11 }}>no alt text</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
