import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import {
  ResearchInput,
  normaliseDomain,
} from "@/lib/validation/research-input";
import { BLOCKED_MESSAGE } from "@/lib/validation/profanity";
import { isFamilyDnsBlocked } from "@/lib/validation/family-dns";
import { getOrCreateSessionId } from "@/lib/session/cookie";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  deleteRun,
  findCachedRun,
  getAgentDoneMessages,
  getRunStatus,
  type AgentMessageRow,
} from "@/lib/db/queries";
import { runResearch, type ResearchResult } from "@/lib/agents/orchestrator";
import { runAgent3 } from "@/lib/agents/agent-3-email";
import { SCHEMA_VERSION } from "@/lib/agents/schema-version";
import { getClientIp } from "@/lib/rate-limit/client-ip";
import { isOnCooldown, markTriggered } from "@/lib/rate-limit/cooldown";
import type { AgentIndex, StreamEvent } from "@/lib/agents/stream-events";

const RunIdInput = z.object({
  id: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      { message: "Invalid run id." }
    ),
});

export const researchRouter = router({
  /**
   * Create a new research run. Validates the URL with `ResearchInput`,
   * normalises the hostname, runs the Cloudflare Family DNS gate, then
   * inserts a `pending` row in `research_runs` and returns the new id.
   *
   * Replaces the old `POST /api/research` route handler. Same contract,
   * mapped to TRPCError codes:
   *   BAD_REQUEST       → invalid URL or DNS-blocked domain
   *   INTERNAL_SERVER_ERROR → DB / config error
   */
  create: publicProcedure
    .input(ResearchInput)
    .mutation(async ({ ctx, input }) => {
      const { url, tone, channel } = input;
      const target_domain = normaliseDomain(url);

      // Cloudflare Family DNS gate — catches NSFW brand domains
      // (onlyfans, chaturbate, etc.) that the sync profanity refine in
      // `ResearchInput` can't see. Fails open on timeout / DNS error so
      // a Cloudflare blip never blocks a legitimate user.
      if (await isFamilyDnsBlocked(target_domain)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: BLOCKED_MESSAGE,
        });
      }

      // Per-IP cooldown — protects free-tier provider quotas from
      // debug-iteration loops. When the same IP fires another fresh
      // request for the same domain inside the cooldown window AND
      // we have a recent cached result, hand back the cached run_id
      // instead of spinning up a fresh orchestrator pass. Silent
      // when no cached run exists yet (first-time visitor proceeds
      // normally even if their IP+domain happens to be on cooldown).
      const clientIp = getClientIp(ctx.headers);
      if (isOnCooldown(clientIp, target_domain)) {
        const cached = await findCachedRun(target_domain);
        if (cached) {
          console.info(
            `[trpc research.create] cooldown hit ip=${clientIp} domain=${target_domain} → reusing run ${cached.id}`
          );
          return { run_id: cached.id };
        }
        // No cached run available — fall through. Still mark
        // triggered so the next attempt within the window also
        // sees cooldown.
      }
      markTriggered(clientIp, target_domain);

      let supabase;
      try {
        supabase = getSupabaseAdmin();
      } catch (error) {
        console.error(
          "[trpc research.create] Supabase client init failed:",
          error instanceof Error ? error.message : error
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Server is missing required configuration.",
        });
      }

      const sessionId = await getOrCreateSessionId();

      const { data, error } = await supabase
        .from("research_runs")
        .insert({
          target_url: url,
          target_domain,
          status: "pending",
          creator_session_id: sessionId,
          tone,
          channel,
          schema_version: SCHEMA_VERSION,
        })
        .select("id")
        .single();

      if (error || !data) {
        console.error(
          "[trpc research.create] Insert failed:",
          error?.message ?? "no data returned"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not create research run. Try again.",
        });
      }

      return { run_id: data.id as string };
    }),

  /**
   * Delete a run created by the current visitor. Ownership check uses
   * the read-only `outboundlab_sid` cookie compared against the row's
   * `creator_session_id`.
   *
   * Replaces the old `DELETE /api/research/[id]` route handler. Same
   * contract:
   *   BAD_REQUEST          → invalid UUID
   *   UNAUTHORIZED         → no session cookie present
   *   NOT_FOUND            → no row with that id
   *   FORBIDDEN            → cookie doesn't match the row's creator
   *   INTERNAL_SERVER_ERROR → DB error
   *
   * Returns `{ ok: true }` on success — the client only needs to know
   * the call succeeded.
   */
  delete: publicProcedure
    .input(RunIdInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.sessionId) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "No session — you can only delete runs you created in this browser.",
        });
      }

      let result;
      try {
        result = await deleteRun(input.id, ctx.sessionId);
      } catch (err) {
        console.error(
          "[trpc research.delete] deleteRun threw:",
          err instanceof Error ? err.message : err
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not delete this run. Try again.",
        });
      }

      if (result === "not_found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Run not found.",
        });
      }
      if (result === "forbidden") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete runs you created.",
        });
      }

      return { ok: true as const };
    }),

  /**
   * Stream the run as a tRPC subscription. Replaces the old
   * `GET /api/research/[id]/stream` SSE route handler.
   *
   * The transport is still SSE on the wire — `httpSubscriptionLink` on
   * the client uses an `EventSource` under the hood — but the client
   * side now consumes typed `StreamEvent` values via tRPC's
   * subscribe/onData API instead of parsing JSON frames manually.
   *
   * Status semantics (matches the prior route):
   *   pending  → start the orchestrator
   *   running  → re-attach: replay completed agents from research_messages,
   *              then poll the row + messages until status flips
   *   done     → ship the cached `result.payload` as a single final_result
   *   error    → ship a single error frame with the persisted message
   *   degraded → same as done — result is still valid
   *
   * Connection-loss handling: if the client disconnects mid-stream the
   * orchestrator continues running on the original Vercel function
   * instance (its work runs in a background Promise and persists via
   * markRunRunning / completeRun / failRun regardless of consumer
   * presence). The next reconnect lands on the re-attach branch.
   */
  stream: publicProcedure
    .input(RunIdInput)
    .subscription(async function* ({ input }) {
      const { id } = input;

      let run: ExistingRunRow | null;
      let resultPayload: unknown = null;
      let errorMessage: string | null = null;

      try {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from("research_runs")
          .select("target_url, status, tone, channel, result, error_message")
          .eq("id", id)
          .maybeSingle<
            ExistingRunRow & { result: unknown; error_message: string | null }
          >();
        if (error) {
          console.error("[trpc research.stream] select failed:", error.message);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not load run.",
          });
        }
        if (!data) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Run not found.",
          });
        }
        run = {
          target_url: data.target_url,
          status: data.status,
          tone: data.tone,
          channel: data.channel,
        };
        resultPayload = data.result ?? null;
        errorMessage = data.error_message ?? null;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        console.error(
          "[trpc research.stream] server config error:",
          err instanceof Error ? err.message : err
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Server is missing required configuration.",
        });
      }

      if (run.status === "done" || run.status === "degraded") {
        yield {
          type: "final_result",
          payload: resultPayload,
        } satisfies StreamEvent;
        return;
      }

      if (run.status === "error") {
        yield {
          type: "error",
          stage: "persisted",
          message: errorMessage ?? "Research failed.",
        } satisfies StreamEvent;
        return;
      }

      if (run.status === "running") {
        yield* replayAndPoll(id);
        return;
      }

      // status === 'pending' — start the orchestrator. Errors thrown
      // inside runResearch propagate as the AsyncGenerator's throw,
      // which tRPC surfaces as the subscription's onError on the client.
      yield* runResearch(run.target_url, id, {
        tone: run.tone,
        channel: run.channel,
      });
    }),

  /**
   * Re-run Agent 3 only with a different decision maker as the email
   * target. Loads the run's persisted recon + people, calls Agent 3
   * with `targetIndex`, returns the new EmailOutput.
   *
   * Does NOT persist the new email back to research_runs.result —
   * keeps the original deliverable intact and lets the visitor explore
   * variants client-side. They can copy whichever they like.
   */
  regenerateEmail: publicProcedure
    .input(
      z.object({
        id: z
          .string()
          .regex(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            { message: "Invalid run id." }
          ),
        /** When omitted, defaults to the agent's first-DM behaviour. */
        targetIndex: z.number().int().min(0).max(20).optional(),
        /** When omitted, uses the channel chosen at run creation. */
        channel: z.enum(["email", "linkedin", "x"]).optional(),
        /** When omitted, uses the tone chosen at run creation. */
        tone: z.enum(["cold", "warm"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("research_runs")
        .select("status, result, tone, channel")
        .eq("id", input.id)
        .maybeSingle<{
          status: string;
          result: ResearchResult | null;
          tone: "cold" | "warm";
          channel: "email" | "linkedin" | "x";
        }>();
      if (error) {
        console.error(
          "[trpc research.regenerateEmail] select failed:",
          error.message
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not load run.",
        });
      }
      if (!data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Run not found.",
        });
      }
      if (
        (data.status !== "done" && data.status !== "degraded") ||
        !data.result
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Run isn't finished yet — can't regenerate the email.",
        });
      }

      // targetIndex bounds check — only when explicitly provided AND
      // out of range. Default (omitted) falls through to Agent 3's
      // first-DM behaviour, which gracefully handles empty DM lists.
      if (
        input.targetIndex !== undefined &&
        input.targetIndex > 0 &&
        input.targetIndex >= data.result.people.decision_makers.length
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That decision maker doesn't exist on this run.",
        });
      }

      const channel = input.channel ?? data.channel;
      const tone = input.tone ?? data.tone;

      try {
        const result = await runAgent3(
          data.result.recon,
          data.result.people,
          input.id,
          () => {
            /* no-op — this is a one-shot mutation, not a stream */
          },
          {
            tone,
            channel,
            targetIndex: input.targetIndex,
          }
        );
        return {
          email: result.output,
          degraded: result.degraded,
          forbiddenReason: result.forbiddenReason,
        };
      } catch (err) {
        console.error(
          "[trpc research.regenerateEmail] Agent 3 failed:",
          err instanceof Error ? err.message : err
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not regenerate the email. Try again.",
        });
      }
    }),
});

