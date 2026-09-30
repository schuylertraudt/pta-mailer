"use client";

export default function Modal(props: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 16, zIndex: 50, overflowY: "auto" }}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div className="card" style={{ width: "100%", maxWidth: props.wide ? 900 : 520, marginTop: 40 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{props.title}</h2>
          <button type="button" className="secondary small" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={{ marginTop: 12 }}>{props.children}</div>
      </div>
    </div>
  );
}
