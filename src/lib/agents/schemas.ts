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

/**
 * Agent 2 — People & ICP
 *
 * Up to 3 decision makers + buyer persona + trigger events.
 * Post-validated by validateDecisionMakers() in agent-2-people.ts —
 * each name must appear in its cited source_url or it gets dropped.
 */
export const DecisionMaker = z.object({
  name: z.string().min(2).max(80),
  role: z.string().min(2).max(120),
  why_them: z
    .string()
    .min(10)
    .max(280)
    .describe("≤280 chars: why outbound matters to this person."),
  source_url: z
    .string()
    .url()
    .describe("Valid URL where you verified the name."),
  linkedin_url: z.string().url().nullable(),
});
export type DecisionMakerT = z.infer<typeof DecisionMaker>;

export const PeopleOutput = z.object({
  decision_makers: z.array(DecisionMaker).min(0).max(3),
  buyer_persona: z
    .string()
    .min(10)
    .max(400)
    .describe("≤400 chars: who would buy this."),
  trigger_events: z
    .array(z.string().min(10).max(280))
    .max(3)
    .describe("0-3 recent hiring/funding/launch signals worth opening with."),
});
export type PeopleOutputT = z.infer<typeof PeopleOutput>;

/**
 * Agent 3 — Personalisation & Outreach
 *
 * The deliverable: one cold email to the first decision maker plus
 * five alternate personalisation hooks. No tools — pure reasoning over
 * Agent 1 + Agent 2's outputs. Temperature 0.7 (vs 0.2 for the
 * factual agents).
 *
 * Post-validated by isEmailAcceptable() in agent-3-email.ts — if the
 * model leaks any of the forbidden marketing phrases ("hope this email
 * finds you well", "amazing", "game-changing", etc.) the run is retried
 * once and then marked degraded.
 */
export const EmailOutput = z.object({
  to: z.object({
    name: z.string().min(2).max(80),
    role: z.string().min(2).max(120),
  }),
  subject: z
    .string()
    .min(5)
    .max(80)
    .describe("≤80 chars; the prompt instructs ≤50 — Zod is the soft cap."),
  body: z
    .string()
    .min(50)
    .max(900)
    .describe("≤900 chars; the prompt instructs ≤120 words."),
  personalisation_hooks: z
    .array(z.string().min(10).max(200))
    .length(5)
    .describe("Exactly 5 alternate one-line opening hooks for variation."),
  tone: z.enum(["cold", "warm"]),
});
export type EmailOutputT = z.infer<typeof EmailOutput>;
