import clsx from "clsx";
import { Panel, Pill, SectionTitle, Stat } from "@/components/ui";
import { LEADERBOARD } from "@/lib/mockData";
import { shortWallet, usdt } from "@/lib/format";
import type { LeaderRow } from "@/lib/types";

/**
 * Precision Score leaderboard (README §5.3) — a Trepa-style reputation metric,
 * strictly off-chain and display-only. It never touches the pot or the program.
 * Rows arrive pre-sorted by precision (descending) from the mock dataset.
 */

const PREC_MIN = 100;
const PREC_MAX = 1000;

/** Normalized 0..1 fill for the precision meter. */
function precFraction(p: number): number {
  return Math.max(0, Math.min(1, (p - PREC_MIN) / (PREC_MAX - PREC_MIN)));
}

type Tier = { label: string; text: string; bar: string; ring: string; chip: string };

function tierOf(p: number): Tier {
  if (p >= 800)
    return { label: "Elite", text: "text-pitch", bar: "bg-pitch", ring: "border-pitch/40", chip: "pitch" };
  if (p >= 600)
    return { label: "Sharp", text: "text-money", bar: "bg-money", ring: "border-money/40", chip: "money" };
  if (p >= 400)
    return { label: "Rising", text: "text-home", bar: "bg-home", ring: "border-home/40", chip: "home" };
  return { label: "Newcomer", text: "text-muted", bar: "bg-muted/70", ring: "border-line", chip: "muted" };
}

/** Slim precision meter: a normalized bar plus the raw 100–1000 figure. */
function Meter({ p, showNumber = true }: { p: number; showNumber?: boolean }) {
  const tier = tierOf(p);
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
        <div
          className={clsx("h-full rounded-full", tier.bar)}
          style={{ width: `${Math.round(precFraction(p) * 100)}%` }}
        />
      </div>
      {showNumber && (
        <span className={clsx("num w-11 shrink-0 text-right text-sm font-semibold", tier.text)}>{p}</span>
      )}
    </div>
  );
}

