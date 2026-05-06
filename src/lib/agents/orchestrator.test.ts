/**
 * Unit tests for the orchestrator (runResearch async generator).
 *
 * Mocks all three agents and the DB query layer; asserts:
 *  - Cache hit short-circuits (cache_hit + final_result, no agents called)
 *  - Cache miss runs A1 → A2 → A3 in order with the expected events
 *  - Agent thrown errors are caught, surface as 'error' frame, run marked failed
 *  - degraded path: Agent 3 degraded → degradeRun() called, status=degraded in payload
 *  - bypassCache=true skips the cache lookup
 *  - tone option flows into Agent 3
 *  - research_messages.recordMessage fires once per agent on success
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "./stream-events";
import type { ReconnaissanceOutputT, PeopleOutputT } from "./schemas";
import type { Agent3Result } from "./agent-3-email";

const RECON: ReconnaissanceOutputT = {
  company_name: "Acquisity",
  one_liner: "AI-powered B2B growth system that books sales meetings.",
  what_they_sell:
    "Acquisity sells an AI growth platform that automates B2B prospecting, qualification, and outreach.",
  target_market: "B2B sales teams at AI-product companies under 200 people.",
  company_size_estimate: "20-50 employees",
  recent_signals: [],
  sources: ["https://acquisity.ai"],
};

const PEOPLE: PeopleOutputT = {
  decision_makers: [
    {
      name: "Tasnim A.",
      role: "Global TA Leader",
      why_them: "Owns hiring strategy at Acquisity.",
      source_url: "https://acquisity.ai/team",
      linkedin_url: null,
    },
  ],
  buyer_persona: "Heads of growth + TA leaders at sub-200-person AI companies.",
  trigger_events: [],
};

const EMAIL = {
  to: { name: "Tasnim A.", role: "Global TA Leader" },
  subject: "Quick thought on your TA scaling",
  body:
    "Hi Tasnim — saw that Acquisity is scaling its TA engine for AI businesses. The pattern that worked well in the past was X. Worth a 15-min call this week? Samuel",
  personalisation_hooks: [
    "Tasnim led TA at noon and talabat — both 1k+ headcount.",
    "Acquisity is positioning as 10 agents in one product.",
    "Recent funding round signals scaling intent.",
    "The brief mentioned hiring a senior full-stack engineer.",
    "Acquisity targets B2B sales teams at AI-product companies.",
  ],
  tone: "cold" as const,
  channel: "email" as const,
};

// ---- Mocks ----

const runAgent1Mock = vi.fn();
const runAgent2Mock = vi.fn();
const runAgent3Mock = vi.fn();

vi.mock("./agent-1-reconnaissance", () => ({
  runAgent1: (...args: unknown[]) => runAgent1Mock(...args),
}));
vi.mock("./agent-2-people", () => ({
  runAgent2: (...args: unknown[]) => runAgent2Mock(...args),
}));
vi.mock("./agent-3-email", () => ({
  runAgent3: (...args: unknown[]) => runAgent3Mock(...args),
}));

const findCachedRunMock = vi.fn();
const markRunRunningMock = vi.fn();
const completeRunMock = vi.fn();
const degradeRunMock = vi.fn();
const failRunMock = vi.fn();
const recordMessageMock = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  findCachedRun: (...args: unknown[]) => findCachedRunMock(...args),
  markRunRunning: (...args: unknown[]) => markRunRunningMock(...args),
  completeRun: (...args: unknown[]) => completeRunMock(...args),
  degradeRun: (...args: unknown[]) => degradeRunMock(...args),
  failRun: (...args: unknown[]) => failRunMock(...args),
  recordMessage: (...args: unknown[]) => recordMessageMock(...args),
}));

const { runResearch } = await import("./orchestrator");

async function collect(gen: AsyncGenerator<StreamEvent>) {
  const events: StreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

beforeEach(() => {
  runAgent1Mock.mockReset();
  runAgent2Mock.mockReset();
  runAgent3Mock.mockReset();
  findCachedRunMock.mockReset().mockResolvedValue(null);
  markRunRunningMock.mockReset().mockResolvedValue(undefined);
  completeRunMock.mockReset().mockResolvedValue(undefined);
  degradeRunMock.mockReset().mockResolvedValue(undefined);
  failRunMock.mockReset().mockResolvedValue(undefined);
  recordMessageMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runResearch() — orchestrator", () => {
  it("short-circuits on cache hit (no agents called)", async () => {
    findCachedRunMock.mockResolvedValueOnce({
      id: "cached-run-id",
      target_url: "https://acquisity.ai",
      target_domain: "acquisity.ai",
      result: { recon: RECON, people: PEOPLE, email: EMAIL },
      completed_at: new Date().toISOString(),
    });

    const events = await collect(runResearch("https://acquisity.ai", "run-id"));

    const types = events.map((e) => e.type);
    expect(types).toEqual(["cache_hit", "final_result"]);
    expect(runAgent1Mock).not.toHaveBeenCalled();
    expect(runAgent2Mock).not.toHaveBeenCalled();
    expect(runAgent3Mock).not.toHaveBeenCalled();
    // Cache hit still completes the run (links to source via cache_hit event).
    expect(completeRunMock).toHaveBeenCalledOnce();
  });

  it("cache miss runs all 3 agents in order with the expected events", async () => {
    findCachedRunMock.mockResolvedValueOnce(null);

    runAgent1Mock.mockImplementationOnce(
      async (_url, _runId, emit: (e: StreamEvent) => void) => {
        emit({ type: "provider_used", agent: 1, provider: "groq" });
        return RECON;
      }
    );
    runAgent2Mock.mockImplementationOnce(
      async (_brief, _runId, emit: (e: StreamEvent) => void) => {
        emit({ type: "provider_used", agent: 2, provider: "groq" });
        return PEOPLE;
      }
    );
    runAgent3Mock.mockResolvedValueOnce({
      output: EMAIL,
      degraded: false,
      forbiddenReason: null,
    } satisfies Agent3Result);

    const events = await collect(runResearch("https://acquisity.ai", "run-id"));

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "agent_start",
      "provider_used",
      "agent_done",
      "agent_start",
      "provider_used",
      "agent_done",
      "agent_start",
      "agent_done",
      "final_result",
    ]);

    expect(runAgent1Mock).toHaveBeenCalledOnce();
    expect(runAgent2Mock).toHaveBeenCalledOnce();
    expect(runAgent3Mock).toHaveBeenCalledOnce();

    // Each agent's output got logged
    expect(recordMessageMock).toHaveBeenCalledTimes(3);
    expect(recordMessageMock.mock.calls.map((c) => (c[0] as { agentIndex: number }).agentIndex)).toEqual([1, 2, 3]);

    // Run was marked running, then completed
    expect(markRunRunningMock).toHaveBeenCalledOnce();
    expect(completeRunMock).toHaveBeenCalledOnce();
    expect(degradeRunMock).not.toHaveBeenCalled();
    expect(failRunMock).not.toHaveBeenCalled();
  });

  it("skips Agent 3 entirely when Agent 2 returns zero decision makers (empty-DM resilience)", async () => {
    // Regression guard for the live 2026-05-06 acquisity.ai bug:
    // Agent 2 returned [] (validation gate dropped every candidate),
    // Agent 3 then ran on an empty DM list, hallucinated a recipient
    // from the buyer-persona placeholder, and Gemini emitted
    // malformed JSON. The orchestrator should short-circuit instead.
    runAgent1Mock.mockResolvedValueOnce(RECON);
    runAgent2Mock.mockResolvedValueOnce({
      ...PEOPLE,
      decision_makers: [],
    });

    const events = await collect(runResearch("https://acquisity.ai", "run-id"));

    // Agent 3 was NEVER invoked — that's the whole point.
    expect(runAgent3Mock).not.toHaveBeenCalled();

    // Run is marked degraded (not done) so the UI knows to show the
    // "no verifiable DMs" panel instead of an empty Outreach tab.
    expect(degradeRunMock).toHaveBeenCalledOnce();
    expect(completeRunMock).not.toHaveBeenCalled();

    // Final payload has email: null + degraded: true.
    const finalEvent = events.find((e) => e.type === "final_result");
    expect(finalEvent).toBeDefined();
    const payload = (finalEvent as { payload: { email: unknown; degraded: boolean } })
      .payload;
    expect(payload.email).toBeNull();
    expect(payload.degraded).toBe(true);

    // Stream still emits a synthetic agent_start + agent_done for
    // agent 3 so the timeline doesn't hang on the third card. Plus
    // an agent_thinking explaining why it was skipped.
    const agent3Events = events.filter(
      (e) => "agent" in e && (e as { agent: number }).agent === 3
    );
    expect(agent3Events.map((e) => e.type)).toEqual([
      "agent_start",
      "agent_thinking",
      "agent_done",
    ]);
  });

  it("flags degraded when Agent 3 returns degraded=true", async () => {
    runAgent1Mock.mockResolvedValueOnce(RECON);
    runAgent2Mock.mockResolvedValueOnce(PEOPLE);
    runAgent3Mock.mockResolvedValueOnce({
      output: EMAIL,
      degraded: true,
      forbiddenReason: '"hope this email finds you well" cliche',
    } satisfies Agent3Result);

    const events = await collect(runResearch("https://acquisity.ai", "run-id"));

    expect(degradeRunMock).toHaveBeenCalledOnce();
    expect(completeRunMock).not.toHaveBeenCalled();

    const finalEvent = events.find((e) => e.type === "final_result");
    expect(finalEvent).toBeDefined();
    expect((finalEvent as { payload: { degraded: boolean } }).payload.degraded).toBe(true);
  });

  it("emits an error event and marks run failed when an agent throws", async () => {
    runAgent1Mock.mockRejectedValueOnce(new Error("Boom — agent 1 broke"));

    const events = await collect(runResearch("https://acquisity.ai", "run-id"));

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toMatchObject({
      type: "error",
      message: "Boom — agent 1 broke",
    });
    expect(failRunMock).toHaveBeenCalledOnce();
    expect(completeRunMock).not.toHaveBeenCalled();
    expect(runAgent2Mock).not.toHaveBeenCalled();
    expect(runAgent3Mock).not.toHaveBeenCalled();
  });

  it("bypassCache=true skips the cache lookup", async () => {
    runAgent1Mock.mockResolvedValueOnce(RECON);
    runAgent2Mock.mockResolvedValueOnce(PEOPLE);
    runAgent3Mock.mockResolvedValueOnce({
      output: EMAIL,
      degraded: false,
      forbiddenReason: null,
    });

    await collect(
      runResearch("https://acquisity.ai", "run-id", { bypassCache: true })
    );
    expect(findCachedRunMock).not.toHaveBeenCalled();
    expect(runAgent1Mock).toHaveBeenCalledOnce();
  });

  it("forwards tone='warm' to Agent 3", async () => {
    runAgent1Mock.mockResolvedValueOnce(RECON);
    runAgent2Mock.mockResolvedValueOnce(PEOPLE);
    runAgent3Mock.mockResolvedValueOnce({
      output: { ...EMAIL, tone: "warm" as const },
      degraded: false,
      forbiddenReason: null,
    });

    await collect(
      runResearch("https://acquisity.ai", "run-id", { tone: "warm" })
    );
    expect(runAgent3Mock).toHaveBeenCalledOnce();
    const a3Call = runAgent3Mock.mock.calls[0]!;
    // Last arg is the options object
    expect(a3Call.at(-1)).toMatchObject({ tone: "warm" });
  });

  it("streams events live (not batched at agent boundaries)", async () => {
    // Set up a slow Agent 1 that emits 2 tool_calls before resolving
    runAgent1Mock.mockImplementationOnce(
      async (_url, _runId, emit: (e: StreamEvent) => void) => {
        emit({ type: "tool_call", agent: 1, tool: "web_fetch", input: { url: "https://acquisity.ai" } });
        emit({
          type: "tool_result",
          agent: 1,
          tool: "web_fetch",
          result_summary: "page content",
        });
        return RECON;
      }
    );
    runAgent2Mock.mockResolvedValueOnce(PEOPLE);
    runAgent3Mock.mockResolvedValueOnce({
      output: EMAIL,
      degraded: false,
      forbiddenReason: null,
    });

    const events = await collect(runResearch("https://acquisity.ai", "run-id"));
    const types = events.map((e) => e.type);

    // Agent 1's tool_call + tool_result must appear BEFORE agent_done(1)
    const agentStart1 = types.indexOf("agent_start");
    const agentDone1 = types.indexOf("agent_done");
    const toolCall = types.indexOf("tool_call");
    const toolResult = types.indexOf("tool_result");

    expect(toolCall).toBeGreaterThan(agentStart1);
    expect(toolCall).toBeLessThan(agentDone1);
    expect(toolResult).toBeGreaterThan(toolCall);
    expect(toolResult).toBeLessThan(agentDone1);
  });
});
