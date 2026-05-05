import "server-only";
import { chat } from "./llm/chat";
import {
  EmailOutput,
  type EmailOutputT,
  type OutreachChannelT,
  type PeopleOutputT,
  type ReconnaissanceOutputT,
} from "./schemas";
import { EMAIL_SYSTEM, emailUserPrompt } from "./prompts/email";
import { extractJSON } from "./utils/extract-json";
import { findForbiddenPhrase } from "./utils/forbidden-phrases";
import { findUnverifiableClaim } from "./utils/unverifiable-claims";
import type { EmitFn } from "./stream-events";

/** Per `.ai/docs/06-agent-system-design.md` §8.4 — creative agent vs factual. */
const TEMPERATURE = 0.7;

/** Per §9.3 — retry once on forbidden-phrase OR Zod failure, then surface as-is for `degraded` marking. */
const MAX_RETRIES = 1;

const MAX_TOKENS = 1_024;

export interface RunAgent3Options {
  tone?: "cold" | "warm";
  channel?: OutreachChannelT;
  /**
   * Index into `people.decision_makers` of the person Agent 3 should
   * write to. When omitted (or 0), Agent 3 picks the first decision
   * maker as before. When set, that decision maker is reordered to
   * index 0 of the array passed to Agent 3 — the prompt always tells
   * the model to write for the FIRST decision maker, so reordering
   * effects the change without prompt-level branching.
   */
  targetIndex?: number;
}

export interface Agent3Result {
  /** The email itself. Always returned, even if `degraded` is true. */
  output: EmailOutputT;
  /**
   * True when both the initial attempt and the retry produced output
   * that tripped the forbidden-phrase regex. The orchestrator (Session 4
   * PR L) reads this and marks `research_runs.status = 'degraded'` so
   * the result card can show a "draft was retried — review carefully"
   * banner per the brand voice rules.
   */
  degraded: boolean;
  /** First forbidden-phrase reason captured (for telemetry / debugging). */
  forbiddenReason: string | null;
}

/**
 * Agent 3 — Personalisation & Outreach.
 *
 * Pure-reasoning agent. No tools — receives the prior agents' structured
 * outputs as JSON in the user prompt and returns a single email JSON
 * object plus 5 alternate hooks.
 *
 * Two failure modes the model can still hit despite the system prompt:
 *  1. Zod schema mismatch (wrong field shape, missing personalisation_hooks)
 *  2. Forbidden-phrase leak (marketing cliches the prompt forbids)
 *
 * Both trigger a single retry with a corrective user message. If the
 * retry also fails, returns whatever the model produced and signals
 * `degraded: true` so the orchestrator can flag the run.
 *
 * Stream events emitted via `emit`:
 *  - provider_used (per chat() call)
 *  - agent_thinking (on retry, with the failing reason)
 *
 * @param brief — Agent 1 output (validated upstream)
 * @param people — Agent 2 output (post-validation already applied)
 * @param _runId — research_runs.id; reserved for Session 4 PR L's per-agent message log
 * @param emit — stream-event callback for the orchestrator's SSE channel
 * @param options.tone — 'cold' (default) or 'warm' (Phase 2 regenerate-warmer button)
 *
 * @throws AllProvidersFailedError if every LLM provider is degraded
 * @throws Zod validation error after retry exhaustion (orchestrator catches & marks failed)
 */
