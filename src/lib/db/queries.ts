import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * DB query layer for the orchestrator + per-agent message log.
 *
 * Server-only — uses the service-role client which bypasses RLS. Public
 * reads from the streaming-page side go through a different (anon) client
 * once Phase 1's server-component fetch is replaced by client-side polling
 * (Session 5 PR N).
 *
 * Source of truth: `.ai/docs/04-database-schema.md` and
 * `.ai/docs/06-agent-system-design.md` §3 (orchestration contract) + §10
 * (caching strategy).
 */

const CACHE_LOOKBACK_DAYS = 7;

export interface CachedRunRow {
  id: string;
  target_url: string;
  target_domain: string;
  result: unknown;
  completed_at: string;
}

/**
 * 7-day exact-domain cache lookup. Returns the most recent successful
 * run for the given normalised domain, or null.
 *
 * Phase 2 introduces vector-similarity matching on top of this; Phase 1
 * is exact-domain only.
 *
 * Source: `.ai/docs/06-agent-system-design.md` §10.
 */
export async function findCachedRun(
  domain: string
): Promise<CachedRunRow | null> {
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(
    Date.now() - CACHE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("research_runs")
    .select("id, target_url, target_domain, result, completed_at")
    .eq("target_domain", domain)
    .eq("status", "done")
    .not("result", "is", null)
    .gte("completed_at", cutoff)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle<CachedRunRow>();

  if (error) {
    console.error("[findCachedRun] Supabase error:", error.message);
    return null;
  }
  return data ?? null;
}

export interface RecentRunRow {
  id: string;
  target_domain: string;
  one_liner: string;
  duration_ms: number | null;
  decision_maker_count: number;
  completed_at: string;
  /** Cookie-derived session id of the visitor who created this run. */
  creator_session_id: string | null;
}

/**
 * The N most-recent successful runs (status='done' OR 'degraded') for the
 * landing-page preview. Uses RLS public_read on research_runs but keeps
 * the service-role client for free since we already have it wired.
 *
 * Reads `result` to extract the recon.one_liner and the
 * people.decision_makers length without a separate join — these live in
 * the run row's JSONB payload.
 *
 * Returns an empty array on any error (best-effort — recent runs are a
 * nice-to-have, never block the landing page).
 */
export async function getRecentRuns(limit: number): Promise<RecentRunRow[]> {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    // Missing env config in local dev — silently return empty.
    return [];
  }

  const { data, error } = await supabase
    .from("research_runs")
    .select(
      "id, target_domain, result, duration_ms, completed_at, creator_session_id"
    )
    .in("status", ["done", "degraded"])
    .not("result", "is", null)
    .order("completed_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    if (error) {
      console.warn("[getRecentRuns] Supabase error:", error.message);
    }
    return [];
  }

  return data.map((row): RecentRunRow => {
    const result = row.result as
      | {
          recon?: { one_liner?: string };
          people?: { decision_makers?: unknown[] };
        }
      | null;
    return {
      id: row.id as string,
      target_domain: row.target_domain as string,
      one_liner: result?.recon?.one_liner ?? "",
      duration_ms: (row.duration_ms as number | null) ?? null,
      decision_maker_count: result?.people?.decision_makers?.length ?? 0,
      completed_at: row.completed_at as string,
      creator_session_id: (row.creator_session_id as string | null) ?? null,
    };
  });
}

export interface InFlightRunRow {
  id: string;
  target_domain: string;
  status: "pending" | "running";
  started_at: string;
}

/**
 * Pending + running rows belonging to the current visitor's session.
 * Powers the "still working" banner on the home page so a visitor who
 * navigates back mid-run can see + click straight back to the
 * streaming view rather than thinking the run was lost.
 *
 * Cookie-scoped via `creator_session_id` so other visitors never see
 * each other's in-flight work.
 *
 * Returns an empty array silently on any DB / config error — the
 * banner is a best-effort affordance, never a blocker.
 */
