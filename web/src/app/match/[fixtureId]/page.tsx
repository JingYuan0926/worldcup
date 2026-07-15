import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExactTimeTimeline } from "@/components/timeline/ExactTimeTimeline";
import { getRecordedFixture, RECORDED_FIXTURES } from "@/lib/fixtures";
import { poolsForFixture } from "@/lib/mockData";

interface MatchPageProps {
  params: { fixtureId: string };
}

export function generateStaticParams() {
  return RECORDED_FIXTURES.map((fixture) => ({ fixtureId: String(fixture.fixtureId) }));
}

export function generateMetadata({ params }: MatchPageProps): Metadata {
  const fixture = getRecordedFixture(params.fixtureId);
  if (!fixture) return { title: "Recording not found — Exact Match" };
  return {
    title: `${fixture.participant1} vs ${fixture.participant2} — Exact Match`,
    description: `Replay the complete TxLINE recording for ${fixture.participant1} vs ${fixture.participant2}.`,
  };
}

export default function MatchPage({ params }: MatchPageProps) {
  const fixture = getRecordedFixture(params.fixtureId);
  if (!fixture) notFound();

  const whenPools = poolsForFixture(fixture).filter((pool) => pool.kind === "WHEN");

  return (
    <div className="match-page fixed inset-0 z-40 overflow-y-auto bg-white [color-scheme:light]">
      <ExactTimeTimeline key={fixture.fixtureId} fixture={fixture} pools={whenPools} />
    </div>
  );
}
