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
 * Resolve the provider chain for a single chat() call. With no
 * override, returns the global registry in its locked order
 * (groq → gemini → openrouter). With an override (e.g. Agent 2
 * passing [gemini, groq, openrouter] to load-split away from
 * Groq's TPM ceiling), returns the registered providers in the
 * caller-specified order. Names absent from the registry are
 * silently dropped.
 */
function resolveChain(
  order: ReadonlyArray<ProviderName> | undefined
): LLMProvider[] {
  if (!order || order.length === 0) return providers;
  const byName = new Map(providers.map((p) => [p.name, p]));
  const chain: LLMProvider[] = [];
  for (const name of order) {
    const p = byName.get(name);
    if (p) chain.push(p);
  }
  return chain;
}

/**
 * All providers raised — agents should surface a graceful "demo capacity
 * reached" rather than a cryptic stack trace. Message includes the full
 * per-provider breakdown so the operator can immediately see which
 * provider failed how (e.g. "groq: 429 rate-limited; gemini: timeout;
 * openrouter: 401 invalid key") rather than just the last one.
 */
export class AllProvidersFailedError extends Error {
  readonly errors: ReadonlyArray<{ provider: ProviderName; error: Error }>;

  constructor(errors: ReadonlyArray<{ provider: ProviderName; error: Error }>) {
    const breakdown = errors
      .map(({ provider, error }) => {
        const status = getStatus(error);
        const statusPart = typeof status === "number" ? `${status} ` : "";
        return `${provider}: ${statusPart}${unwrapErrorMessage(error)}`;
      })
      .join("; ");
    super(
      `All ${errors.length} LLM providers failed. ${breakdown || "(no providers configured)"}`
    );
    this.name = "AllProvidersFailedError";
    this.errors = errors;
  }
}

const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Pull the HTTP status off an error — handles three shapes:
 *  1. AI SDK `APICallError` — `statusCode` on the error itself
 *  2. Hand-crafted test errors — `status` on the error itself
 *  3. AI SDK `AI_RetryError` — wraps a list; recurse into `lastError`
 *     so the underlying 429 is still detectable.
 */
function getStatus(err: unknown): number | undefined {
  if (!(err instanceof Error)) return undefined;
  const e = err as {
    status?: unknown;
    statusCode?: unknown;
    lastError?: unknown;
  };
  if (typeof e.statusCode === "number") return e.statusCode;
  if (typeof e.status === "number") return e.status;
  // Unwrap RetryError → its lastError typically carries the real status.
  if (e.lastError) return getStatus(e.lastError);
  return undefined;
}

/**
 * Returns the error name when it's set (catches `AI_RetryError` and
 * other tagged AI SDK errors).
 */
function getErrorName(err: unknown): string {
  if (err instanceof Error) return err.name;
  return "";
}

/**
 * Unwrap an error's message — when an `AI_RetryError` wraps a per-call
 * failure, the wrapper message is generic ("Failed after 3 attempts.
 * Last error: Provider returned error") and the actually-useful message
 * is on `lastError`. Surface that instead so the operator sees the
 * underlying 429 or quota line.
 */
function unwrapErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as { lastError?: unknown };
  if (e.lastError instanceof Error && e.lastError.message) {
    return e.lastError.message;
  }
  return err.message;
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
  // AI SDK exhaustion wrapper — almost always wraps a transient
  // upstream failure (429, network blip, timeout) that the SDK already
  // retried 2-3 times. Treat as retryable so we fall through to the
  // next provider rather than dead-ending. Underlying status (if any)
  // is also unwrapped via getStatus() above for the explicit check.
  const name = getErrorName(err);
  if (name === "AI_RetryError") return true;
  const status = getStatus(err);
  if (typeof status === "number" && RETRYABLE_HTTP_STATUS.has(status)) {
    return true;
  }
  if (isToolUseFailed(err)) return true;
  // Unwrap once for the message regex too — RetryError.message is
  // generic ("Failed after 3 attempts. Last error: …") so we want to
  // grep the underlying message instead.
  const message = unwrapErrorMessage(err);
  return /rate.?limit|quota|exhaust|unavail|timeout|fetch failed|ECONNRESET|ETIMEDOUT|Provider returned error/i.test(
    message
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

  // Resolve the provider chain for this call. If the caller gave an
  // explicit providerOrder, honour it (skipping any names that aren't
  // in the global registry); otherwise fall back to the locked
  // default [groq, gemini, openrouter].
  const chain = resolveChain(opts.providerOrder);

  for (const provider of chain) {
    if (!provider.isAvailable()) continue;

    try {
      const result = await provider.chat(opts);
      onProviderUsed?.(provider.name);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      errors.push({ provider: provider.name, error });

      const status = getStatus(error);
      const name = getErrorName(error);
      const unwrapped = unwrapErrorMessage(error);
      const retryable = isRetryable(err);

      // Structured per-provider log line — gives the operator a clear
      // record of WHY each fallthrough happened. Always logs (warn
      // for retryable, error for non-retryable) so production logs
      // capture the full chain rather than just the surfaced error.
      const tag = retryable ? "warn" : "error";
      const log = retryable ? console.warn : console.error;
      log(
        `[chat] ${tag} provider=${provider.name} retryable=${retryable} ` +
          `name=${name || "Error"} status=${status ?? "n/a"} message="${unwrapped}"`
      );

      if (!retryable) {
        // Non-retryable — surface immediately, don't waste fallback budget
        // on bugs (e.g. malformed schemas, abort signals).
        throw error;
      }
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
