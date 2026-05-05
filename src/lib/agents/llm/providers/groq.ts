import "server-only";
import { generateText, tool, APICallError } from "ai";
import { createGroq } from "@ai-sdk/groq";
import type {
  ChatOptions,
  ChatResult,
  ChatToolCall,
  LLMProvider,
} from "../types";
import { toAISDKMessages, mapAISDKFinishReason } from "../utils/messages";

const GROQ_MODEL = "llama-3.3-70b-versatile";

/** Truncate the failed_generation snippet so a 30 KB tool_calls dump
 *  doesn't drown the server log on a bad day. */
const FAILED_GEN_LOG_CHARS = 1_000;

/**
 * Surface Groq's `failed_generation` field on `tool_use_failed` errors.
 *
 * Groq rejects tool calls server-side when Llama emits arguments that
 * don't match the function schema. The body includes a
 * `failed_generation` field with the broken payload — the Vercel AI SDK
 * exposes that body via `APICallError.responseBody`. We log a snippet
 * for diagnosis, then let chat.ts:isRetryable classify the error so
 * the chain falls through to Gemini.
 */
function annotateGroqError(err: unknown): unknown {
  if (!(err instanceof APICallError)) return err;
  if (err.statusCode !== 400) return err;
  const body = err.responseBody;
  if (!body || typeof body !== "string") return err;
  let parsed: { error?: { code?: unknown; failed_generation?: unknown } } | null = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    return err;
  }
  if (!parsed?.error || parsed.error.code !== "tool_use_failed") return err;
  const failedGeneration =
    typeof parsed.error.failed_generation === "string"
      ? parsed.error.failed_generation.slice(0, FAILED_GEN_LOG_CHARS)
      : "(no failed_generation field on response)";
  console.error(
    `[groq] tool_use_failed — Llama emitted an invalid tool call. ` +
    `failed_generation (truncated to ${FAILED_GEN_LOG_CHARS} chars):\n${failedGeneration}`
  );
  return err;
}

/**
 * Groq provider — primary in the locked chain.
 *
 * Migrated to the Vercel AI SDK (`@ai-sdk/groq`). Speed is what makes
 * the streaming UI feel instant; Llama-3.3-70B on Groq's LPUs serves
 * happy-path traffic at ~500 tok/s.
 */
export function createGroqProvider(): LLMProvider {
  const apiKey = process.env.GROQ_API_KEY;
  const provider = apiKey ? createGroq({ apiKey }) : null;

  return {
    name: "groq",
    isAvailable: () => Boolean(apiKey),
    async chat(opts: ChatOptions): Promise<ChatResult> {
      if (!provider) {
        throw new Error("Groq provider not configured (missing GROQ_API_KEY)");
      }

      const tools = opts.tools
        ? Object.fromEntries(
            opts.tools.map((t) => [
              t.name,
              tool({
                description: t.description,
                inputSchema: t.parameters,
                // No `execute` — the agent's tool-use loop runs the
                // tool itself so we keep our retries / cap / logging.
              }),
            ])
          )
        : undefined;

      let result;
      try {
        result = await generateText({
          model: provider(GROQ_MODEL),
          system: opts.system,
          messages: toAISDKMessages(opts.messages),
          tools,
          temperature: opts.temperature ?? 0.2,
          maxOutputTokens: opts.maxTokens ?? 2048,
          abortSignal: opts.abortSignal,
          providerOptions: opts.responseFormat === "json"
            ? { groq: { responseFormat: { type: "json_object" } } }
            : undefined,
        });
      } catch (err) {
        throw annotateGroqError(err);
      }

      const toolCalls: ChatToolCall[] = result.toolCalls.map((tc) => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: (tc.input ?? {}) as Record<string, unknown>,
      }));

      return {
        text: result.text,
        toolCalls,
        finishReason: mapAISDKFinishReason(result.finishReason),
        provider: "groq",
        tokensIn: result.usage?.inputTokens ?? 0,
        tokensOut: result.usage?.outputTokens ?? 0,
      };
    },
  };
}
