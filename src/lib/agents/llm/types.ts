/**
 * Provider-agnostic types for the LLM abstraction layer.
 *
 * Every agent calls the single `chat()` function from `./chat.ts`,
 * which dispatches across the locked provider chain (Groq → Gemini →
 * OpenRouter). The contract below is stable across providers — the
 * fallback is invisible at the agent level.
 *
 * Source of truth: `.ai/docs/06-agent-system-design.md` §5.1.
 */
import type { z } from "zod";

export type ProviderName = "groq" | "gemini" | "openrouter";

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant messages that invoked tools. */
  tool_calls?: ChatToolCall[];
  /** Present on tool messages — the id of the tool call this is the result of. */
  tool_call_id?: string;
}

export interface ToolDefinition<
  T extends z.ZodType<Record<string, unknown>> = z.ZodType<
    Record<string, unknown>
  >,
> {
  name: string;
  description: string;
  parameters: T;
  /**
   * Server-side executor. Receives parsed input and returns a string the
   * model will see as the tool result. Throw to signal a transient
   * error; return a "Tool error: …" string for non-retryable failures
   * the model should reason about.
   */
  execute: (input: z.infer<T>) => Promise<string>;
}

export interface ChatOptions {
  system: string;
  messages: ChatMessage[];
  /** Optional list; absent → no tool calling, model returns text only. */
  tools?: ToolDefinition[];
  /** 0..1; 0.2 default for factual agents, 0.7 for creative (Agent 3). */
  temperature?: number;
  /** Hard cap on completion tokens. Default 2048. */
  maxTokens?: number;
  /** "json" forces structured output where the provider supports it. */
  responseFormat?: "json" | "text";
  /** Abort signal forwarded to the underlying SDK. */
  abortSignal?: AbortSignal;
}

export type FinishReason = "stop" | "tool_calls" | "length" | "error";

export interface ChatResult {
  /** Text content of the assistant message; "" if the model only emitted tool_calls. */
  text: string;
  toolCalls: ChatToolCall[];
  finishReason: FinishReason;
  provider: ProviderName;
  tokensIn: number;
  tokensOut: number;
}

export interface LLMProvider {
  name: ProviderName;
  /** True when the env var for this provider's API key is set. */
  isAvailable(): boolean;
  chat(opts: ChatOptions): Promise<ChatResult>;
}
