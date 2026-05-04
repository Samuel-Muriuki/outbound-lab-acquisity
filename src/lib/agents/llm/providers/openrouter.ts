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

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

/**
 * OpenRouter provider — last-resort fallback when Groq + Gemini are
 * both degraded.
 *
 * Routes to whichever free Llama 3.3 70B host is currently up (varies
 * — backed by community-hosted free inference endpoints). Free tier
 * is generous-but-variable, typically ~50 req/day.
 *
 * Same OpenAI-compatible API shape as Groq, so the implementation is
 * almost identical — different baseURL, different model id, plus the
 * HTTP-Referer + X-Title headers OpenRouter uses to attribute traffic
 * (visible to OpenRouter but not the upstream model host).
 */
export function createOpenRouterProvider(): LLMProvider {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const client = apiKey
    ? new OpenAI({
        apiKey,
        baseURL: OPENROUTER_BASE_URL,
        defaultHeaders: {
          "HTTP-Referer":
            process.env.NEXT_PUBLIC_APP_URL ?? "https://outbound-lab.vercel.app",
          "X-Title": "OutboundLab",
        },
      })
    : null;

  return {
    name: "openrouter",
    isAvailable: () => Boolean(apiKey),
    async chat(opts: ChatOptions): Promise<ChatResult> {
      if (!client)
        throw new Error(
          "OpenRouter provider not configured (missing OPENROUTER_API_KEY)"
        );

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
          model: OPENROUTER_MODEL,
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
            `OpenRouter returned a non-function tool call (${tc.type}); none of our tools register as anything else.`
          );
        }
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // Same as Groq — defensive against malformed model output.
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
        provider: "openrouter",
        tokensIn: response.usage?.prompt_tokens ?? 0,
        tokensOut: response.usage?.completion_tokens ?? 0,
      };
    },
  };
}
