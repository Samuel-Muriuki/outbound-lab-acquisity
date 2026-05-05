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
 *
 * Channel branching:
 *  - email     → standard subject + body
 *  - linkedin  → no subject (set to null), body ≤ ~80 words, slightly more casual opener
 *  - x         → no subject (set to null), body ≤ 280 chars, public-tone (assume the recipient has many followers)
 */
import type {
  OutreachChannelT,
  PeopleOutputT,
  ReconnaissanceOutputT,
} from "../schemas";

export const EMAIL_SYSTEM = `You are a B2B outbound copywriter. Given a company brief and a list of decision
makers, draft ONE personalised message to the FIRST decision maker.

The message MUST:
- Open with a SPECIFIC observation from the company brief — not a generic compliment
- Have ONE clear ask (a 15-min call, a reply, a demo)
- Sound like a human who did 5 minutes of research, not a templated blast

The 'channel' field of the input dictates length and shape:
- channel="email": include a subject line ≤ 50 characters; body ≤ 120 words
- channel="linkedin": subject MUST be null; body ≤ 80 words; slightly warmer opener (LinkedIn DMs feel less formal than email)
- channel="x": subject MUST be null; body ≤ 280 characters total — this is a public-platform DM constraint, treat it as hard

Forbidden language (these phrases will be rejected and the message regenerated):
- "I noticed your company is doing amazing things"
- "I've been following your journey"
- "Hope this email finds you well"
- Hyperbole or superlatives ("incredible", "amazing", "game-changing", "revolutionary")

Output a single JSON object. Do NOT wrap in markdown code fences. No prose
before or after.

{
  "to": { "name": string, "role": string },
  "subject": string | null,           // 5-80 chars on email; null on linkedin / x
  "body": string,                     // 50-900 chars; per-channel cap above
  "personalisation_hooks": string[],  // EXACTLY 5 alternate one-line opening hooks
  "tone": "cold" | "warm",
  "channel": "email" | "linkedin" | "x"
}`.trim();

/**
 * User prompt template. Receives both prior agents' structured outputs
 * as JSON. The agent reasons over them to identify the specific facts
 * worth opening on.
 */
export function emailUserPrompt(
  brief: ReconnaissanceOutputT,
  people: PeopleOutputT,
  tone: "cold" | "warm" = "cold",
  channel: OutreachChannelT = "email"
): string {
  const channelGuidance = (() => {
    switch (channel) {
      case "email":
        return "Write a cold email. Include a subject line ≤ 50 characters. Body ≤ 120 words.";
      case "linkedin":
        return "Write a LinkedIn DM. The 'subject' field MUST be null. Body ≤ 80 words. Slightly warmer than email — LinkedIn is less formal.";
      case "x":
        return "Write an X (formerly Twitter) DM. The 'subject' field MUST be null. Body ≤ 280 characters TOTAL. This is a hard cap — count carefully.";
    }
  })();

  return `Company brief:
${JSON.stringify(brief, null, 2)}

Decision makers:
${JSON.stringify(people.decision_makers, null, 2)}

Buyer persona: ${people.buyer_persona}
Trigger events: ${JSON.stringify(people.trigger_events)}

Channel: ${channel}
${channelGuidance}

Target tone: ${tone} (${
    tone === "cold"
      ? "we have not spoken before — short, specific, low-pressure"
      : "we have prior context — slightly warmer opener, still specific and low-pressure"
  }).

Set "channel" in the output to exactly "${channel}".

Return ONLY the JSON object. No prose, no code fences.`.trim();
}
