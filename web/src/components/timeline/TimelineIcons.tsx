import type { CSSProperties } from "react";

export type TimelineEventKind = "goal" | "corner" | "yellow" | "red";

export function EventIcon({ kind, className = "h-5 w-5" }: { kind: TimelineEventKind; className?: string }) {
  const source =
    kind === "goal"
      ? "/soccer-ball-thin-svgrepo-com.svg"
      : kind === "corner"
        ? "/flag-svgrepo-com.svg"
        : "/rectangle-vertical-svgrepo-com.svg?v=solid-2";
  const color = kind === "yellow" ? "#D9A514" : kind === "red" ? "#DC2626" : "currentColor";
  const mask: CSSProperties = {
    backgroundColor: color,
    maskImage: `url(${source})`,
    maskPosition: "center",
    maskRepeat: "no-repeat",
    maskSize: "contain",
    WebkitMaskImage: `url(${source})`,
    WebkitMaskPosition: "center",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
  };
  return (
    <span className={`inline-block shrink-0 ${className}`} style={mask} aria-hidden="true" />
  );
}

export function CountryFlag({ code, className = "h-7 w-10" }: { code?: string; className?: string }) {
  const normalized = code?.toUpperCase();
  if (normalized === "FRA") {
    return (
      <svg viewBox="0 0 30 20" className={className} role="img" aria-label="France flag">
        <rect width="10" height="20" fill="#1B4F9C" />
        <rect x="10" width="10" height="20" fill="#F7F7F2" />
        <rect x="20" width="10" height="20" fill="#E13B45" />
      </svg>
    );
  }
  if (normalized === "MAR") {
    return (
      <svg viewBox="0 0 30 20" className={className} role="img" aria-label="Morocco flag">
        <rect width="30" height="20" fill="#C9293B" />
        <path d="m15 5 1.47 4.52h4.75l-3.84 2.79 1.47 4.52L15 14.04l-3.85 2.79 1.47-4.52-3.84-2.79h4.75L15 5Z" fill="none" stroke="#147A4A" strokeWidth="1.15" />
      </svg>
    );
  }
  if (normalized === "ESP") {
    return (
      <svg viewBox="0 0 30 20" className={className} role="img" aria-label="Spain flag">
        <rect width="30" height="20" fill="#AA151B" />
        <rect y="5" width="30" height="10" fill="#F1BF00" />
      </svg>
    );
  }
  if (normalized === "BEL") {
    return (
      <svg viewBox="0 0 30 20" className={className} role="img" aria-label="Belgium flag">
        <rect width="10" height="20" fill="#111111" />
        <rect x="10" width="10" height="20" fill="#FDDA24" />
        <rect x="20" width="10" height="20" fill="#EF3340" />
      </svg>
    );
  }
  if (normalized === "NOR") {
    return (
      <svg viewBox="0 0 30 20" className={className} role="img" aria-label="Norway flag">
        <rect width="30" height="20" fill="#BA0C2F" />
        <path d="M0 8h30v5H0zM10 0h5v20h-5z" fill="#FFFFFF" />
        <path d="M0 9h30v3H0zM11 0h3v20h-3z" fill="#00205B" />
      </svg>
    );
  }
  if (normalized === "ENG") {
    return (
      <svg viewBox="0 0 30 20" className={className} role="img" aria-label="England flag">
        <rect width="30" height="20" fill="#FFFFFF" />
        <path d="M0 8h30v4H0zM13 0h4v20h-4z" fill="#CE1124" />
      </svg>
    );
  }
  if (normalized === "ARG") {
    return (
      <svg viewBox="0 0 30 20" className={className} role="img" aria-label="Argentina flag">
        <rect width="30" height="20" fill="#74ACDF" />
        <rect y="6.67" width="30" height="6.66" fill="#FFFFFF" />
        <circle cx="15" cy="10" r="1.75" fill="#F6B40E" stroke="#85340A" strokeWidth="0.3" />
      </svg>
    );
  }
  if (normalized === "SUI") {
    return (
      <svg viewBox="0 0 30 20" className={className} role="img" aria-label="Switzerland flag">
        <rect width="30" height="20" fill="#DA291C" />
        <path d="M13 4h4v4h4v4h-4v4h-4v-4H9V8h4z" fill="#FFFFFF" />
      </svg>
    );
  }
  return <div className={`${className} rounded bg-slate-200`} aria-label={`${code ?? "Team"} flag`} />;
}
