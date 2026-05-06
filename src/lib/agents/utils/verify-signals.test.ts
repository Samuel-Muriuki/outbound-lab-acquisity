/**
 * Unit tests for the Agent 1 source-grounding verifier.
 *
 * Two layers:
 *  - extractSpecifics() — purely synchronous, regex-based
 *  - verifySignalsAgainstSources() — fetches sources, filters signals
 *
 * The fetch mock matches the pattern used in agent-2-people.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "../stream-events";

// Hoist fetch mock before importing the module under test.
const webFetchExecute = vi.fn();
vi.mock("../tools/web-fetch", () => ({
  webFetchTool: {
    name: "web_fetch",
    description: "stubbed",
    parameters: { parse: (v: unknown) => v },
    execute: webFetchExecute,
  },
}));

const {
  extractSpecifics,
  hasVerifiableSpecific,
  verifySignalsAgainstSources,
} = await import("./verify-signals");

beforeEach(() => {
  webFetchExecute.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function captureEvents(): {
  emit: (e: StreamEvent) => void;
  events: StreamEvent[];
} {
  const events: StreamEvent[] = [];
  return { emit: (e) => events.push(e), events };
}

describe("extractSpecifics()", () => {
  it("captures multi-digit percentages", () => {
    expect(extractSpecifics("612% growth in 5 months")).toContain("612%");
  });

  it("captures monetary figures with M/B/K suffixes", () => {
    expect(extractSpecifics("raised $50M Series B")).toContain("$50m");
    expect(extractSpecifics("a $1.2B valuation")).toContain("$1.2b");
  });

  it("captures multiplier claims", () => {
    expect(extractSpecifics("delivered 10x growth")).toContain("10x");
  });

  it("captures Series A-K", () => {
    const tokens = extractSpecifics("post-Series B startup");
    expect(tokens.some((t) => t.includes("series b"))).toBe(true);
  });

  it("ignores standalone single digits", () => {
    // "5" alone is too noisy — every page with any "5" anywhere
    // matches. Single-digit numbers without %/$/x/M/B suffix don't
    // count as verifiable specifics.
    expect(extractSpecifics("5 hires last quarter")).toEqual([]);
  });

  it("returns empty for soft claims with no specifics", () => {
    expect(
      extractSpecifics("AI-powered B2B growth platform")
    ).toEqual([]);
  });

  it("hasVerifiableSpecific reflects extractSpecifics", () => {
    expect(hasVerifiableSpecific("612% growth")).toBe(true);
    expect(hasVerifiableSpecific("AI-powered B2B")).toBe(false);
  });
});

describe("verifySignalsAgainstSources()", () => {
  it("keeps a soft claim with no specifics regardless of source content", async () => {
    webFetchExecute.mockResolvedValue("Acquisity is a B2B platform.");
    const { emit } = captureEvents();
    const out = await verifySignalsAgainstSources(
      ["AI-powered B2B growth"],
      ["https://acquisity.ai"],
      emit
    );
    expect(out).toEqual(["AI-powered B2B growth"]);
  });

  it("DROPS the 612% regression — specific not found in cited source", async () => {
    webFetchExecute.mockResolvedValue(
      "Acquisity is an AI-powered B2B growth platform serving small businesses."
    );
    const { emit, events } = captureEvents();
    const out = await verifySignalsAgainstSources(
      ["612% growth in 5 months"],
      ["https://acquisity.ai"],
      emit
    );
    expect(out).toEqual([]);
    const drop = events.find(
      (e) =>
        e.type === "agent_thinking" &&
        (e as { delta: string }).delta.includes("612%")
    );
    expect(drop).toBeDefined();
  });

  it("keeps a signal whose specific appears in any source body", async () => {
    webFetchExecute.mockResolvedValue(
      "We posted 30% YoY revenue growth last quarter, the press release noted."
    );
    const { emit } = captureEvents();
    const out = await verifySignalsAgainstSources(
      ["30% YoY revenue growth"],
      ["https://acquisity.ai/press"],
      emit
    );
    expect(out).toEqual(["30% YoY revenue growth"]);
  });

  it("does not drop signals when ALL fetches fail (no evidence either way)", async () => {
    webFetchExecute.mockRejectedValue(new Error("network blocked"));
    const { emit } = captureEvents();
    const out = await verifySignalsAgainstSources(
      ["612% growth in 5 months"],
      ["https://acquisity.ai"],
      emit
    );
    // Conservative: we don't have evidence to drop, so keep.
    expect(out).toEqual(["612% growth in 5 months"]);
  });

  it("checks against the COMBINED corpus from all sources", async () => {
    // Specific only in source 2 — should still pass.
    webFetchExecute
      .mockResolvedValueOnce("Source 1: nothing relevant.")
      .mockResolvedValueOnce(
        "Source 2: Acquisity raised $50M in Series B funding."
      );
    const { emit } = captureEvents();
    const out = await verifySignalsAgainstSources(
      ["raised $50M Series B"],
      ["https://example.com/a", "https://example.com/b"],
      emit
    );
    expect(out).toEqual(["raised $50M Series B"]);
  });

  it("drops a multi-specific signal when NONE of the specifics appear", async () => {
    webFetchExecute.mockResolvedValue(
      "Acquisity is a B2B growth platform — no revenue or fundraising disclosures."
    );
    const { emit } = captureEvents();
    const out = await verifySignalsAgainstSources(
      ["raised $50M after 612% growth"],
      ["https://acquisity.ai"],
      emit
    );
    expect(out).toEqual([]);
  });

  it("KEEPS a multi-specific signal if ANY specific is found", async () => {
    // Body has "$50M" but not "612%". The signal is ambiguous truth-
    // wise but at least partially grounded — keep, don't drop.
    webFetchExecute.mockResolvedValue(
      "Acquisity raised $50M in their last round."
    );
    const { emit } = captureEvents();
    const out = await verifySignalsAgainstSources(
      ["raised $50M after 612% growth"],
      ["https://acquisity.ai"],
      emit
    );
    expect(out).toEqual(["raised $50M after 612% growth"]);
  });

  it("returns the input unchanged when there are no signals", async () => {
    const { emit } = captureEvents();
    const out = await verifySignalsAgainstSources(
      [],
      ["https://acquisity.ai"],
      emit
    );
    expect(out).toEqual([]);
    expect(webFetchExecute).not.toHaveBeenCalled();
  });

  it("returns the input unchanged when there are no sources", async () => {
    const { emit } = captureEvents();
    const out = await verifySignalsAgainstSources(
      ["612% growth"],
      [],
      emit
    );
    expect(out).toEqual(["612% growth"]);
    expect(webFetchExecute).not.toHaveBeenCalled();
  });
});
