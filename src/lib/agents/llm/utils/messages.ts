import type { ModelMessage } from "ai";
import type { ChatMessage, FinishReason } from "../types";

/**
 * Map the Vercel AI SDK's `finishReason` (a stable string union across
 * providers) to our internal FinishReason. AI SDK uses `tool-calls`
 * (hyphen) where OpenAI uses `tool_calls` (underscore) — this hides
 * the wire-format difference from our agents.
 */
export function mapAISDKFinishReason(
  reason: string | null | undefined
): FinishReason {
  if (reason === "tool-calls") return "tool_calls";
  if (reason === "length") return "length";
  if (reason === "error") return "error";
  return "stop";
}

/**
 * Convert our internal ChatMessage list to the Vercel AI SDK's
 * ModelMessage format. The system instruction is passed separately to
 * `generateText({ system })` rather than prepended here, so this only
 * handles the conversation tail. AI SDK uses structured-content
 * message shapes:
 *
 *   - assistant messages with tool_calls → assistant w/ TextPart +
 *     ToolCallPart[] in `content`
 *   - tool messages → tool message w/ a single ToolResultPart in
 *     `content`, keyed by toolCallId AND toolName (the latter is why
 *     ChatMessage.tool_name was added — AI SDK requires it)
 *   - plain user/assistant string content → string content (the SDK
 *     accepts both shapes)
 */
export function toAISDKMessages(messages: ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      if (!m.tool_call_id || !m.tool_name) {
        throw new Error(
          "Tool message must include tool_call_id and tool_name for AI SDK"
        );
      }
      out.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: m.tool_call_id,
            toolName: m.tool_name,
            output: { type: "text", value: m.content },
          },
        ],
      });
      continue;
    }
    if (m.role === "assistant") {
      // No tool calls → pass content through as a string for brevity.
      if (!m.tool_calls || m.tool_calls.length === 0) {
        out.push({ role: "assistant", content: m.content });
        continue;
      }
      const parts: Array<
        | { type: "text"; text: string }
        | {
            type: "tool-call";
            toolCallId: string;
            toolName: string;
            input: Record<string, unknown>;
          }
      > = [];
      if (m.content) parts.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) {
        parts.push({
          type: "tool-call",
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.arguments,
        });
      }
      out.push({ role: "assistant", content: parts });
      continue;
    }
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    // 'system' role messages should be merged into the system arg
    // upstream; if one slips through, treat it as a user note.
    out.push({ role: "user", content: m.content });
  }
  return out;
}
