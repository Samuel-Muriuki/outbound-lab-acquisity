import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ResearchView } from "@/components/streaming/research-view";
import type { ResearchResult } from "@/lib/agents/orchestrator";

export const dynamic = "force-dynamic";

interface ResearchRunRow {
  id: string;
  target_url: string;
  target_domain: string;
  status: "pending" | "running" | "done" | "error" | "degraded";
  started_at: string;
  completed_at: string | null;
  cache_hit: boolean;
  cache_source_id: string | null;
  result: unknown;
  error_message: string | null;
}

/**
 * Streaming research view (Phase 1).
 *
 * Server Component shell: resolves the run row via the Supabase admin
 * client (RLS public_read would also work, but we already have the
 * service-role client wired and it bypasses RLS for free). Mounts the
 * <ResearchView> client wrapper that owns the EventSource lifecycle.
 *
 * For runs already in `done` / `degraded` / `error` status the cached
 * payload is passed in as initial state so the client never opens an
 * EventSource — instant render of past runs and cache hits.
 */
export default async function ResearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // UUID v4 shape gate — 404s without a DB round-trip on bad input.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    notFound();
  }

  let data: ResearchRunRow | null = null;
  try {
    const supabase = getSupabaseAdmin();
    const result = await supabase
      .from("research_runs")
      .select(
        "id, target_url, target_domain, status, started_at, completed_at, cache_hit, cache_source_id, result, error_message"
      )
      .eq("id", id)
      .maybeSingle<ResearchRunRow>();
    if (result.error) {
      console.error(
        "[research/[id]] Supabase select failed:",
        result.error.message
      );
      notFound();
    }
    data = result.data;
  } catch (err) {
    console.error(
      "[research/[id]] Server config error:",
      err instanceof Error ? err.message : err
    );
    notFound();
  }

  if (!data) {
    notFound();
  }

  const initialResult =
    data.status === "done" || data.status === "degraded"
      ? (data.result as ResearchResult | null)
      : null;
  const initialError = data.status === "error" ? data.error_message : null;

  return (
    <ResearchView
      runId={data.id}
      targetDomain={data.target_domain}
      initialStatus={data.status}
      initialResult={initialResult}
      initialError={initialError}
      cacheSourceCompletedAt={
        data.cache_hit && data.cache_source_id ? data.completed_at : null
      }
    />
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return {
    title: `Research · ${id.slice(0, 8)}`,
  };
}
