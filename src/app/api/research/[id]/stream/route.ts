import { NextResponse, type NextRequest } from "next/server";
import { runResearch } from "@/lib/agents/orchestrator";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { StreamEvent } from "@/lib/agents/stream-events";

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
 *   running  → an SSE consumer is already attached upstream; reject 409 to
 *              prevent double-runs (defensive — the route handler is the
 *              only place orchestration kicks off, so this should never
 *              fire under normal use)
 *   done     → ship the cached result.payload as a single final_result frame
 *   error    → ship a single error frame with the persisted message
 *   degraded → same as done — result is still valid; UI surfaces the banner
 *
 * Connection-loss handling: if the client disconnects mid-stream the
 * orchestrator continues running (the run row gets persisted at the end
 * regardless). The next client load of /research/[id] picks up the
 * `done` state and streams `final_result` from the row.
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
    // Another stream is presumably attached. Defensive 409 — the
    // streaming page only opens one EventSource per id under normal use.
    return NextResponse.json(
      { error: "This run is already streaming elsewhere." },
      { status: 409 }
    );
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
