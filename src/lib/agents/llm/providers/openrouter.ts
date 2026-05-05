import "server-only";
import { generateText, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type {
  ChatOptions,
  ChatResult,
  ChatToolCall,
  LLMProvider,
} from "../types";
import { toAISDKMessages, mapAISDKFinishReason } from "../utils/messages";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

/**
 * OpenRouter provider — last-resort fallback when Groq + Gemini are
 * both degraded.
 *
 * Migrated to the Vercel AI SDK via `@ai-sdk/openai-compatible` —
 * OpenRouter speaks the OpenAI Chat Completions schema, so the
 * compatible adapter handles message + tool conversion for us. The
 * HTTP-Referer + X-Title headers OpenRouter uses for attribution are
 * forwarded via the `headers` option.
 *
 * Free tier is generous-but-variable, typically ~50 req/day; routes to
 * whichever community-hosted Llama 3.3 70B host is currently up.
 */
export function createOpenRouterProvider(): LLMProvider {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const provider = apiKey
    ? createOpenAICompatible({
        name: "openrouter",
        apiKey,
        baseURL: OPENROUTER_BASE_URL,
        headers: {
          "HTTP-Referer":
            process.env.NEXT_PUBLIC_APP_URL ??
            "https://outbound-lab-acquisity.vercel.app",
          "X-Title": "OutboundLab",
        },
      })
    : null;

  return {
    name: "openrouter",
    isAvailable: () => Boolean(apiKey),
    async chat(opts: ChatOptions): Promise<ChatResult> {
      if (!provider) {
        throw new Error(
          "OpenRouter provider not configured (missing OPENROUTER_API_KEY)"
        );
      }

      const tools = opts.tools
        ? Object.fromEntries(
            opts.tools.map((t) => [
              t.name,
              tool({
                description: t.description,
                inputSchema: t.parameters,
              }),
            ])
          )
        : undefined;

      const result = await generateText({
        model: provider(OPENROUTER_MODEL),
        system: opts.system,
        messages: toAISDKMessages(opts.messages),
        tools,
        temperature: opts.temperature ?? 0.2,
        maxOutputTokens: opts.maxTokens ?? 2048,
        abortSignal: opts.abortSignal,
        providerOptions: opts.responseFormat === "json"
          ? { openrouter: { responseFormat: { type: "json_object" } } }
          : undefined,
      });

      const toolCalls: ChatToolCall[] = result.toolCalls.map((tc) => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: (tc.input ?? {}) as Record<string, unknown>,
      }));

      return {
        text: result.text,
        toolCalls,
        finishReason: mapAISDKFinishReason(result.finishReason),
        provider: "openrouter",
        tokensIn: result.usage?.inputTokens ?? 0,
        tokensOut: result.usage?.outputTokens ?? 0,
      };
    },
  };
}
