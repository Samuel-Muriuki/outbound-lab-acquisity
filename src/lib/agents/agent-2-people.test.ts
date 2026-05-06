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
  sources: ["https://acquisity.ai"],
};

const VALID_OUTPUT = {
  decision_makers: [
    {
      name: "Tasnim A.",
      role: "Global TA & People Experience Leader",
      why_them: "Owns TA hiring strategy at Acquisity; would directly evaluate this kind of pitch.",
      source_url: "https://acquisity.ai/team",
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
  it("auto-accepts a DM when the source URL is on the target domain (no source fetch needed)", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_OUTPUT) })
    );
    // VALID_OUTPUT source_url is https://acquisity.ai/team — host
    // matches RECON_BRIEF.sources[0] hostname → Tier 1 accept.
    // The trusted-corpus build fetches brief.sources[0] but the DM's
    // own source_url is never fetched.
    webFetchExecute.mockResolvedValue("Acquisity homepage content.");

    const { emit, events } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(1);
    expect(out.decision_makers[0]!.name).toBe("Tasnim A.");
    // The DM's own source_url is not fetched (only the brief source).
    const fetchedUrls = webFetchExecute.mock.calls.map((c) => c[0].url);
    expect(fetchedUrls).not.toContain("https://acquisity.ai/team");
    expect(events.find((e) => e.type === "provider_used")).toBeDefined();
  });

  it("Tier 2: accepts a LinkedIn-cited DM whose name appears on target's own pages", async () => {
    // Real-world flow: agent finds Stauffer via search, cites his
    // LinkedIn (linkedin.com/in/jaredpstauffer). LinkedIn fetch
    // returns a wall, but his name IS on acquisity.ai/story. Tier 2
    // catches this case via the trusted corpus.
    chatMock.mockResolvedValueOnce(
      makeChatResult({
        text: JSON.stringify({
          ...VALID_OUTPUT,
          decision_makers: [
            {
              name: "Jared Stauffer",
              role: "CEO",
              why_them: "Founder of Acquisity, named on the company's story page.",
              source_url: "https://linkedin.com/in/jaredpstauffer",
              linkedin_url: "https://linkedin.com/in/jaredpstauffer",
            },
          ],
        }),
      })
    );
    // First fetch: brief.sources[0] = https://acquisity.ai (target
    // domain), trusted corpus build. Returns body with Stauffer's
    // name — Tier 2 accept, no further fetch needed.
    webFetchExecute.mockResolvedValue(
      "Acquisity story: Jared Stauffer founded the company in 2024."
    );

    const { emit } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(1);
    expect(out.decision_makers[0]!.name).toBe("Jared Stauffer");
    // Trusted-corpus fetch was called for the target source.
    expect(webFetchExecute).toHaveBeenCalledWith({
      url: "https://acquisity.ai",
    });
  });

  it("auto-accepts subdomains of the target (e.g. blog.acquisity.ai)", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({
        text: JSON.stringify({
          ...VALID_OUTPUT,
          decision_makers: [
            {
              name: "Tasnim A.",
              role: "Global TA Leader",
              why_them: "Cited on the Acquisity engineering blog.",
              source_url: "https://blog.acquisity.ai/why-we-hire",
              linkedin_url: null,
            },
          ],
        }),
      })
    );
    webFetchExecute.mockResolvedValue("Acquisity homepage content.");
    const { emit } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(1);
    // The DM's source_url (subdomain) is NOT fetched — Tier 1 accepts
    // it. Only the brief sources are fetched (for the trusted corpus).
    const fetchedUrls = webFetchExecute.mock.calls.map((c) => c[0].url);
    expect(fetchedUrls).not.toContain(
      "https://blog.acquisity.ai/why-we-hire"
    );
  });

  it("Tier 3: accepts a cross-domain source when body has BOTH name and target company name", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({
        text: JSON.stringify({
          ...VALID_OUTPUT,
          decision_makers: [
            {
              name: "Marcus Reed",
              role: "Head of Sales",
              why_them: "Profiled on a third-party tech blog.",
              source_url: "https://techcrunch.com/2026/04/acquisity-feature",
              linkedin_url: null,
            },
          ],
        }),
      })
    );
    // Trusted corpus build (brief.sources[0]) returns content WITHOUT
    // Marcus Reed's name → Tier 2 misses → fall through to Tier 3
    // which fetches the cross-domain source.
    webFetchExecute.mockImplementation(async ({ url }: { url: string }) => {
      if (url === "https://acquisity.ai") {
        return "Acquisity homepage — no team mentions here.";
      }
      return "Marcus Reed leads sales at Acquisity, the AI-powered B2B growth system.";
    });

    const { emit } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(1);
    expect(webFetchExecute).toHaveBeenCalledWith({
      url: "https://techcrunch.com/2026/04/acquisity-feature",
    });
  });

  it("DROPS a cross-domain DM when the body has the name but NOT the target company name (Hormozi-style cross-company)", async () => {
    // Regression guard: this mirrors the live 2026-05-05 bug where
    // Leila Hormozi was returned as an Acquisity DM because her
    // LinkedIn slug matched her name. The new gate requires the
    // target's company name to also appear in the source body, AND
    // her name doesn't appear on Acquisity's own pages either.
    chatMock.mockResolvedValueOnce(
      makeChatResult({
        text: JSON.stringify({
          ...VALID_OUTPUT,
          decision_makers: [
            {
              name: "Leila Hormozi",
              role: "Founder and CEO of Acquisition.com",
              why_them: "Mistakenly surfaced for Acquisity — actually runs Acquisition.com.",
              source_url: "https://acquisition.com/team/leila",
              linkedin_url: "https://linkedin.com/in/leilahormozi",
            },
          ],
        }),
      })
    );
    webFetchExecute.mockImplementation(async ({ url }: { url: string }) => {
      if (url === "https://acquisity.ai") {
        // Trusted corpus: Acquisity's own page does NOT mention Hormozi.
        return "Acquisity is an AI-powered B2B growth platform. Founded 2024.";
      }
      // Cross-domain source: Acquisition.com page has Hormozi but not Acquisity.
      return "Leila Hormozi is the Founder and CEO of Acquisition.com — a holding company...";
    });

    const { emit, events } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(0);
    const drop = events.find(
      (e) =>
        e.type === "agent_thinking" &&
        (e as { delta: string }).delta.includes("Leila Hormozi") &&
        (e as { delta: string }).delta.includes("does not mention target company")
    );
    expect(drop).toBeDefined();
  });

  it("drops a cross-domain DM when the body lacks the person's name", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({
        text: JSON.stringify({
          ...VALID_OUTPUT,
          decision_makers: [
            {
              name: "Made Up Person",
              role: "VP Imaginary",
              why_them: "Fabricated by the model — should be dropped by validation.",
              source_url: "https://techcrunch.com/2026/04/acquisity-launch",
              linkedin_url: null,
            },
          ],
        }),
      })
    );
    webFetchExecute.mockResolvedValue(
      "Acquisity launched its growth platform last quarter. No mention of the fabricated person."
    );

    const { emit, events } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(0);
    const drop = events.find(
      (e) =>
        e.type === "agent_thinking" &&
        (e as { delta: string }).delta.includes("Made Up Person") &&
        (e as { delta: string }).delta.includes("name not found")
    );
    expect(drop).toBeDefined();
  });

  it("drops a cross-domain DM when the source fetch fails", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({
        text: JSON.stringify({
          ...VALID_OUTPUT,
          decision_makers: [
            {
              name: "Marcus Reed",
              role: "VP Sales",
              why_them: "Won't survive validation — cross-domain source fetch throws.",
              source_url: "https://linkedin.com/in/marcusreed",
              linkedin_url: null,
            },
          ],
        }),
      })
    );
    webFetchExecute.mockRejectedValue(
      new Error("Fetch failed: 403 Forbidden")
    );

    const { emit, events } = captureEvents();
    const out = await runAgent2(RECON_BRIEF, "run-id", emit);
    expect(out.decision_makers).toHaveLength(0);
    expect(
      events.find(
        (e) =>
          e.type === "agent_thinking" &&
          (e as { delta: string }).delta.includes("could not fetch")
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
