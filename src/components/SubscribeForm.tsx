"use client";

import Script from "next/script";
import { useRef, useState } from "react";
import { MailIcon, styles as s } from "@/components/public/PublicShell";

type Props = { formToken: string; schools: string[]; turnstileSiteKey?: string; title: string; intro: string };

export default function SubscribeForm(props: Props) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [resend, setResend] = useState<"" | "busy" | "sent" | "error">("");
  const submitted = useRef<Record<string, FormDataEntryValue>>({});
  const [email, setEmail] = useState("");

  async function post(body: Record<string, FormDataEntryValue>) {
    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    return { ok: !!res?.ok, error: (data.error as string | undefined) ?? "Something went wrong. Please try again." };
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("busy");
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    const r = await post(body);
    if (r.ok) {
      submitted.current = body;
      setEmail(String(body.email ?? "").trim());
      setResend("");
      setState("done");
    } else {
      setError(r.error);
      setState("error");
    }
  }

  async function onResend() {
    setResend("busy");
    const r = await post(submitted.current);
    setResend(r.ok ? "sent" : "error");
    if (!r.ok) setError(r.error);
  }

  if (state === "done") {
    return (
      <div className={s.status} role="status">
        <MailIcon />
        <h1 className={s.h1}>Check your email</h1>
        <p className={s.lead}>
          We sent a confirmation link to <strong style={{ color: "#16202B", fontWeight: 600 }}>{email}</strong>. Click the
          link to finish subscribing.
        </p>
        <div className={s.card} style={{ width: "100%", boxSizing: "border-box", gap: 10 }}>
          <div className={s.label}>Don&apos;t see it?</div>
          <p className={s.small}>
            Check your spam or promotions folder. The link expires in 7 days. If you&apos;re already subscribed, no new link
            is sent.
          </p>
          {resend === "sent" && <p className={s.small}>Sent again.</p>}
          {resend === "error" && <p className={s.error}>{error}</p>}
          <div className={s.linkRow}>
            <button type="button" className={s.linkButton} onClick={onResend} disabled={resend === "busy" || resend === "sent"}>
              {resend === "busy" ? "Sending…" : "Resend link"}
            </button>
            <button type="button" className={s.linkButton} onClick={() => setState("idle")}>
              Use a different email
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={s.intro}>
        <h1 className={s.h1}>{props.title}</h1>
        <p className={s.lead}>{props.intro}</p>
      </div>
      <form className={s.card} onSubmit={onSubmit}>
        <div className={s.field}>
          <label htmlFor="email" className={s.label}>
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="name@example.com"
            required
            defaultValue={email}
            className={s.input}
          />
        </div>
        <div className={s.field}>
          <label htmlFor="school" className={s.label}>
            Home elementary school
          </label>
          <select id="school" name="school" required defaultValue={String(submitted.current.school ?? "")} className={s.input}>
            <option value="" disabled>
              Choose a school
            </option>
            {props.schools.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {/* Honeypot: hidden from people, filled by naive bots. */}
        <div className={s.hp} aria-hidden="true">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <input type="hidden" name="formToken" value={props.formToken} />
        {props.turnstileSiteKey && (
          <>
            <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
            <div className="cf-turnstile" data-sitekey={props.turnstileSiteKey} />
          </>
        )}
        {state === "error" && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={s.button} disabled={state === "busy"}>
          {state === "busy" ? "Subscribing…" : "Subscribe"}
        </button>
        <p className={s.note}>We&apos;ll email you a link to confirm your subscription.</p>
      </form>
    </>
  );
}
