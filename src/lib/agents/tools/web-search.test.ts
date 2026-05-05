/**
 * Unit tests for the web_search tool.
 *
 * Mocks global.fetch and asserts that:
 *  - Request shape (URL, method, headers, body) matches Tavily's contract
 *  - Response is formatted into the model-friendly numbered list
 *  - Snippets are truncated at MAX_SNIPPET_CHARS
 *  - Empty results render a sensible "no results" string
 *  - HTTP errors throw with status info
 *  - Timeout errors throw a clear message
 *  - Missing TAVILY_API_KEY throws
 *  - Malformed Tavily responses throw with the schema diff
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webSearchTool } from "./web-search";

const ORIGINAL_KEY = process.env.TAVILY_API_KEY;
const FAKE_KEY = "tvly-test-key";

beforeEach(() => {
  process.env.TAVILY_API_KEY = FAKE_KEY;
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env.TAVILY_API_KEY = ORIGINAL_KEY;
});

function mockFetchOnce(response: { ok: boolean; status?: number; statusText?: string; body: unknown }) {
  const fakeResponse = {
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    statusText: response.statusText ?? "",
    json: () => Promise.resolve(response.body),
  } as unknown as Response;
  return vi.spyOn(global, "fetch").mockResolvedValueOnce(fakeResponse);
}

describe("webSearchTool.execute()", () => {
  it("formats a successful Tavily response into a numbered list", async () => {
    const fetchSpy = mockFetchOnce({
      ok: true,
      body: {
        results: [
          {
            title: "Acquisity — AI Growth System",
            url: "https://acquisity.ai",
            content: "AI-powered growth system for B2B clients.",
          },
          {
            title: "Acquisity team page",
            url: "https://acquisity.ai/team",
            content: "Meet the founders.",
          },
        ],
      },
    });

    const out = await webSearchTool.execute({ query: "acquisity B2B" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.tavily.com/search");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      api_key: FAKE_KEY,
      query: "acquisity B2B",
      max_results: 8,
      search_depth: "basic",
      include_answer: false,
    });

    expect(out).toContain("1. Acquisity — AI Growth System");
    expect(out).toContain("https://acquisity.ai");
    expect(out).toContain("AI-powered growth system");
    expect(out).toContain("2. Acquisity team page");
  });

  it("truncates snippets to 280 characters", async () => {
    const longContent = "x".repeat(500);
    mockFetchOnce({
      ok: true,
      body: {
        results: [
          {
            title: "Long page",
            url: "https://example.com",
            content: longContent,
          },
        ],
      },
    });

    const out = await webSearchTool.execute({ query: "long" });
    // Snippet line is the third line of the entry
    const lines = out.split("\n");
    const snippetLine = lines.find((l) => l.trim().startsWith("xxx"));
    expect(snippetLine).toBeDefined();
    expect(snippetLine!.trim().length).toBeLessThanOrEqual(280);
  });

  it("handles empty results", async () => {
    mockFetchOnce({ ok: true, body: { results: [] } });
    const out = await webSearchTool.execute({ query: "nothing here" });
    expect(out).toBe('No results for "nothing here".');
  });

  it("missing content field gracefully defaults to empty string", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        results: [{ title: "No snippet", url: "https://x.com" }],
      },
    });
    const out = await webSearchTool.execute({ query: "x" });
    expect(out).toContain("1. No snippet");
    expect(out).toContain("https://x.com");
  });

  it("throws on HTTP error response", async () => {
    mockFetchOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      body: {},
    });
    await expect(webSearchTool.execute({ query: "rate-limited" })).rejects.toThrow(
      /Tavily search failed.*429/
    );
  });

  it("throws when TAVILY_API_KEY is missing", async () => {
    delete process.env.TAVILY_API_KEY;
    await expect(webSearchTool.execute({ query: "no key" })).rejects.toThrow(
      /Missing TAVILY_API_KEY/
    );
  });

  it("throws on a malformed Tavily response", async () => {
    mockFetchOnce({
      ok: true,
      body: { not_results: [] },
    });
    await expect(webSearchTool.execute({ query: "bad shape" })).rejects.toThrow(
      /Tavily returned an unexpected response shape/
    );
  });

  it("throws a clear message on AbortSignal.timeout", async () => {
    const timeoutError = new Error("Operation timed out");
    timeoutError.name = "TimeoutError";
    vi.spyOn(global, "fetch").mockRejectedValueOnce(timeoutError);

    await expect(webSearchTool.execute({ query: "slow" })).rejects.toThrow(
      /Tavily search timed out after 10000ms/
    );
  });
});
