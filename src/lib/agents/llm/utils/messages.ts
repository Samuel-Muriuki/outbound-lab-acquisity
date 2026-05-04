import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat/completions";
import type { ChatMessage, FinishReason } from "../types";

/**
 * Convert our internal ChatMessage to the shape OpenAI's SDK expects.
 * Used by the Groq and OpenRouter providers (both speak the OpenAI
 * Chat Completions schema).
 */
export function toOpenAIMessage(
  message: ChatMessage
): ChatCompletionMessageParam {
  if (message.role === "tool") {
    if (!message.tool_call_id) {
      throw new Error("Tool message must include tool_call_id");
    }
    const toolMessage: ChatCompletionToolMessageParam = {
      role: "tool",
      tool_call_id: message.tool_call_id,
      content: message.content,
    };
    return toolMessage;
  }
  if (message.role === "assistant") {
    const assistantMessage: ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: message.content,
    };
    if (message.tool_calls && message.tool_calls.length > 0) {
      assistantMessage.tool_calls = message.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }
    return assistantMessage;
  }
  if (message.role === "user") {
    const userMessage: ChatCompletionUserMessageParam = {
      role: "user",
      content: message.content,
    };
    return userMessage;
  }
  if (message.role === "system") {
    return { role: "system", content: message.content };
  }
  // Exhaustive — TypeScript's narrowing should already cover this.
  const _exhaustive: never = message.role;
  throw new Error(`Unknown message role: ${String(_exhaustive)}`);
}

/**
 * Map OpenAI's finish_reason to our internal FinishReason.
 * - `tool_calls` → tool_calls
 * - `length` → length (truncated)
 * - `stop` / `null` / anything else → stop
 */
export function mapOpenAIFinishReason(
  reason: string | null | undefined
): FinishReason {
  if (reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  return "stop";
}