interface ExistingRunRow {
  target_url: string;
  status: "pending" | "running" | "done" | "error" | "degraded";
  tone: "cold" | "warm";
  channel: "email" | "linkedin" | "x";
}

/** Poll interval for the re-attach path (ms). Long enough not to thrash
 *  the DB, short enough that the visitor sees agent transitions inside
 *  a few seconds of the orchestrator emitting them. */
const REATTACH_POLL_INTERVAL_MS = 1500;

/** Hard ceiling on the re-attach loop. The route handler is also
 *  bounded by Vercel's 90s `maxDuration`; this keeps the loop from
 *  running right up to the kill line if Vercel's timer drifts. */
const REATTACH_MAX_LOOP_MS = 80_000;

const AGENT_NAMES: Record<AgentIndex, string> = {
  1: "Reconnaissance",
  2: "People & ICP",
  3: "Personalisation & Outreach",
};

/**
 * Async generator for the running-run re-attach path. Yields events
 * shaped exactly like the orchestrator's live stream so the client's
 * useResearchStream hook can consume them unchanged.
 *
 *   1. Fetch all completed agents from research_messages
 *   2. Yield agent_start + agent_done for each (in order)
 *   3. Loop: poll status + messages every REATTACH_POLL_INTERVAL_MS
 *      - new agent_done rows → yield agent_start + agent_done
 *      - status === 'done' / 'degraded' → yield final_result, return
 *      - status === 'error' → yield error, return
 *      - exceed REATTACH_MAX_LOOP_MS → return cleanly (next reconnect
 *        lands here again with the latest replay state)
 *
 * Tool-call + agent_thinking events are NOT replayed — the messages
 * log only persists per-agent assistant outputs. The visitor sees each
 * agent flip from pending straight to done; that's a worse but
 * acceptable visual than a stale 409 error.
 */
