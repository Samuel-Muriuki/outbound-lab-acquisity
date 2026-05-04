"use client";

import Link from "next/link";
import { ArrowLeft, AlertCircle, Zap } from "lucide-react";
import {
  useResearchStream,
  type UseResearchStreamArgs,
} from "@/hooks/use-research-stream";
import { AgentTimeline } from "./agent-timeline";

export interface ResearchViewProps {
  runId: string;
  targetDomain: string;
  initialStatus: UseResearchStreamArgs["initialStatus"];
  initialResult?: UseResearchStreamArgs["initialResult"];
  initialError?: UseResearchStreamArgs["initialError"];
  /** Provided when the run was served from cache — drives the "served from cache" banner. */
  cacheSourceCompletedAt?: string | null;
}

/**
 * Streaming view client wrapper. Owns the EventSource lifecycle via
 * useResearchStream() and renders the AgentTimeline + result region.
 *
 * Layout per `.ai/docs/12-ux-flows.md` §2.2.
 *
 * The actual ResultCard component lands in PR O. For now, when status
 * resolves to 'done' the JSON payload is rendered in a minimal preview
 * card so the integration is exercisable end-to-end.
 */
export function ResearchView({
  runId,
  targetDomain,
  initialStatus,
  initialResult = null,
  initialError = null,
  cacheSourceCompletedAt = null,
}: ResearchViewProps) {
  const stream = useResearchStream({
    runId,
    initialStatus,
    initialResult,
    initialError,
  });

  const isCacheHit =
    cacheSourceCompletedAt !== null || stream.cacheSourceRunId !== null;

  const provider = stream.agents[1].provider ?? stream.agents[2].provider ?? stream.agents[3].provider;
  const totalDuration =
    (stream.agents[1].durationMs ?? 0) +
    (stream.agents[2].durationMs ?? 0) +
    (stream.agents[3].durationMs ?? 0);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-12 sm:px-6 lg:px-8">
      <header className="flex items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Link>
        <span className="flex items-center gap-2 text-sm">
          <span className="size-2 rounded-full gradient-bg" aria-hidden />
          <span className="font-medium tracking-tight">OutboundLab</span>
        </span>
      </header>

      <section className="mt-12">
        <p className="text-sm uppercase tracking-wide text-subtle-foreground">
          Researching
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
          {targetDomain}
        </h1>
        {provider && (
          <p className="mt-3 font-mono text-sm text-muted-foreground">
            via {provider}
            {totalDuration > 0 && (
              <span className="ml-2 tabular-nums">
                · {(totalDuration / 1000).toFixed(1)}s
              </span>
            )}
          </p>
        )}
      </section>

      {isCacheHit && (
        <section
          className="mt-6 flex items-center gap-2 rounded-xl border border-border bg-surface-1 px-4 py-3 text-sm"
          role="status"
        >
          <Zap className="size-4 text-brand-secondary" aria-hidden />
          <span className="text-foreground">Served from cache</span>
          <span className="text-subtle-foreground">·</span>
          <span className="text-muted-foreground">
            this run is a cached replay of an earlier OutboundLab session
          </span>
        </section>
      )}

      {stream.status === "error" && (
        <section
          className="mt-8 rounded-xl border border-error/40 bg-surface-1 p-5"
          role="alert"
        >
          <div className="flex items-center gap-2 text-error">
            <AlertCircle className="size-4" aria-hidden />
            <h2 className="text-base font-medium">
              We couldn&apos;t complete that research.
            </h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {stream.error ?? "Something went wrong. Try again."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/"
              className="inline-flex h-9 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-colors duration-200 [transition-timing-function:var(--ease-out)] hover:bg-foreground/90"
            >
              Back to home
            </Link>
          </div>
        </section>
      )}

      {stream.status !== "error" && (
        <section className="mt-10">
          <AgentTimeline state={stream} />
        </section>
      )}

      {stream.status === "done" && stream.result && (
        <section className="mt-10 rounded-xl border border-border bg-surface-1 p-5">
          <header className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-wide text-subtle-foreground">
                Result
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                {stream.result.recon?.company_name ?? targetDomain}
              </h2>
              {stream.result.recon?.one_liner && (
                <p className="mt-1 text-base text-muted-foreground">
                  {stream.result.recon.one_liner}
                </p>
              )}
            </div>
          </header>
          <p className="mt-6 text-sm text-muted-foreground">
            The full result card with Brief / People / Email / Sources tabs lands
            in PR O. For now, here&apos;s the raw payload:
          </p>
          <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-surface-2 p-4 font-mono text-xs">
            {JSON.stringify(stream.result, null, 2)}
          </pre>
        </section>
      )}
    </main>
  );
}
