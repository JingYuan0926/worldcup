import Link from "next/link";
import { CountryFlag } from "@/components/timeline/TimelineIcons";
import { Panel, Pill, SectionTitle } from "@/components/ui";
import {
  fixtureKickoffLabel,
  RECORDED_FIXTURES,
  type RecordedFixture,
} from "@/lib/fixtures";

const TOTAL_RECORDED_SECONDS = RECORDED_FIXTURES.reduce(
  (sum, fixture) => sum + fixture.recording.seconds,
  0,
);

function recordedDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${hours}h ${minutes}m`;
}

function MatchCard({ fixture }: { fixture: RecordedFixture }) {
  return (
    <Link
      href={`/match/${fixture.fixtureId}`}
      className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch focus-visible:ring-offset-2"
      aria-label={`Open ${fixture.participant1} versus ${fixture.participant2} recording`}
    >
      <Panel className="h-full overflow-hidden p-0 transition duration-200 group-hover:-translate-y-0.5 group-hover:border-pitch/40 group-hover:shadow-lg">
        <div className="flex items-center justify-between border-b border-line bg-panel-2/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <Pill tone="pitch">Complete recording</Pill>
            <span className="hidden text-xs text-muted sm:inline">Quarterfinal</span>
          </div>
          <span className="num text-xs text-muted">#{fixture.fixtureId}</span>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <div className="min-w-0 text-center">
              <CountryFlag
                code={fixture.p1Code}
                className="mx-auto h-8 w-12 overflow-hidden rounded-sm border border-line shadow-sm"
              />
              <div className="mt-2 truncate font-semibold text-ink">{fixture.participant1}</div>
            </div>

            <div className="text-center">
              <div className="num whitespace-nowrap text-3xl font-semibold tracking-tight text-ink">
                {fixture.result.home}
                <span className="px-2 text-muted">–</span>
                {fixture.result.away}
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                {fixture.result.label}
              </div>
            </div>

            <div className="min-w-0 text-center">
              <CountryFlag
                code={fixture.p2Code}
                className="mx-auto h-8 w-12 overflow-hidden rounded-sm border border-line shadow-sm"
              />
              <div className="mt-2 truncate font-semibold text-ink">{fixture.participant2}</div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-xs">
            <span className="text-muted">{fixtureKickoffLabel(fixture.startTime)} MYT</span>
            <span className="font-semibold text-pitch transition group-hover:translate-x-0.5">
              Open timeline →
            </span>
          </div>
        </div>
      </Panel>
    </Link>
  );
}

export default function HomePage() {
  const latestFixture = RECORDED_FIXTURES.at(-1)!;

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-3xl border border-line bg-white pitch-stripes shadow-card">
        <div className="relative z-10 grid gap-8 p-6 sm:p-9 md:grid-cols-[1.35fr_1fr] md:items-center">
          <div>
            <Pill tone="pitch">Proof-settled precision pools</Pill>
            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">
              Four real matches.
              <br />
              <span className="text-muted">Every second captured.</span>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
              Explore complete World Cup timelines captured from TxLINE. Goals, corners and cards
              become proof-verifiable precision markets on Solana—no admin deciding the result.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href={`/match/${latestFixture.fixtureId}`}
                className="rounded-lg bg-pitch px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-95"
              >
                Open latest recording →
              </Link>
              <Link
                href="/replay"
                className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-medium text-ink transition hover:border-pitch/30 hover:bg-panel-2"
              >
                Judges&apos; replay room
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Matches", value: RECORDED_FIXTURES.length },
              { label: "Captured", value: recordedDuration(TOTAL_RECORDED_SECONDS) },
              { label: "Missing", value: "0 sec" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-line bg-white/90 p-4 text-center shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {item.label}
                </div>
                <div className="num mt-1 text-xl font-semibold text-pitch">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <SectionTitle
          kicker="TxLINE · devnet"
          title="Recorded World Cup matches"
          right={<Pill tone="muted">4 complete · zero opening gaps</Pill>}
        />
        <div className="grid gap-4 md:grid-cols-2">
          {RECORDED_FIXTURES.map((fixture) => (
            <MatchCard key={fixture.fixtureId} fixture={fixture} />
          ))}
        </div>
      </section>

      <Panel className="grid gap-5 p-6 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-pitch">How it settles</div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            The recording shows the match. The Merkle proof moves the pot.
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            Predictions lock before kickoff. A permissionless crank submits TxLINE&apos;s proof of
            the real statistic, and the program deterministically pays the closest entries.
          </p>
        </div>
        <Link
          href="/forecast"
          className="inline-flex justify-center rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:border-pitch/30 hover:bg-panel-2"
        >
          View crowd forecast
        </Link>
      </Panel>
    </div>
  );
}
