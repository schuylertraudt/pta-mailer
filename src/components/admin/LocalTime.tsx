"use client";

import { useEffect, useState } from "react";

/** A time shown in the viewer's own time zone (the server renders in UTC). */
export default function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }));
  }, [iso]);
  return <time dateTime={iso}>{text ?? iso.slice(0, 16).replace("T", " ") + " UTC"}</time>;
}
