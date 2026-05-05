import "server-only";
import { chat } from "./llm/chat";
import type { ChatMessage, ToolDefinition } from "./llm/types";
import {
  ReconnaissanceOutput,
  type ReconnaissanceOutputT,
} from "./schemas";
import {
  RECONNAISSANCE_SYSTEM,
  reconnaissanceUserPrompt,
} from "./prompts/reconnaissance";
import { webSearchTool } from "./tools/web-search";
import { webFetchTool } from "./tools/web-fetch";
import { extractJSON } from "./utils/extract-json";
import type { EmitFn } from "./stream-events";

const TOOLS: ToolDefinition[] = [
  webSearchTool as ToolDefinition,
  webFetchTool as ToolDefinition,
];

/** Hard cap from `.ai/docs/06-agent-system-design.md` §6.2. */
const MAX_TOOL_CALLS = 6;

/** §6.5 — retry the whole agent twice on failure (3 attempts total). */
const MAX_RETRIES = 2;

/** Truncation for tool_result event summaries (UI consumes these as event_summary). */
const RESULT_SUMMARY_CHARS = 200;

/** Truncation when feeding tool output back into the model context. */
const MODEL_TOOL_RESULT_CHARS = 8_000;

/**
 * Agent 1 — Reconnaissance.
 *
 * Calls chat() with web_search + web_fetch registered as tools. Runs the
 * tool-use loop: model emits tool_calls → we execute → we feed results
 * back as `role: 'tool'` messages → repeat. When the model emits text
 * with no tool_calls, we parse it as JSON and validate against the
 * `ReconnaissanceOutput` schema.
 *
 * Stream events emitted via `emit`:
 *   - provider_used (once per chat() call, on success)
 *   - tool_call    (once per model-issued tool call)
 *   - tool_result  (once per executed tool)
 *   - agent_thinking (on retry)
 *
 * The orchestrator (Session 4) wraps this with agent_start / agent_done.
 *
 * @param targetUrl — the company URL to research, validated upstream
 * @param _runId — research_runs.id for downstream telemetry; unused in
 *                 Phase 1 PR H. Wired up in Session 4 with the message log.
 * @param emit — stream-event callback for the orchestrator's SSE channel
 * @returns a Zod-validated ReconnaissanceOutputT
 *
 * @throws if all 3 attempts fail (last error surfaces in the message)
 * @throws AllProvidersFailedError if the entire LLM chain is degraded
 */
export async function runAgent1(
  targetUrl: string,
  _runId: string,
  emit: EmitFn
): Promise<ReconnaissanceOutputT> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES + 1; attempt++) {
    try {
      return await runOnce(targetUrl, emit);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        emit({
          type: "agent_thinking",
          agent: 1,
          delta: `Retry ${attempt + 1}/${MAX_RETRIES} after error: ${lastError.message}`,
        });
      }
    }
  }

  throw lastError ?? new Error("Agent 1 failed without a specific error.");
}

async function runOnce(
  targetUrl: string,
  emit: EmitFn
): Promise<ReconnaissanceOutputT> {
  const messages: ChatMessage[] = [
    { role: "user", content: reconnaissanceUserPrompt(targetUrl) },
  ];
  let toolCallCount = 0;

  while (toolCallCount <= MAX_TOOL_CALLS) {
    const result = await chat(
      {
        system: RECONNAISSANCE_SYSTEM,
        messages,
        tools: TOOLS,
        temperature: 0.2,
        maxTokens: 2_048,
        // No responseFormat: "json" — Groq rejects JSON mode + tools in
        // the same request. The system prompt instructs JSON-only output
        // and extractJSON() handles any markdown-fence slips.
      },
      (provider) => emit({ type: "provider_used", agent: 1, provider })
    );

    // Tool-call branch: model wants more information.
    if (result.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: result.text,
        tool_calls: result.toolCalls,
      });

      for (const tc of result.toolCalls) {
        toolCallCount++;
        emit({ type: "tool_call", agent: 1, tool: tc.name, input: tc.arguments });

        const tool = TOOLS.find((t) => t.name === tc.name);
        let toolResult: string;
        if (!tool) {
          toolResult = `Tool error: unknown tool "${tc.name}"`;
        } else {
          try {
            const parsedInput = tool.parameters.parse(tc.arguments);
            toolResult = await tool.execute(parsedInput);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            toolResult = `Tool error: ${message}`;
          }
        }

        emit({
          type: "tool_result",
          agent: 1,
          tool: tc.name,
          result_summary: toolResult.slice(0, RESULT_SUMMARY_CHARS),
        });

        messages.push({
          role: "tool",
          content: toolResult.slice(0, MODEL_TOOL_RESULT_CHARS),
          tool_call_id: tc.id,
          tool_name: tc.name,
        });
      }

      if (toolCallCount >= MAX_TOOL_CALLS) {
        // Push a synthetic user message nudging the model to wrap up
        // with whatever it has rather than asking for another tool.
        messages.push({
          role: "user",
          content:
            "You have hit the 6-tool-call cap. Output the final JSON now using whatever you've gathered. Do not call any more tools.",
        });
      }
      continue;
    }

    // Output branch: model returned text only — parse + validate.
    const json = extractJSON(result.text);
    return ReconnaissanceOutput.parse(json);
  }

  throw new Error(
    "Agent 1 exited the tool-use loop without producing output (this should not happen — the cap-nudge user message should force a final JSON)."
  );
}
