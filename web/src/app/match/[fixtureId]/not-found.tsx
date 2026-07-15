import Link from "next/link";
import { Panel, Pill } from "@/components/ui";

export default function MatchNotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <Panel className="p-8">
        <Pill tone="muted">Recording unavailable</Pill>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">That match was not captured.</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Choose one of the four complete TxLINE recordings on the matches page.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-lg bg-pitch px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-95"
        >
          View recorded matches
        </Link>
      </Panel>
    </div>
  );
}
