/**
 * Stream event taxonomy.
 *
 * The orchestrator (Session 4) emits these events as SSE frames. The
 * client `EventSource` deserialises them into UI updates per
 * `.ai/docs/12-ux-flows.md` §2.5.
 *
 * Source of truth: `.ai/docs/06-agent-system-design.md` §4.
 *
 * Each agent receives an `emit(event)` callback so it can announce
 * tool_call / tool_result / agent_thinking / provider_used as it runs.
 * The orchestrator wraps this with agent_start / agent_done bookends.
 */
import type { ProviderName } from "./llm/types";

export type AgentIndex = 1 | 2 | 3;

/** Cache hit short-circuits the orchestrator — final_result follows. */
export interface CacheHitEvent {
  type: "cache_hit";
  source_run_id: string;
}

/** Emitted by the orchestrator as soon as the row is created. */
export interface RunCreatedEvent {
  type: "run_created";
  run_id: string;
}

/** Bookends each agent. */
export interface AgentStartEvent {
  type: "agent_start";
  agent: AgentIndex;
  name: string;
}

export interface AgentDoneEvent {
  type: "agent_done";
  agent: AgentIndex;
  output: unknown;
  duration_ms: number;
}

/** Tells the UI which provider served the underlying chat() call. */
export interface ProviderUsedEvent {
  type: "provider_used";
  agent: AgentIndex;
  provider: ProviderName;
}

/** Model invoked a tool. */
export interface ToolCallEvent {
  type: "tool_call";
  agent: AgentIndex;
  tool: string;
  input: unknown;
}

/** Tool returned. result_summary is truncated for the UI. */
export interface ToolResultEvent {
  type: "tool_result";
  agent: AgentIndex;
  tool: string;
  result_summary: string;
}

/** Agent's natural-language thinking (e.g. retry notices). */
export interface AgentThinkingEvent {
  type: "agent_thinking";
  agent: AgentIndex;
  delta: string;
}

/** Final structured output across all 3 agents. */
export interface FinalResultEvent {
  type: "final_result";
  payload: unknown;
}

/** Any failure from any stage. */
export interface ErrorEvent {
  type: "error";
  stage: string;
  message: string;
}

export type StreamEvent =
  | CacheHitEvent
  | RunCreatedEvent
  | AgentStartEvent
  | AgentDoneEvent
  | ProviderUsedEvent
  | ToolCallEvent
  | ToolResultEvent
  | AgentThinkingEvent
  | FinalResultEvent
  | ErrorEvent;

/** Callback the agents receive for emitting events. */
export type EmitFn = (event: StreamEvent) => void;
