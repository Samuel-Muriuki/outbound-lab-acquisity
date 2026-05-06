/**
 * Unit tests for the chat() fallback chain.
 *
 * We swap the providers array (exported via __testOnly__) for fakes so
 * tests can assert that fallback / short-circuit behaviour matches the
 * locked product narrative — specifically that:
 *
 *  - Configured providers are tried in chain order
 *  - Unconfigured providers are skipped without raising
 *  - Retryable errors fall through to the next provider
 *  - Non-retryable errors short-circuit (no further fallback)
 *  - All-failed paths surface AllProvidersFailedError
 *  - onProviderUsed fires with the name of the provider that succeeded
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AllProvidersFailedError,
  __testOnly__,
  chat,
} from "./chat";
import type { LLMProvider, ChatOptions, ChatResult } from "./types";

const baseOpts: ChatOptions = {
  system: "system",
  messages: [{ role: "user", content: "hi" }],
};

function fakeProvider(
  name: LLMProvider["name"],
  behavior:
    | { kind: "ok"; result?: Partial<ChatResult> }
    | { kind: "throw"; error: Error }
    | { kind: "unavailable" }
): LLMProvider {
  return {
    name,
    isAvailable: () => behavior.kind !== "unavailable",
    chat: vi.fn(async (): Promise<ChatResult> => {
      if (behavior.kind === "unavailable")
        throw new Error("called when unavailable");
      if (behavior.kind === "throw") throw behavior.error;
      return {
        text: "ok",
        toolCalls: [],
        finishReason: "stop",
        provider: name,
        tokensIn: 0,
        tokensOut: 0,
        ...behavior.result,
      };
    }),
  };
}

let originalProviders: LLMProvider[];

beforeEach(() => {
  originalProviders = [...__testOnly__.providers];
});

afterEach(() => {
  __testOnly__.providers.splice(0, __testOnly__.providers.length, ...originalProviders);
});

function setProviders(...next: LLMProvider[]) {
  __testOnly__.providers.splice(0, __testOnly__.providers.length, ...next);
}

describe("chat() fallback chain", () => {
  it("returns the first available provider's result", async () => {
    const groq = fakeProvider("groq", { kind: "ok" });
    const gemini = fakeProvider("gemini", { kind: "ok" });
    setProviders(groq, gemini);

    const used: string[] = [];
    const result = await chat(baseOpts, (p) => used.push(p));

    expect(result.provider).toBe("groq");
    expect(used).toEqual(["groq"]);
    expect(gemini.chat).not.toHaveBeenCalled();
  });

  it("skips unconfigured providers without raising", async () => {
    const groq = fakeProvider("groq", { kind: "unavailable" });
    const gemini = fakeProvider("gemini", { kind: "ok" });
    setProviders(groq, gemini);

    const result = await chat(baseOpts);
    expect(result.provider).toBe("gemini");
  });

  it("falls through to the next provider on a retryable error", async () => {
    const rateLimited = Object.assign(new Error("Rate limit exceeded"), {
      status: 429,
    });
    const groq = fakeProvider("groq", { kind: "throw", error: rateLimited });
    const gemini = fakeProvider("gemini", { kind: "ok" });
    setProviders(groq, gemini);

    const result = await chat(baseOpts);
    expect(result.provider).toBe("gemini");
    expect(groq.chat).toHaveBeenCalledOnce();
    expect(gemini.chat).toHaveBeenCalledOnce();
  });

  it("falls through on a 5xx error", async () => {
    const serverError = Object.assign(new Error("Bad gateway"), { status: 502 });
    const groq = fakeProvider("groq", { kind: "throw", error: serverError });
    const gemini = fakeProvider("gemini", { kind: "ok" });
    setProviders(groq, gemini);

    const result = await chat(baseOpts);
    expect(result.provider).toBe("gemini");
  });

  it("short-circuits on a non-retryable error (e.g. 400 schema validation)", async () => {
    const schemaError = Object.assign(new Error("Bad request"), { status: 400 });
    const groq = fakeProvider("groq", { kind: "throw", error: schemaError });
    const gemini = fakeProvider("gemini", { kind: "ok" });
    setProviders(groq, gemini);

    await expect(chat(baseOpts)).rejects.toThrow("Bad request");
    expect(gemini.chat).not.toHaveBeenCalled();
  });

  it("falls through on Groq tool_use_failed (400 with code in body)", async () => {
    const toolUseFailed = Object.assign(
      new Error("Failed to call a function. Please adjust your prompt."),
      {
        status: 400,
        error: { code: "tool_use_failed", failed_generation: "<tool_call>...</tool_call>" },
      }
    );
    const groq = fakeProvider("groq", { kind: "throw", error: toolUseFailed });
    const gemini = fakeProvider("gemini", { kind: "ok" });
    setProviders(groq, gemini);

    const result = await chat(baseOpts);
    expect(result.provider).toBe("gemini");
    expect(groq.chat).toHaveBeenCalledOnce();
    expect(gemini.chat).toHaveBeenCalledOnce();
  });

  it("falls through on Groq tool_use_failed via message regex (no body code)", async () => {
    // Defensive: if the body isn't shaped as expected, the message regex
    // still classifies the error correctly.
    const toolUseFailed = Object.assign(
      new Error("400 Failed to call a function. Please adjust your prompt."),
      { status: 400 }
    );
    const groq = fakeProvider("groq", { kind: "throw", error: toolUseFailed });
    const gemini = fakeProvider("gemini", { kind: "ok" });
    setProviders(groq, gemini);

    const result = await chat(baseOpts);
    expect(result.provider).toBe("gemini");
  });

  it("short-circuits on AbortError", async () => {
    const abort = Object.assign(new Error("Aborted"), { name: "AbortError" });
    const groq = fakeProvider("groq", { kind: "throw", error: abort });
    const gemini = fakeProvider("gemini", { kind: "ok" });
    setProviders(groq, gemini);

    await expect(chat(baseOpts)).rejects.toThrow("Aborted");
    expect(gemini.chat).not.toHaveBeenCalled();
  });

  it("raises AllProvidersFailedError when every configured provider fails retryably", async () => {
    const rateLimit = Object.assign(new Error("rate limit"), { status: 429 });
    const groq = fakeProvider("groq", { kind: "throw", error: rateLimit });
    const gemini = fakeProvider("gemini", { kind: "throw", error: rateLimit });
    const openrouter = fakeProvider("openrouter", {
      kind: "throw",
      error: rateLimit,
    });
    setProviders(groq, gemini, openrouter);

    let captured: unknown = null;
    try {
      await chat(baseOpts);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(AllProvidersFailedError);
    const all = captured as AllProvidersFailedError;
    expect(all.errors).toHaveLength(3);
    expect(all.errors.map((e) => e.provider)).toEqual([
      "groq",
      "gemini",
      "openrouter",
    ]);
  });

  it("raises AllProvidersFailedError with empty trail when nothing is configured", async () => {
    const groq = fakeProvider("groq", { kind: "unavailable" });
    const gemini = fakeProvider("gemini", { kind: "unavailable" });
    setProviders(groq, gemini);

    await expect(chat(baseOpts)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it("falls through on AI_RetryError (AI SDK retry-exhaustion wrapper)", async () => {
    // Regression guard for the live 2026-05-06 bug: Groq returned 429s
    // until the AI SDK exhausted its internal retries, then threw an
    // AI_RetryError whose message ("Failed after 3 attempts. Last
    // error: Provider returned error") didn't match isRetryable's
    // keyword regex. Old chat() rethrew immediately and never tried
    // Gemini. The new logic recognises the name + unwraps status from
    // lastError.
    const inner429 = Object.assign(new Error("429 Too Many Requests"), {
      statusCode: 429,
    });
    const retryError = Object.assign(
      new Error("Failed after 3 attempts. Last error: Provider returned error"),
      {
        name: "AI_RetryError",
        lastError: inner429,
        errors: [inner429, inner429, inner429],
      }
    );
    const groq = fakeProvider("groq", { kind: "throw", error: retryError });
    const gemini = fakeProvider("gemini", { kind: "ok" });
    setProviders(groq, gemini);

    const result = await chat(baseOpts);
    expect(result.provider).toBe("gemini");
    expect(groq.chat).toHaveBeenCalledOnce();
    expect(gemini.chat).toHaveBeenCalledOnce();
  });

  it("AllProvidersFailedError message includes per-provider breakdown with statuses", async () => {
    const rate429 = Object.assign(new Error("rate limit exceeded"), {
      statusCode: 429,
    });
    const timeout = Object.assign(new Error("Connection timeout"), {
      statusCode: 504,
    });
    const groq = fakeProvider("groq", { kind: "throw", error: rate429 });
    const gemini = fakeProvider("gemini", { kind: "throw", error: timeout });
    setProviders(groq, gemini);

    let captured: unknown = null;
    try {
      await chat(baseOpts);
    } catch (err) {
      captured = err;
    }
    const error = captured as AllProvidersFailedError;
    expect(error).toBeInstanceOf(AllProvidersFailedError);
    expect(error.message).toContain("groq: 429 rate limit exceeded");
    expect(error.message).toContain("gemini: 504 Connection timeout");
  });

  it("honours an explicit providerOrder override (Agent 2's gemini-first policy)", async () => {
    // Agent 2 passes providerOrder: ["gemini", "groq", "openrouter"]
    // to load-split away from Groq. Confirm gemini is hit first.
    const groq = fakeProvider("groq", { kind: "ok" });
    const gemini = fakeProvider("gemini", { kind: "ok" });
    setProviders(groq, gemini);

    const result = await chat({
      ...baseOpts,
      providerOrder: ["gemini", "groq", "openrouter"],
    });
    expect(result.provider).toBe("gemini");
    expect(groq.chat).not.toHaveBeenCalled();
    expect(gemini.chat).toHaveBeenCalledOnce();
  });

  it("providerOrder override skips providers absent from the registry", async () => {
    const gemini = fakeProvider("gemini", { kind: "ok" });
    setProviders(gemini);

    // Caller asks for groq-first, but groq isn't registered → silently
    // dropped, gemini is used.
    const result = await chat({
      ...baseOpts,
      providerOrder: ["groq", "gemini"],
    });
    expect(result.provider).toBe("gemini");
  });

  it("providerOrder override falls through retryable errors in the overridden order", async () => {
    const rate429 = Object.assign(new Error("rate limit"), { status: 429 });
    const gemini = fakeProvider("gemini", { kind: "throw", error: rate429 });
    const groq = fakeProvider("groq", { kind: "ok" });
    setProviders(groq, gemini);

    const result = await chat({
      ...baseOpts,
      providerOrder: ["gemini", "groq"],
    });
    expect(result.provider).toBe("groq");
    expect(gemini.chat).toHaveBeenCalledOnce();
    expect(groq.chat).toHaveBeenCalledOnce();
  });

  it("AllProvidersFailedError unwraps an AI_RetryError to surface the underlying message", async () => {
    const inner429 = Object.assign(new Error("Too many requests"), {
      statusCode: 429,
    });
    const wrapped = Object.assign(
      new Error("Failed after 3 attempts. Last error: Provider returned error"),
      { name: "AI_RetryError", lastError: inner429, errors: [inner429] }
    );
    const groq = fakeProvider("groq", { kind: "throw", error: wrapped });
    const gemini = fakeProvider("gemini", { kind: "throw", error: wrapped });
    const openrouter = fakeProvider("openrouter", {
      kind: "throw",
      error: wrapped,
    });
    setProviders(groq, gemini, openrouter);

    let captured: unknown = null;
    try {
      await chat(baseOpts);
    } catch (err) {
      captured = err;
    }
    const error = captured as AllProvidersFailedError;
    // The message should show the underlying status + message, not the
    // generic "Provider returned error" wrapper.
    expect(error.message).toContain("429");
    expect(error.message).toContain("Too many requests");
    expect(error.message).not.toContain("Failed after 3 attempts");
  });
});
