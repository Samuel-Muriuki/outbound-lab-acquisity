"use client";

import { useEffect, useRef, useState } from "react";
import type { ResearchResult } from "@/lib/agents/orchestrator";
import type { ProviderName } from "@/lib/agents/llm/types";
import type {
  AgentIndex,
  StreamEvent,
} from "@/lib/agents/stream-events";

/**
 * Per-agent runtime state assembled from incoming StreamEvents.
 *
 * The streaming UI in `<AgentTimeline>` reads these three rows directly
 * to drive the pending/running/done visual state per agent.
 */
export interface AgentState {
  status: "pending" | "running" | "done";
  /** Provider that served the most-recent chat() call, if any. */
  provider: ProviderName | null;
  /** Tool calls observed during this agent's run, in order. */
  toolCalls: ToolCallEntry[];
  /** Accumulated agent_thinking deltas (concatenated, newline-separated). */
  thinking: string;
  /** ms — populated when agent_done fires. */
  durationMs: number | null;
  /** Final structured output from this agent, populated on agent_done. */
  output: unknown | null;
}

export interface ToolCallEntry {
  tool: string;
  input: unknown;
  /** Populated when the matching tool_result event arrives. */
  resultSummary: string | null;
}

/**
 * The hook's external state. Components consume this and re-render as
 * events flow in.
 */
export interface ResearchStreamState {
  /** 'idle' = no EventSource yet (e.g. status=done, no streaming needed). */
  status: "idle" | "connecting" | "streaming" | "done" | "error";
  /** Per-agent timeline rows. */
  agents: Record<AgentIndex, AgentState>;
  /** Cache-hit attribution if the run was served from cache. */
  cacheSourceRunId: string | null;
  /** Final structured payload — populated on `final_result` or when status starts at 'done'. */
  result: ResearchResult | null;
  /** Most recent error message, if any. */
  error: string | null;
}

export interface UseResearchStreamArgs {
  /** Run id (UUID). */
  runId: string;
  /**
   * Initial run status from the server-rendered shell. If 'done' or
   * 'degraded' or 'error', the hook seeds state and never opens an
   * EventSource. If 'pending' or 'running', the hook subscribes.
   */
  initialStatus: "pending" | "running" | "done" | "error" | "degraded";
  /** When initialStatus is 'done' / 'degraded' the cached payload from research_runs.result. */
  initialResult?: ResearchResult | null;
  /** When initialStatus is 'error' the persisted error_message. */
  initialError?: string | null;
}

const EMPTY_AGENT_STATE: AgentState = {
  status: "pending",
  provider: null,
  toolCalls: [],
  thinking: "",
  durationMs: null,
  output: null,
};

function makeInitialAgents(): Record<AgentIndex, AgentState> {
  return {
    1: { ...EMPTY_AGENT_STATE },
    2: { ...EMPTY_AGENT_STATE },
    3: { ...EMPTY_AGENT_STATE },
  };
}

/**
 * Subscribes to `GET /api/research/[id]/stream` and accumulates events
 * into typed React state.
 *
 * - Skips the EventSource entirely when initialStatus is already
 *   resolved ('done' / 'degraded' / 'error') and seeds state from the
 *   provided initialResult / initialError instead. The streaming page
 *   server-component does this hand-off so cache hits and past runs
 *   never trigger a redundant SSE connection.
 * - Closes the EventSource on `final_result` or `error`, or on unmount.
 *
 * Source of truth: `.ai/docs/06-agent-system-design.md` §4 + `.ai/docs/12-ux-flows.md` §2.5.
 */
