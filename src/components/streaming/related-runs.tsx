import Link from "next/link";
import { Sparkles, ArrowUpRight } from "lucide-react";
import type { SimilarRunRow } from "@/lib/db/queries";
import { RunTimestamp } from "@/components/run-timestamp";

export interface RelatedRunsProps {
  runs: SimilarRunRow[];
}

/**
 * "Related research" panel — shown beneath the ResultCard on
 * /research/[id]. Lists the K closest past runs by cosine distance
 * against the current run's recon-brief embedding (server-component
 * fetch via `findSimilarRuns()`).
 *
 * Concrete RAG signal for the demo: the same pgvector + HNSW index that
 * powers the cache also surfaces semantically-similar companies the
 * visitor has already researched. Empty list (cold start, only one run
 * in the DB, etc.) → component returns null and nothing renders.
 *
 * Distance display: pgvector cosine distance is in [0, 2]; we surface
 * a similarity percentage (1 - distance/2) capped at 99% so identical
 * vectors don't read as "100% similar" (they wouldn't appear here
 * anyway since the source run is excluded).
 */
export function RelatedRuns({ runs }: RelatedRunsProps) {
  if (runs.length === 0) return null;

  return (
    <section
      aria-labelledby="related-runs-heading"
      className="mt-10 rounded-2xl border border-border bg-surface-1/40 p-5 sm:p-6"
    >
      <header className="flex items-center gap-2 text-sm">
        <Sparkles className="size-4 text-brand-secondary" aria-hidden />
        <h2
          id="related-runs-heading"
          className="font-medium text-foreground"
        >
          Related research
        </h2>
        <span className="text-subtle-foreground">·</span>
        <span className="text-muted-foreground">
          via vector similarity on the recon brief
        </span>
      </header>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {runs.map((run) => {
          const similarityPct = Math.min(
            99,
            Math.max(0, Math.round((1 - run.distance / 2) * 100))
          );
          return (
            <li key={run.id}>
              <Link
                href={`/research/${run.id}`}
                className="group block h-full rounded-xl border border-border bg-surface-1 p-4 transition-colors duration-200 [transition-timing-function:var(--ease-out)] hover:border-brand-secondary/60 hover:bg-surface-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium text-foreground line-clamp-1">
                    {run.company_name ?? run.target_domain}
                  </h3>
                  <ArrowUpRight
                    className="size-4 shrink-0 text-subtle-foreground transition-colors group-hover:text-brand-secondary"
                    aria-hidden
                  />
                </div>
                {run.one_liner && (
                  <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
                    {run.one_liner}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-wide text-subtle-foreground">
                  <span className="truncate">{run.target_domain}</span>
                  <span className="shrink-0 text-brand-secondary">
                    {similarityPct}% match
                  </span>
                </div>
                {run.completed_at && (
                  <RunTimestamp
                    iso={run.completed_at}
                    className="mt-1.5 block font-mono text-[11px] tabular-nums text-subtle-foreground/70"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