export async function getInFlightRunsForSession(
  sessionId: string,
  limit = 5
): Promise<InFlightRunRow[]> {
  if (!sessionId) return [];
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return [];
  }
  const { data, error } = await supabase
    .from("research_runs")
    .select("id, target_domain, status, started_at")
    .in("status", ["pending", "running"])
    .eq("creator_session_id", sessionId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    if (error) {
      console.warn("[getInFlightRunsForSession] Supabase error:", error.message);
    }
    return [];
  }

  return data.map(
    (row): InFlightRunRow => ({
      id: row.id as string,
      target_domain: row.target_domain as string,
      status: row.status as InFlightRunRow["status"],
      started_at: row.started_at as string,
    })
  );
}

export interface SearchRunsArgs {
  /** Free-text query — matches target_domain or recon.company_name (case-insensitive substring). */
  query?: string;
  /** Page size, capped at 50 server-side regardless of input. */
  limit: number;
  /** Offset in completed_at-DESC order. */
  offset: number;
}

export interface SearchRunsResult {
  runs: RecentRunRow[];
  /** Total number of rows matching the filter — drives pagination UI. */
  total: number;
}

/**
 * Searchable, paginated list of successful runs for the /runs page.
 *
 * Query semantics (case-insensitive substring against target_domain).
 * If the query is empty, returns all runs. Limit is clamped to [1, 50]
 * to keep payloads modest (each row carries the full result JSONB).
 */
