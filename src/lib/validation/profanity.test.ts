import { describe, expect, it } from "vitest";
import { containsProfanity, BLOCKED_MESSAGE } from "./profanity";

describe("containsProfanity", () => {
  it.each([
    "acquisity.ai",
    "github.com",
    "vercel.com",
    "samuel-muriuki.vercel.app",
    "popcorn.com", // contains 'porn' as substring of 'popcorn' — must NOT match
    "scunthorpe-tile-co.com", // classic Scunthorpe-problem case
    "anthropic.com",
    "stripe.com",
    "groq.com",
  ])("allows the legitimate hostname %s", (host) => {
    expect(containsProfanity(host)).toBe(false);
  });

  it("returns boolean without throwing on empty/edge inputs", () => {
    expect(typeof containsProfanity("")).toBe("boolean");
    expect(typeof containsProfanity("a")).toBe("boolean");
  });

  it("normalises uppercase before matching", () => {
    // Acquisity in any case is allowed; this is purely a normalisation
    // guard — the matcher itself is case-insensitive after our toLower.
    expect(containsProfanity("ACQUISITY.COM")).toBe(false);
  });
});

describe("BLOCKED_MESSAGE", () => {
  it("is a non-empty user-facing string", () => {
    expect(BLOCKED_MESSAGE).toMatch(/.+/);
    expect(BLOCKED_MESSAGE.toLowerCase()).toContain("isn't allowed");
  });
});
