/**
 * Unit tests for Agent 2 (People & ICP).
 *
 * Mocks chat() and the tools to exercise:
 *  - Tool-use loop (web_search only — no web_fetch via the model)
 *  - Post-validation gate: webFetchTool.execute() drops names not
 *    appearing in their cited source URL
 *  - Retry on Zod validation failure
 *  - 4-tool-call cap (vs Agent 1's 6)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatOptions, ChatResult } from "./llm/types";
import type { StreamEvent } from "./stream-events";
import type { ReconnaissanceOutputT } from "./schemas";

const RECON_BRIEF: ReconnaissanceOutputT = {
  company_name: "Acquisity",
  one_liner: "AI-powered B2B growth system that books sales meetings.",
  what_they_sell:
    "Acquisity sells an AI growth platform that automates B2B prospecting, qualification, and outreach for sales teams.",
  target_market:
    "B2B sales teams at AI-product companies, especially startups under 200 people.",
  company_size_estimate: "20-50 employees",
  recent_signals: [],
  sources: ["https://acquisity.com"],
};

const VALID_OUTPUT = {
  decision_makers: [
    {
      name: "Tasnim A.",
      role: "Global TA & People Experience Leader",
      why_them: "Owns TA hiring strategy at Acquisity; would directly evaluate this kind of pitch.",
      source_url: "https://acquisity.com/team",
      linkedin_url: "https://linkedin.com/in/tasnim-a",
    },
  ],
  buyer_persona: "Heads of growth + TA leaders at sub-200-person AI companies.",
  trigger_events: ["Hiring a senior full-stack engineer in May 2026."],
};

// Mocks must be hoisted before importing the agent.
const webFetchExecute = vi.fn();
vi.mock("./tools/web-search", () => ({
  webSearchTool: {
    name: "web_search",
    description: "stubbed",
    parameters: { parse: (v: unknown) => v },
    execute: vi.fn(async ({ query }: { query: string }) =>
      `1. Search result for "${query}"\n   https://example.com\n   snippet`
    ),
  },
}));
vi.mock("./tools/web-fetch", () => ({
  webFetchTool: {
    name: "web_fetch",
    description: "stubbed",
    parameters: { parse: (v: unknown) => v },
    execute: webFetchExecute,
  },
}));

const chatMock = vi.fn();
vi.mock("./llm/chat", () => ({
  chat: async (
    opts: ChatOptions,
    onProviderUsed?: (p: "groq" | "gemini" | "openrouter") => void
  ) => {
    const result = await chatMock(opts);
    if (onProviderUsed && result?.provider) onProviderUsed(result.provider);
    return result;
  },
  AllProvidersFailedError: class extends Error {},
}));

const { runAgent2 } = await import("./agent-2-people");

function makeChatResult(overrides: Partial<ChatResult> = {}): ChatResult {
  return {
    text: "",
    toolCalls: [],
    finishReason: "stop",
    provider: "groq",
    tokensIn: 80,
    tokensOut: 60,
    ...overrides,
  };
}

function captureEvents(): { emit: (e: StreamEvent) => void; events: StreamEvent[] } {
  const events: StreamEvent[] = [];
  return { emit: (e) => events.push(e), events };
}

beforeEach(() => {
  chatMock.mockReset();
  webFetchExecute.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runAgent2()", () => {
  it("returns a Zod-validated PeopleOutput when the LinkedIn slug matches (no fetch needed)", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_OUTPUT) })
    );
    // VALID_OUTPUT.linkedin_url is `https://linkedin.com/in/tasnim-a` —
    // its slug contains "tasnim" so the fast-path validates without
    // ever fetching the source page. Mock fetch to make sure it's NOT
    // called.

    const { emit, events } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(1);
    expect(out.decision_makers[0]!.name).toBe("Tasnim A.");
    expect(webFetchExecute).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "provider_used")).toBeDefined();
  });

  it("falls back to source_url fetch when neither URL slug matches the name", async () => {
    // Name + URLs that won't pass the slug check, so fetch IS the gate.
    chatMock.mockResolvedValueOnce(
      makeChatResult({
        text: JSON.stringify({
          ...VALID_OUTPUT,
          decision_makers: [
            {
              name: "Marcus Reed",
              role: "Head of Sales",
              why_them: "Owns sales hiring strategy at Acquisity.",
              source_url: "https://acquisity.com/team",
              linkedin_url: null,
            },
          ],
        }),
      })
    );
    // Page content includes the name → kept via the fallback fetch path.
    webFetchExecute.mockResolvedValue(
      "Marcus Reed is the Head of Sales at Acquisity."
    );

    const { emit } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(1);
    expect(webFetchExecute).toHaveBeenCalledWith({
      url: "https://acquisity.com/team",
    });
  });

  it("drops a decision maker whose name does not appear in the source URL", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({
        text: JSON.stringify({
          ...VALID_OUTPUT,
          decision_makers: [
            VALID_OUTPUT.decision_makers[0],
            {
              name: "Made Up Person",
              role: "VP Imaginary",
              why_them: "Fabricated by the model — should be dropped by validation.",
              source_url: "https://acquisity.com/team",
              linkedin_url: null,
            },
          ],
        }),
      })
    );
    webFetchExecute.mockResolvedValue(
      "Tasnim A. is on the Acquisity team page. No mention of any other people."
    );

    const { emit, events } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(1);
    expect(out.decision_makers[0]!.name).toBe("Tasnim A.");
    // agent_thinking event for the dropped fake
    const dropMessage = events.find(
      (e) => e.type === "agent_thinking" && (e as { delta: string }).delta.includes("Made Up Person")
    );
    expect(dropMessage).toBeDefined();
  });

  it("drops a decision maker when neither slug matches AND fetch fails", async () => {
    // Use a name whose tokens won't match either URL's slug, then make
    // the fetch throw — both validation paths fail, dm is dropped.
    chatMock.mockResolvedValueOnce(
      makeChatResult({
        text: JSON.stringify({
          ...VALID_OUTPUT,
          decision_makers: [
            {
              name: "Marcus Reed",
              role: "VP Imaginary",
              why_them: "Won't survive validation — fetch will throw.",
              source_url: "https://acquisity.com/team",
              linkedin_url: null,
            },
          ],
        }),
      })
    );
    webFetchExecute.mockRejectedValue(
      new Error("Could not fetch private or local addresses (192.168.0.1).")
    );

    const { emit, events } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(0);
    expect(
      events.find(
        (e) =>
          e.type === "agent_thinking" &&
          (e as { delta: string }).delta.includes("could not verify source")
      )
    ).toBeDefined();
  });

  it("executes web_search tool calls and threads the result back into messages", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({
        toolCalls: [
          {
            id: "call_1",
            name: "web_search",
            arguments: { query: "Acquisity founder OR CEO" },
          },
        ],
        finishReason: "tool_calls",
      })
    );
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_OUTPUT) })
    );
    webFetchExecute.mockResolvedValue("Tasnim A. is the Global TA Leader.");

    const { emit, events } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(1);
    expect(chatMock).toHaveBeenCalledTimes(2);

    const tool_call = events.find((e) => e.type === "tool_call");
    expect(tool_call).toMatchObject({
      type: "tool_call",
      agent: 2,
      tool: "web_search",
    });
  });

  it("retries on Zod validation failure and succeeds on the second attempt", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify({ broken: "schema" }) })
    );
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_OUTPUT) })
    );
    webFetchExecute.mockResolvedValue("Tasnim A. is here.");

    const { emit, events } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(1);
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.type === "agent_thinking").length).toBeGreaterThan(0);
  });

  it("injects a wrap-up nudge after hitting the 4-tool-call cap", async () => {
    for (let i = 0; i < 4; i++) {
      chatMock.mockResolvedValueOnce(
        makeChatResult({
          toolCalls: [
            {
              id: `call_${i}`,
              name: "web_search",
              arguments: { query: `q${i}` },
            },
          ],
          finishReason: "tool_calls",
        })
      );
    }
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_OUTPUT) })
    );
    webFetchExecute.mockResolvedValue("Tasnim A. is here.");

    const { emit } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(1);

    // Last chat() call should have the cap-nudge user message
    const lastOpts = chatMock.mock.calls.at(-1)![0] as ChatOptions;
    const lastUser = lastOpts.messages.filter((m) => m.role === "user").at(-1);
    expect(lastUser?.content).toMatch(/4-tool-call cap/i);
  });
});