export async function searchRuns(args: SearchRunsArgs): Promise<SearchRunsResult> {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return { runs: [], total: 0 };
  }

  const limit = Math.max(1, Math.min(args.limit, 50));
  const offset = Math.max(0, args.offset);
  const trimmed = args.query?.trim() ?? "";

  let countQuery = supabase
    .from("research_runs")
    .select("id", { count: "exact", head: true })
    .in("status", ["done", "degraded"])
    .not("result", "is", null);

  let dataQuery = supabase
    .from("research_runs")
    .select(
      "id, target_domain, result, duration_ms, completed_at, creator_session_id"
    )
    .in("status", ["done", "degraded"])
    .not("result", "is", null)
    .order("completed_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (trimmed) {
    // PostgREST `ilike` — case-insensitive substring on target_domain.
    // company_name lives inside `result` JSONB; matching it would require
    // a server-side filter expression we don't have a clean PostgREST
    // form for, so we keep the search to target_domain for now.
    const pattern = `%${trimmed.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    countQuery = countQuery.ilike("target_domain", pattern);
    dataQuery = dataQuery.ilike("target_domain", pattern);
  }

  const [countRes, dataRes] = await Promise.all([countQuery, dataQuery]);

  if (countRes.error) {
    console.warn("[searchRuns] count query error:", countRes.error.message);
  }
  if (dataRes.error || !dataRes.data) {
    if (dataRes.error) {
      console.warn("[searchRuns] data query error:", dataRes.error.message);
    }
    return { runs: [], total: countRes.count ?? 0 };
  }

  const runs = dataRes.data.map((row): RecentRunRow => {
    const result = row.result as
      | {
          recon?: { one_liner?: string };
          people?: { decision_makers?: unknown[] };
        }
      | null;
    return {
      id: row.id as string,
      target_domain: row.target_domain as string,
      one_liner: result?.recon?.one_liner ?? "",
      duration_ms: (row.duration_ms as number | null) ?? null,
      decision_maker_count: result?.people?.decision_makers?.length ?? 0,
      completed_at: row.completed_at as string,
      creator_session_id: (row.creator_session_id as string | null) ?? null,
    };
  });

  return {
    runs,
    total: countRes.count ?? runs.length,
  };
}

/**
 * Delete a run if and only if the supplied sessionId matches the row's
 * creator_session_id. Returns one of three results so the caller can
 * tell apart "not found", "not yours", and "deleted".
 *
 * Cascades: research_messages and research_embeddings are linked by
 * `run_id` FKs; their ON DELETE behaviour is set in the initial
 * migration so deleting the parent row clears them too.
 */
export type DeleteRunResult = "deleted" | "not_found" | "forbidden";

export async function deleteRun(
  runId: string,
  sessionId: string
): Promise<DeleteRunResult> {
  const supabase = getSupabaseAdmin();

  const { data, error: lookupError } = await supabase
    .from("research_runs")
    .select("id, creator_session_id")
    .eq("id", runId)
    .maybeSingle<{ id: string; creator_session_id: string | null }>();

  if (lookupError) {
    console.error("[deleteRun] lookup failed:", lookupError.message);
    throw new Error(`Could not look up run: ${lookupError.message}`);
  }
  if (!data) return "not_found";
  if (data.creator_session_id !== sessionId) return "forbidden";

  const { error: deleteError } = await supabase
    .from("research_runs")
    .delete()
    .eq("id", runId);

  if (deleteError) {
    console.error("[deleteRun] delete failed:", deleteError.message);
    throw new Error(`Could not delete run: ${deleteError.message}`);
  }
  return "deleted";
}

/** Move a pending row into running status when the orchestrator starts work. */
export async function markRunRunning(runId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("research_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) {
    console.warn("[markRunRunning] Supabase error:", error.message);
  }
}

export interface CompleteRunArgs {
  runId: string;
  result: unknown;
  totalTokens?: number;
  totalCostUsd?: number;
  durationMs: number;
  modelUsed?: string;
}

/** Move a running row to done with the final structured payload. */
export async function completeRun(args: CompleteRunArgs): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("research_runs")
    .update({
      status: "done",
      result: args.result,
      total_tokens: args.totalTokens,
      total_cost_usd: args.totalCostUsd,
      duration_ms: args.durationMs,
      completed_at: new Date().toISOString(),
      ...(args.modelUsed ? { model: args.modelUsed } : {}),
    })
    .eq("id", args.runId);
  if (error) {
    console.error("[completeRun] Supabase error:", error.message);
    throw new Error(`Could not mark run done: ${error.message}`);
  }
}

/**
 * Move a running row to degraded — used when Agent 3 leaks a forbidden
 * phrase twice. The result is still persisted so the streaming UI can
 * display the email; the status flag drives a "draft was retried" banner.
 */
export async function degradeRun(args: CompleteRunArgs & { reason: string }): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("research_runs")
    .update({
      status: "degraded",
      result: args.result,
      total_tokens: args.totalTokens,
      total_cost_usd: args.totalCostUsd,
      duration_ms: args.durationMs,
      completed_at: new Date().toISOString(),
      error_message: args.reason,
      ...(args.modelUsed ? { model: args.modelUsed } : {}),
    })
    .eq("id", args.runId);
  if (error) {
    console.error("[degradeRun] Supabase error:", error.message);
    throw new Error(`Could not mark run degraded: ${error.message}`);
  }
}

/** Move a row to error status with the failure message. */
export async function failRun(runId: string, message: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("research_runs")
    .update({
      status: "error",
      error_message: message.slice(0, 1000),
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) {
    console.error("[failRun] Supabase error:", error.message);
  }
}

export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export interface RecordMessageArgs {
  runId: string;
  agentIndex: 1 | 2 | 3;
  agentName: string;
  role: AgentMessageRole;
  content: unknown;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
}

/**
 * Insert one row into research_messages — the per-agent log the streaming
 * view replays. Best-effort: failures are logged but don't fail the run.
 */
export async function recordMessage(args: RecordMessageArgs): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("research_messages").insert({
    run_id: args.runId,
    agent_index: args.agentIndex,
    agent_name: args.agentName,
    role: args.role,
    content: args.content,
    tokens_in: args.tokensIn,
    tokens_out: args.tokensOut,
    duration_ms: args.durationMs,
  });
  if (error) {
    console.warn(
      `[recordMessage] Could not insert message for run ${args.runId}:`,
      error.message
    );
  }
}
