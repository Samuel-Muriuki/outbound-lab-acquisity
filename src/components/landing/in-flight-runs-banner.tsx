import Link from "next/link";
import { Loader2 } from "lucide-react";
import { getInFlightRunsForSession } from "@/lib/db/queries";
import { getSessionId } from "@/lib/session/cookie";

/**
 * "Still working" banner shown on the home page when the visitor has
 * one or more pending / running research runs in flight (cookie-scoped
 * via `creator_session_id`). Links straight back to /research/[id] so
 * a visitor who navigated home mid-run can pick up where they left off
 * rather than wondering whether the work was lost.
 *
 * Server Component — fetches the current session's in-flight rows on
 * each request. The home page is force-dynamic, so this re-runs every
 * load.
 *
 * Renders nothing (returns null) when there are no in-flight runs, so
 * the landing page stays visually quiet on the happy path.
 */
export async function InFlightRunsBanner() {
  const sessionId = await getSessionId();
  if (!sessionId) return null;
  const runs = await getInFlightRunsForSession(sessionId);
  if (runs.length === 0) return null;

  return (
    <section
      role="status"
      aria-live="polite"
      className="mt-8 rounded-xl border border-brand-secondary/40 bg-surface-1/60 p-4 backdrop-blur-md"
    >
      <header className="flex items-center gap-2 text-sm text-foreground">
        <Loader2 className="size-4 animate-spin text-brand-secondary" aria-hidden />
        <span className="font-medium">
          {runs.length === 1
            ? "Still working on a research run"
            : `Still working on ${runs.length} research runs`}
        </span>
      </header>
      <ul className="mt-3 flex flex-col gap-2 list-none p-0">
        {runs.map((run) => (
          <li key={run.id}>
            <Link
              href={`/research/${run.id}`}
              className="group flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-surface-2/50 px-3 py-2 text-sm transition-colors hover:border-brand-secondary"
            >
              <span className="font-medium tracking-tight text-foreground">
                {run.target_domain}
              </span>
              <span className="font-mono text-xs uppercase tracking-wide text-subtle-foreground transition-colors group-hover:text-brand-secondary">
                {run.status === "pending" ? "queued" : "running"} →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
