"use client";

import { useState } from "react";
import { api } from "./api";

type Name = "ses" | "brevo";
type Status = {
  active: Name | "console" | "memory";
  chosenBy: { email: string | null; at: string } | null;
  configured: Record<Name, boolean>;
  missing: Record<Name, string[]>;
  reporting: Record<Name, boolean>;
  pause: { until: string; reason: string } | null;
  queued: number;
};

const INFO: Record<Name, { label: string; blurb: string; reportingNote: string }> = {
  ses: {
    label: "Amazon SES",
    blurb: "About $0.10 per 1,000 emails. Needs Amazon's production access to reach families.",
    reportingNote: "Bounce, spam, open and click reports need SES_CONFIGURATION_SET and SNS_TOPIC_ARNS.",
  },
  brevo: {
    label: "Brevo",
    blurb: "Free plan: 300 emails a day, with a Brevo logo. Paid plans remove the daily limit.",
    reportingNote: "Bounce, spam, open and click reports need BREVO_WEBHOOK_SECRET and the Brevo webhook.",
  },
};

export default function SendingSettings({ initial }: { initial: Status }) {
  const [s, setS] = useState(initial);
  const [confirm, setConfirm] = useState<Name | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function switchTo(provider: Name) {
    setBusy(true);
    setError("");
    try {
      setS(await api<Status>("/api/admin/sending", { method: "PUT", body: { provider } }));
      setNotice(`Now sending through ${INFO[provider].label}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const activeLabel = s.active === "ses" || s.active === "brevo" ? INFO[s.active].label : "nothing (emails are only written to the server log)";

  return (
    <div className="composer">
      <div className="page-head">
        <div>
          <h1>Sending</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Which email service delivers messages, confirmations and Send Preview.
          </p>
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

      <section className="panel">
        <div className="panel-head">
          <h2>Sending through {activeLabel}</h2>
        </div>
        <p className="muted hint" style={{ marginTop: 12 }}>
          {s.chosenBy
            ? `Chosen by ${s.chosenBy.email ?? "a former team member"} on ${new Date(s.chosenBy.at).toLocaleString()}.`
            : "Set by the server's EMAIL_PROVIDER setting until an admin picks a service below."}{" "}
          {s.queued > 0 ? `${s.queued} email${s.queued === 1 ? "" : "s"} waiting to send.` : "Nothing waiting to send."}
        </p>
        {s.pause && (
          <div className="warn-box" role="status">
            <strong>Sending is paused until {new Date(s.pause.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</strong>{" "}
            The service reported its sending limit is used up. Waiting emails stay queued and go out automatically; the app checks again every
            hour. To send now, switch to the other service.
            <span className="muted" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
              {s.pause.reason}
            </span>
          </div>
        )}
      </section>

      <div className="provider-grid">
        {(["ses", "brevo"] as const).map((name) => {
          const on = s.active === name;
          return (
            <section key={name} className={on ? "panel provider on" : "panel provider"}>
              <div className="panel-head">
                <h2>{INFO[name].label}</h2>
                {on ? <span className="badge">In use</span> : s.configured[name] ? <span className="badge">Ready</span> : <span className="badge">Not set up</span>}
              </div>
              <p className="hint muted">{INFO[name].blurb}</p>
              {!s.configured[name] && (
                <p className="hint">
                  Missing on the server:{" "}
                  {s.missing[name].map((m, i) => (
                    <span key={m}>
                      {i > 0 && ", "}
                      <code>{m}</code>
                    </span>
                  ))}
                  . Add {s.missing[name].length === 1 ? "it" : "them"} to <code>/etc/pta-mailer.env</code>, then restart.
                </p>
              )}
              {s.configured[name] && !s.reporting[name] && <p className="hint warn">{INFO[name].reportingNote}</p>}
              <div className="row" style={{ marginTop: 16 }}>
                {on ? null : confirm === name ? (
                  <>
                    <button type="button" disabled={busy} onClick={() => switchTo(name)}>
                      Yes, switch to {INFO[name].label}
                    </button>
                    <button type="button" className="secondary" disabled={busy} onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={!s.configured[name] || busy} onClick={() => setConfirm(name)}>
                    Use {INFO[name].label}
                  </button>
                )}
              </div>
              {confirm === name && (
                <p className="hint muted">
                  Emails already waiting{s.queued ? ` (${s.queued})` : ""} and everything sent from now on will go through {INFO[name].label}. Messages
                  already delivered aren&apos;t affected.
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
