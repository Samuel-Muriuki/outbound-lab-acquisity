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
});
