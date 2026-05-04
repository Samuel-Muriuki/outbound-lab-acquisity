import "server-only";
import {
  GoogleGenerativeAI,
  type Content,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type Tool,
} from "@google/generative-ai";
import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  ChatToolCall,
  LLMProvider,
} from "../types";
import { zodToGeminiSchema } from "../utils/zod-schema";

const GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Gemini provider — fallback when Groq rate-limits or is degraded.
 *
 * Different infrastructure (Google) so it doesn't share Groq's rate
 * limits. Free tier: 1,500 req/day on gemini-2.5-flash, plus unlimited
 * embeddings via text-embedding-004 (used in Phase 2 cache).
 *
 * Uses @google/generative-ai SDK directly (different schema language
 * than OpenAI; can't share the openai package).
 */
export function createGeminiProvider(): LLMProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

  return {
    name: "gemini",
    isAvailable: () => Boolean(apiKey),
    async chat(opts: ChatOptions): Promise<ChatResult> {
      if (!genAI)
        throw new Error("Gemini provider not configured (missing GEMINI_API_KEY)");

      const tools: Tool[] = opts.tools
        ? [
            {
              functionDeclarations: opts.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: zodToGeminiSchema(
                  t.parameters
                ) as FunctionDeclarationSchema,
              })) satisfies FunctionDeclaration[],
            },
          ]
        : [];

      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: opts.system,
        tools,
        generationConfig: {
          temperature: opts.temperature ?? 0.2,
          maxOutputTokens: opts.maxTokens ?? 2048,
          responseMimeType:
            opts.responseFormat === "json"
              ? "application/json"
              : "text/plain",
        },
      });

      const result = await model.generateContent({
        contents: opts.messages
          .filter((m) => m.role !== "system")
          .map(toGeminiContent),
      });

      const response = result.response;
      const text = response.text();
      const fnCalls = response.functionCalls() ?? [];

      const toolCalls: ChatToolCall[] = fnCalls.map((fc, i) => ({
        id: `gemini-tool-${i}`,
        name: fc.name,
        arguments: (fc.args ?? {}) as Record<string, unknown>,
      }));

      return {
        text,
        toolCalls,
        finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
        provider: "gemini",
        tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
        tokensOut: response.usageMetadata?.candidatesTokenCount ?? 0,
      };
    },
  };
}

/**
 * Convert our internal ChatMessage to Gemini's Content shape.
 * Gemini uses `user` and `model` roles only — assistant maps to model.
 * Tool messages go in as `function`-role parts.
 */
function toGeminiContent(message: ChatMessage): Content {
  if (message.role === "tool") {
    if (!message.tool_call_id) {
      throw new Error("Tool message must include tool_call_id");
    }
    return {
      role: "function",
      parts: [
        {
          functionResponse: {
            // Gemini binds responses by name, not id; the orchestrator
            // tracks which call this is via tool_call_id.
            name: message.tool_call_id,
            response: { content: message.content },
          },
        },
      ],
    };
  }
  if (message.role === "assistant") {
    const parts: Content["parts"] = [];
    if (message.content) parts.push({ text: message.content });
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.name,
            args: tc.arguments,
          },
        });
      }
    }
    return { role: "model", parts };
  }
  // user
  return { role: "user", parts: [{ text: message.content }] };
}
