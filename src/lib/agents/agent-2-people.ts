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
      const verified = await validateDecisionMakers(raw, brief, emit);
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
        // No responseFormat: "json" — Groq rejects JSON mode + tools in
        // the same request. The system prompt instructs JSON-only output
        // and extractJSON() handles any markdown-fence slips.
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
          tool_name: tc.name,
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

/** Best-effort target-domain extraction from the brief.sources array. */
function deriveTargetDomain(brief: ReconnaissanceOutputT): string | null {
  for (const source of brief.sources) {
    try {
      return new URL(source).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      // Skip malformed URLs.
    }
  }
  return null;
}

/**
 * True when the source URL's hostname is on the target domain (exact
 * match or subdomain — e.g. blog.acquisity.ai counts).
 */
function isOnTargetDomain(sourceUrl: string, targetDomain: string): boolean {
  let host: string;
  try {
    host = new URL(sourceUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return false;
  }
  return host === targetDomain || host.endsWith(`.${targetDomain}`);
}

/**
 * Tokenise a company name into searchable lowercase fragments — drops
 * filler tokens like "Inc", "LLC", "Corp" so a body containing
 * "Acquisity" still matches when the brief says "Acquisity, Inc.".
 */
function companyNameTokens(companyName: string): string[] {
  const filler = new Set(["inc", "llc", "ltd", "corp", "co", "the", "and"]);
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !filler.has(t));
}

/**
 * Body-side disambiguation: does this page text actually pertain to
 * the target company (and not a similarly-named different company)?
 * Accept if the body contains EITHER the target domain OR every
 * non-filler token of the company name.
 */
function bodyMentionsTarget(
  body: string,
  targetDomain: string | null,
  companyName: string
): boolean {
  const lc = body.toLowerCase();
  if (targetDomain && lc.includes(targetDomain)) return true;
  const tokens = companyNameTokens(companyName);
  if (tokens.length === 0) return false;
  return tokens.every((t) => lc.includes(t));
}

/**
 * Post-validation gate per `.ai/docs/06-agent-system-design.md` §9.2,
 * tightened 2026-05-05 after the Hormozi/Acquisition.com regression
 * (different company with similar name was passing the slug check).
 *
 * Per decision maker, accept if EITHER:
 *   1. source_url is on the target's own domain (the company's own
 *      page is canonical — name appearing there is sufficient), OR
 *   2. source_url body contains BOTH the person's name AND a target-
 *      company signal (target_domain literal OR every non-filler
 *      token of the company_name). Catches the "right name, wrong
 *      company" failure mode.
 *
 * The previous slug-only fast path is gone. LinkedIn URLs that the
 * agent surfaces will fail body verification (login wall, no
 * target-company mention) — that's correct: we can't vouch for a
 * person we can't actually verify is at the target.
 */
async function validateDecisionMakers(
  people: PeopleOutputT,
  brief: ReconnaissanceOutputT,
  emit: EmitFn
): Promise<PeopleOutputT> {
  const targetDomain = deriveTargetDomain(brief);
  const companyName = brief.company_name;

  const verified = await Promise.all(
    people.decision_makers.map(async (dm) => {
      // Tier 1: source on the target's own domain — accept.
      if (targetDomain && isOnTargetDomain(dm.source_url, targetDomain)) {
        return dm;
      }

      // Tier 2: cross-domain source — fetch and require BOTH name and
      // target-company signal in body.
      let content: string;
      try {
        content = await webFetchTool.execute({ url: dm.source_url });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit({
          type: "agent_thinking",
          agent: 2,
          delta: `Dropping "${dm.name}" — could not fetch ${dm.source_url} to verify cross-domain source: ${message}`,
        });
        return null;
      }

      const lcContent = content.toLowerCase();
      const nameInBody = lcContent.includes(dm.name.toLowerCase());
      if (!nameInBody) {
        emit({
          type: "agent_thinking",
          agent: 2,
          delta: `Dropping "${dm.name}" — name not found in ${dm.source_url} body.`,
        });
        return null;
      }

      if (!bodyMentionsTarget(content, targetDomain, companyName)) {
        emit({
          type: "agent_thinking",
          agent: 2,
          delta: `Dropping "${dm.name}" — source ${dm.source_url} does not mention target company "${companyName}". Likely a similarly-named different company.`,
        });
        return null;
      }

      return dm;
    })
  );

  return {
    ...people,
    decision_makers: verified.filter((d): d is NonNullable<typeof d> => d !== null),
  };
}
