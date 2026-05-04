/**
 * Zod schemas for the structured output of each agent.
 *
 * Single source of truth — both the agent's runtime validation and the
 * orchestrator's persistence path import from here. Drift between
 * "what the prompt requests" and "what we validate" is a bug class
 * this file is designed to prevent.
 *
 * Source of truth: `.ai/docs/06-agent-system-design.md` §6.1, §7.1, §8.1.
 */
import { z } from "zod";

/**
 * Agent 1 — Reconnaissance
 *
 * What does the company do? Who do they sell to? Recent signals.
 */
export const ReconnaissanceOutput = z.object({
  company_name: z
    .string()
    .min(1)
    .max(120)
    .describe("Their official name."),
  one_liner: z
    .string()
    .min(10)
    .max(140)
    .describe("≤140 chars: what they do in one sentence."),
  what_they_sell: z
    .string()
    .min(20)
    .max(400)
    .describe("≤400 chars: the product or service."),
  target_market: z
    .string()
    .min(20)
    .max(400)
    .describe("≤400 chars: their ICP."),
  company_size_estimate: z
    .string()
    .min(3)
    .max(60)
    .describe('e.g. "20-50 employees" or "Unknown".'),
  recent_signals: z
    .array(z.string().min(10).max(280))
    .max(3)
    .describe("0-3 newsworthy facts (funding, launches, hires)."),
  sources: z
    .array(z.string().url())
    .min(1)
    .max(8)
    .describe("URLs the agent actually used."),
});

export type ReconnaissanceOutputT = z.infer<typeof ReconnaissanceOutput>;
