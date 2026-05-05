/**
 * Unit tests for Agent 3 (Personalisation & Outreach).
 *
 * Mocks chat() and asserts:
 *  - Returns Zod-valid EmailOutput on a clean single-shot
 *  - Forbidden-phrase hit triggers retry with corrective user message
 *  - Successful retry returns clean output with degraded=false
 *  - Two consecutive forbidden-phrase outputs return degraded=true
 *  - Zod schema failure triggers retry; second pass succeeds
 *  - Two consecutive Zod failures throw
 *  - Tone parameter ('warm') flows into the user prompt
 *  - provider_used + agent_thinking events fire correctly
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatOptions, ChatResult } from "./llm/types";
import type { StreamEvent } from "./stream-events";
import type { PeopleOutputT, ReconnaissanceOutputT } from "./schemas";

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

const PEOPLE: PeopleOutputT = {
  decision_makers: [
    {
      name: "Tasnim A.",
      role: "Global TA & People Experience Leader",
      why_them: "Owns TA hiring strategy at Acquisity.",
      source_url: "https://acquisity.ai/team",
      linkedin_url: null,
    },
  ],
  buyer_persona: "Heads of growth + TA leaders at sub-200-person AI companies.",
  trigger_events: [],
};

const VALID_EMAIL = {
  to: { name: "Tasnim A.", role: "Global TA Leader" },
  subject: "Quick thought on your TA scaling",
  body:
    "Hi Tasnim — saw that Acquisity is scaling its TA engine for AI businesses, and that you led growth at noon and talabat before this. The pattern that worked well in those scaling moments was X. Worth a 15-minute call this week? Samuel",
  personalisation_hooks: [
    "Tasnim led TA at noon and talabat — both 1k+ headcount.",
    "Acquisity is positioning as 10 agents in one product.",
    "The brief mentioned hiring a senior full-stack engineer.",
    "Acquisity targets B2B sales teams at AI-product companies.",
    "Recent funding round signals scaling intent.",
  ],
  tone: "cold" as const,
  channel: "email" as const,
};

const FORBIDDEN_EMAIL = {
  ...VALID_EMAIL,
  body:
    "Hi Tasnim — hope this email finds you well. I noticed your company is doing amazing things in B2B. Worth a chat?",
};

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

const { runAgent3 } = await import("./agent-3-email");

function makeChatResult(overrides: Partial<ChatResult> = {}): ChatResult {
  return {
    text: "",
    toolCalls: [],
    finishReason: "stop",
    provider: "groq",
    tokensIn: 60,
    tokensOut: 200,
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

describe("runAgent3()", () => {
  it("returns a Zod-valid EmailOutput with degraded=false on a clean single-shot", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_EMAIL) })
    );

    const { emit, events } = captureEvents();
    const result = await runAgent3(RECON_BRIEF, PEOPLE, "run-id", emit);

    expect(result.degraded).toBe(false);
    expect(result.forbiddenReason).toBeNull();
    expect(result.output.subject).toBe(VALID_EMAIL.subject);
    expect(chatMock).toHaveBeenCalledOnce();
    expect(events.find((e) => e.type === "provider_used")).toBeDefined();
  });

  it("retries on a forbidden-phrase hit and succeeds on the retry with degraded=false", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(FORBIDDEN_EMAIL) })
    );
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_EMAIL) })
    );

    const { emit, events } = captureEvents();
    const result = await runAgent3(RECON_BRIEF, PEOPLE, "run-id", emit);

    expect(result.degraded).toBe(false);
    expect(result.forbiddenReason).toBeNull();
    expect(chatMock).toHaveBeenCalledTimes(2);
    // Second chat() call should have the corrective user prompt
    const secondCall = chatMock.mock.calls[1]![0] as ChatOptions;
    const lastUser = secondCall.messages.at(-1);
    expect(lastUser?.content).toMatch(/forbidden phrases/i);
    // agent_thinking event should mention the cliche
    expect(
      events.find(
        (e) =>
          e.type === "agent_thinking" &&
          (e as { delta: string }).delta.includes("cliche")
      )
    ).toBeDefined();
  });

  it("flags degraded=true when both attempts produce forbidden phrases", async () => {
    chatMock.mockResolvedValue(
      makeChatResult({ text: JSON.stringify(FORBIDDEN_EMAIL) })
    );

    const { emit } = captureEvents();
    const result = await runAgent3(RECON_BRIEF, PEOPLE, "run-id", emit);

    expect(result.degraded).toBe(true);
    // FORBIDDEN_EMAIL trips multiple patterns; first-match wins —
    // "noticed your company is doing amazing" is registered first.
    expect(result.forbiddenReason).toMatch(/noticed your company|hope this email|amazing/i);
    expect(result.output.subject).toBe(FORBIDDEN_EMAIL.subject);
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("retries on Zod schema failure and succeeds on the retry", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify({ broken: "shape" }) })
    );
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_EMAIL) })
    );

    const { emit, events } = captureEvents();
    const result = await runAgent3(RECON_BRIEF, PEOPLE, "run-id", emit);

    expect(result.degraded).toBe(false);
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(
      events.find(
        (e) =>
          e.type === "agent_thinking" &&
          (e as { delta: string }).delta.match(/match schema/)
      )
    ).toBeDefined();
  });

  it("throws on Zod failure that survives the retry", async () => {
    chatMock.mockResolvedValue(
      makeChatResult({ text: JSON.stringify({ broken: "shape" }) })
    );

    const { emit } = captureEvents();
    await expect(
      runAgent3(RECON_BRIEF, PEOPLE, "run-id", emit)
    ).rejects.toThrow();
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("threads tone='warm' into the user prompt", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({
        text: JSON.stringify({ ...VALID_EMAIL, tone: "warm" as const }),
      })
    );

    const { emit } = captureEvents();
    await runAgent3(RECON_BRIEF, PEOPLE, "run-id", emit, { tone: "warm" });

    const opts = chatMock.mock.calls[0]![0] as ChatOptions;
    const userMessage = opts.messages[0]!;
    expect(userMessage.content).toMatch(/Target tone: warm/);
  });

  it("uses temperature 0.7 (creative agent vs factual)", async () => {
    chatMock.mockResolvedValueOnce(
      makeChatResult({ text: JSON.stringify(VALID_EMAIL) })
    );

    const { emit } = captureEvents();
    await runAgent3(RECON_BRIEF, PEOPLE, "run-id", emit);

    const opts = chatMock.mock.calls[0]![0] as ChatOptions;
    expect(opts.temperature).toBe(0.7);
  });
});