/** Signed net USDT — green when up, away/pink when down. */
function Net({ n, className }: { n: number; className?: string }) {
  const up = n >= 0;
  return (
    <span className={clsx("num font-semibold", up ? "text-pitch" : "text-away", className)}>
      {usdt(n, { sign: true })}
      <span className="ml-1 text-[11px] font-normal text-muted">USDT</span>
    </span>
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];
// #1 sits center + lifted; #2 left, #3 right on the podium row.
const PODIUM_ORDER = ["sm:order-2", "sm:order-1", "sm:order-3"];

function PodiumCard({ row, place }: { row: LeaderRow; place: number }) {
  const tier = tierOf(row.precision);
  const first = place === 0;
  return (
    <div
      className={clsx(
        "relative flex flex-1 flex-col items-center rounded-2xl border bg-panel/80 p-5 text-center shadow-card transition",
        first ? "border-money/50 sm:-translate-y-3 shadow-glow" : tier.ring,
        PODIUM_ORDER[place],
      )}
    >
      <div className="text-3xl leading-none" aria-hidden>
        {MEDALS[place]}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="num text-xs font-semibold text-muted">#{row.rank}</span>
        <Pill tone={tier.chip as "muted" | "pitch" | "money" | "home"}>{tier.label}</Pill>
      </div>
      <div className="mt-2 truncate text-base font-semibold tracking-tight" title={row.handle}>
        {row.handle}
      </div>
      <div className="num text-xs text-muted">{shortWallet(row.wallet)}</div>

      <div className="mt-4">
        <span className={clsx("num font-semibold tabular-nums", first ? "text-4xl" : "text-3xl", tier.text)}>
          {row.precision}
        </span>
        <span className="num text-sm text-muted">/1000</span>
      </div>
      <div className="mt-2 w-full">
        <Meter p={row.precision} showNumber={false} />
      </div>

      <div className="mt-4 flex w-full items-center justify-between border-t border-line pt-3 text-sm">
        <span className="text-muted">
          <span className="num font-semibold text-ink">{row.pools}</span> pools
        </span>
        <Net n={row.netUsdt} />
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const rows = LEADERBOARD;
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  const topScore = rows[0]?.precision ?? 0;
  const avgPrecision = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.precision, 0) / rows.length)
    : 0;
  const poolsScored = rows.reduce((s, r) => s + r.pools, 0);

  const GRID = "grid-cols-[2.75rem_minmax(0,1.3fr)_minmax(0,1.7fr)_4rem_7.5rem]";

  return (
    <div className="space-y-8">
      <SectionTitle
        kicker="Trepa-style reputation"
        title="Precision leaderboard"
        right={<Pill tone="muted">Off-chain · display only</Pill>}
      />

      {/* Top-line stats */}
      <Panel className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
        <Stat label="Forecasters" value={rows.length} />
        <Stat label="Top score" value={topScore} tone="pitch" />
        <Stat label="Avg precision" value={avgPrecision} />
        <Stat label="Pools scored" value={poolsScored} tone="money" />
      </Panel>

      {/* Podium — top 3 */}
      <section>
        <SectionTitle kicker="The podium" title="Sharpest forecasters" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          {podium.map((row, i) => (
            <PodiumCard key={row.wallet} row={row} place={i} />
          ))}
        </div>
      </section>

      {/* Explainer */}
      <Panel className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-pitch/12 text-lg text-pitch">
            ✦
          </span>
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold tracking-tight">How the Precision Score works</h3>
              <Pill tone="muted">100–1000</Pill>
              <Pill tone="pitch">Off-chain</Pill>
              <Pill tone="muted">Display only</Pill>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              Precision Score is a Trepa-style reputation metric averaging normalized accuracy
              across pools — it never touches money or the program.
            </p>
          </div>
        </div>
      </Panel>

      {/* Full standings */}
      <section>
        <SectionTitle
          kicker="Standings"
          title="The chasing pack"
          right={<Pill tone="muted">Ranks 4–{rows.length}</Pill>}
        />

        {/* Desktop: table */}
        <Panel className="hidden overflow-hidden lg:block">
          <div
            className={clsx(
              "grid gap-3 px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted",
              GRID,
            )}
          >
            <div>Rank</div>
            <div>Forecaster</div>
            <div>Precision</div>
            <div className="text-right">Pools</div>
            <div className="text-right">Net</div>
          </div>
          {rest.map((row) => (
            <div
              key={row.wallet}
              className={clsx(
                "grid items-center gap-3 border-t border-line px-4 py-3 transition hover:bg-panel-2/60",
                GRID,
              )}
            >
              <div className="num text-sm font-semibold text-muted">#{row.rank}</div>
              <div className="min-w-0">
                <div className="truncate font-medium">{row.handle}</div>
                <div className="num truncate text-xs text-muted">{shortWallet(row.wallet)}</div>
              </div>
              <Meter p={row.precision} />
              <div className="num text-right text-sm text-muted">{row.pools}</div>
              <div className="text-right">
                <Net n={row.netUsdt} />
              </div>
            </div>
          ))}
        </Panel>

        {/* Mobile / tablet: cards */}
        <div className="space-y-3 lg:hidden">
          {rest.map((row) => (
            <div
              key={row.wallet}
              className="flex items-center gap-3 rounded-xl border border-line bg-panel/80 p-4 shadow-card"
            >
              <div className="num grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel-2 text-sm font-semibold text-muted">
                {row.rank}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate font-medium">{row.handle}</div>
                  <Net n={row.netUsdt} />
                </div>
                <div className="num mb-2 truncate text-xs text-muted">
                  {shortWallet(row.wallet)} · {row.pools} pools
                </div>
                <Meter p={row.precision} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
