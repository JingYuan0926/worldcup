import { MOCK_PROOF } from "@/lib/mockData";
import { Pill } from "@/components/ui";

/**
 * The judging-gold proof panel (README §5.4 item 4). Renders a TxLINE Merkle
 * settlement proof: the predicate, the on-chain root PDA, a Solana Explorer
 * link for the settle tx, the raw proof JSON, and a "verify yourself" ladder
 * that walks each Merkle sibling from the stat leaf up to the on-chain root.
 *
 * Uses native <details> so it stays a server component (no client JS).
 */

type Proof = typeof MOCK_PROOF;
type ProofNode = Proof["fixtureProof"][number];

function truncHash(h: string): string {
  const clean = h.startsWith("0x") ? h.slice(2) : h;
  if (clean.length <= 20) return clean;
  return `${clean.slice(0, 10)}…${clean.slice(-8)}`;
}

function Rung({ node, index }: { node: ProofNode; index: number }) {
  return (
    <li className="relative flex items-center gap-3 pl-6">
      {/* connector dot */}
      <span className="absolute left-[3px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border border-money/60 bg-panel" />
      <span
        className={
          "num inline-flex h-5 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold " +
          (node.isRight
            ? "bg-home/15 text-home"
            : "bg-away/15 text-away")
        }
        title={node.isRight ? "sibling hashed on the right" : "sibling hashed on the left"}
      >
        {node.isRight ? "R" : "L"}
      </span>
      <code className="num truncate text-[11px] text-muted" title={node.hash}>
        {truncHash(node.hash)}
      </code>
      <span className="ml-auto shrink-0 text-[10px] text-muted/70">
        level {index + 1}
      </span>
    </li>
  );
}

function Ladder({
  title,
  leafLabel,
  nodes,
  topLabel,
}: {
  title: string;
  leafLabel: string;
  nodes: ProofNode[];
  topLabel: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel-2/60 p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {title}
      </div>
      <div className="mb-2 flex items-center gap-2 text-[11px]">
        <span className="rounded bg-pitch/15 px-1.5 py-0.5 font-semibold text-pitch">leaf</span>
        <code className="num truncate text-[11px] text-muted">{leafLabel}</code>
      </div>
      <ol className="relative space-y-1.5 border-l border-money/25 pl-1">
        {nodes.map((n, i) => (
          <Rung key={i} node={n} index={i} />
        ))}
      </ol>
      <div className="mt-2 flex items-center gap-2 pl-6 text-[11px]">
        <span className="rounded bg-money/15 px-1.5 py-0.5 font-semibold text-money">= {topLabel}</span>
        <span className="text-pitch">✓ matches on-chain root</span>
      </div>
    </div>
  );
}

export function ProofViewer({ proof = MOCK_PROOF }: { proof?: Proof }) {
  const explorerUrl = `https://explorer.solana.com/tx/${proof.settleTx}?cluster=devnet`;

  return (
    <div className="rounded-xl border border-money/30 bg-gradient-to-b from-money/[0.08] to-transparent p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-money/15 text-money">◆</span>
          <div>
            <div className="text-sm font-semibold tracking-tight">TxLINE Merkle settlement proof</div>
            <div className="num text-[11px] text-muted">
              fixture {proof.fixtureId} · seq #{proof.seq}
            </div>
          </div>
        </div>
        <Pill tone="money">on-chain verifiable</Pill>
      </div>

      {/* predicate */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm">
        <span className="text-[11px] uppercase tracking-wide text-muted">Predicate</span>
        <code className="num text-ink">
          stat {proof.statKey}
          {proof.statKey2 ? `+${proof.statKey2}` : ""}
        </code>
        <Pill tone="pitch">{proof.predicate.comparison}</Pill>
        <code className="num text-money">{proof.predicate.threshold}</code>
        <span className="ml-auto text-[11px] text-muted">threshold met at settlement</span>
      </div>

      {/* key facts */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-panel-2 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted">On-chain root PDA</div>
          <code className="num mt-0.5 block truncate text-[12px] text-ink" title={proof.rootPda}>
            {proof.rootPda}
          </code>
        </div>
        <div className="rounded-lg border border-line bg-panel-2 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted">
            events_sub_tree_root
          </div>
          <code
            className="num mt-0.5 block truncate text-[12px] text-ink"
            title={proof.eventStatsSubTreeRoot}
          >
            {truncHash(proof.eventStatsSubTreeRoot)}
          </code>
        </div>
      </div>

      {/* explorer link */}
      <a
        href={explorerUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex items-center justify-between rounded-lg border border-pitch/30 bg-pitch/5 px-3 py-2 text-sm transition hover:bg-pitch/10"
      >
        <span className="flex items-center gap-2">
          <span className="text-pitch">↗</span>
          <span>Settle transaction on Solana Explorer</span>
        </span>
        <code className="num truncate pl-3 text-[11px] text-muted">{truncHash(proof.settleTx)}</code>
      </a>

      {/* verify yourself */}
      <details className="group mt-3 rounded-lg border border-line bg-panel-2/60">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-ink">
          <span className="flex items-center gap-2">
            <span className="text-money transition group-open:rotate-90">▶</span>
            Verify yourself — walk the Merkle proof
          </span>
          <span className="text-[11px] text-muted">
            {proof.statProof.length + proof.fixtureProof.length} sibling hashes
          </span>
        </summary>
        <div className="space-y-3 px-3 pb-3">
          <p className="text-[11px] leading-relaxed text-muted">
            Hash the settled stat leaf, fold in each sibling in order, and the result equals the
            root the program already committed on-chain. No trust — just SHA-256.
          </p>
          <Ladder
            title="1 · Stat inclusion"
            leafLabel={`stat ${proof.statKey}+${proof.statKey2} = ${proof.predicate.threshold}`}
            nodes={proof.statProof}
            topLabel="events_sub_tree_root"
          />
          <Ladder
            title="2 · Fixture inclusion"
            leafLabel={truncHash(proof.eventStatsSubTreeRoot)}
            nodes={proof.fixtureProof}
            topLabel="root PDA"
          />
        </div>
      </details>

      {/* raw json */}
      <details className="group mt-3 rounded-lg border border-line bg-panel-2/60">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-ink">
          <span className="flex items-center gap-2">
            <span className="text-money transition group-open:rotate-90">▶</span>
            Raw proof JSON
          </span>
          <span className="text-[11px] text-muted">as returned by TxLINE</span>
        </summary>
        <div className="overflow-x-auto px-3 pb-3">
          <pre className="num text-[11px] leading-relaxed text-muted">
            {JSON.stringify(proof, null, 2)}
          </pre>
        </div>
      </details>
    </div>
  );
}
