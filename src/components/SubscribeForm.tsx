"use client";

import Script from "next/script";
import { useState } from "react";

export default function SubscribeForm(props: { formToken: string; grades: string[]; turnstileSiteKey?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("busy");
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) {
      setState("done");
      setMessage(data.message);
    } else {
      setState("error");
      setMessage(data.error ?? "Something went wrong. Please try again.");
    }
  }

  if (state === "done") {
    return (
      <div role="status">
        <h2>Check your email</h2>
        <p>{message}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate={false}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      <label htmlFor="grade">Grade</label>
      <select id="grade" name="grade" required defaultValue="">
        <option value="" disabled>
          Choose a grade
        </option>
        {props.grades.map((g) => (
          <option key={g} value={g}>
            {g === "K" ? "Kindergarten" : g === "TK" ? "Transitional K" : `Grade ${g}`}
          </option>
        ))}
      </select>
      <label htmlFor="teacher">
        Teacher <span className="muted">(optional)</span>
      </label>
      <input id="teacher" name="teacher" type="text" maxLength={80} autoComplete="off" />
      {/* Honeypot: hidden from people, filled by naive bots. */}
      <div className="hp" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <input type="hidden" name="formToken" value={props.formToken} />
      {props.turnstileSiteKey && (
        <>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
          <div className="cf-turnstile" data-sitekey={props.turnstileSiteKey} style={{ marginTop: 12 }} />
        </>
      )}
      <p className="muted" style={{ fontSize: 14 }}>
        By subscribing you agree to receive PTA emails. We&apos;ll send a confirmation link first.
      </p>
      {state === "error" && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      <button type="submit" className="full" disabled={state === "busy"}>
        {state === "busy" ? "Subscribing…" : "Subscribe"}
      </button>
    </form>
  );
}
