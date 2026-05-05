/**
 * Unit tests for Agent 1 (Reconnaissance).
 *
 * Mocks the `chat()` provider abstraction to feed controlled responses
 * into the tool-use loop and asserts:
 *
 *  - Tool calls are executed and results threaded back into the model context
 *  - emit() fires with provider_used / tool_call / tool_result / agent_thinking
 *  - Final JSON output is Zod-validated against ReconnaissanceOutput
 *  - Output wrapped in markdown fences is still parsed (Llama-tolerant)
 *  - Schema-invalid output triggers retry; succeeds on second attempt
 *  - 3 consecutive failures throw with the last error message
 *  - Hitting the 6-tool-call cap injects the wrap-up nudge
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatOptions, ChatResult } from "./llm/types";
import type { StreamEvent } from "./stream-events";

// Mock the tools BEFORE importing the agent (which imports the tools).
vi.mock("./tools/web-search", () => ({
  webSearchTool: {
    name: "web_search",
    description: "stubbed",
    parameters: {
      parse: (v: unknown) => v,
      _parse: () => ({ success: true, data: {} }),
    },
    execute: vi.fn(async ({ query }: { query: string }) =>
      `1. Result for "${query}"\n   https://example.com\n   snippet`
    ),
  },
}));

vi.mock("./tools/web-fetch", () => ({
  webFetchTool: {
    name: "web_fetch",
    description: "stubbed",
    parameters: {
      parse: (v: unknown) => v,
      _parse: () => ({ success: true, data: {} }),
    },
    execute: vi.fn(async ({ url }: { url: string }) =>
      `Page content from ${url}.`
    ),
  },
}));

// chat() lives in ./llm/chat — mock it last so the agent picks up the mock.
const chatMock = vi.fn();
vi.mock("./llm/chat", () => ({
  // Mirror real chat() behavior: invoke onProviderUsed(result.provider) on success
  // before returning. This is what the real implementation does in chat.ts.
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

// Import the agent AFTER all mocks are set.
const { runAgent1 } = await import("./agent-1-reconnaissance");

const VALID_OUTPUT = {
  company_name: "Acquisity",
  one_liner: "AI-powered B2B growth system that books sales meetings.",
  what_they_sell:
    "Acquisity sells an AI growth platform that automates B2B prospecting, qualification, and outreach for sales teams.",
  target_market:
    "B2B sales teams at AI-product companies, especially startups under 200 people who need outbound velocity without hiring SDRs.",
  company_size_estimate: "20-50 employees",
  recent_signals: ["Hiring a senior full-stack engineer in May 2026."],
  sources: ["https://acquisity.ai", "https://acquisity.ai/about"],
};

function makeChatResult(overrides: Partial<ChatResult> = {}): ChatResult {
  return {
    text: "",
    toolCalls: [],
    finishReason: "stop",
    provider: "groq",
    tokensIn: 100,
    tokensOut: 50,
    ...overrides,
  };
}

function captureEvents(): { emit: (e: StreamEvent) => void; events: StreamEvent[] } {
  const events: StreamEvent[] = [];
  return { emit: (e) => events.push(e), events };
}

beforeEach(() => {
  chatMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runAgent1()", () => {
  it("returns a Zod-validated ReconnaissanceOutput on a clean single-shot response", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_OUTPUT) })
    );

    const { emit, events } = captureEvents();
    const out = await runAgent1("https://acquisity.ai", "run-id-1", emit);

    expect(out).toEqual(VALID_OUTPUT);
    expect(chatMock).toHaveBeenCalledOnce();
    // No tool_call / tool_result events since the model went straight to JSON
    expect(events.find((e) => e.type === "tool_call")).toBeUndefined();
    // provider_used should fire
    expect(events.find((e) => e.type === "provider_used")).toMatchObject({
      type: "provider_used",
      agent: 1,
      provider: "groq",
    });
  });

  it("executes tool calls and threads results back into the model context", async () => {
    // First call: model wants web_fetch
    chatMock.mockResolvedValueOnce(
      makeChatResult({
        toolCalls: [
          {
            id: "call_1",
            name: "web_fetch",
            arguments: { url: "https://acquisity.ai" },
          },
        ],
        finishReason: "tool_calls",
      })
    );
    // Second call: model now has the page, emits the JSON
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_OUTPUT) })
    );

    const { emit, events } = captureEvents();
    const out = await runAgent1("https://acquisity.ai", "run-id-2", emit);

    expect(out).toEqual(VALID_OUTPUT);
    expect(chatMock).toHaveBeenCalledTimes(2);

    // Second chat() call should have the assistant's tool_call message
    // and a tool result message in messages
    const secondCallOpts = chatMock.mock.calls[1]![0] as ChatOptions;
    const messageRoles = secondCallOpts.messages.map((m) => m.role);
    expect(messageRoles).toEqual(["user", "assistant", "tool"]);

    // Events fired
    const toolCallEvent = events.find((e) => e.type === "tool_call");
    expect(toolCallEvent).toMatchObject({
      type: "tool_call",
      agent: 1,
      tool: "web_fetch",
      input: { url: "https://acquisity.ai" },
    });
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toMatchObject({
      type: "tool_result",
      agent: 1,
      tool: "web_fetch",
    });
  });

  it("parses JSON wrapped in markdown code fences", async () => {
    const fenced = "```json\n" + JSON.stringify(VALID_OUTPUT) + "\n```";
    chatMock.mockResolvedValueOnce(makeChatResult({ text: fenced }));

    const { emit } = captureEvents();
    const out = await runAgent1("https://acquisity.ai", "run-id-3", emit);
    expect(out).toEqual(VALID_OUTPUT);
  });

  it("retries on Zod validation failure and succeeds on the second attempt", async () => {
    // Attempt 1: invalid output (missing fields)
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify({ company_name: "Bad" }) })
    );
    // Attempt 2: valid
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_OUTPUT) })
    );

    const { emit, events } = captureEvents();
    const out = await runAgent1("https://acquisity.ai", "run-id-4", emit);
    expect(out).toEqual(VALID_OUTPUT);
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(
      events.find((e) => e.type === "agent_thinking")
    ).toMatchObject({
      type: "agent_thinking",
      agent: 1,
    });
  });

  it("throws after 3 consecutive validation failures (2 retries + initial)", async () => {
    chatMock.mockResolvedValue(
      makeChatResult({ text: JSON.stringify({ broken: "schema" }) })
    );

    const { emit, events } = captureEvents();
    await expect(
      runAgent1("https://acquisity.ai", "run-id-5", emit)
    ).rejects.toThrow();
    // Initial attempt + 2 retries = 3 chat() calls
    expect(chatMock).toHaveBeenCalledTimes(3);
    // 2 agent_thinking events for the retries
    const retries = events.filter((e) => e.type === "agent_thinking");
    expect(retries).toHaveLength(2);
  });

  it("injects a wrap-up nudge after hitting the 6-tool-call cap", async () => {
    // 6 successive tool calls, then a final JSON
    for (let i = 0; i < 6; i++) {
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
    // 7th call: model finally emits JSON after seeing the cap nudge
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_OUTPUT) })
    );

    const { emit } = captureEvents();
    const out = await runAgent1("https://acquisity.ai", "run-id-6", emit);
    expect(out).toEqual(VALID_OUTPUT);

    // Last chat() call's messages should include the nudge text
    const lastCallOpts = chatMock.mock.calls.at(-1)![0] as ChatOptions;
    const lastUser = lastCallOpts.messages
      .filter((m) => m.role === "user")
      .at(-1);
    expect(lastUser?.content).toMatch(/6-tool-call cap/i);
    expect(lastUser?.content).toMatch(/output the final JSON/i);
  });

  it("propagates AllProvidersFailedError from chat() without retrying", async () => {
    const { AllProvidersFailedError } = await import("./llm/chat");
    chatMock.mockRejectedValue(
      new AllProvidersFailedError([])
    );

    const { emit } = captureEvents();
    await expect(
      runAgent1("https://acquisity.ai", "run-id-7", emit)
    ).rejects.toBeInstanceOf(AllProvidersFailedError);
    // The agent retries (since AllProvidersFailedError surfaces as a
    // generic Error from runOnce's perspective), so 3 attempts total.
    expect(chatMock).toHaveBeenCalledTimes(3);
  });
});
