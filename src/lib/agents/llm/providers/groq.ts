import "server-only";
import OpenAI from "openai";
import type {
  ChatOptions,
  ChatResult,
  ChatToolCall,
  LLMProvider,
} from "../types";
import { zodToOpenAISchema } from "../utils/zod-schema";
import { toOpenAIMessage, mapOpenAIFinishReason } from "../utils/messages";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GROQ_MODEL = "llama-3.3-70b-versatile";

/** Truncate the failed_generation snippet so a 30 KB tool_calls dump
 *  doesn't drown the server log on a bad day. */
const FAILED_GEN_LOG_CHARS = 1_000;

/**
 * Surface Groq's `failed_generation` field on `tool_use_failed` errors.
 *
 * Groq rejects tool calls server-side when Llama emits arguments that
 * don't match the function schema (e.g. wrong type, bad JSON, hallucinated
 * tool name). Their 400 response includes `error.failed_generation` with
 * the exact broken payload — invaluable for diagnosis. The OpenAI SDK
 * exposes the parsed body as `APIError.error`, so we read it here, log
 * the snippet, and re-throw with the original message preserved (so the
 * regex in chat.ts:isRetryable still matches and the chain falls through
 * to Gemini). Returns the input unchanged if it isn't a Groq tool-use
 * failure.
 */
function annotateGroqError(err: unknown): unknown {
  if (!(err instanceof OpenAI.APIError)) return err;
  if (err.status !== 400) return err;
  const body = err.error as { code?: unknown; failed_generation?: unknown } | null | undefined;
  if (!body || body.code !== "tool_use_failed") return err;
  const failedGeneration = typeof body.failed_generation === "string"
    ? body.failed_generation.slice(0, FAILED_GEN_LOG_CHARS)
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
 * Why first: ~500 tok/s on Llama 3.3 70B Versatile, native function
 * calling, generous free tier (14,400 req/day). Speed is what makes the
 * streaming UI feel instant, which is the whole point of putting Groq
 * before Gemini.
 *
 * Uses the openai npm SDK with a custom baseURL — Groq exposes an
 * OpenAI-compatible Chat Completions API.
 */
export function createGroqProvider(): LLMProvider {
  const apiKey = process.env.GROQ_API_KEY;
  const client = apiKey
    ? new OpenAI({ apiKey, baseURL: GROQ_BASE_URL })
    : null;

  return {
    name: "groq",
    isAvailable: () => Boolean(apiKey),
    async chat(opts: ChatOptions): Promise<ChatResult> {
      if (!client) throw new Error("Groq provider not configured (missing GROQ_API_KEY)");

      const tools = opts.tools?.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: zodToOpenAISchema(t.parameters),
        },
      }));

      let response;
      try {
        response = await client.chat.completions.create(
          {
            model: GROQ_MODEL,
            messages: [
              { role: "system", content: opts.system },
              ...opts.messages.map(toOpenAIMessage),
            ],
            tools,
            temperature: opts.temperature ?? 0.2,
            max_tokens: opts.maxTokens ?? 2048,
            response_format:
              opts.responseFormat === "json"
                ? { type: "json_object" }
                : undefined,
          },
          { signal: opts.abortSignal }
        );
      } catch (err) {
        throw annotateGroqError(err);
      }

      const choice = response.choices[0];
      const rawToolCalls = choice?.message?.tool_calls ?? [];
      const toolCalls: ChatToolCall[] = rawToolCalls.map((tc) => {
        if (tc.type !== "function") {
          throw new Error(
            `Groq returned a non-function tool call (${tc.type}); none of our tools register as anything else.`
          );
        }
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // Model emitted malformed JSON; surface empty args and let the
          // tool's Zod parse raise a structured error downstream.
        }
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: parsed,
        };
      });

      return {
        text: choice?.message?.content ?? "",
        toolCalls,
        finishReason: mapOpenAIFinishReason(choice?.finish_reason),
        provider: "groq",
        tokensIn: response.usage?.prompt_tokens ?? 0,
        tokensOut: response.usage?.completion_tokens ?? 0,
      };
    },
  };
}
