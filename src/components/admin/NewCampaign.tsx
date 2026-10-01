"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";

export default function NewCampaign({ templates }: { templates: { id: string; name: string }[] }) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    setBusy(true);
    try {
      const { campaign } = await api<{ campaign: { id: string } }>("/api/campaigns", { body: { templateId: templateId || null } });
      router.push(`/admin/campaigns/${campaign.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="row">
      <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ width: "auto" }} aria-label="Start from">
        <option value="">Blank message</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button onClick={create} disabled={busy}>
        New Message
      </button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
