import { NextResponse, type NextRequest } from "next/server";
import { runResearch } from "@/lib/agents/orchestrator";
import {
  getAgentDoneMessages,
  getRunStatus,
  type AgentMessageRow,
} from "@/lib/db/queries";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AgentIndex, StreamEvent } from "@/lib/agents/stream-events";

/** Poll interval for the re-attach path (ms). Long enough not to thrash
 *  the DB, short enough that the visitor sees agent transitions inside
 *  a few seconds of the orchestrator emitting them. */
const REATTACH_POLL_INTERVAL_MS = 1500;

/** Hard ceiling on the re-attach loop. The route handler is also bounded
 *  by `maxDuration` (90s); this keeps the loop from running right up to
 *  the kill line if Vercel's timer drifts. */
const REATTACH_MAX_LOOP_MS = 80_000;

const AGENT_NAMES: Record<AgentIndex, string> = {
  1: "Reconnaissance",
  2: "People & ICP",
  3: "Personalisation & Outreach",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Maximum function-execution time on Vercel. The full pipeline (3 agents
 * × tool-use loops) can take 30–60s on the free tier; cap at 90s with
 * room for a graceful close.
 */
export const maxDuration = 90;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ExistingRunRow {
  target_url: string;
  status: "pending" | "running" | "done" | "error" | "degraded";
  tone: "cold" | "warm";
  channel: "email" | "linkedin" | "x";
}

/**
 * GET /api/research/[id]/stream
 *
 * Server-Sent Events endpoint that drives the streaming view at
 * `/research/[id]`. Resolves the run row, then pipes the orchestrator's
 * StreamEvents straight into the response as `text/event-stream`
 * frames.
 *
 * Frame format:
 *   data: { "type": "agent_start", "agent": 1, "name": "Reconnaissance" }\n\n
 *
 * Status semantics:
 *   pending  → start the orchestrator
 *   running  → re-attach: replay completed agents from research_messages,
 *              then poll the row + messages until status flips. The
 *              orchestrator runs on a separate Vercel function instance
 *              (the original POST → first-stream lifecycle); we observe
 *              its progress through the DB rather than re-attaching
 *              in-process (which serverless can't do).
 *   done     → ship the cached result.payload as a single final_result frame
 *   error    → ship a single error frame with the persisted message
 *   degraded → same as done — result is still valid; UI surfaces the banner
 *
 * Connection-loss handling: if the client disconnects mid-stream the
 * orchestrator continues running (the run row gets persisted at the end
 * regardless). The next client load of /research/[id] picks up where
 * progress left off via the re-attach path above.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid run id." }, { status: 400 });
  }

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
      console.error("[stream] Supabase select failed:", error.message);
      return NextResponse.json({ error: "Could not load run." }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
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
    console.error(
      "[stream] Server config error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Server is missing required configuration." },
      { status: 500 }
    );
  }

  // Already resolved — ship the persisted state as a single-frame stream.
  if (run.status === "done" || run.status === "degraded") {
    return makeSseResponse(async function* () {
      yield {
        type: "final_result",
        payload: resultPayload,
      } satisfies StreamEvent;
    });
  }

  if (run.status === "error") {
    return makeSseResponse(async function* () {
      yield {
        type: "error",
        stage: "persisted",
        message: errorMessage ?? "Research failed.",
      } satisfies StreamEvent;
    });
  }

  if (run.status === "running") {
    // Re-attach path: the orchestrator is running on the original
    // Vercel instance (or already finished and just hasn't been
    // re-fetched here yet). Replay completed agents from the messages
    // log, then poll until status flips out of 'running'.
    return makeSseResponse(() => replayAndPoll(id));
  }

  // status === 'pending' — start the orchestrator.
  return makeSseResponse(() =>
    runResearch(run!.target_url, id, {
      tone: run!.tone,
      channel: run!.channel,
    })
  );
}

/**
 * Async generator for the running-run re-attach path. Yields events
 * shaped exactly like the orchestrator's live stream so the existing
 * useResearchStream hook on the client can consume them unchanged.
 *
 *   1. Fetch all completed agents from research_messages
 *   2. Yield agent_start + agent_done for each (in order)
 *   3. Loop: poll status + messages every REATTACH_POLL_INTERVAL_MS
 *      - new agent_done rows → yield agent_start + agent_done
 *      - status === 'done' / 'degraded' → yield final_result, return
 *      - status === 'error' → yield error, return
 *      - exceed REATTACH_MAX_LOOP_MS → return cleanly (next reload picks up)
 *
 * Tool-call + agent_thinking events are NOT replayed — the messages
 * log only persists per-agent assistant outputs. The visitor sees
 * each agent flip from pending straight to done; that's a worse but
 * acceptable visual than a stale 409 error.
 */
async function* replayAndPoll(runId: string): AsyncGenerator<StreamEvent> {
  const replayed = new Set<AgentIndex>();

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

  const initial = await getAgentDoneMessages(runId);
  for (const row of initial) {
    const agent = row.agent_index as AgentIndex;
    if (replayed.has(agent)) continue;
    for (const ev of eventsForAgentRow(row)) yield ev;
    replayed.add(agent);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < REATTACH_MAX_LOOP_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, REATTACH_POLL_INTERVAL_MS)
    );

    const latest = await getAgentDoneMessages(runId);
    for (const row of latest) {
      const agent = row.agent_index as AgentIndex;
      if (replayed.has(agent)) continue;
      for (const ev of eventsForAgentRow(row)) yield ev;
      replayed.add(agent);
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
  // Hit the loop ceiling without the run finishing — bail cleanly.
  // The client's EventSource auto-reconnects, which lands us back on
  // the same re-attach path with the latest replay state.
}

/**
 * Wrap an async iterable of StreamEvents into a Response with the
 * correct SSE headers. Each event becomes a `data: <json>\n\n` frame.
 */
function makeSseResponse(
  iterableFactory: () => AsyncIterable<StreamEvent>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of iterableFactory()) {
          const frame = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const frame = `data: ${JSON.stringify({
          type: "error",
          stage: "stream",
          message,
        } satisfies StreamEvent)}\n\n`;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // Client already disconnected — nothing to do.
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // X-Accel-Buffering disables nginx-style buffering on platforms
      // that proxy through nginx (some Vercel configurations).
      "X-Accel-Buffering": "no",
    },
  });
}
