import "server-only";
import { runAgent1 } from "./agent-1-reconnaissance";
import { runAgent2 } from "./agent-2-people";
import { runAgent3, type Agent3Result } from "./agent-3-email";
import type {
  EmailOutputT,
  PeopleOutputT,
  ReconnaissanceOutputT,
} from "./schemas";
import type { StreamEvent } from "./stream-events";
import { createEventStream } from "./event-stream";
import { normaliseDomain } from "@/lib/validation/research-input";
import {
  completeRun,
  degradeRun,
  failRun,
  findCachedRun,
  insertEmbedding,
  markRunRunning,
  recordMessage,
} from "@/lib/db/queries";
import { composeEmbeddingInput, embedText } from "./embeddings/embed";

/**
 * Final structured result the orchestrator persists to research_runs.result
 * and ships as the SSE final_result frame.
 */
export interface ResearchResult {
  recon: ReconnaissanceOutputT;
  people: PeopleOutputT;
  email: EmailOutputT;
  degraded?: boolean;
  forbiddenReason?: string | null;
}

export interface RunResearchOptions {
  /** Skip the cache check — used by the 'Re-run fresh' button (Phase 2). */
  bypassCache?: boolean;
  /** Tone forwarded to Agent 3 — flipped to 'warm' by the regenerate button. */
  tone?: "cold" | "warm";
  /** Outreach channel — picks Agent 3's prompt branch and output shape. */
  channel?: "email" | "linkedin" | "x";
}

/**
 * Sequential A1 → A2 → A3 orchestrator. Yields StreamEvents as work
 * progresses; the route handler pipes them straight into an SSE
 * ReadableStream.
 *
 * Algorithm (per `.ai/docs/06-agent-system-design.md` §3):
 *
 *   normalise targetUrl → domain
 *   IF cache hit:
 *     yield cache_hit { source_run_id }
 *     yield final_result { payload: cached.result }
 *     return
 *   markRunRunning(runId)
 *   try:
 *     yield agent_start(1) → run Agent 1 → record messages → yield agent_done(1)
 *     yield agent_start(2) → run Agent 2 → record messages → yield agent_done(2)
 *     yield agent_start(3) → run Agent 3 → record messages → yield agent_done(3)
 *     IF Agent 3 degraded → degradeRun() ELSE completeRun()
 *     yield final_result { payload }
 *   catch err:
 *     failRun(runId, err.message)
 *     yield error { stage, message }
 *
 * The agent work runs in a separate Promise; events from inside
 * agents (tool_call, tool_result, agent_thinking, provider_used)
 * stream live through the event-stream helper rather than batching
 * at agent boundaries.
 */
export async function* runResearch(
  targetUrl: string,
  runId: string,
  options: RunResearchOptions = {}
): AsyncGenerator<StreamEvent, void, unknown> {
  const stream = createEventStream();

  const work = (async () => {
    try {
      const domain = normaliseDomain(targetUrl);

      // 1. Cache lookup (skip if bypassCache=true)
      if (!options.bypassCache) {
        const cached = await findCachedRun(domain);
        if (cached && cached.result) {
          stream.emit({ type: "cache_hit", source_run_id: cached.id });
          stream.emit({ type: "final_result", payload: cached.result });
          // Mark this run done (and link to cache source) so the streaming
          // page reflects "served from cache".
          await completeRun({
            runId,
            result: cached.result,
            durationMs: 0,
          });
          return;
        }
      }

      // 2. Mark running
      await markRunRunning(runId);

      // 3. Agent 1 — Reconnaissance
      stream.emit({ type: "agent_start", agent: 1, name: "Reconnaissance" });
      const a1Start = Date.now();
      const recon = await runAgent1(targetUrl, runId, stream.emit);
      const a1Duration = Date.now() - a1Start;
      await recordMessage({
        runId,
        agentIndex: 1,
        agentName: "Reconnaissance",
        role: "assistant",
        content: recon,
        durationMs: a1Duration,
      });
      stream.emit({
        type: "agent_done",
        agent: 1,
        output: recon,
        duration_ms: a1Duration,
      });

      // 4. Agent 2 — People & ICP
      stream.emit({ type: "agent_start", agent: 2, name: "People & ICP" });
      const a2Start = Date.now();
      const people = await runAgent2(recon, runId, stream.emit);
      const a2Duration = Date.now() - a2Start;
      await recordMessage({
        runId,
        agentIndex: 2,
        agentName: "People & ICP",
        role: "assistant",
        content: people,
        durationMs: a2Duration,
      });
      stream.emit({
        type: "agent_done",
        agent: 2,
        output: people,
        duration_ms: a2Duration,
      });

      // 5. Agent 3 — Personalisation & Outreach
      stream.emit({
        type: "agent_start",
        agent: 3,
        name: "Personalisation & Outreach",
      });
      const a3Start = Date.now();
      const a3Result: Agent3Result = await runAgent3(
        recon,
        people,
        runId,
        stream.emit,
        {
          tone: options.tone ?? "cold",
          channel: options.channel ?? "email",
        }
      );
      const a3Duration = Date.now() - a3Start;
      await recordMessage({
        runId,
        agentIndex: 3,
        agentName: "Personalisation & Outreach",
        role: "assistant",
        content: a3Result.output,
        durationMs: a3Duration,
      });
      stream.emit({
        type: "agent_done",
        agent: 3,
        output: a3Result.output,
        duration_ms: a3Duration,
      });

      // 6. Build final payload + persist
      const payload: ResearchResult = {
        recon,
        people,
        email: a3Result.output,
        degraded: a3Result.degraded,
        forbiddenReason: a3Result.forbiddenReason,
      };
      const totalDuration = a1Duration + a2Duration + a3Duration;

      if (a3Result.degraded) {
        await degradeRun({
          runId,
          result: payload,
          durationMs: totalDuration,
          reason:
            a3Result.forbiddenReason ??
            "Agent 3 emitted forbidden phrasing twice; surface as draft.",
        });
      } else {
        await completeRun({
          runId,
          result: payload,
          durationMs: totalDuration,
        });
      }

      // Best-effort RAG sidecar: embed the recon brief + persist into
      // research_embeddings. Powers the vector-similarity cache lookup.
      // Failures here never fail the run — the user already has their
      // result and the next call will fall back to exact-domain match.
      const embeddingInput = composeEmbeddingInput({
        companyName: recon.company_name,
        oneLiner: recon.one_liner,
        whatTheySell: recon.what_they_sell,
        targetMarket: recon.target_market,
      });
      const vector = await embedText(embeddingInput);
      if (vector) {
        await insertEmbedding({
          runId,
          targetDomain: domain,
          embedding: vector,
        });
      }

      stream.emit({ type: "final_result", payload });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stage = err instanceof Error ? err.name : "orchestrator";
      console.error("[orchestrator] runResearch failed:", message);
      try {
        await failRun(runId, message);
      } catch (markErr) {
        // Best-effort — we still want to yield the error event below.
        console.error(
          "[orchestrator] also failed to mark run errored:",
          markErr instanceof Error ? markErr.message : markErr
        );
      }
      stream.emit({ type: "error", stage, message });
    } finally {
      stream.close();
    }
  })();

  for await (const event of stream) {
    yield event;
  }
  // Surface any unhandled error from the work promise
  await work;
}