export async function runAgent3(
  brief: ReconnaissanceOutputT,
  people: PeopleOutputT,
  _runId: string,
  emit: EmitFn,
  options: RunAgent3Options = {}
): Promise<Agent3Result> {
  const tone = options.tone ?? "cold";
  const channel = options.channel ?? "email";

  // Pull the picked decision maker to the front so Agent 3's prompt
  // ("write to the FIRST decision maker") targets them. Skip when no
  // targetIndex, or when out of bounds, or when it's already 0.
  const peopleForAgent: PeopleOutputT = (() => {
    const idx = options.targetIndex ?? 0;
    if (
      idx <= 0 ||
      idx >= people.decision_makers.length
    ) {
      return people;
    }
    const picked = people.decision_makers[idx];
    const rest = people.decision_makers.filter((_, i) => i !== idx);
    return {
      ...people,
      decision_makers: [picked, ...rest],
    };
  })();

  let firstForbiddenReason: string | null = null;
  let lastZodError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES + 1; attempt++) {
    const userPrompt =
      attempt === 0
        ? emailUserPrompt(brief, peopleForAgent, tone, channel)
        : buildRetryPrompt(brief, peopleForAgent, tone, channel, firstForbiddenReason, lastZodError);

    const result = await chat(
      {
        system: EMAIL_SYSTEM,
        messages: [{ role: "user", content: userPrompt }],
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
        responseFormat: "json",
      },
      (provider) => emit({ type: "provider_used", agent: 3, provider })
    );

    let parsed: EmailOutputT;
    try {
      const json = extractJSON(result.text);
      parsed = EmailOutput.parse(json);
    } catch (err) {
      lastZodError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        emit({
          type: "agent_thinking",
          agent: 3,
          delta: `Retry — output didn't match schema: ${lastZodError.message.slice(0, 120)}`,
        });
        continue;
      }
      // Out of retries — surface the schema error.
      throw lastZodError;
    }

    const hit = findForbiddenPhrase(parsed.body);
    if (hit) {
      firstForbiddenReason = firstForbiddenReason ?? hit.reason;
      if (attempt < MAX_RETRIES) {
        emit({
          type: "agent_thinking",
          agent: 3,
          delta: `Retry — body contained ${hit.reason}: "${hit.match}"`,
        });
        continue;
      }
      // Out of retries — return the email anyway, but flag `degraded`.
      return {
        output: parsed,
        degraded: true,
        forbiddenReason: firstForbiddenReason,
      };
    }

    // Anti-hallucination gate. Specific numeric / fundraising claims
    // are treated as suspect by default — even when present in the
    // brief, since the brief itself can carry an upstream fabrication
    // from Agent 1. Force Agent 3 to fall back to the public value
    // proposition.
    const unverifiable = findUnverifiableClaim(parsed.body);
    if (unverifiable) {
      const reasonLabel = `unverifiable claim — ${unverifiable.reason}`;
      firstForbiddenReason = firstForbiddenReason ?? reasonLabel;
      if (attempt < MAX_RETRIES) {
        emit({
          type: "agent_thinking",
          agent: 3,
          delta: `Retry — body contained ${unverifiable.reason}: "${unverifiable.match}"`,
        });
        continue;
      }
      return {
        output: parsed,
        degraded: true,
        forbiddenReason: firstForbiddenReason,
      };
    }

    // Clean output.
    return {
      output: parsed,
      degraded: false,
      forbiddenReason: null,
    };
  }

  // Unreachable: the loop always returns or throws inside.
  throw new Error("Agent 3 exhausted retries without producing output.");
}

/**
 * Constructs the user prompt for the retry attempt, including a
 * specific corrective note about what failed the first time.
 */
function buildRetryPrompt(
  brief: ReconnaissanceOutputT,
  people: PeopleOutputT,
  tone: "cold" | "warm",
  channel: OutreachChannelT,
  forbiddenReason: string | null,
  zodError: Error | null
): string {
  const correction = forbiddenReason
    ? forbiddenReason.startsWith("unverifiable claim")
      ? `Your previous draft contained an ${forbiddenReason} — a specific number or fundraising claim that the recipient could verify and find wrong. Rewrite the opener using ONLY the public value proposition from the brief (what the company sells, who it sells to). Do NOT use any specific percentage, dollar figure, multiplier, customer count, or funding round. A safe factual reference to the company's product is far better than a confident-sounding stat.`
      : `Your previous draft contained a ${forbiddenReason}. Rewrite WITHOUT any of the forbidden phrases listed in the system prompt. Be specific and quiet — the brief has plenty of factual hooks to open with.`
    : zodError
      ? `Your previous output did not match the required JSON schema (${zodError.message.slice(0, 200)}). Output ONLY the JSON object with all required fields populated.`
      : "Try again, sticking strictly to the system-prompt requirements.";

  return `${correction}

${emailUserPrompt(brief, people, tone, channel)}`;
}