async function* replayAndPoll(runId: string): AsyncGenerator<StreamEvent> {
  const replayed = new Set<AgentIndex>();
  let inFlightAgent: AgentIndex | null = null;

  function eventsForAgentRow(row: AgentMessageRow): StreamEvent[] {
    const agent = row.agent_index as AgentIndex;
    return [
      { type: "agent_start", agent, name: AGENT_NAMES[agent] ?? row.agent_name },
      {
        type: "agent_done",
        agent,
        output: row.content,
        duration_ms: row.duration_ms ?? 0,
      },
    ];
  }

  function nextInFlightAgent(): AgentIndex | null {
    for (const agent of [1, 2, 3] as const) {
      if (!replayed.has(agent)) return agent;
    }
    return null;
  }

  function* maybeEmitInFlight(): Generator<StreamEvent> {
    const next = nextInFlightAgent();
    if (next === null) return;
    if (inFlightAgent === next) return;
    inFlightAgent = next;
    yield { type: "agent_start", agent: next, name: AGENT_NAMES[next] };
  }

  const initial = await getAgentDoneMessages(runId);
  for (const row of initial) {
    const agent = row.agent_index as AgentIndex;
    if (replayed.has(agent)) continue;
    for (const ev of eventsForAgentRow(row)) yield ev;
    replayed.add(agent);
  }
  for (const ev of maybeEmitInFlight()) yield ev;

  const startedAt = Date.now();
  while (Date.now() - startedAt < REATTACH_MAX_LOOP_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, REATTACH_POLL_INTERVAL_MS)
    );

    const latest = await getAgentDoneMessages(runId);
    let advanced = false;
    for (const row of latest) {
      const agent = row.agent_index as AgentIndex;
      if (replayed.has(agent)) continue;
      if (inFlightAgent === agent) {
        yield {
          type: "agent_done",
          agent,
          output: row.content,
          duration_ms: row.duration_ms ?? 0,
        };
      } else {
        for (const ev of eventsForAgentRow(row)) yield ev;
      }
      replayed.add(agent);
      advanced = true;
    }
    if (advanced) {
      inFlightAgent = null;
      for (const ev of maybeEmitInFlight()) yield ev;
    }

    const status = await getRunStatus(runId);
    if (!status) continue;
    if (status.status === "done" || status.status === "degraded") {
      yield { type: "final_result", payload: status.result } satisfies StreamEvent;
      return;
    }
    if (status.status === "error") {
      yield {
        type: "error",
        stage: "persisted",
        message: status.error_message ?? "Research failed.",
      } satisfies StreamEvent;
      return;
    }
  }
}
