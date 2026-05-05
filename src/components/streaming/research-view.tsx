"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, AlertCircle, Zap } from "lucide-react";
import {
  useResearchStream,
  type UseResearchStreamArgs,
} from "@/hooks/use-research-stream";
import { DeleteRunButton } from "@/components/delete-run-button";
import { DotFieldBackground } from "@/components/backgrounds/dot-field-background";
import { TiltedWrapper } from "@/components/tilted-wrapper";
import { AgentTimeline } from "./agent-timeline";
import { ResultCard } from "./result-card";
import { RelatedRuns } from "./related-runs";
import type { SimilarRunRow } from "@/lib/db/queries";

export interface ResearchViewProps {
  runId: string;
  targetDomain: string;
  initialStatus: UseResearchStreamArgs["initialStatus"];
  initialResult?: UseResearchStreamArgs["initialResult"];
  initialError?: UseResearchStreamArgs["initialError"];
  /** Provided when the run was served from cache — drives the "served from cache" banner. */
  cacheSourceCompletedAt?: string | null;
  /** True when the visitor's session cookie matches this run's creator. */
  isOwner?: boolean;
  /** Top-N vector-similar past runs — fetched server-side in /research/[id]/page.tsx. */
  similarRuns?: SimilarRunRow[];
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
  isOwner = false,
  similarRuns = [],
}: ResearchViewProps) {
  const stream = useResearchStream({
    runId,
    initialStatus,
    initialResult,
    initialError,
  });

  /*
   * Focus management per .ai/docs/12-ux-flows.md §9.3: after route
   * transition into the streaming view, programmatic focus moves to
   * the page's main heading so screen readers announce
   * "Researching <domain>" without the user having to navigate the
   * back-link / wordmark header first.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const isCacheHit =
    cacheSourceCompletedAt !== null || stream.cacheSourceRunId !== null;

  // While the EventSource is open the user might want to abort. Navigating
  // home unmounts this view, which triggers the hook's cleanup and closes
  // the stream client-side. (The orchestrator on the server keeps churning
  // until the run completes — full server-side cancellation needs a
  // `cancelled` status enum + abort signal plumbing through the agents
  // and is left for a follow-up PR.)
  const isInFlight =
    stream.status === "connecting" || stream.status === "streaming";
  // Show the delete button only when the run is finished AND the visitor
  // is the original creator. The DELETE endpoint validates the cookie
  // server-side regardless — this is a UX gate.
  const canDelete =
    isOwner &&
    (stream.status === "done" || stream.status === "error" || initialStatus === "degraded");

  const provider = stream.agents[1].provider ?? stream.agents[2].provider ?? stream.agents[3].provider;
  const totalDuration =
    (stream.agents[1].durationMs ?? 0) +
    (stream.agents[2].durationMs ?? 0) +
    (stream.agents[3].durationMs ?? 0);

  return (
    <>
      <DotFieldBackground />
      <main
        id="main"
        className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-12 sm:px-6 lg:px-8"
      >
      <header className="flex items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          aria-label={isInFlight ? "Back to home — the research keeps running in the background" : "Back to home"}
          title={isInFlight ? "Research keeps running in the background. You'll see it on the home page until it finishes." : undefined}
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to home
        </Link>
        {canDelete && (
          <DeleteRunButton runId={runId} onDeleted="home" variant="with-label" />
        )}
      </header>

      <section className="mt-12">
        <p className="text-sm uppercase tracking-wide text-subtle-foreground">
          Researching
        </p>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl focus:outline-none"
        >
          <span className="sr-only">Researching </span>
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
        <ResultSection result={stream.result} />
      )}

      {stream.status === "done" && stream.result && similarRuns.length > 0 && (
        <RelatedRuns runs={similarRuns} />
      )}
      </main>
    </>
  );
}

/**
 * Wraps the ResultCard with an effect that scrolls itself into view the
 * first time it mounts, so visitors are taken straight to the
 * deliverable when the run finishes (rather than having to scroll past
 * the agent timeline manually).
 */
function ResultSection({ result }: { result: NonNullable<ReturnType<typeof useResearchStream>["result"]> }) {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const reduced = typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  // ResultCard is the page's centerpiece — keep the tilt very mild
  // (rotateAmplitude=3) so it whispers rather than waves around while
  // the visitor is reading the email body or clicking tabs.
  return (
    <section ref={sectionRef} className="mt-10 scroll-mt-12">
      <TiltedWrapper rotateAmplitude={3} scaleOnHover={1.005}>
        <ResultCard result={result} />
      </TiltedWrapper>
    </section>
  );
}
