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

      const response = await client.chat.completions.create(
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
