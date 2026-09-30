"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
import Modal from "./Modal";

export default function DeleteSubscriber({ id, email }: { id: string; email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [suppress, setSuppress] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await api(`/api/subscribers/${id}`, { method: "DELETE", body: { suppress } });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="small danger" onClick={() => setOpen(true)}>
        Delete
      </button>
      {open && (
        <Modal title="Delete subscriber" onClose={() => setOpen(false)}>
          <p>
            Permanently delete <strong>{email}</strong> and their grade/teacher details? This can&apos;t be undone. Past newsletter
            totals are kept without their address.
          </p>
          <label className="row" style={{ fontWeight: 400, alignItems: "flex-start" }}>
            <input type="checkbox" checked={suppress} onChange={(e) => setSuppress(e.target.checked)} style={{ marginTop: 4 }} />
            <span>
              Also add this address to the do-not-mail list, so it can never be mailed again, even if someone re-subscribes it.
              Untick only if the family wants to be able to sign up again later.
            </span>
          </label>
          {error && <p className="error">{error}</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="danger" disabled={busy} onClick={confirm}>
              Delete permanently
            </button>
            <button className="secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
