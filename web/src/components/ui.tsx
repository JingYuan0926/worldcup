import clsx from "clsx";

export function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-line bg-panel/80 shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Pill({
  tone = "muted",
  className,
  children,
}: {
  tone?: "muted" | "pitch" | "money" | "home" | "away";
  className?: string;
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    muted: "border-line text-muted",
    pitch: "border-pitch/40 text-pitch bg-pitch/10",
    money: "border-money/40 text-money bg-money/10",
    home: "border-home/40 text-home bg-home/10",
    away: "border-away/40 text-away bg-away/10",
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SectionTitle({
  kicker,
  title,
  right,
}: {
  kicker?: string;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        {kicker && (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            {kicker}
          </div>
        )}
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      {right && <div className="min-w-0">{right}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "ink" | "pitch" | "money";
}) {
  const c = tone === "pitch" ? "text-pitch" : tone === "money" ? "text-money" : "text-ink";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={clsx("num text-lg font-semibold", c)}>{value}</div>
    </div>
  );
}
