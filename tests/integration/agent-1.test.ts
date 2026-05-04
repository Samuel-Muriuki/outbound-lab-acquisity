/**
 * Integration test for Agent 1 (Reconnaissance).
 *
 * Calls the **real** Groq API + the **real** Tavily search + real
 * fetch() against acquisity.com. Asserts the output passes Zod
 * validation and the company_name + sources look right.
 *
 * Skipped automatically when:
 *  - No LLM provider key is configured (GROQ_API_KEY / GEMINI_API_KEY /
 *    OPENROUTER_API_KEY all missing — fall-through chain has nothing to
 *    fall through to)
 *  - TAVILY_API_KEY is missing
 *  - process.env.CI is set (don't burn quota on every CI run)
 *  - process.env.SKIP_INTEGRATION_TESTS is set (manual escape hatch)
 *
 * Run locally: `pnpm test tests/integration/agent-1.test.ts`
 *
 * Cost (live): ~0 — Groq + Tavily are free tier; ~3-6 tool calls per
 * run, well under the daily quota.
 */
import { describe, expect, it } from "vitest";
import { runAgent1 } from "@/lib/agents/agent-1-reconnaissance";
import { ReconnaissanceOutput } from "@/lib/agents/schemas";
import type { StreamEvent } from "@/lib/agents/stream-events";

const TARGET_URL = "https://acquisity.com";
const TIMEOUT_MS = 90_000;

function shouldSkip(): { skip: boolean; reason: string } {
  if (process.env.CI) {
    return { skip: true, reason: "CI environment — don't burn API quota" };
  }
  if (process.env.SKIP_INTEGRATION_TESTS) {
    return { skip: true, reason: "SKIP_INTEGRATION_TESTS is set" };
  }
  const hasLLM =
    Boolean(process.env.GROQ_API_KEY) ||
    Boolean(process.env.GEMINI_API_KEY) ||
    Boolean(process.env.OPENROUTER_API_KEY);
  if (!hasLLM) {
    return {
      skip: true,
      reason:
        "No LLM provider key (GROQ_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY)",
    };
  }
  if (!process.env.TAVILY_API_KEY) {
    return { skip: true, reason: "TAVILY_API_KEY not set" };
  }
  return { skip: false, reason: "" };
}

const status = shouldSkip();

describe.skipIf(status.skip)("Agent 1 — Reconnaissance (integration)", () => {
  it(
    `produces a Zod-valid ReconnaissanceOutput for ${TARGET_URL}`,
    async () => {
      const events: StreamEvent[] = [];
      const emit = (e: StreamEvent) => events.push(e);

      const output = await runAgent1(TARGET_URL, "integration-test-run-id", emit);

      // 1. Zod validation passes
      const parsed = ReconnaissanceOutput.safeParse(output);
      expect(parsed.success, formatZodError(parsed)).toBe(true);

      // 2. Sanity-check the headline fields
      expect(output.company_name.toLowerCase()).toContain("acquisity");
      expect(output.sources.length).toBeGreaterThanOrEqual(1);
      expect(output.sources.some((url) => url.includes("acquisity"))).toBe(true);

      // 3. The agent issued at least one tool_call (otherwise it's
      //    making things up — that's a regression we want to catch)
      const toolCalls = events.filter((e) => e.type === "tool_call");
      expect(toolCalls.length).toBeGreaterThan(0);

      // 4. provider_used was emitted at least once with a known provider
      const providerEvents = events.filter((e) => e.type === "provider_used");
      expect(providerEvents.length).toBeGreaterThan(0);
      const provider = (providerEvents[0] as { provider: string }).provider;
      expect(["groq", "gemini", "openrouter"]).toContain(provider);

      // 5. Print a one-line summary so the developer sees what landed
      console.info(
        `[agent-1 integration] provider=${provider}, tool_calls=${toolCalls.length}, sources=${output.sources.length}, company_name="${output.company_name}"`
      );
    },
    TIMEOUT_MS
  );
});

if (status.skip) {
  console.info(`[agent-1 integration] skipped: ${status.reason}`);
}

function formatZodError(
  parsed: ReturnType<typeof ReconnaissanceOutput.safeParse>
): string {
  if (parsed.success) return "";
  return parsed.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("\n");
}