export function useResearchStream({
  runId,
  initialStatus,
  initialResult = null,
  initialError = null,
}: UseResearchStreamArgs): ResearchStreamState {
  const isResolved =
    initialStatus === "done" ||
    initialStatus === "degraded" ||
    initialStatus === "error";

  const [state, setState] = useState<ResearchStreamState>(() => ({
    status: isResolved ? (initialStatus === "error" ? "error" : "done") : "idle",
    agents: makeInitialAgents(),
    cacheSourceRunId: null,
    result: initialResult,
    error: initialError,
  }));

  // Stable ref to mark whether the EventSource is already open — guards
  // against StrictMode double-effect in dev.
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (isResolved) return;
    if (eventSourceRef.current) return;

    setState((prev) => ({ ...prev, status: "connecting" }));

    const url = `/api/research/${runId}/stream`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setState((prev) => ({ ...prev, status: "streaming" }));
    };

    es.onmessage = (msg) => {
      let event: StreamEvent;
      try {
        event = JSON.parse(msg.data) as StreamEvent;
      } catch (err) {
        console.warn("[useResearchStream] Failed to parse SSE frame:", err);
        return;
      }
      setState((prev) => applyEvent(prev, event));

      if (event.type === "final_result" || event.type === "error") {
        es.close();
        eventSourceRef.current = null;
      }
    };

    es.onerror = (event) => {
      console.warn("[useResearchStream] EventSource error", event);
      setState((prev) =>
        prev.status === "done" || prev.status === "error"
          ? prev
          : {
              ...prev,
              status: "error",
              error:
                prev.error ?? "Connection lost. Refresh to try again.",
            }
      );
      es.close();
      eventSourceRef.current = null;
    };

    return () => {
      if (eventSourceRef.current === es) {
        es.close();
        eventSourceRef.current = null;
      }
    };
  }, [runId, isResolved]);

  return state;
}

function applyEvent(
  prev: ResearchStreamState,
  event: StreamEvent
): ResearchStreamState {
  switch (event.type) {
    case "cache_hit":
      return { ...prev, cacheSourceRunId: event.source_run_id };

    case "run_created":
      return prev;

    case "agent_start": {
      const agents = { ...prev.agents };
      agents[event.agent] = { ...agents[event.agent], status: "running" };
      return { ...prev, agents };
    }

    case "agent_done": {
      const agents = { ...prev.agents };
      agents[event.agent] = {
        ...agents[event.agent],
        status: "done",
        durationMs: event.duration_ms,
        output: event.output,
      };
      return { ...prev, agents };
    }

    case "provider_used": {
      const agents = { ...prev.agents };
      agents[event.agent] = {
        ...agents[event.agent],
        provider: event.provider,
      };
      return { ...prev, agents };
    }

    case "tool_call": {
      const agents = { ...prev.agents };
      agents[event.agent] = {
        ...agents[event.agent],
        toolCalls: [
          ...agents[event.agent].toolCalls,
          { tool: event.tool, input: event.input, resultSummary: null },
        ],
      };
      return { ...prev, agents };
    }

    case "tool_result": {
      const agents = { ...prev.agents };
      const calls = agents[event.agent].toolCalls;
      // Match the most recent unfilled tool_call for this tool name.
      let updated = false;
      const next = calls
        .slice()
        .reverse()
        .map((entry) => {
          if (
            !updated &&
            entry.tool === event.tool &&
            entry.resultSummary === null
          ) {
            updated = true;
            return { ...entry, resultSummary: event.result_summary };
          }
          return entry;
        })
        .reverse();
      agents[event.agent] = { ...agents[event.agent], toolCalls: next };
      return { ...prev, agents };
    }

    case "agent_thinking": {
      const agents = { ...prev.agents };
      const existing = agents[event.agent].thinking;
      agents[event.agent] = {
        ...agents[event.agent],
        thinking: existing ? `${existing}\n${event.delta}` : event.delta,
      };
      return { ...prev, agents };
    }

    case "final_result":
      return {
        ...prev,
        status: "done",
        result: event.payload as ResearchResult,
      };

    case "error":
      return {
        ...prev,
        status: "error",
        error: event.message,
      };

    default: {
      // Exhaustiveness check
      const _never: never = event;
      void _never;
      return prev;
    }
  }
}
