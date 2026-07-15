"use client";

import { useEffect, useState } from "react";
import { countdown } from "@/lib/format";

/** Live-ticking countdown to a target unix-ms. Renders "LIVE" once reached. */
export function Countdown({ target, prefix }: { target: number; prefix?: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Avoid hydration mismatch: render a stable placeholder until mounted.
  if (now === null) {
    return <span className="num text-muted">—:—:—</span>;
  }
  const { text, done } = countdown(target, now);
  return (
    <span className={`num ${done ? "text-pitch" : "text-ink"}`}>
      {prefix && !done ? `${prefix} ` : ""}
      {text}
    </span>
  );
}
