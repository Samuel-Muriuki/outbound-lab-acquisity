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
});
