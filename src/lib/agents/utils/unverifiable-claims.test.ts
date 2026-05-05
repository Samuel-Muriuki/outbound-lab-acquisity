/**
 * Unit tests for the anti-hallucination unverifiable-claims gate.
 *
 * Each pattern gets a positive (catches the fabrication) and a
 * negative (doesn't fire on legitimate text) case. The whole point
 * of this gate is to err on the side of false-positives — so the
 * negatives mostly check "obviously unrelated" rather than "borderline".
 */
import { describe, expect, it } from "vitest";
import {
  findUnverifiableClaim,
  __testOnly__,
} from "./unverifiable-claims";

describe("findUnverifiableClaim()", () => {
  describe("multi-digit percentage", () => {
    it("catches 612% — the live regression", () => {
      const hit = findUnverifiableClaim(
        "Acquisity achieved 612% growth in 5 months"
      );
      expect(hit?.reason).toMatch(/percentage/);
      expect(hit?.match).toContain("612");
    });

    it("catches 30% YoY", () => {
      expect(
        findUnverifiableClaim("They posted 30% YoY revenue growth.")?.match
      ).toContain("30");
    });

    it("catches a percentage with spaced %", () => {
      expect(findUnverifiableClaim("up 50 % last quarter")).not.toBeNull();
    });

    it("does NOT catch a single-digit percentage", () => {
      // Less likely to be invented; many legitimate uses (e.g. tax rates).
      expect(findUnverifiableClaim("their 5% revenue lift")).toBeNull();
    });

    it("does NOT match a non-% number", () => {
      expect(findUnverifiableClaim("a 15-min call this week")).toBeNull();
    });
  });

  describe("monetary figures", () => {
    it("catches '$50M raised'", () => {
      expect(findUnverifiableClaim("raised $50M last year")).not.toBeNull();
    });

    it("catches '$1.2B valuation'", () => {
      expect(findUnverifiableClaim("their $1.2B valuation")).not.toBeNull();
    });

    it("catches '$10K MRR'", () => {
      expect(findUnverifiableClaim("$10K MRR within 6 months")).not.toBeNull();
    });

    it("does NOT match a single-digit dollar figure like '$5'", () => {
      expect(findUnverifiableClaim("a $5 product")).toBeNull();
    });
  });

  describe("funding rounds", () => {
    it("catches 'Series A' through 'Series K'", () => {
      expect(findUnverifiableClaim("post-Series A startup")).not.toBeNull();
      expect(findUnverifiableClaim("their Series C round")).not.toBeNull();
    });

    it("does NOT match unrelated 'Series' usage", () => {
      expect(findUnverifiableClaim("a series of products")).toBeNull();
      expect(findUnverifiableClaim("Series 2024 launch")).toBeNull();
    });
  });

  describe("fundraising verb claims", () => {
    it("catches 'raised $X', 'secured $X', 'closed $X'", () => {
      expect(findUnverifiableClaim("they raised $20M")).not.toBeNull();
      expect(findUnverifiableClaim("recently secured $50K")).not.toBeNull();
      expect(findUnverifiableClaim("just closed $1M")).not.toBeNull();
    });
  });

  describe("multiplier claims", () => {
    it("catches '10x growth', '50x return'", () => {
      expect(findUnverifiableClaim("delivered 10x growth")).not.toBeNull();
      expect(findUnverifiableClaim("a 50x return")).not.toBeNull();
    });

    it("does NOT match 'x' in plain text without multiplier context", () => {
      expect(findUnverifiableClaim("the x-axis was logarithmic")).toBeNull();
    });
  });

  it("returns null on a clean opener with no specific numbers", () => {
    const clean =
      "Saw Acquisity is building an AI-powered B2B client acquisition system. " +
      "Curious about your approach — would love a 15-min call this week.";
    expect(findUnverifiableClaim(clean)).toBeNull();
  });

  it("UNVERIFIABLE_PATTERNS table has the 5 documented patterns", () => {
    expect(__testOnly__.UNVERIFIABLE_PATTERNS).toHaveLength(5);
  });
});
