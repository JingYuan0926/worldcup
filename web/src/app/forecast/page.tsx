import { CrowdForecast } from "@/components/CrowdForecast";
import { Panel, Pill, SectionTitle, Stat } from "@/components/ui";
import { CROWD, FIXTURE, POOLS } from "@/lib/mockData";
import { potUsdt } from "@/lib/payoutPreview";
import { usdt } from "@/lib/format";

export const metadata = {
  title: "Crowd forecast — Exact Match",
  description:
    "Every staked prediction is a weighted vote. Exact Match turns its pools into a live, crowd-sourced forecast dataset for each match.",
};

export default function ForecastPage() {
  const totalEntries = POOLS.reduce((s, p) => s + (CROWD[p.id]?.length ?? 0), 0);
  const totalPot = POOLS.reduce((s, p) => s + potUsdt(CROWD[p.id] ?? []), 0);

  return (
    <div className="space-y-8">
      <SectionTitle
        kicker="Data producer"
        title="Crowd forecast"
        right={<Pill tone="pitch">{POOLS.length} live pools</Pill>}
      />

      {/* explainer */}
      <Panel className="p-6">
        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              The pools don&apos;t just take predictions — they{" "}
              <span className="text-pitch">produce a forecast</span>.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
              Every entry is a number backed by staked USDT, so each pool is a live,
              money-weighted probability distribution over the outcome. Read together they form a
              crowd-sourced forecast dataset for{" "}
              <span className="text-home">{FIXTURE.participant1}</span> vs{" "}
              <span className="text-away">{FIXTURE.participant2}</span> — exportable, timestamped,
              and ready to sit next to TxLINE&apos;s own consensus odds. Toggle each card between
              stake-weighted and one-vote-per-entry to see where the money and the crowd disagree.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Panel className="p-4 text-center">
              <Stat label="Pools" value={POOLS.length} tone="pitch" />
            </Panel>
            <Panel className="p-4 text-center">
              <Stat label="Votes" value={totalEntries} tone="pitch" />
            </Panel>
            <Panel className="p-4 text-center">
              <Stat label="Staked" value={`${usdt(totalPot)}`} tone="money" />
            </Panel>
          </div>
        </div>
      </Panel>

      {/* forecast grid */}
      <section>
        <SectionTitle
          kicker={FIXTURE.competition}
          title={`${FIXTURE.participant1} vs ${FIXTURE.participant2}`}
          right={<Pill tone="muted">crowd distribution per pool</Pill>}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          {POOLS.map((p) => (
            <CrowdForecast key={p.id} pool={p} crowd={CROWD[p.id] ?? []} />
          ))}
        </div>
      </section>
    </div>
  );
}
