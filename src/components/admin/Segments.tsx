"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

type Seg = { id: string; name: string; rule: string; recipients: number };

export default function Segments(props: { segments: Seg[]; schools: string[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"all" | "school" | "committee">("school");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [members, setMembers] = useState<{ email: string; status: string }[]>([]);
  const [emails, setEmails] = useState("");
  const [msg, setMsg] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/segments", { body: { name, rule: kind === "all" ? "all" : `${kind}=${value}` } });
      setName("");
      setValue("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function show(id: string) {
    setOpen(id);
    setMsg("");
    setMembers((await api<{ members: typeof members }>(`/api/segments/${id}/members`)).members);
  }
  async function add() {
    if (!open) return;
    const r = await api<{ added: number; unknown: string[] }>(`/api/segments/${open}/members`, { body: { emails } });
    setMsg(`Added ${r.added}.${r.unknown.length ? ` Not subscribed (ask them to sign up first): ${r.unknown.join(", ")}` : ""}`);
    setEmails("");
    await show(open);
    router.refresh();
  }
  async function remove(email: string) {
    if (!open) return;
    await api(`/api/segments/${open}/members`, { method: "DELETE", body: { email } });
    await show(open);
    router.refresh();
  }

  return (
    <div className="stack">
      <table className="list">
        <thead>
          <tr>
            <th>Audience</th>
            <th>Rule</th>
            <th>Recipients</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {props.segments.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td className="muted">{s.rule}</td>
              <td>{s.recipients}</td>
              <td>{s.rule.startsWith("committee=") && <button className="small secondary" onClick={() => show(s.id)}>Members</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {open && (
        <div className="card stack">
          <strong>Committee members: {props.segments.find((s) => s.id === open)?.name}</strong>
          <textarea rows={3} placeholder="Subscriber emails, separated by commas or new lines" value={emails} onChange={(e) => setEmails(e.target.value)} />
          <div className="row">
            <button className="small" onClick={add} disabled={!emails.trim()}>
              Add members
            </button>
            {msg && <span className="muted">{msg}</span>}
          </div>
          <ul>
            {members.map((m) => (
              <li key={m.email}>
                {m.email} <span className="muted">({m.status})</span>{" "}
                <button className="small secondary" onClick={() => remove(m.email)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="card" onSubmit={create}>
        <strong>New audience</strong>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
        <label>Who</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">Everyone</option>
          <option value="school">One school</option>
          <option value="committee">A committee (hand-picked members)</option>
        </select>
        {kind === "school" && (
          <select value={value} onChange={(e) => setValue(e.target.value)} required>
            <option value="">Choose a school</option>
            {props.schools.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
        {kind === "committee" && (
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Committee name" required />
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" style={{ marginTop: 12 }}>
          Create audience
        </button>
      </form>
    </div>
  );
}
