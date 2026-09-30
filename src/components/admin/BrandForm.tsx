"use client";

import { useState } from "react";
import { api } from "./api";
import MediaLibrary from "./MediaLibrary";
import Modal from "./Modal";

type Brand = { primaryColor: string; accentColor: string; footerText: string; ptaMailingAddress: string; logoAssetId: string | null };

export default function BrandForm(props: { brand: Brand; logoUrl: string | null }) {
  const [b, setB] = useState(props.brand);
  const [logoUrl, setLogoUrl] = useState(props.logoUrl);
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setError("");
    try {
      await api("/api/brand", { method: "PUT", body: b });
      setMsg("Saved. New previews and sends use these settings.");
    } catch (err) {
      const data = (err as { data?: { issues?: { message: string }[] } }).data;
      setError(data?.issues?.map((i) => i.message).join(" ") || (err as Error).message);
    }
  }

  return (
    <form className="card" onSubmit={save}>
      <label>Logo</label>
      <div className="row">
        {logoUrl ? (
          <div style={{ background: "#fff", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
            <img src={logoUrl} alt="" style={{ maxWidth: 200, height: "auto", display: "block" }} />
          </div>
        ) : (
          <span className="muted">No logo</span>
        )}
        <button type="button" className="secondary small" onClick={() => setPicking(true)}>
          Choose logo
        </button>
        {logoUrl && (
          <button type="button" className="secondary small" onClick={() => { setB({ ...b, logoAssetId: null }); setLogoUrl(null); }}>
            Remove
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Emails show the logo on a white tile so it stays readable in dark mode. A transparent PNG about 400px wide works best.
      </p>
      <div className="row">
        <div>
          <label>Primary color</label>
          <div className="row">
            <input type="color" value={b.primaryColor} onChange={(e) => setB({ ...b, primaryColor: e.target.value })} />
            <input value={b.primaryColor} onChange={(e) => setB({ ...b, primaryColor: e.target.value })} style={{ width: 110 }} />
          </div>
        </div>
        <div>
          <label>Accent color</label>
          <div className="row">
            <input type="color" value={b.accentColor} onChange={(e) => setB({ ...b, accentColor: e.target.value })} />
            <input value={b.accentColor} onChange={(e) => setB({ ...b, accentColor: e.target.value })} style={{ width: 110 }} />
          </div>
        </div>
      </div>
      <label>Footer text</label>
      <textarea rows={2} maxLength={500} value={b.footerText} onChange={(e) => setB({ ...b, footerText: e.target.value })} />
      <label>PTA mailing address (required by law in every email)</label>
      <input value={b.ptaMailingAddress} maxLength={300} onChange={(e) => setB({ ...b, ptaMailingAddress: e.target.value })} required />
      {error && <p className="error">{error}</p>}
      {msg && <p className="ok">{msg}</p>}
      <button type="submit" style={{ marginTop: 12 }}>
        Save brand settings
      </button>
      {picking && (
        <Modal title="Choose a logo" wide onClose={() => setPicking(false)}>
          <MediaLibrary
            pickLabel="Use as logo"
            onPick={(a) => {
              setB({ ...b, logoAssetId: a.id });
              setLogoUrl(a.publicUrl);
              setPicking(false);
            }}
          />
        </Modal>
      )}
    </form>
  );
}
