"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

type Officer = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "sender" | "drafter";
  active: boolean;
  lastLoginAt: string | null;
  addedBy: string | null;
};
type Audit = { id: number; action: string; details: Record<string, unknown>; timestamp: string; officerEmail: string; actorEmail: string | null };

const ROLES = ["admin", "sender", "drafter"] as const;
const ROLE_HELP = "Admin: manage the team and brand, compose and send. Sender: compose and send. Drafter: compose; a sender or admin approves and sends.";

export default function Officers(props: { officers: Officer[]; audit: Audit[]; meId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Officer["role"]>("drafter");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError("");
    setMsg("");
    try {
      await fn();
      setMsg(ok);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="stack">
      {error && <p className="error" role="alert">{error}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      <table className="list">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Last sign-in</th>
            <th>Added by</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {props.officers.map((o) => (
            <tr key={o.id} style={{ opacity: o.active ? 1 : 0.6 }}>
              <td>{o.name ?? "—"}{o.id === props.meId && <span className="badge" style={{ marginLeft: 6 }}>you</span>}</td>
              <td>{o.email}</td>
              <td>
                {o.active ? (
                  <select
                    value={o.role}
                    aria-label={`Role for ${o.email}`}
                    style={{ width: "auto", padding: "4px 8px" }}
                    onChange={(e) => run(() => api(`/api/admin/officers/${o.id}`, { method: "PATCH", body: { role: e.target.value } }), `Changed ${o.email} to ${e.target.value}.`)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  o.role
                )}
              </td>
              <td>{o.active ? "Active" : "Deactivated"}</td>
              <td className="muted">{o.lastLoginAt ? new Date(o.lastLoginAt).toLocaleString() : "Never"}</td>
              <td className="muted">{o.addedBy ?? "bootstrap"}</td>
              <td>
                {o.active ? (
                  <button
                    className="small danger"
                    onClick={() =>
                      window.confirm(`Deactivate ${o.email}? They are signed out immediately.`) &&
                      run(() => api(`/api/admin/officers/${o.id}/deactivate`, { body: {} }), `Deactivated ${o.email}.`)
                    }
                  >
                    Deactivate
                  </button>
                ) : (
                  <button className="small secondary" onClick={() => run(() => api(`/api/admin/officers/${o.id}/reactivate`, { body: {} }), `Reactivated ${o.email}.`)}>
                    Reactivate
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api("/api/admin/officers", { body: { email, name, role } });
            setEmail("");
            setName("");
          }, `Added ${email}. They can sign in with Google now.`);
        }}
      >
        <strong>Add team member</strong>
        <p className="muted" style={{ fontSize: 13 }}>
          Use the Google account email they&apos;ll sign in with. No invite needed: access works on their next Google sign-in. {ROLE_HELP}
        </p>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as Officer["role"])}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <button type="submit">Add</button>
        </div>
      </form>

      <h2>Audit log</h2>
      <table className="list">
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>Team member</th>
            <th>By</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {props.audit.map((a) => (
            <tr key={a.id}>
              <td className="muted">{new Date(a.timestamp).toLocaleString()}</td>
              <td>{a.action.replace("_", " ")}</td>
              <td>{a.officerEmail}</td>
              <td>{a.actorEmail ?? "system"}</td>
              <td className="muted" style={{ fontSize: 13 }}>
                {Object.entries(a.details)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
