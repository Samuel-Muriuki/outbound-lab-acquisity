import Link from "next/link";
import { getRecentRuns } from "@/lib/db/queries";

/**
 * Recent runs preview on the landing page.
 *
 * Server Component — fetches the 3 most recent successful runs at build
 * time (or per request, since `/` is currently static but with the
 * env-conditional pull below the page becomes dynamic when populated).
 *
 * Renders as a horizontal grid of small cards on >=sm: viewports,
 * stacking vertically on mobile. Hover lifts each card by 2px and
 * shifts the border to the brand accent.
 *
 * If the query returns no rows (cold DB, missing env, or no successful
 * runs yet), the section renders nothing — the landing page should
 * still be usable on day one before any runs have completed.
 *
 * Source: `.ai/docs/12-ux-flows.md` §1.8.
 */
export async function RecentRunsPreview() {
  const runs = await getRecentRuns(3);
  if (runs.length === 0) return null;

  return (
    <section className="mt-16 md:mt-24" aria-labelledby="recent-runs-heading">
      <h2
        id="recent-runs-heading"
        className="text-xs uppercase tracking-[0.2em] text-subtle-foreground"
      >
        — Recent runs
      </h2>
      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 list-none p-0">
        {runs.map((run) => (
          <li key={run.id}>
            <Link
              href={`/research/${run.id}`}
              className="group block h-full rounded-lg border border-border bg-surface-1 p-4 transition-all duration-200 [transition-timing-function:var(--ease-out)] hover:-translate-y-0.5 hover:border-brand-secondary hover:bg-surface-2"
            >
              <p className="font-medium tracking-tight text-foreground">
                {run.target_domain}
              </p>
              {run.one_liner && (
                <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                  {run.one_liner}
                </p>
              )}
              <hr className="my-3 border-border/60" />
              <p className="font-mono text-xs tabular-nums text-subtle-foreground">
                {run.decision_maker_count > 0 && (
                  <>
                    {run.decision_maker_count}{" "}
                    {run.decision_maker_count === 1 ? "maker" : "makers"}
                  </>
                )}
                {run.decision_maker_count > 0 && run.duration_ms !== null && " · "}
                {run.duration_ms !== null && (
                  <>{(run.duration_ms / 1000).toFixed(1)}s</>
                )}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
