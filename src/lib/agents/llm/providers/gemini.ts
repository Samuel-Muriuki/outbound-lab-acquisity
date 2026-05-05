import "server-only";
import { generateText, tool } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type {
  ChatOptions,
  ChatResult,
  ChatToolCall,
  LLMProvider,
} from "../types";
import { toAISDKMessages, mapAISDKFinishReason } from "../utils/messages";

const GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Gemini provider — fallback when Groq rate-limits or is degraded.
 *
 * Migrated to the Vercel AI SDK (`@ai-sdk/google`). Different
 * infrastructure (Google) so it doesn't share Groq's rate limits. Free
 * tier: 1,500 req/day on gemini-2.5-flash.
 */
export function createGeminiProvider(): LLMProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  // The AI SDK reads GOOGLE_GENERATIVE_AI_API_KEY by default. Map our
  // GEMINI_API_KEY env name onto that explicit factory call so we
  // don't have to rename the env var across the deployed environments.
  const provider = apiKey ? createGoogleGenerativeAI({ apiKey }) : null;

  return {
    name: "gemini",
    isAvailable: () => Boolean(apiKey),
    async chat(opts: ChatOptions): Promise<ChatResult> {
      if (!provider) {
        throw new Error(
          "Gemini provider not configured (missing GEMINI_API_KEY)"
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
        model: provider(GEMINI_MODEL),
        system: opts.system,
        messages: toAISDKMessages(opts.messages),
        tools,
        temperature: opts.temperature ?? 0.2,
        maxOutputTokens: opts.maxTokens ?? 2048,
        abortSignal: opts.abortSignal,
        // Gemini exposes `responseMimeType` via providerOptions for JSON.
        providerOptions: opts.responseFormat === "json"
          ? { google: { responseMimeType: "application/json" } }
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
        provider: "gemini",
        tokensIn: result.usage?.inputTokens ?? 0,
        tokensOut: result.usage?.outputTokens ?? 0,
      };
    },
  };
}
