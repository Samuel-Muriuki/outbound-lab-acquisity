import Link from "next/link";
import type { Metadata } from "next";
import { searchRuns } from "@/lib/db/queries";
import { getSessionId } from "@/lib/session/cookie";
import { DeleteRunButton } from "@/components/delete-run-button";
import { DotFieldBackground } from "@/components/backgrounds/dot-field-background";
import { RunsSearch } from "@/components/runs/runs-search";
import { TiltedWrapper } from "@/components/tilted-wrapper";
import { HoverElectricBorder } from "@/components/hover-electric-border";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "All runs",
  description: "Search and browse every research run.",
};

const PAGE_SIZE = 20;

interface RunsPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function RunsPage({ searchParams }: RunsPageProps) {
  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [{ runs, total }, visitorSessionId] = await Promise.all([
    searchRuns({ query, limit: PAGE_SIZE, offset }),
    getSessionId(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasResults = runs.length > 0;

  return (
    <>
      <DotFieldBackground />
      <main
        id="main"
        tabIndex={-1}
        className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-12 sm:px-6 md:py-16 lg:px-8 focus:outline-none"
      >
      <header>
        <Link
          href="/"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Home
        </Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight md:text-4xl">
          All runs
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          {query
            ? total === 1
              ? `1 run matching “${query}”.`
              : `${total} runs matching “${query}”.`
            : total === 1
              ? "1 run total."
              : `${total} runs total.`}
        </p>
      </header>

      <div className="mt-6">
        <RunsSearch initialQuery={query} />
      </div>

      {hasResults ? (
        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 list-none p-0">
          {runs.map((run) => {
            const isOwner =
              visitorSessionId !== null &&
              run.creator_session_id !== null &&
              visitorSessionId === run.creator_session_id;
            return (
              <li key={run.id} className="relative h-full">
                <HoverElectricBorder borderRadius={12}>
                  <TiltedWrapper innerClassName="h-full">
                    <Link
                      href={`/research/${run.id}`}
                      className="group flex h-full min-h-[180px] flex-col rounded-lg border border-border bg-surface-1 p-4 transition-colors duration-200 [transition-timing-function:var(--ease-out)] hover:border-transparent hover:bg-surface-2"
                    >
                      <p className="font-medium tracking-tight text-foreground">
                        {run.target_domain}
                      </p>
                      {run.one_liner && (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {run.one_liner}
                        </p>
                      )}
                      <hr className="my-3 border-border/60" />
                      <p className="mt-auto font-mono text-xs tabular-nums text-subtle-foreground">
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
                  </TiltedWrapper>
                  {/* DeleteRunButton inside HoverElectricBorder so the
                    * mouseleave doesn't fire when the cursor moves
                    * onto the trash icon. z-20 keeps it above the
                    * canvas overlay (z-2). */}
                  {isOwner && (
                    <DeleteRunButton
                      runId={run.id}
                      variant="icon-only"
                      className="absolute right-2 top-2 z-20"
                    />
                  )}
                </HoverElectricBorder>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-12 text-sm text-muted-foreground">
          {query
            ? "No runs match that search. Try a different domain fragment."
            : "No runs yet — be the first to research something from the homepage."}
        </p>
      )}

      {totalPages > 1 && (
        <Pagination current={page} totalPages={totalPages} query={query} />
      )}
      </main>
    </>
  );
}

interface PaginationProps {
  current: number;
  totalPages: number;
  query: string;
}

function Pagination({ current, totalPages, query }: PaginationProps) {
  const prevHref = buildHref(query, Math.max(1, current - 1));
  const nextHref = buildHref(query, Math.min(totalPages, current + 1));

  return (
    <nav
      aria-label="Runs pagination"
      className="mt-10 flex items-center justify-between gap-4 border-t border-border/60 pt-6 text-sm"
    >
      {current > 1 ? (
        <Link
          href={prevHref}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Newer
        </Link>
      ) : (
        <span className="text-subtle-foreground/60">← Newer</span>
      )}
      <span className="font-mono text-xs tabular-nums text-subtle-foreground">
        Page {current} of {totalPages}
      </span>
      {current < totalPages ? (
        <Link
          href={nextHref}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Older →
        </Link>
      ) : (
        <span className="text-subtle-foreground/60">Older →</span>
      )}
    </nav>
  );
}

function buildHref(query: string, page: number): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/runs?${qs}` : "/runs";
}
