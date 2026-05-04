import "server-only";
import { chat } from "./llm/chat";
import type { ChatMessage, ToolDefinition } from "./llm/types";
import {
  PeopleOutput,
  type PeopleOutputT,
  type ReconnaissanceOutputT,
} from "./schemas";
import { PEOPLE_SYSTEM, peopleUserPrompt } from "./prompts/people";
import { webSearchTool } from "./tools/web-search";
import { webFetchTool } from "./tools/web-fetch";
import { extractJSON } from "./utils/extract-json";
import type { EmitFn } from "./stream-events";

const TOOLS: ToolDefinition[] = [webSearchTool as ToolDefinition];

/** Hard cap from `.ai/docs/06-agent-system-design.md` §7.2. */
const MAX_TOOL_CALLS = 4;

/** Per §6.5 — same retry policy as Agent 1. */
const MAX_RETRIES = 2;

const RESULT_SUMMARY_CHARS = 200;
const MODEL_TOOL_RESULT_CHARS = 8_000;

/**
 * Agent 2 — People & ICP.
 *
 * Identifies up to 3 decision makers for outbound, then runs a
 * post-validation gate that fetches each cited source_url and drops
 * any entry whose name doesn't appear in the page text. This kills
 * the agent-fabricated-people class of bug at the validation layer
 * (per .ai/docs/06-agent-system-design.md §9.2).
 *
 * Tools: web_search only (no web_fetch — finding sources, not reading them).
 *        web_fetch is used by the post-validation step from outside the
 *        model's reach.
 */
export async function runAgent2(
  brief: ReconnaissanceOutputT,
  _runId: string,
  emit: EmitFn
): Promise<PeopleOutputT> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES + 1; attempt++) {
    try {
      const raw = await runOnce(brief, emit);
      // Post-validate before returning.
      const verified = await validateDecisionMakers(raw, emit);
      return verified;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        emit({
          type: "agent_thinking",
          agent: 2,
          delta: `Retry ${attempt + 1}/${MAX_RETRIES} after error: ${lastError.message}`,
        });
      }
    }
  }

  throw lastError ?? new Error("Agent 2 failed without a specific error.");
}

async function runOnce(
  brief: ReconnaissanceOutputT,
  emit: EmitFn
): Promise<PeopleOutputT> {
  const messages: ChatMessage[] = [
    { role: "user", content: peopleUserPrompt(brief) },
  ];
  let toolCallCount = 0;

  while (toolCallCount <= MAX_TOOL_CALLS) {
    const result = await chat(
      {
        system: PEOPLE_SYSTEM,
        messages,
        tools: TOOLS,
        temperature: 0.2,
        maxTokens: 2_048,
        responseFormat: "json",
      },
      (provider) => emit({ type: "provider_used", agent: 2, provider })
    );

    if (result.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: result.text,
        tool_calls: result.toolCalls,
      });

      for (const tc of result.toolCalls) {
        toolCallCount++;
        emit({ type: "tool_call", agent: 2, tool: tc.name, input: tc.arguments });

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
          agent: 2,
          tool: tc.name,
          result_summary: toolResult.slice(0, RESULT_SUMMARY_CHARS),
        });

        messages.push({
          role: "tool",
          content: toolResult.slice(0, MODEL_TOOL_RESULT_CHARS),
          tool_call_id: tc.id,
        });
      }

      if (toolCallCount >= MAX_TOOL_CALLS) {
        messages.push({
          role: "user",
          content:
            "You have hit the 4-tool-call cap. Output the final JSON now using whatever you've gathered. Do not call any more tools.",
        });
      }
      continue;
    }

    const json = extractJSON(result.text);
    return PeopleOutput.parse(json);
  }

  throw new Error(
    "Agent 2 exited the tool-use loop without producing output (this should not happen — the cap-nudge user message should force a final JSON)."
  );
}

/**
 * Post-validation gate per `.ai/docs/06-agent-system-design.md` §9.2.
 *
 * Fetches each decision maker's cited source_url and verifies the name
 * appears (case-insensitive) in the page text. Drops any entry that
 * fails. Returns a new PeopleOutput with the verified entries.
 *
 * Failures here aren't agent retries — the agent did its work; we're
 * simply auditing the citations. If the page is unreachable we drop
 * the entry rather than retrying.
 */
async function validateDecisionMakers(
  people: PeopleOutputT,
  emit: EmitFn
): Promise<PeopleOutputT> {
  const verified = await Promise.all(
    people.decision_makers.map(async (dm) => {
      try {
        const content = await webFetchTool.execute({ url: dm.source_url });
        if (content.toLowerCase().includes(dm.name.toLowerCase())) {
          return dm;
        }
        emit({
          type: "agent_thinking",
          agent: 2,
          delta: `Dropping "${dm.name}" — name not found at ${dm.source_url}.`,
        });
        return null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({
          type: "agent_thinking",
          agent: 2,
          delta: `Dropping "${dm.name}" — could not verify source: ${message}`,
        });
        return null;
      }
    })
  );

  return {
    ...people,
    decision_makers: verified.filter((d): d is NonNullable<typeof d> => d !== null),
  };
}
