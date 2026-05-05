import "server-only";
import { createGroqProvider } from "./providers/groq";
import { createGeminiProvider } from "./providers/gemini";
import { createOpenRouterProvider } from "./providers/openrouter";
import type {
  ChatOptions,
  ChatResult,
  LLMProvider,
  ProviderName,
} from "./types";

/**
 * Locked provider order: Groq → Gemini → OpenRouter.
 *
 * Do NOT reorder. Speed (Groq) is part of the product narrative; the
 * streaming UI feel depends on Llama-3.3-70b on Groq's LPUs serving
 * happy-path traffic. Gemini exists to absorb Groq rate-limits without
 * changing inference quality. OpenRouter is a last-resort safety net.
 *
 * `.ai/docs/06-agent-system-design.md` §1 documents the rationale.
 */
const providers: LLMProvider[] = [
  createGroqProvider(),
  createGeminiProvider(),
  createOpenRouterProvider(),
];

/**
 * All three providers raised — agents should surface a graceful "demo
 * capacity reached" rather than a cryptic stack trace.
 */
export class AllProvidersFailedError extends Error {
  readonly errors: ReadonlyArray<{ provider: ProviderName; error: Error }>;

  constructor(errors: ReadonlyArray<{ provider: ProviderName; error: Error }>) {
    const last = errors[errors.length - 1];
    super(
      `All ${errors.length} LLM providers failed.${
        last ? ` Last error from ${last.provider}: ${last.error.message}` : ""
      }`
    );
    this.name = "AllProvidersFailedError";
    this.errors = errors;
  }
}

const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Pull the HTTP status off an error regardless of whether it came from
 * the AI SDK (`statusCode`) or a hand-crafted error in tests (`status`).
 */
function getStatus(err: unknown): number | undefined {
  if (!(err instanceof Error)) return undefined;
  const e = err as { status?: unknown; statusCode?: unknown };
  if (typeof e.statusCode === "number") return e.statusCode;
  if (typeof e.status === "number") return e.status;
  return undefined;
}

/**
 * Groq's `tool_use_failed` (HTTP 400) means Llama emitted a tool call
 * Groq's own validator rejected. It's non-deterministic — Gemini handles
 * tool calls differently and usually succeeds on the same prompt — so
 * treat it as retryable to fall through the provider chain rather than
 * surfacing a 400 to the user.
 *
 * Inspects both shapes:
 *  - AI SDK `APICallError`: body is a JSON string on `responseBody`
 *  - Fake / hand-crafted (test) errors: parsed body on `error`
 */
function isToolUseFailed(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (getStatus(err) !== 400) return false;
  const e = err as { error?: { code?: unknown }; responseBody?: unknown };
  if (e.error && e.error.code === "tool_use_failed") return true;
  if (typeof e.responseBody === "string") {
    try {
      const parsed = JSON.parse(e.responseBody) as {
        error?: { code?: unknown };
      };
      if (parsed.error?.code === "tool_use_failed") return true;
    } catch {
      // fall through to message regex
    }
  }
  return /failed to call a function/i.test(err.message);
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;
  const status = getStatus(err);
  if (typeof status === "number" && RETRYABLE_HTTP_STATUS.has(status)) {
    return true;
  }
  if (isToolUseFailed(err)) return true;
  return /rate.?limit|quota|exhaust|unavail|timeout|fetch failed|ECONNRESET|ETIMEDOUT/i.test(
    err.message
  );
}

/**
 * Single entry point every agent uses. Tries Groq, falls through to
 * Gemini, falls through to OpenRouter. Skips providers whose API key
 * isn't configured. Raises AllProvidersFailedError only if every
 * configured provider raised a retryable error or there were none
 * configured at all.
 *
 * Non-retryable errors (auth, schema validation, abort) short-circuit
 * the chain — those are caller bugs, not transient infra issues.
 */
export async function chat(
  opts: ChatOptions,
  onProviderUsed?: (provider: ProviderName) => void
): Promise<ChatResult> {
  const errors: { provider: ProviderName; error: Error }[] = [];

  for (const provider of providers) {
    if (!provider.isAvailable()) continue;

    try {
      const result = await provider.chat(opts);
      onProviderUsed?.(provider.name);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      errors.push({ provider: provider.name, error });

      if (!isRetryable(err)) {
        // Non-retryable — surface immediately, don't waste fallback budget
        // on bugs (e.g. malformed schemas, abort signals).
        throw error;
      }
      console.warn(
        `[chat] ${provider.name} retryable error, falling through:`,
        error.message
      );
    }
  }

  throw new AllProvidersFailedError(errors);
}

/**
 * Boot-time provider availability check. Prints a single line at server
 * startup like:
 *   [OutboundLab] LLM providers: groq: ✓  gemini: ✓  openrouter: —
 *
 * Throws if no provider is configured at all — better to fail at boot
 * than to ship a build that 500s on every research request.
 */
export function logProviderStatus(): void {
  const status = providers
    .map((p) => `${p.name}: ${p.isAvailable() ? "✓" : "—"}`)
    .join("  ");
  console.info(`[OutboundLab] LLM providers: ${status}`);

  if (!providers.some((p) => p.isAvailable())) {
    throw new Error(
      "No LLM providers configured. Set GROQ_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY in .env.local."
    );
  }
}

/**
 * Test-only export. Not part of the public surface; agents should NOT
 * use this — they should call chat().
 */
export const __testOnly__ = { providers };
