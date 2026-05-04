/**
 * Agent 3 — Personalisation & Outreach prompts.
 *
 * Source of truth: `.ai/docs/06-agent-system-design.md` §8.2 (system).
 *
 * No tools. Pure reasoning over the prior agents' structured outputs
 * (Reconnaissance brief + People decision-makers list).
 *
 * Voice rules per `.ai/design/brand-decision-2026-05.md` §11 — precise,
 * confident, quiet. Forbidden marketing phrases are listed inline so the
 * model sees them, AND a regex gate in agent-3-email.ts retries once if
 * the model emits them anyway.
 */
import type { PeopleOutputT, ReconnaissanceOutputT } from "../schemas";

export const EMAIL_SYSTEM = `You are a B2B outbound copywriter. Given a company brief and a list of decision
makers, draft ONE personalised cold email to the FIRST decision maker.

The email MUST:
- Open with a SPECIFIC observation from the company brief — not a generic compliment
- Have ONE clear ask (a 15-min call, a reply, a demo)
- Body ≤ 120 words
- Subject line ≤ 50 characters
- Sound like a human who did 5 minutes of research, not a templated blast

Forbidden language (these phrases will be rejected and the email regenerated):
- "I noticed your company is doing amazing things"
- "I've been following your journey"
- "Hope this email finds you well"
- Hyperbole or superlatives ("incredible", "amazing", "game-changing", "revolutionary")

Output a single JSON object. Do NOT wrap in markdown code fences. No prose
before or after.

{
  "to": { "name": string, "role": string },
  "subject": string,                  // 5-80 chars (target ≤50)
  "body": string,                     // 50-900 chars (target ≤120 words)
  "personalisation_hooks": string[],  // EXACTLY 5 alternate one-line opening hooks
  "tone": "cold" | "warm"
}`.trim();

/**
 * User prompt template. Receives both prior agents' structured outputs
 * as JSON. The agent reasons over them to identify the specific facts
 * worth opening on.
 */
export function emailUserPrompt(
  brief: ReconnaissanceOutputT,
  people: PeopleOutputT,
  tone: "cold" | "warm" = "cold"
): string {
  return `Company brief:
${JSON.stringify(brief, null, 2)}

Decision makers:
${JSON.stringify(people.decision_makers, null, 2)}

Buyer persona: ${people.buyer_persona}
Trigger events: ${JSON.stringify(people.trigger_events)}

Draft the email to the FIRST decision maker. Target tone: ${tone} (${
    tone === "cold"
      ? "we have not spoken before — short, specific, low-pressure"
      : "we have prior context — slightly warmer opener, still specific and low-pressure"
  }).

Return ONLY the JSON object. No prose, no code fences.`.trim();
}
