"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";

export type Audience = { id: string; name: string; recipients: number };

/** Searchable multi-select of audiences, shown as removable chips. */
export default function RecipientPicker(props: { audiences: Audience[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = props.value.map((id) => props.audiences.find((a) => a.id === id)).filter((a): a is Audience => !!a);
  const q = query.trim().toLowerCase();
  const options = props.audiences.filter((a) => !q || a.name.toLowerCase().includes(q));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function toggle(id: string) {
    props.onChange(props.value.includes(id) ? props.value.filter((x) => x !== id) : [...props.value, id]);
    setQuery("");
    input.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const n = options.length;
      if (n) setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
    } else if (e.key === "Enter" && open && options[active]) {
      e.preventDefault();
      toggle(options[active].id);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !query && props.value.length) {
      props.onChange(props.value.slice(0, -1));
    }
  }

  return (
    <div className={`combo${props.disabled ? " disabled" : ""}`} ref={root}>
      <div
        className="combo-box"
        onMouseDown={(e) => {
          if (props.disabled || e.target === input.current) return;
          e.preventDefault();
          input.current?.focus();
          setOpen((o) => !o);
        }}
      >
        {selected.map((a) => (
          <span key={a.id} className="chip">
            {a.name}
            {!props.disabled && (
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => toggle(a.id)}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </span>
        ))}
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label="Search and select recipients"
          aria-activedescendant={open && options[active] ? `${listId}-${options[active].id}` : undefined}
          placeholder={selected.length ? "" : "Search and select recipients"}
          value={query}
          disabled={props.disabled}
          onFocus={() => setOpen(true)}
          onMouseDown={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <span className="combo-caret">
          <Icon name="chevronDown" />
        </span>
      </div>
      {open && !props.disabled && (
        <ul className="combo-list" role="listbox" id={listId} aria-multiselectable="true">
          {options.map((a, i) => {
            const on = props.value.includes(a.id);
            return (
              <li
                key={a.id}
                id={`${listId}-${a.id}`}
                role="option"
                aria-selected={on}
                className={i === active ? "active" : undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggle(a.id)}
              >
                <input type="checkbox" checked={on} readOnly tabIndex={-1} aria-hidden="true" />
                <span>{a.name}</span>
                <span className="muted">
                  {a.recipients} {a.recipients === 1 ? "family" : "families"}
                </span>
              </li>
            );
          })}
          {options.length === 0 && <li className="muted empty">No audience matches “{query}”. Create audiences on the Audiences page.</li>}
        </ul>
      )}
    </div>
  );
}
