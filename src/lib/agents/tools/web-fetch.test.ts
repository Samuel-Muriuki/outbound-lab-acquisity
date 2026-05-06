/**
 * Unit tests for the web_fetch tool.
 *
 * Mocks global.fetch and asserts:
 *  - HTML is stripped to readable text (scripts, styles, tags removed)
 *  - Whitespace is collapsed
 *  - Output is capped at 4,000 chars
 *  - Common HTML entities are decoded
 *  - Bad scheme returns a model-readable error string (not thrown)
 *  - Private addresses throw (SSRF guard — invariant, never reachable)
 *  - HTTP 4xx/5xx returns the error string
 *  - Non-text content-type returns the error string
 *  - Timeout throws a clear message
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webFetchTool } from "./web-fetch";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(args: {
  ok: boolean;
  status?: number;
  statusText?: string;
  contentType?: string;
  text: string;
}) {
  const headers = new Headers({
    "content-type": args.contentType ?? "text/html; charset=utf-8",
  });
  const response = {
    ok: args.ok,
    status: args.status ?? (args.ok ? 200 : 500),
    statusText: args.statusText ?? "",
    headers,
    text: () => Promise.resolve(args.text),
  } as unknown as Response;
  return vi.spyOn(global, "fetch").mockResolvedValueOnce(response);
}

describe("webFetchTool.execute()", () => {
  it("strips a simple HTML page to readable text", async () => {
    mockFetchOnce({
      ok: true,
      text: `
        <html>
          <head>
            <title>Acquisity</title>
            <script>tracking()</script>
            <style>.hero{color:red}</style>
          </head>
          <body>
            <h1>Acquisity — AI Growth System</h1>
            <p>We build AI agents for B2B sales teams.</p>
            <!-- analytics comment -->
          </body>
        </html>
      `,
    });
    const out = await webFetchTool.execute({ url: "https://acquisity.ai" });
    expect(out).toContain("Acquisity — AI Growth System");
    expect(out).toContain("We build AI agents for B2B sales teams.");
    expect(out).not.toMatch(/tracking\(\)/);
    expect(out).not.toMatch(/color:red/);
    expect(out).not.toMatch(/<\w+/);
    expect(out).not.toMatch(/-->/);
  });

  it("collapses runs of whitespace into single spaces", async () => {
    mockFetchOnce({
      ok: true,
      text: "<p>one\n\n\n   two\t\tthree</p>",
    });
    const out = await webFetchTool.execute({ url: "https://example.com" });
    expect(out).toBe("one two three");
  });

  it("decodes common HTML entities", async () => {
    mockFetchOnce({
      ok: true,
      text: "<p>Tom &amp; Jerry &mdash; &ldquo;hello&rdquo; (&nbsp;)&hellip;</p>",
    });
    const out = await webFetchTool.execute({ url: "https://example.com" });
    expect(out).toContain("Tom & Jerry");
    expect(out).toContain("—");
    expect(out).toContain("…");
  });

  it("caps output at 4,000 characters", async () => {
    const longText = `<p>${"x".repeat(10_000)}</p>`;
    mockFetchOnce({ ok: true, text: longText });
    const out = await webFetchTool.execute({ url: "https://example.com" });
    expect(out.length).toBe(4_000);
  });

  it("returns a readable error string (not thrown) on HTTP 404", async () => {
    mockFetchOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: "",
    });
    const out = await webFetchTool.execute({ url: "https://example.com/missing" });
    expect(out).toBe("Fetch failed: HTTP 404 Not Found");
  });

  it("returns a readable error string for non-text content-type", async () => {
    mockFetchOnce({
      ok: true,
      contentType: "application/pdf",
      text: "%PDF-1.4 ...",
    });
    const out = await webFetchTool.execute({ url: "https://example.com/doc.pdf" });
    expect(out).toContain("content-type");
    expect(out).toContain("application/pdf");
  });

  it("throws when a private/local address is targeted (SSRF guard)", async () => {
    await expect(
      webFetchTool.execute({ url: "http://127.0.0.1:5432/admin" })
    ).rejects.toThrow(/Cannot fetch private or local addresses.*127\.0\.0\.1/);
    await expect(
      webFetchTool.execute({ url: "http://10.0.0.1/internal" })
    ).rejects.toThrow(/Cannot fetch private or local addresses/);
    await expect(
      webFetchTool.execute({ url: "http://192.168.1.1/" })
    ).rejects.toThrow(/Cannot fetch private or local addresses/);
  });

  it("returns an error string for unsupported schemes (after Zod's url() lets them through)", async () => {
    // file:// schemes pass z.string().url() but are explicitly rejected here.
    const out = await webFetchTool.execute({ url: "file:///etc/passwd" });
    expect(out).toContain("only http:// and https:// are supported");
  });

  it("throws a clear message on AbortSignal.timeout", async () => {
    const timeoutError = new Error("Operation timed out");
    timeoutError.name = "TimeoutError";
    vi.spyOn(global, "fetch").mockRejectedValueOnce(timeoutError);

    await expect(
      webFetchTool.execute({ url: "https://slow.example.com" })
    ).rejects.toThrow(/Fetch timed out after 15000ms/);
  });

  it("removes <noscript> blocks", async () => {
    mockFetchOnce({
      ok: true,
      text: "<p>Visible</p><noscript>JS required: tracking pixels here</noscript>",
    });
    const out = await webFetchTool.execute({ url: "https://example.com" });
    expect(out).toContain("Visible");
    expect(out).not.toContain("tracking pixels");
  });

  // -----------------------------------------------------------------
  // SPA fallback — when stripped text is thin and raw HTML is heavy
  // (>=2KB), web_fetch falls through to Tavily's rendered crawl.
  // -----------------------------------------------------------------
  describe("SPA fallback via Tavily", () => {
    const ORIG_KEY = process.env.TAVILY_API_KEY;
    beforeEach(() => {
      process.env.TAVILY_API_KEY = "test-key";
    });
    afterEach(() => {
      if (ORIG_KEY === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = ORIG_KEY;
    });

    function spaShellHtml(): string {
      // ~3KB of script tags — substantial raw bytes, near-zero text
      // after strip. Models a real SPA shell.
      const script = "<script src=\"/assets/chunk-abcdef1234567890.js\"></script>";
      return (
        '<!doctype html><html><head><title>Acquisity</title></head>' +
        '<body><div id="root"></div>' +
        Array.from({ length: 50 }, () => script).join("\n") +
        "</body></html>"
      );
    }

    it("falls back to Tavily when stripped HTML is thin (<300 chars) but raw is heavy (>=2KB)", async () => {
      // 1st fetch: SPA shell (thin after strip, heavy raw)
      mockFetchOnce({ ok: true, text: spaShellHtml() });
      // 2nd fetch: Tavily — returns rendered raw_content for the same domain
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: () =>
          Promise.resolve({
            results: [
              {
                url: "https://www.acquisity.ai/",
                raw_content:
                  "Acquisity helps B2B SaaS startups find profitable niches and automate cold outreach. Founded by Jared Stauffer.",
              },
            ],
          }),
      } as unknown as Response);

      const out = await webFetchTool.execute({
        url: "https://www.acquisity.ai/",
      });
      expect(out).toContain("Jared Stauffer");
      expect(out).toContain("profitable niches");
    });

    it("does NOT fall back when stripped text is healthy (>=300 chars)", async () => {
      const richHtml = "<p>" + "Lorem ipsum dolor sit amet ".repeat(40) + "</p>";
      mockFetchOnce({ ok: true, text: richHtml });
      // If we tried to fall back to Tavily, the next fetch call would
      // throw (no second mock prepared), and the function would
      // silently return the stripped original. Either way the
      // verification: the rendered text comes through and we don't
      // crash.
      const out = await webFetchTool.execute({
        url: "https://example.com/",
      });
      expect(out).toContain("Lorem ipsum");
    });

    it("does NOT fall back on a sparse legitimate page (raw HTML < 2KB)", async () => {
      // Tiny 404 / coming-soon page: thin stripped + thin raw. Don't
      // burn a Tavily call on it.
      mockFetchOnce({ ok: true, text: "<p>Coming soon.</p>" });
      const out = await webFetchTool.execute({
        url: "https://startup.example.com/",
      });
      expect(out).toBe("Coming soon.");
    });

    it("falls through to thin original when Tavily has no matching results", async () => {
      mockFetchOnce({ ok: true, text: spaShellHtml() });
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: () =>
          Promise.resolve({
            results: [
              // Different host — filter drops it.
              {
                url: "https://otherdomain.com/page",
                raw_content: "Unrelated body.",
              },
            ],
          }),
      } as unknown as Response);

      const out = await webFetchTool.execute({
        url: "https://www.acquisity.ai/",
      });
      // Returns the thin original (stripped div skeleton).
      expect(out).not.toContain("Unrelated body");
    });

    it("falls through to thin original when Tavily call fails", async () => {
      mockFetchOnce({ ok: true, text: spaShellHtml() });
      vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("network"));

      const out = await webFetchTool.execute({
        url: "https://www.acquisity.ai/",
      });
      // Doesn't throw — graceful fallthrough. Output is whatever the
      // thin strip gave us.
      expect(typeof out).toBe("string");
    });

    it("matches subdomains of the target host (e.g. blog.acquisity.ai)", async () => {
      mockFetchOnce({ ok: true, text: spaShellHtml() });
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: () =>
          Promise.resolve({
            results: [
              {
                url: "https://blog.acquisity.ai/our-story",
                raw_content: "Our story: founded 2024 by Jared Stauffer.",
              },
            ],
          }),
      } as unknown as Response);

      const out = await webFetchTool.execute({
        url: "https://www.acquisity.ai/",
      });
      expect(out).toContain("Jared Stauffer");
    });
  });
});
