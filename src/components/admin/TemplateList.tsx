"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

export default function TemplateList(props: { templates: { id: string; name: string; starter: boolean; updatedAt: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  async function use(id: string) {
    try {
      const { campaign } = await api<{ campaign: { id: string } }>("/api/campaigns", { body: { templateId: id } });
      router.push(`/admin/campaigns/${campaign.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    try {
      await api(`/api/templates/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      {error && <p className="error">{error}</p>}
      <table className="list">
        <thead>
          <tr>
            <th>Name</th>
            <th>Updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {props.templates.map((t) => (
            <tr key={t.id}>
              <td>
                {t.name} {t.starter && <span className="badge">starter</span>}
              </td>
              <td className="muted">{new Date(t.updatedAt).toLocaleDateString()}</td>
              <td className="row" style={{ justifyContent: "flex-end" }}>
                <button className="small" onClick={() => use(t.id)}>
                  New message from this
                </button>
                {!t.starter && (
                  <button className="small danger" onClick={() => remove(t.id, t.name)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
